//! Screen publisher owned by the session process: WGC capture → letterbox to the
//! chosen preset → NV12 → H.264 (Media Foundation) → bounded queue to the network
//! task, which sends only to members watching this publisher. Frames are dropped,
//! never queued without bound; a drop forces the next frame to be a keyframe.
use anyhow::{Context, Result, ensure};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use voxy_core::ipc::{SCREEN_PRESETS, ScreenSource, ScreenStatus};
use voxy_network::live::VideoOut;

#[derive(Default)]
pub struct Counters {
    pub captured: AtomicU64,
    pub encoded: AtomicU64,
    pub dropped: AtomicU64,
    pub keyframes: AtomicU64,
    pub bytes: AtomicU64,
    pub bitrate: AtomicU32,
    pub failed: AtomicBool,
}
pub struct Publisher {
    stop: Arc<AtomicBool>,
    pub keyframe: Arc<AtomicBool>,
    pub counters: Arc<Counters>,
    thread: Option<JoinHandle<()>>,
    pub status: ScreenStatus,
    last_bytes: u64,
    last_sample: Instant,
}
impl Publisher {
    pub fn is_finished(&self) -> bool {
        self.thread.as_ref().is_none_or(JoinHandle::is_finished)
    }
    /// Refreshes the status snapshot from the counters (called by the session tick).
    pub fn refresh(&mut self, watchers: u32) -> ScreenStatus {
        let c = &self.counters;
        let bytes = c.bytes.load(Ordering::Relaxed);
        let elapsed = self.last_sample.elapsed().as_secs_f64().max(0.001);
        self.status.sent_kbps = ((bytes - self.last_bytes) as f64 * 8.0 / 1000.0 / elapsed) as u32;
        self.last_bytes = bytes;
        self.last_sample = Instant::now();
        self.status.captured = c.captured.load(Ordering::Relaxed);
        self.status.encoded = c.encoded.load(Ordering::Relaxed);
        self.status.dropped = c.dropped.load(Ordering::Relaxed);
        self.status.keyframes = c.keyframes.load(Ordering::Relaxed);
        self.status.bitrate_kbps = c.bitrate.load(Ordering::Relaxed) / 1000;
        self.status.watchers = watchers;
        self.status.clone()
    }
}
impl Drop for Publisher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn preset(name: &str) -> Result<(u32, u32, u32, u32)> {
    SCREEN_PRESETS
        .iter()
        .find(|p| p.0 == name)
        .map(|p| (p.1, p.2, p.3, p.4))
        .context("Qualidade de transmissão inválida")
}

/// Starts capture/encode on a dedicated thread. Returns after the first encoded
/// frame (or an error), so the UI never shows a share that is not producing video.
pub fn start(
    source: ScreenSource,
    preset_name: &str,
    output: mpsc::Sender<VideoOut>,
) -> Result<Publisher> {
    let (width, height, fps, bitrate) = preset(preset_name)?;
    ensure!(
        matches!(source.kind.as_str(), "window" | "monitor"),
        "Fonte de captura inválida"
    );
    let stop = Arc::new(AtomicBool::new(false));
    let keyframe = Arc::new(AtomicBool::new(true));
    let counters = Arc::new(Counters::default());
    counters.bitrate.store(bitrate, Ordering::Relaxed);
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    let (thread_stop, thread_keyframe, thread_counters) =
        (stop.clone(), keyframe.clone(), counters.clone());
    let thread_source = source.clone();
    let thread = std::thread::Builder::new()
        .name("voxy-screen".into())
        .spawn(move || {
            let mut ready = Some(ready_tx);
            let result = run(
                &thread_source,
                (width, height, fps, bitrate),
                &output,
                &thread_stop,
                &thread_keyframe,
                &thread_counters,
                &mut ready,
            );
            if let Err(error) = result {
                thread_counters.failed.store(true, Ordering::Release);
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Err(error.to_string()));
                }
            }
        })?;
    let publisher = Publisher {
        stop,
        keyframe,
        counters,
        thread: Some(thread),
        status: ScreenStatus {
            label: source.label.chars().take(80).collect(),
            preset: preset_name.into(),
            width,
            height,
            fps,
            encoder: "H.264 software (Media Foundation)".into(),
            ..Default::default()
        },
        last_bytes: 0,
        last_sample: Instant::now(),
    };
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(publisher),
        Ok(Err(error)) => anyhow::bail!("{error}"),
        Err(_) => anyhow::bail!("A captura não produziu vídeo em 8 s"),
    }
}

#[cfg(windows)]
fn run(
    source: &ScreenSource,
    (width, height, fps, target): (u32, u32, u32, u32),
    output: &mpsc::Sender<VideoOut>,
    stop: &AtomicBool,
    keyframe: &AtomicBool,
    counters: &Counters,
    ready: &mut Option<std::sync::mpsc::SyncSender<Result<(), String>>>,
) -> Result<()> {
    use voxy_media::{
        CaptureOptions, CaptureSource, MediaRuntime, ScreenCapture,
        codec::{EncoderPreference, H264Encoder, VideoFormat, bgra_to_nv12},
        enumerate_sources, fit_bgra,
    };
    let runtime = MediaRuntime::new()?;
    // Re-validate the UI's choice against the live source list: a stale or forged
    // handle cannot select some other window.
    let selected = enumerate_sources()?
        .into_iter()
        .find(|candidate| match (candidate, source.kind.as_str()) {
            (
                CaptureSource::Window {
                    handle, process_id, ..
                },
                "window",
            ) => *handle as u64 == source.handle && *process_id == source.process_id,
            (CaptureSource::Monitor { handle, .. }, "monitor") => *handle as u64 == source.handle,
            _ => false,
        })
        .context("A janela ou monitor escolhido não está mais disponível")?;
    let mut capture = ScreenCapture::start(
        &runtime,
        &selected,
        CaptureOptions {
            frames_per_second: fps,
            include_audio: false,
        },
    )?;
    let mut bitrate = target;
    let mut encoder = H264Encoder::new(
        &runtime,
        VideoFormat {
            width,
            height,
            frames_per_second: fps,
            bitrate,
        },
        EncoderPreference::Software,
    )?;
    let duration = Duration::from_micros(1_000_000 / fps as u64);
    let mut window = (Instant::now(), 0_u64, 0_u64);
    let mut needs_keyframe = false;
    while !stop.load(Ordering::Acquire) {
        let Some(frame) = capture.next_frame(Duration::from_millis(250))? else {
            continue;
        };
        counters.captured.fetch_add(1, Ordering::Relaxed);
        if keyframe.swap(false, Ordering::AcqRel) || needs_keyframe {
            encoder.request_keyframe()?;
            needs_keyframe = false;
        }
        let fitted = fit_bgra(&frame, width, height)?;
        let nv12 = bgra_to_nv12(&fitted)?;
        for encoded in encoder.encode(&nv12)? {
            counters.encoded.fetch_add(1, Ordering::Relaxed);
            if encoded.keyframe {
                counters.keyframes.fetch_add(1, Ordering::Relaxed);
            }
            if let Some(ready) = ready.take() {
                let _ = ready.send(Ok(()));
            }
            let size = encoded.bytes.len() as u64;
            match output.try_send(VideoOut {
                frame: encoded.bytes,
                duration,
            }) {
                Ok(()) => {
                    counters.bytes.fetch_add(size, Ordering::Relaxed);
                }
                Err(mpsc::error::TrySendError::Full(_)) => {
                    // A missing P-frame corrupts the following ones: resync on a keyframe.
                    counters.dropped.fetch_add(1, Ordering::Relaxed);
                    window.2 += 1;
                    needs_keyframe = true;
                }
                Err(mpsc::error::TrySendError::Closed(_)) => return Ok(()),
            }
            window.1 += 1;
        }
        // Backpressure-driven bitrate adaptation every 2 s: >5% drops lowers the
        // target by 20% (floor 40%); a clean window recovers 10% up to the preset.
        if window.0.elapsed() >= Duration::from_secs(2) && window.1 > 0 {
            let next = if window.2 * 20 > window.1 {
                (bitrate as f64 * 0.8).max(target as f64 * 0.4) as u32
            } else {
                (bitrate as f64 * 1.1).min(target as f64) as u32
            };
            if next != bitrate && encoder.set_bitrate(next).is_ok() {
                bitrate = next;
                counters.bitrate.store(bitrate, Ordering::Relaxed);
            }
            window = (Instant::now(), 0, 0);
        }
    }
    let _ = encoder.finish();
    Ok(())
}
#[cfg(not(windows))]
fn run(
    _: &ScreenSource,
    _: (u32, u32, u32, u32),
    _: &mpsc::Sender<VideoOut>,
    _: &AtomicBool,
    _: &AtomicBool,
    _: &Counters,
    _: &mut Option<std::sync::mpsc::SyncSender<Result<(), String>>>,
) -> Result<()> {
    anyhow::bail!("Compartilhamento de tela disponível apenas no Windows")
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_documented_presets_are_accepted() {
        assert_eq!(
            super::preset("1080p60").unwrap(),
            (1920, 1080, 60, 6_500_000)
        );
        assert_eq!(super::preset("720p30").unwrap().0, 1280);
        assert!(super::preset("4k120").is_err());
    }
}
