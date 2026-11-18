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
use voxy_core::ipc::{CAMERA_PRESETS, SCREEN_PRESETS, ScreenSource, ScreenStatus};
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
    pub audio_packets: AtomicU64,
    pub audio_failed: AtomicBool,
}
pub struct Publisher {
    stop: Arc<AtomicBool>,
    pub keyframe: Arc<AtomicBool>,
    pub counters: Arc<Counters>,
    thread: Option<JoinHandle<()>>,
    audio_thread: Option<JoinHandle<()>>,
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
        self.status.audio_packets = c.audio_packets.load(Ordering::Relaxed);
        self.status.audio = self.audio_thread.is_some() && !c.audio_failed.load(Ordering::Relaxed);
        self.status.clone()
    }
}
impl Drop for Publisher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.audio_thread.take() {
            let _ = thread.join();
        }
    }
}

/// What a publisher captures. Cameras are opened only on explicit user action.
#[derive(Clone, Debug)]
pub enum Source {
    Screen(ScreenSource),
    Camera { device: String, label: String },
}
pub const SYNTHETIC_CAMERA: &str = "synthetic:camera";
pub fn synthetic_camera_enabled() -> bool {
    std::env::var("VOXY_TEST_SYNTHETIC_CAMERA").as_deref() == Ok("1")
}
pub fn camera_preset(name: &str) -> Result<(u32, u32, u32, u32)> {
    CAMERA_PRESETS
        .iter()
        .find(|p| p.0 == name)
        .map(|p| (p.1, p.2, p.3, p.4))
        .context("Qualidade de câmera inválida")
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
    source: Source,
    preset_name: &str,
    output: mpsc::Sender<VideoOut>,
    audio: bool,
) -> Result<Publisher> {
    let audio_mode = match (&source, audio) {
        (Source::Screen(screen), true) if screen.kind == "window" => Some(
            voxy_media::app_audio::LoopbackMode::IncludeTree(screen.process_id),
        ),
        // Monitor: everything except this session process tree, which renders the call.
        (Source::Screen(_), true) => Some(voxy_media::app_audio::LoopbackMode::ExcludeTree(
            std::process::id(),
        )),
        _ => None,
    };
    let audio_output = output.clone();
    let (width, height, fps, bitrate) = match &source {
        Source::Screen(screen) => {
            ensure!(
                matches!(screen.kind.as_str(), "window" | "monitor"),
                "Fonte de captura inválida"
            );
            preset(preset_name)?
        }
        Source::Camera { device, .. } => {
            ensure!(
                device != SYNTHETIC_CAMERA || synthetic_camera_enabled(),
                "Câmera de teste desativada"
            );
            camera_preset(preset_name)?
        }
    };
    let label = match &source {
        Source::Screen(screen) => screen.label.clone(),
        Source::Camera { label, .. } => label.clone(),
    };
    let stop = Arc::new(AtomicBool::new(false));
    let keyframe = Arc::new(AtomicBool::new(true));
    let counters = Arc::new(Counters::default());
    counters.bitrate.store(bitrate, Ordering::Relaxed);
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    let (thread_stop, thread_keyframe, thread_counters) =
        (stop.clone(), keyframe.clone(), counters.clone());
    let thread_source = source.clone();
    let thread = std::thread::Builder::new()
        .name("voxy-video-publisher".into())
        .spawn(move || {
            let mut ready = Some(ready_tx);
            // A panic in capture/encoding ends this share only; voice and the session continue.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                run(
                    &thread_source,
                    (width, height, fps, bitrate),
                    &output,
                    &thread_stop,
                    &thread_keyframe,
                    &thread_counters,
                    &mut ready,
                )
            }))
            .unwrap_or_else(|_| Err(anyhow::anyhow!("Falha interna na captura de vídeo")));
            if let Err(error) = &result {
                voxy_core::log::event("video-publisher", &error.to_string());
            }
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
            label: label.chars().take(80).collect(),
            preset: preset_name.into(),
            width,
            height,
            fps,
            encoder: "H.264 software (Media Foundation)".into(),
            ..Default::default()
        },
        audio_thread: None,
        last_bytes: 0,
        last_sample: Instant::now(),
    };
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => {
            let mut publisher = publisher;
            if let Some(mode) = audio_mode {
                let (stop, counters) = (publisher.stop.clone(), publisher.counters.clone());
                publisher.audio_thread = Some(
                    std::thread::Builder::new()
                        .name("voxy-share-audio".into())
                        .spawn(move || {
                            let result =
                                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                    share_audio(mode, &audio_output, &stop, &counters)
                                }))
                                .unwrap_or_else(|_| {
                                    Err(anyhow::anyhow!("Falha interna no áudio compartilhado"))
                                });
                            if let Err(error) = &result {
                                voxy_core::log::event("share-audio", &error.to_string());
                            }
                            if result.is_err() {
                                counters.audio_failed.store(true, Ordering::Release);
                            }
                        })?,
                );
            }
            Ok(publisher)
        }
        Ok(Err(error)) => anyhow::bail!("{error}"),
        Err(_) => anyhow::bail!("A captura não produziu vídeo em 8 s"),
    }
}

#[cfg(windows)]
fn run(
    source: &Source,
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
    let camera = matches!(source, Source::Camera { .. });
    let mut screen_capture = None;
    let mut camera_capture = None;
    let mut synthetic = None;
    match source {
        Source::Screen(source) => {
            // Re-validate the UI's choice against the live source list: a stale or
            // forged handle cannot select some other window.
            let selected = enumerate_sources()?
                .into_iter()
                .find(|candidate| match (candidate, source.kind.as_str()) {
                    (
                        CaptureSource::Window {
                            handle, process_id, ..
                        },
                        "window",
                    ) => *handle as u64 == source.handle && *process_id == source.process_id,
                    (CaptureSource::Monitor { handle, .. }, "monitor") => {
                        *handle as u64 == source.handle
                    }
                    _ => false,
                })
                .context("A janela ou monitor escolhido não está mais disponível")?;
            screen_capture = Some(ScreenCapture::start(
                &runtime,
                &selected,
                CaptureOptions {
                    frames_per_second: fps,
                    include_audio: false,
                },
            )?);
        }
        Source::Camera { device, .. } if device == SYNTHETIC_CAMERA => {
            synthetic = Some((Instant::now(), 0_u64));
        }
        Source::Camera { device, .. } => {
            camera_capture = Some(voxy_media::camera::CameraCapture::start(
                &runtime, device, width, height, fps,
            )?);
        }
    }
    let mut next_frame = || -> Result<Option<voxy_media::CaptureFrame>> {
        if let Some(capture) = screen_capture.as_mut() {
            return capture.next_frame(Duration::from_millis(250));
        }
        if let Some(capture) = camera_capture.as_mut() {
            return capture.next_frame();
        }
        let (started, index) = synthetic.as_mut().context("Fonte ausente")?;
        let due = *started + Duration::from_micros(*index * 1_000_000 / fps as u64);
        if let Some(wait) = due.checked_duration_since(Instant::now()) {
            std::thread::sleep(wait);
        }
        *index += 1;
        Ok(Some(voxy_media::synthetic_camera_frame(
            width, height, *index,
        )))
    };
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
        let Some(frame) = next_frame()? else {
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
                camera,
                share_audio: false,
                keyframe: encoded.keyframe,
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
    _: &Source,
    _: (u32, u32, u32, u32),
    _: &mpsc::Sender<VideoOut>,
    _: &AtomicBool,
    _: &AtomicBool,
    _: &Counters,
    _: &mut Option<std::sync::mpsc::SyncSender<Result<(), String>>>,
) -> Result<()> {
    anyhow::bail!("Compartilhamento de tela disponível apenas no Windows")
}

/// Shared application/system audio: process loopback → mono 48 kHz → Opus
/// (music mode) → the same bounded media queue, marked as share audio.
#[cfg(windows)]
fn share_audio(
    mode: voxy_media::app_audio::LoopbackMode,
    output: &mpsc::Sender<VideoOut>,
    stop: &AtomicBool,
    counters: &Counters,
) -> Result<()> {
    use voxy_voice::codec::{FRAME_SAMPLES, VoiceEncoder};
    let runtime = voxy_media::MediaRuntime::new()?;
    let mut capture = voxy_media::app_audio::ProcessAudioCapture::start(&runtime, mode)?;
    let mut encoder = VoiceEncoder::music()?;
    let mut stereo = Vec::with_capacity(48_000);
    let mut mono: Vec<f32> = Vec::with_capacity(FRAME_SAMPLES * 4);
    let mut frame = [0.0f32; FRAME_SAMPLES];
    let mut packet = [0u8; 1275];
    while !stop.load(Ordering::Acquire) {
        stereo.clear();
        capture.read(&mut stereo, 50)?;
        mono.extend(stereo.as_chunks::<2>().0.iter().map(|[l, r]| (l + r) * 0.5));
        while mono.len() >= FRAME_SAMPLES {
            frame.copy_from_slice(&mono[..FRAME_SAMPLES]);
            mono.drain(..FRAME_SAMPLES);
            let size = encoder.encode(&frame, &mut packet)?;
            if output
                .try_send(VideoOut {
                    frame: packet[..size].into(),
                    duration: Duration::from_millis(20),
                    camera: false,
                    share_audio: true,
                    keyframe: false,
                })
                .is_ok()
            {
                counters.audio_packets.fetch_add(1, Ordering::Relaxed);
            }
        }
        // Bound latency: never keep more than 100 ms of pending audio.
        if mono.len() > FRAME_SAMPLES * 5 {
            mono.clear();
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn share_audio(
    _: voxy_media::app_audio::LoopbackMode,
    _: &mpsc::Sender<VideoOut>,
    _: &AtomicBool,
    _: &Counters,
) -> Result<()> {
    anyhow::bail!("Indisponível")
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
