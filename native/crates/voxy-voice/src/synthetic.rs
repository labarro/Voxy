//! Test-only synthetic audio endpoints, enabled exclusively by
//! `VOXY_TEST_SYNTHETIC_AUDIO=1`. They replace only the physical device
//! boundary: the same SPSC queues, mute/PTT gate, level meter, DSP/AEC,
//! Opus, transport, jitter buffer, mixer, per-peer volume and deafen run
//! unchanged. The analyzer sink records objective metrics about what was
//! actually delivered to the playback boundary; no audio is ever recorded.
use crate::{control::VoiceControl, devices::AudioDevice};
use anyhow::{Context, Result, bail, ensure};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

pub const PREFIX: &str = "synthetic:";
pub const VOICES: [u32; 4] = [140, 210, 330, 470];
/// Interface cue notes that are not harmonics of the synthetic voices (E2E).
pub const CUE_PROBES: [u32; 5] = [380, 440, 520, 620, 730];
const CHUNK: usize = 480;
const WINDOW: usize = 24_000;
const PROBE_OFFSETS: [f32; 9] = [-8.0, -6.0, -4.0, -2.0, 0.0, 2.0, 4.0, 6.0, 8.0];

pub fn enabled() -> bool {
    std::env::var("VOXY_TEST_SYNTHETIC_AUDIO").as_deref() == Ok("1")
}
pub fn is_synthetic(id: &str) -> bool {
    id.starts_with(PREFIX)
}
pub fn devices() -> Vec<AudioDevice> {
    if !enabled() {
        return vec![];
    }
    let mut devices: Vec<_> = VOICES
        .iter()
        .map(|hz| AudioDevice {
            id: format!("{PREFIX}voice:{hz}"),
            name: format!("Teste sintético · voz {hz} Hz"),
            input: true,
            default: false,
        })
        .collect();
    devices.push(AudioDevice {
        id: format!("{PREFIX}analyzer"),
        name: "Teste sintético · analisador".into(),
        input: false,
        default: false,
    });
    devices
}
fn voice_frequency(id: &str) -> Result<f32> {
    ensure!(enabled(), "Dispositivo de teste sintético desativado");
    let hz: u32 = id
        .strip_prefix(PREFIX)
        .and_then(|rest| rest.strip_prefix("voice:"))
        .context("Fonte sintética inválida")?
        .parse()
        .context("Fonte sintética inválida")?;
    ensure!(VOICES.contains(&hz), "Fonte sintética inválida");
    Ok(hz as f32)
}

/// Deterministic voiced signal: harmonics with ±6 Hz vibrato and a 4 Hz
/// syllabic envelope, the same family validated through DSP+Opus in unit tests.
pub fn voiced_sample(fundamental: f32, index: u64) -> f32 {
    let time = index as f32 / 48_000.0;
    let time = time % 1000.0;
    let phase = std::f32::consts::TAU * fundamental * time
        + 3.0 * (1.0 - (std::f32::consts::TAU * 2.0 * time).cos());
    let envelope = 0.55 + 0.45 * (std::f32::consts::TAU * 4.0 * time).sin();
    (1..=4)
        .map(|harmonic| (phase * harmonic as f32).sin() / harmonic as f32)
        .sum::<f32>()
        * 0.12
        * envelope
}

pub struct Worker {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
fn paced(name: &str, mut tick: impl FnMut() + Send + 'static) -> Result<Worker> {
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = stop.clone();
    let thread = std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let mut next = Instant::now();
            while !stopping.load(Ordering::Acquire) {
                tick();
                next += Duration::from_millis(10);
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else if now - next > Duration::from_millis(200) {
                    next = now;
                }
            }
        })?;
    Ok(Worker {
        stop,
        thread: Some(thread),
    })
}

/// Mirrors the CPAL capture callback: gate, level meter and counters.
pub fn capture(
    id: &str,
    mut producer: rtrb::Producer<f32>,
    control: Arc<VoiceControl>,
) -> Result<Worker> {
    let fundamental = voice_frequency(id)?;
    let mut index = 0_u64;
    paced("voxy-synthetic-capture", move || {
        let allowed = control.may_transmit();
        let mut energy = 0.0;
        for _ in 0..CHUNK {
            let value = voiced_sample(fundamental, index);
            index += 1;
            energy += value * value;
            if producer.push(if allowed { value } else { 0.0 }).is_err() {
                control.capture_overruns.fetch_add(1, Ordering::Relaxed);
            }
        }
        control
            .level_bits
            .store((energy / CHUNK as f32).sqrt().to_bits(), Ordering::Relaxed);
        control
            .captured_samples
            .fetch_add(CHUNK as u64, Ordering::Relaxed);
    })
}

/// Mirrors the CPAL playback callback and analyzes delivered samples.
pub fn playback(
    id: &str,
    mut consumer: rtrb::Consumer<f32>,
    mut reference: rtrb::Producer<f32>,
    control: Arc<VoiceControl>,
) -> Result<Worker> {
    ensure!(enabled(), "Dispositivo de teste sintético desativado");
    if id != format!("{PREFIX}analyzer") {
        bail!("Saída sintética inválida");
    }
    let mut analyzer =
        Analyzer::new(std::env::var_os("VOXY_TEST_SYNTHETIC_AUDIO_REPORT").map(PathBuf::from));
    paced("voxy-synthetic-playback", move || {
        control
            .rendered_samples
            .fetch_add(CHUNK as u64, Ordering::Relaxed);
        for _ in 0..CHUNK {
            let current = consumer.pop().unwrap_or_else(|_| {
                control.playback_underruns.fetch_add(1, Ordering::Relaxed);
                analyzer.underruns += 1;
                0.0
            });
            let sample = if control.deafened.load(Ordering::Relaxed) && !control.cues.audible() {
                0.0
            } else {
                current.clamp(-0.98, 0.98)
            };
            let _ = reference.push(sample);
            analyzer.push(sample);
        }
    })
}

struct Goertzel {
    coefficient: f32,
    s1: f32,
    s2: f32,
}
impl Goertzel {
    fn new(hz: f32) -> Self {
        Self {
            coefficient: 2.0 * (std::f32::consts::TAU * hz / 48_000.0).cos(),
            s1: 0.0,
            s2: 0.0,
        }
    }
    fn push(&mut self, sample: f32) {
        let s0 = sample + self.coefficient * self.s1 - self.s2;
        self.s2 = self.s1;
        self.s1 = s0;
    }
    fn power(&mut self) -> f64 {
        let (s1, s2) = (self.s1 as f64, self.s2 as f64);
        let power = s1 * s1 + s2 * s2 - self.coefficient as f64 * s1 * s2;
        self.s1 = 0.0;
        self.s2 = 0.0;
        power.max(0.0)
    }
}
struct Analyzer {
    report: Option<PathBuf>,
    banks: Vec<(u32, Vec<Goertzel>)>,
    energy: f64,
    count: usize,
    delivered: u64,
    non_silent: u64,
    underruns: u64,
    windows: VecDeque<serde_json::Value>,
}
impl Analyzer {
    fn new(report: Option<PathBuf>) -> Self {
        Self {
            report,
            banks: VOICES
                .iter()
                .chain(CUE_PROBES.iter())
                .map(|hz| {
                    (
                        *hz,
                        PROBE_OFFSETS
                            .iter()
                            .map(|offset| Goertzel::new(*hz as f32 + offset))
                            .collect(),
                    )
                })
                .collect(),
            energy: 0.0,
            count: 0,
            delivered: 0,
            non_silent: 0,
            underruns: 0,
            windows: VecDeque::new(),
        }
    }
    fn push(&mut self, sample: f32) {
        self.delivered += 1;
        if sample.abs() > 1e-4 {
            self.non_silent += 1;
        }
        self.energy += (sample as f64) * (sample as f64);
        for (_, bank) in &mut self.banks {
            for probe in bank {
                probe.push(sample);
            }
        }
        self.count += 1;
        if self.count == WINDOW {
            self.finish_window();
        }
    }
    fn finish_window(&mut self) {
        // Parseval: a one-sided band fraction of 2*sum|X_k|^2 / (N * sum x^2).
        let energy = self.energy;
        let mut probes = serde_json::Map::new();
        for (hz, bank) in &mut self.banks {
            let band: f64 = bank.iter_mut().map(Goertzel::power).sum();
            let fraction = if energy > 1e-9 {
                (2.0 * band / (WINDOW as f64 * energy)).min(1.0)
            } else {
                0.0
            };
            probes.insert(
                hz.to_string(),
                serde_json::json!((fraction * 1000.0).round() / 1000.0),
            );
        }
        let rms = (energy / WINDOW as f64).sqrt();
        self.windows.push_back(serde_json::json!({
            "atMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            "rms": (rms * 10_000.0).round() / 10_000.0,
            "bandFraction": probes,
        }));
        while self.windows.len() > 120 {
            self.windows.pop_front();
        }
        self.energy = 0.0;
        self.count = 0;
        if let Some(path) = &self.report {
            let report = serde_json::json!({
                "kind": "synthetic-playback-analyzer",
                "windowMs": 500,
                "deliveredSamples": self.delivered,
                "nonSilentSamples": self.non_silent,
                "underrunSamples": self.underruns,
                "windows": self.windows,
            });
            let temporary = path.with_extension("tmp");
            if std::fs::write(&temporary, report.to_string()).is_ok() {
                let _ = std::fs::rename(&temporary, path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn analyzer_identifies_each_voice_and_rejects_the_others() {
        for target in VOICES {
            let mut analyzer = Analyzer::new(None);
            for index in 0..WINDOW as u64 {
                analyzer.push(voiced_sample(target as f32, index + 7_919));
            }
            let window = analyzer.windows.back().unwrap();
            for other in VOICES {
                let fraction = window["bandFraction"][other.to_string()].as_f64().unwrap();
                if other == target {
                    assert!(fraction > 0.3, "{target} Hz own band {fraction}");
                } else {
                    assert!(
                        fraction < 0.05,
                        "{target} Hz leaked into {other}: {fraction}"
                    );
                }
            }
        }
        let mut silent = Analyzer::new(None);
        for _ in 0..WINDOW {
            silent.push(0.0);
        }
        assert_eq!(silent.non_silent, 0);
        assert_eq!(silent.windows[0]["rms"], 0.0);
    }
}
