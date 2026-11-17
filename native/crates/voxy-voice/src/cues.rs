//! Short synthesized interface sounds (cues).
//!
//! Notes and envelopes follow the Voxy 1.4 (Electron) chimes: sine notes 100 ms
//! apart, 12 ms linear attack to the peak, exponential decay to -60 dB at 90 ms.
//! Cues are mixed by the call worker after the deafen gate (so the deafen cue is
//! still heard) and are part of the echo-canceller render reference, so they are
//! never transmitted through the microphone.
use std::{
    collections::VecDeque,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cue {
    Join,
    Leave,
    PeerJoin,
    PeerLeave,
    PttOn,
    PttOff,
    Mute,
    Unmute,
    Deafen,
    Undeafen,
    ShareStart,
    ShareStop,
    Message,
    Mention,
    FriendRequest,
    Call,
    Notification,
}
/// Preference groups the user can switch individually.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    Call,
    Controls,
    Media,
    Social,
}
impl Cue {
    pub const ALL: [Cue; 17] = [
        Cue::Join,
        Cue::Leave,
        Cue::PeerJoin,
        Cue::PeerLeave,
        Cue::PttOn,
        Cue::PttOff,
        Cue::Mute,
        Cue::Unmute,
        Cue::Deafen,
        Cue::Undeafen,
        Cue::ShareStart,
        Cue::ShareStop,
        Cue::Message,
        Cue::Mention,
        Cue::FriendRequest,
        Cue::Call,
        Cue::Notification,
    ];
    pub fn group(self) -> Group {
        match self {
            Cue::Join | Cue::Leave | Cue::PeerJoin | Cue::PeerLeave | Cue::Call => Group::Call,
            Cue::PttOn | Cue::PttOff | Cue::Mute | Cue::Unmute | Cue::Deafen | Cue::Undeafen => {
                Group::Controls
            }
            Cue::ShareStart | Cue::ShareStop => Group::Media,
            Cue::Message | Cue::Mention | Cue::FriendRequest | Cue::Notification => Group::Social,
        }
    }
    /// Note frequencies in Hz (Electron table where it existed).
    pub fn notes(self) -> &'static [f32] {
        match self {
            Cue::Mute => &[380.0, 260.0],
            Cue::Unmute => &[520.0, 760.0],
            Cue::Deafen => &[480.0, 320.0, 200.0],
            Cue::Undeafen => &[320.0, 520.0, 820.0],
            Cue::PttOn => &[620.0, 880.0],
            Cue::PttOff => &[440.0, 310.0],
            Cue::ShareStart => &[523.25, 659.25, 1046.5],
            Cue::ShareStop => &[784.0, 587.33, 392.0],
            Cue::PeerJoin => &[440.0, 660.0],
            Cue::PeerLeave => &[660.0, 330.0],
            Cue::Join => &[392.0, 523.25, 784.0],
            Cue::Leave => &[784.0, 523.25, 349.23],
            Cue::Message => &[740.0, 980.0],
            Cue::Mention => &[880.0, 1174.66, 880.0],
            Cue::FriendRequest => &[587.33, 880.0, 1174.66],
            Cue::Call => &[659.25, 880.0, 659.25, 880.0],
            Cue::Notification => &[740.0, 980.0],
        }
    }
    /// Peak amplitude; social cues are softer, matching the Electron 0.07 gain.
    fn peak(self) -> f32 {
        if self.group() == Group::Social {
            0.08
        } else {
            0.12
        }
    }
}

fn clock_ms() -> u64 {
    static EPOCH: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64
}

pub const RATE: f32 = 48_000.0;
const STEP: f32 = 0.1;
const ATTACK: f32 = 0.012;
const DECAY_END: f32 = 0.09;

/// Mono 48 kHz samples for a cue at `volume` (0.0–1.0).
pub fn synthesize(cue: Cue, volume: f32) -> Vec<f32> {
    let volume = volume.clamp(0.0, 1.0);
    let notes = cue.notes();
    let total = ((notes.len() as f32 - 1.0) * STEP + STEP) * RATE;
    let mut out = vec![0.0; total as usize];
    // exp decay from peak to 0.001 between ATTACK and DECAY_END.
    let rate = (0.001f32).ln() / (DECAY_END - ATTACK);
    for (n, hz) in notes.iter().enumerate() {
        let start = (n as f32 * STEP * RATE) as usize;
        for i in 0..(STEP * RATE) as usize {
            let t = i as f32 / RATE;
            let envelope = if t < ATTACK {
                t / ATTACK
            } else if t < DECAY_END {
                ((t - ATTACK) * rate).exp()
            } else {
                0.0
            };
            if let Some(sample) = out.get_mut(start + i) {
                *sample += (std::f32::consts::TAU * hz * t).sin() * envelope * cue.peak() * volume;
            }
        }
    }
    out
}

/// Bounded queue of pending cue samples shared with the call worker.
pub struct CueQueue {
    pending: Mutex<VecDeque<f32>>,
    last: Mutex<Option<(Cue, Instant)>>,
    /// Set by the worker while it is mixing cue samples into the output.
    pub active: AtomicBool,
    /// Output devices let samples through a deafen gate until this instant
    /// (ms on [`clock_ms`]); covers the playback ring latency of a cue tail.
    audible_until: std::sync::atomic::AtomicU64,
}
impl Default for CueQueue {
    fn default() -> Self {
        Self {
            pending: Mutex::new(VecDeque::new()),
            last: Mutex::new(None),
            active: AtomicBool::new(false),
            audible_until: std::sync::atomic::AtomicU64::new(0),
        }
    }
}
const MAX_PENDING: usize = 48_000 * 2;
impl CueQueue {
    /// Adds a cue, overlapping it with anything already pending. The same cue
    /// twice within 150 ms is dropped (one physical action, one sound).
    pub fn push(&self, cue: Cue, volume: f32) -> bool {
        if let Ok(mut last) = self.last.lock() {
            if last.is_some_and(|(previous, at)| {
                previous == cue && at.elapsed() < Duration::from_millis(150)
            }) {
                return false;
            }
            *last = Some((cue, Instant::now()));
        }
        let samples = synthesize(cue, volume);
        let Ok(mut pending) = self.pending.lock() else {
            return false;
        };
        for (i, sample) in samples.into_iter().enumerate() {
            if i < pending.len() {
                pending[i] += sample;
            } else if pending.len() < MAX_PENDING {
                pending.push_back(sample);
            }
        }
        true
    }
    /// Mixes up to `out.len()` pending samples into `out`. Never blocks.
    pub fn mix_into(&self, out: &mut [f32]) -> bool {
        let Ok(mut pending) = self.pending.try_lock() else {
            return false;
        };
        let mut mixed = false;
        for sample in out.iter_mut() {
            let Some(cue) = pending.pop_front() else {
                break;
            };
            *sample += cue;
            mixed = true;
        }
        self.active
            .store(mixed || !pending.is_empty(), Ordering::Release);
        if mixed {
            self.audible_until
                .store(clock_ms() + 250, Ordering::Release);
        }
        mixed
    }
    pub fn clear(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
        self.active.store(false, Ordering::Release);
    }
    /// True while recently mixed cue samples may still be in the device ring.
    /// Lock-free; safe to call from audio device callbacks.
    pub fn audible(&self) -> bool {
        clock_ms() < self.audible_until.load(Ordering::Acquire)
    }
    pub fn pending(&self) -> usize {
        self.pending.lock().map(|p| p.len()).unwrap_or(0)
    }
}


/// Plays a cue on `output` without a call (social notifications, previews).
/// Opens the device briefly on a background thread and releases it afterwards.
/// Returns immediately; at most one detached cue plays at a time.
pub fn play_detached(output: &str, cue: Cue, volume: f32) {
    static BUSY: AtomicBool = AtomicBool::new(false);
    if BUSY.swap(true, Ordering::AcqRel) {
        return;
    }
    let output = output.to_owned();
    let spawned = std::thread::Builder::new()
        .name("voxy-cue".into())
        .spawn(move || {
            let control = std::sync::Arc::new(crate::control::VoiceControl::default());
            if let Ok(mut playback) = crate::devices::Playback::start(&output, control) {
                let samples = synthesize(cue, volume);
                let duration = Duration::from_secs_f32(samples.len() as f32 / RATE);
                let mut queued = 0;
                let started = Instant::now();
                // Feed the device ring as it drains (ring holds 100 ms).
                while queued < samples.len() && started.elapsed() < duration * 4 {
                    while queued < samples.len() && playback.samples.push(samples[queued]).is_ok() {
                        queued += 1;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                std::thread::sleep(Duration::from_millis(180));
            }
            BUSY.store(false, Ordering::Release);
        });
    if spawned.is_err() {
        BUSY.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn goertzel(samples: &[f32], hz: f32) -> f32 {
        let k = 2.0 * (std::f32::consts::TAU * hz / RATE).cos();
        let (mut s1, mut s2) = (0.0f32, 0.0f32);
        for x in samples {
            let s0 = x + k * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        (s1 * s1 + s2 * s2 - k * s1 * s2).sqrt() / samples.len() as f32
    }
    #[test]
    fn cues_contain_their_notes_in_order_and_are_bounded() {
        for cue in Cue::ALL {
            let samples = synthesize(cue, 1.0);
            assert_eq!(samples.len(), cue.notes().len() * 4_800);
            assert!(samples.iter().all(|s| s.abs() <= 0.13));
            for (n, hz) in cue.notes().iter().enumerate() {
                let slot = &samples[n * 4_800..n * 4_800 + 4_320];
                let own = goertzel(slot, *hz);
                let other = goertzel(slot, hz * 1.37);
                assert!(
                    own > other * 4.0,
                    "{cue:?} note {n} {hz} Hz: {own} vs {other}"
                );
            }
            // Silence at the end of each note slot (envelope reached -60 dB).
            assert!(samples[4_790].abs() < 0.001);
        }
        assert!(synthesize(Cue::Mute, 0.0).iter().all(|s| *s == 0.0));
    }
    #[test]
    fn queue_mixes_overlapping_cues_and_drops_immediate_duplicates() {
        let queue = CueQueue::default();
        assert!(queue.push(Cue::Mute, 1.0));
        assert!(!queue.push(Cue::Mute, 1.0), "duplicate within 150 ms");
        assert!(queue.push(Cue::Deafen, 1.0));
        assert_eq!(queue.pending(), 3 * 4_800);
        let mut frame = [0.0f32; 960];
        assert!(queue.mix_into(&mut frame));
        assert!(queue.active.load(Ordering::Acquire));
        let mut drained = 960;
        while queue.mix_into(&mut [0.0; 960]) {
            drained += 960;
        }
        assert_eq!(drained, 3 * 4_800);
        assert!(!queue.active.load(Ordering::Acquire));
    }
}
