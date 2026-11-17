//! Bounded retry of the explicitly selected device after an established call fails.
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use voxy_voice::call::CallConfig;

pub(crate) fn silence_failed_device(
    state: &mut voxy_core::ipc::State,
    control: &voxy_voice::control::VoiceControl,
    generation: u64,
) {
    state.muted = true;
    state.microphone_ready = false;
    state.input_level = 0.0;
    control.muted.store(true, Ordering::Release);
    control.level_bits.store(0, Ordering::Relaxed);
    control.prepare_audio_generation(generation, control.ptt.load(Ordering::Acquire));
}

pub(crate) struct AudioRecovery {
    config: CallConfig,
    attempts: u8,
    next: Option<Instant>,
}
impl AudioRecovery {
    pub(crate) fn new(config: CallConfig, now: Instant) -> Self {
        Self {
            config,
            attempts: 0,
            next: Some(now + Duration::from_secs(2)),
        }
    }
    pub(crate) fn take_attempt(&mut self, now: Instant) -> Option<CallConfig> {
        if self.next.is_some_and(|next| now >= next) && self.attempts < 3 {
            self.next = None;
            self.attempts += 1;
            Some(self.config.clone())
        } else {
            None
        }
    }
    /// Schedule another attempt only after a failure/timeout result, at most three.
    /// A blocked OS call may outlive its timeout; generation checks reject it later.
    pub(crate) fn failed(&mut self, now: Instant) -> bool {
        if self.attempts >= 3 {
            return false;
        }
        self.next = Some(now + Duration::from_secs(2 << self.attempts));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn device_failure_closes_transmit_gate_preserves_deafen_and_requires_explicit_unmute() {
        let control = voxy_voice::control::VoiceControl::default();
        let mut state = voxy_core::ipc::State {
            deafened: true,
            microphone_ready: true,
            input_level: 0.8,
            ..Default::default()
        };
        assert!(control.may_transmit());
        silence_failed_device(&mut state, &control, 1);
        assert!(state.muted && state.deafened);
        assert!(!state.microphone_ready);
        assert_eq!(state.input_level, 0.0);
        assert!(!control.may_transmit());
        // Even an explicit unmute cannot reopen a cancelled audio generation.
        control.muted.store(false, Ordering::Release);
        assert!(!control.may_transmit());
        assert_eq!(control.audio_generation(), 1);
    }
    #[test]
    fn retries_preserve_device_selection_serialize_opens_and_exhaust() {
        let now = Instant::now();
        let mut recovery = AudioRecovery::new(
            CallConfig {
                input: "Selected mic".into(),
                output: "Selected output".into(),
                ..Default::default()
            },
            now,
        );
        assert!(
            recovery
                .take_attempt(now + Duration::from_secs(1))
                .is_none()
        );
        let config = recovery.take_attempt(now + Duration::from_secs(2)).unwrap();
        assert_eq!(config.input, "Selected mic");
        assert_eq!(config.output, "Selected output");
        assert!(
            recovery
                .take_attempt(now + Duration::from_secs(100))
                .is_none()
        );
        assert!(recovery.failed(now + Duration::from_secs(3)));
        assert!(
            recovery
                .take_attempt(now + Duration::from_secs(6))
                .is_none()
        );
        assert!(
            recovery
                .take_attempt(now + Duration::from_secs(7))
                .is_some()
        );
        assert!(recovery.failed(now + Duration::from_secs(8)));
        assert!(
            recovery
                .take_attempt(now + Duration::from_secs(15))
                .is_none()
        );
        assert!(
            recovery
                .take_attempt(now + Duration::from_secs(16))
                .is_some()
        );
        assert!(!recovery.failed(now + Duration::from_secs(17)));
        assert!(
            recovery
                .take_attempt(now + Duration::from_secs(1000))
                .is_none()
        );
    }
}
