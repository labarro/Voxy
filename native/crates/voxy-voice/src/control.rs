use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

/// Read by real-time callbacks without locks. Failed/stale PTT always closes speech.
pub struct VoiceControl {
    clock: Instant,
    audio_state: AtomicU64,
    ptt_state: AtomicU64,
    ptt_deadline_ms: AtomicU64,
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
    pub capture_overruns: AtomicU64,
    pub playback_underruns: AtomicU64,
    /// Peak decoded voice RMS per remote peer since the last `take_peer_levels`.
    /// Written only by the DSP worker (never by device callbacks) with try_lock.
    pub peer_levels: std::sync::Mutex<std::collections::BTreeMap<u64, f32>>,
    /// Peak processed outgoing RMS since the last take, after the transmit gate.
    pub sent_level_bits: AtomicU32,
    /// Interface sounds mixed into the call output (see `cues`).
    pub cues: crate::cues::CueQueue,
}
impl Default for VoiceControl {
    fn default() -> Self {
        Self {
            clock: Instant::now(),
            audio_state: AtomicU64::new(1),
            ptt_state: AtomicU64::new(0),
            ptt_deadline_ms: AtomicU64::new(0),
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
            capture_overruns: AtomicU64::new(0),
            playback_underruns: AtomicU64::new(0),
            peer_levels: Default::default(),
            sent_level_bits: AtomicU32::new(0),
            cues: Default::default(),
        }
    }
}
impl VoiceControl {
    /// Returns and clears per-peer peak receive levels and the outgoing peak.
    pub fn take_levels(&self) -> (std::collections::BTreeMap<u64, f32>, f32) {
        let peers = self
            .peer_levels
            .lock()
            .map(|mut levels| std::mem::take(&mut *levels))
            .unwrap_or_default();
        (
            peers,
            f32::from_bits(self.sent_level_bits.swap(0, Ordering::Relaxed)),
        )
    }
    pub fn may_transmit(&self) -> bool {
        let audio = self.audio_state.load(Ordering::Acquire);
        audio & 1 != 0
            && !self.muted.load(Ordering::Relaxed)
            && !self.deafened.load(Ordering::Relaxed)
            && (!self.ptt.load(Ordering::Relaxed)
                || (self.ptt_state.load(Ordering::Acquire) == audio
                    && self.clock.elapsed().as_millis()
                        < self.ptt_deadline_ms.load(Ordering::Acquire) as u128))
            && !self.device_failed.load(Ordering::Relaxed)
    }
    /// The DSP/network gate expires this lease even if the keyboard thread stalls.
    #[cfg(test)]
    fn update_ptt(&self, pressed: bool) {
        self.update_ptt_generation(pressed, self.audio_generation());
    }
    fn update_ptt_generation(&self, pressed: bool, generation: u64) {
        let inactive = generation << 1;
        let mut previous = self.ptt_state.load(Ordering::Acquire);
        loop {
            if previous >> 1 != generation {
                return;
            }
            match self.ptt_state.compare_exchange_weak(
                previous,
                inactive | u64::from(pressed),
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(actual) => previous = actual,
            }
        }
        self.ptt_deadline_ms.store(
            (self.clock.elapsed().as_millis() as u64).saturating_add(if pressed { 250 } else { 0 }),
            Ordering::Release,
        );
        self.pressed.store(pressed, Ordering::Release);
    }
    pub fn audio_generation(&self) -> u64 {
        self.audio_state.load(Ordering::Acquire) >> 1
    }
    /// Session authority closes the transport gate before starting/cancelling I/O.
    /// A delayed worker can only activate its exact generation with compare-exchange.
    pub fn prepare_audio_generation(&self, generation: u64, ptt: bool) {
        self.audio_state.store(generation << 1, Ordering::Release);
        self.ptt_state.store(generation << 1, Ordering::Release);
        self.pressed.store(false, Ordering::Release);
        self.ptt.store(ptt, Ordering::Release);
    }
    pub fn owns_audio_generation(&self, generation: u64) -> bool {
        self.audio_generation() == generation
    }
    pub(crate) fn activate_audio_generation(&self, generation: u64) -> bool {
        self.audio_state
            .compare_exchange(
                generation << 1,
                (generation << 1) | 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
    pub fn cancel_audio_generation(&self, generation: u64) {
        let mut state = self.audio_state.load(Ordering::Acquire);
        loop {
            if state >> 1 != generation {
                return;
            }
            match self.audio_state.compare_exchange_weak(
                state,
                (generation + 1) << 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(actual) => state = actual,
            }
        }
        self.update_ptt_generation(false, generation);
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
        "Backspace" => Some(8),
        "NumpadEnter" => Some(13),
        "Pause" => Some(19),
        "PageUp" => Some(33),
        "PageDown" => Some(34),
        "End" => Some(35),
        "Home" => Some(36),
        "ArrowLeft" => Some(37),
        "ArrowUp" => Some(38),
        "ArrowRight" => Some(39),
        "ArrowDown" => Some(40),
        "PrintScreen" => Some(44),
        "Insert" => Some(45),
        "Delete" => Some(46),
        "MetaLeft" => Some(91),
        "MetaRight" => Some(92),
        "ContextMenu" => Some(93),
        "NumpadMultiply" => Some(106),
        "NumpadAdd" => Some(107),
        "NumpadSubtract" => Some(109),
        "NumpadDecimal" => Some(110),
        "NumpadDivide" => Some(111),
        "NumLock" => Some(144),
        "ScrollLock" => Some(145),
        "Semicolon" => Some(186),
        "Equal" => Some(187),
        "Comma" => Some(188),
        "Minus" => Some(189),
        "Period" => Some(190),
        "Slash" => Some(191),
        "BracketLeft" => Some(219),
        "Backslash" => Some(220),
        "BracketRight" => Some(221),
        "Quote" => Some(222),
        "IntlBackslash" => Some(226),
        "Space" => Some(32),
        "Enter" => Some(13),
        "Tab" => Some(9),
        "Escape" => Some(27),
        "Backquote" => Some(192),
        "CapsLock" => Some(20),
        "Control" => Some(17),
        "Shift" => Some(16),
        "Alt" => Some(18),
        key if key.starts_with("Numpad") && key.len() == 7 => key
            .as_bytes()
            .get(6)
            .copied()
            .filter(u8::is_ascii_digit)
            .map(|key| i32::from(key - b'0') + 96),
        key if key.starts_with("Digit") && key.len() == 6 => key
            .as_bytes()
            .get(5)
            .copied()
            .filter(u8::is_ascii_digit)
            .map(i32::from),
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
        let generation = control.audio_generation();
        Self::start_for_generation(control, key, generation)
    }
    pub(crate) fn start_for_generation(
        control: Arc<VoiceControl>,
        key: &str,
        generation: u64,
    ) -> anyhow::Result<Self> {
        let chord = KeyChord::parse(key)?;
        control.update_ptt_generation(false, generation);
        let stop = Arc::new(AtomicBool::new(false));
        let stop_copy = stop.clone();
        let thread = std::thread::Builder::new()
            .name("voxy-ptt".into())
            .spawn(move || {
                let mut armed = false;
                let mut last = Instant::now();
                while !stop_copy.load(Ordering::Acquire)
                    && control.owns_audio_generation(generation)
                {
                    let timely = last.elapsed() < Duration::from_millis(250);
                    last = Instant::now();
                    let down = chord.is_down();
                    if !down {
                        armed = true;
                    }
                    if !timely {
                        armed = false;
                    }
                    control.update_ptt_generation(timely && armed && down, generation);
                    std::thread::sleep(Duration::from_millis(10));
                }
                control.update_ptt_generation(false, generation);
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
/// Validated native key chord. The final key may be Mouse4/Mouse5.
#[derive(Clone, Debug)]
pub struct KeyChord {
    keys: Vec<i32>,
}
impl KeyChord {
    pub fn parse(value: &str) -> anyhow::Result<Self> {
        let parts: Vec<_> = value.split('+').collect();
        anyhow::ensure!(!parts.is_empty() && parts.len() <= 4, "Atalho inválido");
        let mut keys = Vec::new();
        for part in parts {
            let key = virtual_key(part)
                .ok_or_else(|| anyhow::anyhow!("Tecla de atalho não suportada"))?;
            anyhow::ensure!(!keys.contains(&key), "Tecla repetida no atalho");
            keys.push(key);
        }
        Ok(Self { keys })
    }
    fn is_down(&self) -> bool {
        self.matches(|key| {
            #[cfg(windows)]
            {
                (unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(key) })
                    < 0
            }
            #[cfg(not(windows))]
            {
                let _ = key;
                false
            }
        })
    }
    fn matches(&self, down: impl Fn(i32) -> bool) -> bool {
        self.keys.iter().all(|key| down(*key))
            && [
                (17, [17, 162, 163]),
                (18, [18, 164, 165]),
                (16, [16, 160, 161]),
            ]
            .iter()
            .all(|(generic, aliases)| {
                down(*generic) == self.keys.iter().any(|key| aliases.contains(key))
            })
            && [91, 92]
                .iter()
                .all(|key| down(*key) == self.keys.contains(key))
    }
}
/// Require release before a rising edge, including after a stalled polling thread.
#[derive(Default)]
struct ShortcutEdge {
    armed: bool,
    was_down: bool,
}
impl ShortcutEdge {
    fn sample(&mut self, down: bool, timely: bool) -> bool {
        if !timely {
            self.armed = false;
        }
        if !down {
            self.armed = true;
        }
        let fire = timely && self.armed && down && !self.was_down;
        self.was_down = down;
        fire
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShortcutAction {
    ToggleMute,
    ToggleDeafen,
}
/// Session authority consumes events to keep UI, persistence and mute state coherent.
pub struct GlobalShortcuts {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl GlobalShortcuts {
    pub fn start(
        mute: Option<&str>,
        deafen: Option<&str>,
    ) -> anyhow::Result<(Self, std::sync::mpsc::Receiver<ShortcutAction>)> {
        let mute = mute.map(KeyChord::parse).transpose()?;
        let deafen = deafen.map(KeyChord::parse).transpose()?;
        anyhow::ensure!(
            mute.is_some() || deafen.is_some(),
            "Nenhum atalho configurado"
        );
        if let (Some(a), Some(b)) = (&mute, &deafen) {
            let mut a = a.keys.clone();
            a.sort_unstable();
            let mut b = b.keys.clone();
            b.sort_unstable();
            anyhow::ensure!(a != b, "Atalhos de mudo e ensurdecer devem ser diferentes");
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let thread = std::thread::Builder::new()
            .name("voxy-shortcuts".into())
            .spawn(move || {
                let mut mute_edge = ShortcutEdge::default();
                let mut deafen_edge = ShortcutEdge::default();
                let mut last = Instant::now();
                while !stopping.load(Ordering::Acquire) {
                    let timely = last.elapsed() < Duration::from_millis(250);
                    last = Instant::now();
                    let deafened =
                        deafen_edge.sample(deafen.as_ref().is_some_and(KeyChord::is_down), timely);
                    let muted =
                        mute_edge.sample(mute.as_ref().is_some_and(KeyChord::is_down), timely);
                    // A simultaneous deafen wins over overlapping mute bindings.
                    if deafened {
                        let _ = sender.try_send(ShortcutAction::ToggleDeafen);
                    } else if muted {
                        let _ = sender.try_send(ShortcutAction::ToggleMute);
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            })?;
        Ok((
            Self {
                stop,
                thread: Some(thread),
            },
            receiver,
        ))
    }
}
impl Drop for GlobalShortcuts {
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
    fn expired_ptt_lease_closes_speech_while_pressed_remains_true() {
        let control = VoiceControl::default();
        control.ptt.store(true, Ordering::Release);
        control.update_ptt(true);
        assert!(control.may_transmit());
        control.ptt_deadline_ms.store(0, Ordering::Release);
        assert!(control.pressed.load(Ordering::Acquire));
        assert!(!control.may_transmit());
    }
    #[test]
    fn late_audio_generation_cannot_activate_or_modify_new_ptt_lease() {
        let control = VoiceControl::default();
        control.prepare_audio_generation(1, false);
        control.prepare_audio_generation(2, true);
        assert!(!control.activate_audio_generation(1));
        assert!(!control.may_transmit());
        assert!(control.activate_audio_generation(2));
        control.update_ptt_generation(true, 1);
        assert!(!control.may_transmit());
        control.update_ptt_generation(true, 2);
        assert!(control.may_transmit());
        control.cancel_audio_generation(1);
        assert!(control.may_transmit());
        control.update_ptt_generation(false, 2);
        control.update_ptt_generation(true, 1);
        assert!(!control.may_transmit());
        control.cancel_audio_generation(2);
        assert!(!control.may_transmit());
    }
    #[test]
    fn shortcuts_require_release_without_repeat_or_resume_after_stall() {
        let mut edge = ShortcutEdge::default();
        assert!(!edge.sample(true, true));
        assert!(!edge.sample(false, true));
        assert!(edge.sample(true, true));
        assert!(!edge.sample(true, true));
        assert!(!edge.sample(true, false));
        assert!(!edge.sample(true, true));
        assert!(!edge.sample(false, true));
        assert!(edge.sample(true, true));
        assert!(KeyChord::parse("Control+Shift+Mouse4").is_ok());
        assert!(KeyChord::parse("Control+Control+KeyM").is_err());
        assert!(KeyChord::parse("KeyM+").is_err());
        assert!(GlobalShortcuts::start(Some("Control+KeyM"), Some("KeyM+Control")).is_err());
        let chord = KeyChord::parse("Control+KeyM").unwrap();
        assert!(chord.matches(|key| [17, 77].contains(&key)));
        assert!(!chord.matches(|key| [16, 17, 77].contains(&key)));
        assert!(!chord.matches(|key| [17, 77, 91].contains(&key)));
        assert_eq!(virtual_key("NumpadEnter"), virtual_key("Enter"));
        assert_eq!(virtual_key("Numpad9"), Some(105));
    }
    #[test]
    fn mute_and_deafen_dominate_ptt_and_bad_gain_is_silent() {
        let c = VoiceControl::default();
        c.ptt.store(true, Ordering::Relaxed);
        assert!(!c.may_transmit());
        c.update_ptt(true);
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
