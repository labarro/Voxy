use crate::{control::VoiceControl, dsp::MonoResampler};
use anyhow::{Context, Result, bail};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, atomic::Ordering};

fn device_error(control: &VoiceControl, kind: cpal::ErrorKind) {
    // CPAL explicitly keeps these streams active. A scheduling warning or an
    // initial underrun must not permanently silence an otherwise healthy call.
    if matches!(
        kind,
        cpal::ErrorKind::Xrun | cpal::ErrorKind::RealtimeDenied | cpal::ErrorKind::DeviceChanged
    ) {
        control
            .recoverable_device_events
            .fetch_add(1, Ordering::Relaxed);
    } else {
        control.device_failed.store(true, Ordering::Release);
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub input: bool,
    pub default: bool,
}
pub fn enumerate() -> Result<Vec<AudioDevice>> {
    let host = cpal::default_host();
    let mut devices = Vec::new();
    for (input, default) in [
        (true, host.default_input_device()),
        (false, host.default_output_device()),
    ] {
        let default = default.and_then(|d| d.id().ok()).map(|id| id.to_string());
        for device in if input {
            host.input_devices()?
        } else {
            host.output_devices()?
        } {
            if let (Ok(id), Ok(description)) = (device.id(), device.description()) {
                let id = id.to_string();
                devices.push(AudioDevice {
                    default: default.as_ref() == Some(&id),
                    id,
                    name: description.name().to_string(),
                    input,
                });
            }
        }
    }
    devices.extend(crate::synthetic::devices());
    Ok(devices)
}
fn choose(id: &str, input: bool) -> Result<cpal::Device> {
    let host = cpal::default_host();
    if !id.is_empty() {
        // Never silently open another microphone after an explicitly selected
        // device disappears. Only the empty selection means system default.
        let selected = id
            .parse()
            .context("Identificador de dispositivo inválido")?;
        let device = host
            .device_by_id(&selected)
            .context("Dispositivo selecionado indisponível. Selecione outro dispositivo.")?;
        if input {
            device.default_input_config()?;
        } else {
            device.default_output_config()?;
        }
        return Ok(device);
    }
    if input {
        host.default_input_device()
    } else {
        host.default_output_device()
    }
    .context("Nenhum dispositivo de áudio disponível")
}
/// Physical CPAL stream or the explicit test-only synthetic endpoint.
enum Backend {
    Device(#[allow(dead_code)] cpal::Stream),
    Synthetic(#[allow(dead_code)] crate::synthetic::Worker),
}
pub struct Capture {
    _stream: Backend,
    pub samples: rtrb::Consumer<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}
impl Capture {
    /// Called only on explicit microphone action. No network or storage is accessed.
    pub fn start(id: &str, control: Arc<VoiceControl>) -> Result<Self> {
        if crate::synthetic::is_synthetic(id) {
            let (producer, consumer) = rtrb::RingBuffer::new(4_800);
            return Ok(Self {
                _stream: Backend::Synthetic(crate::synthetic::capture(id, producer, control)?),
                samples: consumer,
                sample_rate: 48_000,
                channels: 1,
            });
        }
        let device = choose(id, true)?;
        let config = device.default_input_config()?;
        let sample_rate = config.sample_rate();
        let channels = config.channels();
        let (producer, consumer) = rtrb::RingBuffer::new(4_800);
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => capture::<f32>(&device, &config.into(), producer, control)?,
            cpal::SampleFormat::I16 => capture::<i16>(&device, &config.into(), producer, control)?,
            cpal::SampleFormat::U16 => capture::<u16>(&device, &config.into(), producer, control)?,
            format => bail!("Formato de microfone não suportado: {format:?}"),
        };
        stream.play()?;
        Ok(Self {
            _stream: Backend::Device(stream),
            samples: consumer,
            sample_rate,
            channels,
        })
    }
}
fn capture<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut producer: rtrb::Producer<f32>,
    control: Arc<VoiceControl>,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    use cpal::Sample;
    let channels = config.channels as usize;
    let mut resample = MonoResampler::new(config.sample_rate, 48000);
    let error_control = control.clone();
    Ok(device.build_input_stream(
        *config,
        move |data: &[T], _| {
            // Sanitize at capture too: muted/PTT-closed samples must not wait
            // in the PCM queue and become audible after a later unmute.
            let allowed = control.may_transmit();
            let mut energy = 0.0;
            let mut count = 0;
            for frame in data.chunks_exact(channels) {
                let mono =
                    frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / channels as f32;
                let mono = if mono.is_finite() { mono } else { 0.0 };
                energy += mono * mono;
                count += 1;
                // No allocation, blocking channel or mutex on this callback.
                resample.push(mono, |value| {
                    if producer.push(if allowed { value } else { 0.0 }).is_err() {
                        control.capture_overruns.fetch_add(1, Ordering::Relaxed);
                    }
                });
            }
            let level = (energy / count.max(1) as f32).sqrt();
            control.level_bits.store(level.to_bits(), Ordering::Relaxed);
            control
                .captured_samples
                .fetch_add(count as u64, Ordering::Relaxed);
        },
        move |error| {
            device_error(&error_control, error.kind());
        },
        None,
    )?)
}
pub struct Playback {
    _stream: Backend,
    pub samples: rtrb::Producer<f32>,
    pub rendered: rtrb::Consumer<f32>,
}
impl Playback {
    pub fn start(id: &str, control: Arc<VoiceControl>) -> Result<Self> {
        if crate::synthetic::is_synthetic(id) {
            let (producer, consumer) = rtrb::RingBuffer::new(4_800);
            let (reference, rendered) = rtrb::RingBuffer::new(4_800);
            return Ok(Self {
                _stream: Backend::Synthetic(crate::synthetic::playback(
                    id, consumer, reference, control,
                )?),
                samples: producer,
                rendered,
            });
        }
        let device = choose(id, false)?;
        let config = device.default_output_config()?;
        let (producer, consumer) = rtrb::RingBuffer::new(4_800);
        let (reference, rendered) = rtrb::RingBuffer::new(4_800);
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                playback::<f32>(&device, &config.into(), consumer, reference, control)?
            }
            cpal::SampleFormat::I16 => {
                playback::<i16>(&device, &config.into(), consumer, reference, control)?
            }
            cpal::SampleFormat::U16 => {
                playback::<u16>(&device, &config.into(), consumer, reference, control)?
            }
            format => bail!("Formato de saída não suportado: {format:?}"),
        };
        stream.play()?;
        Ok(Self {
            _stream: Backend::Device(stream),
            samples: producer,
            rendered,
        })
    }
}
fn playback<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut consumer: rtrb::Consumer<f32>,
    mut reference: rtrb::Producer<f32>,
    control: Arc<VoiceControl>,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    let channels = config.channels as usize;
    let rate = config.sample_rate;
    let mut phase = 0_u64;
    let mut current = 0.0;
    let mut reference_resampler = MonoResampler::new(rate, 48000);
    let error_control = control.clone();
    Ok(device.build_output_stream(
        *config,
        move |data: &mut [T], _| {
            control
                .rendered_samples
                .fetch_add((data.len() / channels) as u64, Ordering::Relaxed);
            for frame in data.chunks_exact_mut(channels) {
                phase += 48_000;
                while phase >= rate as u64 {
                    phase -= rate as u64;
                    current = consumer.pop().unwrap_or_else(|_| {
                        control.playback_underruns.fetch_add(1, Ordering::Relaxed);
                        0.0
                    });
                }
                let sample = if control.deafened.load(Ordering::Relaxed) && !control.cues.audible()
                {
                    0.0
                } else {
                    current.clamp(-0.98, 0.98)
                };
                reference_resampler.push(sample, |value| {
                    let _ = reference.push(value);
                });
                for output in frame {
                    *output = T::from_sample(sample);
                }
            }
        },
        move |error| {
            device_error(&error_control, error.kind());
        },
        None,
    )?)
}

/// Private test guard. Drop releases capture/playback, queue and worker deterministically.
pub struct MicrophoneTest {
    stop: Arc<std::sync::atomic::AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl MicrophoneTest {
    pub fn start(input: String, output: String, control: Arc<VoiceControl>) -> Result<Self> {
        Self::start_config(
            crate::call::CallConfig {
                input,
                output,
                ..Default::default()
            },
            control,
        )
    }
    /// The private monitor uses the same NS/AGC/manual gain/VAD chain as calls.
    /// AEC is bypassed deliberately: monitoring one's own voice through speakers
    /// is not a far-end reference. Use headphones; no network exists in this path.
    pub fn start_config(
        config: crate::call::CallConfig,
        control: Arc<VoiceControl>,
    ) -> Result<Self> {
        anyhow::ensure!(
            config.threshold.is_finite() && (-100.0..=0.0).contains(&config.threshold),
            "Sensibilidade inválida"
        );
        let capture = Capture::start(&config.input, control.clone())?;
        let playback = Playback::start(&config.output, control.clone())?;
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopping = stop.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let worker = std::thread::Builder::new()
            .name("voxy-mic-test".into())
            .spawn(move || {
                // Retain the device owners, including their streams, for the full test.
                let mut capture = capture;
                let mut playback = playback;
                // The upstream graph is thread-confined, so construct and drop
                // it on this owner instead of asserting an unsafe Send contract.
                let mut processor = match crate::processing::CaptureProcessor::new(
                    false,
                    config.noise_suppression,
                    config.automatic_gain,
                    config.threshold,
                    config.voice_detection,
                ) {
                    Ok(processor) => processor,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                        return;
                    }
                };
                let mut capture_block = [0.0; crate::processing::BLOCK];
                let mut count = 0;
                let mut processed = [0.0; crate::processing::BLOCK];
                let mut ready = Some(ready_tx);
                let mut watchdog =
                    crate::call::DeviceWatchdog::new(std::time::Instant::now(), &control);
                while !stopping.load(Ordering::Acquire)
                    && !control.device_failed.load(Ordering::Acquire)
                {
                    if !watchdog.healthy(std::time::Instant::now(), &control) {
                        control.device_failed.store(true, Ordering::Release);
                        break;
                    }
                    while count < crate::processing::BLOCK {
                        match capture.samples.pop() {
                            Ok(sample) => {
                                capture_block[count] = sample;
                                count += 1;
                            }
                            Err(_) => break,
                        }
                    }
                    if count == crate::processing::BLOCK {
                        match processor.process(
                            &[0.0; crate::processing::BLOCK],
                            &capture_block,
                            &mut processed,
                            &control,
                        ) {
                            Ok(true) => {
                                for sample in processed {
                                    let _ = playback.samples.push(sample);
                                }
                                if let Some(ready) = ready.take() {
                                    let _ = ready.send(Ok(()));
                                }
                            }
                            Ok(false) => {}
                            Err(_) => {
                                control.device_failed.store(true, Ordering::Release);
                                break;
                            }
                        }
                        count = 0;
                        for _ in 0..crate::processing::BLOCK {
                            let _ = playback.rendered.pop();
                        }
                    } else {
                        std::thread::sleep(std::time::Duration::from_millis(1));
                    }
                }
            })?;
        match ready_rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(())) => {}
            failure => {
                stop.store(true, Ordering::Release);
                let _ = worker.join();
                if let Ok(Err(error)) = failure {
                    bail!("{error}");
                }
                bail!(
                    "Teste privado não produziu áudio no prazo; verifique dispositivos e processamento"
                );
            }
        }
        Ok(Self {
            stop,
            worker: Some(worker),
        })
    }
    pub fn is_finished(&self) -> bool {
        self.worker
            .as_ref()
            .is_none_or(|worker| worker.is_finished())
    }
}
impl Drop for MicrophoneTest {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_underrun_does_not_kill_call_but_invalidated_stream_does() {
        let control = VoiceControl::default();
        for kind in [
            cpal::ErrorKind::Xrun,
            cpal::ErrorKind::RealtimeDenied,
            cpal::ErrorKind::DeviceChanged,
        ] {
            device_error(&control, kind);
        }
        assert!(!control.device_failed.load(Ordering::Acquire));
        assert_eq!(control.recoverable_device_events.load(Ordering::Relaxed), 3);
        device_error(&control, cpal::ErrorKind::StreamInvalidated);
        assert!(control.device_failed.load(Ordering::Acquire));
        assert!(!control.may_transmit());
    }
}
