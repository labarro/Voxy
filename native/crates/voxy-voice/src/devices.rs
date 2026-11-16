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
    Ok(devices)
}
fn choose(id: &str, input: bool) -> Result<cpal::Device> {
    let host = cpal::default_host();
    if !id.is_empty()
        && let Ok(id) = id.parse()
        && let Some(device) = host.device_by_id(&id)
    {
        return Ok(device);
    }
    if input {
        host.default_input_device()
    } else {
        host.default_output_device()
    }
    .context("Nenhum dispositivo de áudio disponível")
}
pub struct Capture {
    _stream: cpal::Stream,
    pub samples: rtrb::Consumer<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}
impl Capture {
    /// Called only on explicit microphone action. No network or storage is accessed.
    pub fn start(id: &str, control: Arc<VoiceControl>) -> Result<Self> {
        let device = choose(id, true)?;
        let config = device.default_input_config()?;
        let sample_rate = config.sample_rate();
        let channels = config.channels();
        let (producer, consumer) = rtrb::RingBuffer::new(48_000 / 2);
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => capture::<f32>(&device, &config.into(), producer, control)?,
            cpal::SampleFormat::I16 => capture::<i16>(&device, &config.into(), producer, control)?,
            cpal::SampleFormat::U16 => capture::<u16>(&device, &config.into(), producer, control)?,
            format => bail!("Formato de microfone não suportado: {format:?}"),
        };
        stream.play()?;
        Ok(Self {
            _stream: stream,
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
                    let _ = producer.push(value);
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
    _stream: cpal::Stream,
    pub samples: rtrb::Producer<f32>,
    pub rendered: rtrb::Consumer<f32>,
}
impl Playback {
    pub fn start(id: &str, control: Arc<VoiceControl>) -> Result<Self> {
        let device = choose(id, false)?;
        let config = device.default_output_config()?;
        let (producer, consumer) = rtrb::RingBuffer::new(48_000 / 2);
        let (reference, rendered) = rtrb::RingBuffer::new(24000);
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
            _stream: stream,
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
                    current = consumer.pop().unwrap_or(0.0);
                }
                let sample = if control.deafened.load(Ordering::Relaxed) {
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
        let capture = Capture::start(&input, control.clone())?;
        let playback = Playback::start(&output, control.clone())?;
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopping = stop.clone();
        let worker = std::thread::Builder::new()
            .name("voxy-mic-test".into())
            .spawn(move || {
                // Retain the device owners, including their streams, for the full test.
                let mut capture = capture;
                let mut playback = playback;
                while !stopping.load(Ordering::Acquire) {
                    let mut count = 0;
                    while let Ok(sample) = capture.samples.pop() {
                        let _ = playback
                            .samples
                            .push((sample * control.gain()).clamp(-0.98, 0.98));
                        count += 1;
                        if count >= 960 {
                            break;
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
            })?;
        Ok(Self {
            stop,
            worker: Some(worker),
        })
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
