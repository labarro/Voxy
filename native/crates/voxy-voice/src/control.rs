use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

/// Read by real-time callbacks without locks. Failed/stale PTT always closes speech.
pub struct VoiceControl {
    pub muted: AtomicBool,
    pub deafened: AtomicBool,
    pub ptt: AtomicBool,
    pub pressed: AtomicBool,
    pub gain_bits: AtomicU32,
    pub level_bits: AtomicU32,
    pub device_failed: AtomicBool,
    pub captured_samples: AtomicU64,
    pub rendered_samples: AtomicU64,
    pub processed_blocks: AtomicU64,
    pub decoded_frames: AtomicU64,
    pub recoverable_device_events: AtomicU64,
}
impl Default for VoiceControl {
    fn default() -> Self {
        Self {
            muted: AtomicBool::new(false),
            deafened: AtomicBool::new(false),
            ptt: AtomicBool::new(false),
            pressed: AtomicBool::new(false),
            gain_bits: AtomicU32::new(1.0f32.to_bits()),
            level_bits: AtomicU32::new(0),
            device_failed: AtomicBool::new(false),
            captured_samples: AtomicU64::new(0),
            rendered_samples: AtomicU64::new(0),
            processed_blocks: AtomicU64::new(0),
            decoded_frames: AtomicU64::new(0),
            recoverable_device_events: AtomicU64::new(0),
        }
    }
}
impl VoiceControl {
    pub fn may_transmit(&self) -> bool {
        !self.muted.load(Ordering::Relaxed)
            && !self.deafened.load(Ordering::Relaxed)
            && (!self.ptt.load(Ordering::Relaxed) || self.pressed.load(Ordering::Acquire))
            && !self.device_failed.load(Ordering::Relaxed)
    }
    pub fn set_gain(&self, gain: f32) {
        self.gain_bits.store(
            if gain.is_finite() {
                gain.clamp(0.0, 2.0)
            } else {
                0.0
            }
            .to_bits(),
            Ordering::Relaxed,
        )
    }
    pub fn gain(&self) -> f32 {
        f32::from_bits(self.gain_bits.load(Ordering::Relaxed))
    }
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level_bits.load(Ordering::Relaxed))
    }
}

pub fn virtual_key(key: &str) -> Option<i32> {
    match key {
        "Mouse4" => Some(5),
        "Mouse5" => Some(6),
        "Space" => Some(32),
        "ControlLeft" => Some(162),
        "ControlRight" => Some(163),
        "ShiftLeft" => Some(160),
        "ShiftRight" => Some(161),
        "AltLeft" => Some(164),
        "AltRight" => Some(165),
        key if key.starts_with("Key") && key.len() == 4 => key
            .as_bytes()
            .get(3)
            .copied()
            .filter(u8::is_ascii_uppercase)
            .map(i32::from),
        key if key.starts_with('F') => key[1..]
            .parse::<i32>()
            .ok()
            .filter(|v| (1..=24).contains(v))
            .map(|v| 111 + v),
        _ => None,
    }
}
pub struct GlobalPtt {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl GlobalPtt {
    pub fn start(control: Arc<VoiceControl>, key: &str) -> anyhow::Result<Self> {
        let vk = virtual_key(key).ok_or_else(|| anyhow::anyhow!("Tecla PTT não suportada"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_copy = stop.clone();
        let thread = std::thread::Builder::new()
            .name("voxy-ptt".into())
            .spawn(move || {
                let mut armed = false;
                let mut last = Instant::now();
                while !stop_copy.load(Ordering::Acquire) {
                    let timely = last.elapsed() < Duration::from_millis(250);
                    last = Instant::now();
                    #[cfg(windows)]
                    let down = unsafe {
                        windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(vk)
                    } < 0;
                    #[cfg(not(windows))]
                    let down = {
                        let _ = vk;
                        false
                    };
                    if !down {
                        armed = true;
                    }
                    if !timely {
                        armed = false;
                    }
                    control
                        .pressed
                        .store(timely && armed && down, Ordering::Release);
                    std::thread::sleep(Duration::from_millis(10));
                }
                control.pressed.store(false, Ordering::Release);
            })?;
        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }
}
impl Drop for GlobalPtt {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mute_and_deafen_dominate_ptt_and_bad_gain_is_silent() {
        let c = VoiceControl::default();
        c.ptt.store(true, Ordering::Relaxed);
        assert!(!c.may_transmit());
        c.pressed.store(true, Ordering::Release);
        assert!(c.may_transmit());
        c.deafened.store(true, Ordering::Relaxed);
        assert!(!c.may_transmit());
        c.deafened.store(false, Ordering::Relaxed);
        c.muted.store(true, Ordering::Relaxed);
        assert!(!c.may_transmit());
        c.set_gain(f32::NAN);
        assert_eq!(c.gain(), 0.0);
        assert_eq!(virtual_key("Mouse5"), Some(6));
        assert_eq!(virtual_key("F24"), Some(135));
        assert_eq!(virtual_key("F25"), None);
    }
}
