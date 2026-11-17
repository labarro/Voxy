//! Processing adapter with an explicit render-reference input. Runs off the I/O callback.
//! AEC3's upstream Rust port is experimental; physical certification is still required.
use crate::{control::VoiceControl, dsp::VoiceGate};
use aec3::{
    graph::NodeControlState,
    nodes::audio::AudioFormat,
    pipelines::linear::{self, LinearPipeline},
};
use anyhow::Result;
pub const BLOCK: usize = 480;
/// Shared call/private-monitor capture chain. Device I/O and networking remain
/// outside this object, so deterministic PCM tests cover the actual DSP path.
pub struct CaptureProcessor {
    processing: AudioProcessing,
    gate: VoiceGate,
    threshold: f32,
    voice_detection: bool,
}
impl CaptureProcessor {
    pub fn new(
        echo: bool,
        noise: bool,
        automatic_gain: bool,
        threshold: f32,
        voice_detection: bool,
    ) -> Result<Self> {
        anyhow::ensure!(
            threshold.is_finite() && (-100.0..=0.0).contains(&threshold),
            "Sensibilidade inválida"
        );
        Ok(Self {
            processing: AudioProcessing::with_echo_cancellation(40, echo, noise, automatic_gain)?,
            gate: VoiceGate::default(),
            threshold,
            voice_detection,
        })
    }
    pub fn process(
        &mut self,
        render: &[f32; BLOCK],
        capture: &[f32; BLOCK],
        output: &mut [f32; BLOCK],
        control: &VoiceControl,
    ) -> Result<bool> {
        let produced = self.processing.process(render, capture, output)?;
        if produced {
            self.gate
                .process(output, self.threshold, self.voice_detection, control.gain());
            if !control.may_transmit() {
                output.fill(0.0);
            }
        }
        Ok(produced)
    }
}
pub struct AudioProcessing {
    pipeline: LinearPipeline,
    echo_cancellation: bool,
}
impl AudioProcessing {
    pub fn new(delay_ms: i32, noise: bool, gain: bool) -> Result<Self> {
        Self::with_echo_cancellation(delay_ms, true, noise, gain)
    }
    pub fn with_echo_cancellation(
        delay_ms: i32,
        echo_cancellation: bool,
        noise: bool,
        gain: bool,
    ) -> Result<Self> {
        let format = AudioFormat::ten_ms(48000, 1);
        let mut pipeline = linear::builder(format, format)
            .enable_noise_suppression(noise)
            .enable_gain_controller2(gain)
            .enable_post_filter(false)
            .initial_delay_ms(delay_ms.clamp(0, 500))
            .build()
            .map_err(|e| anyhow::anyhow!("Processamento de voz indisponível: {e}"))?;
        if !echo_cancellation {
            let node = pipeline.handles().aec3.node_id();
            pipeline
                .set_node_state(node, NodeControlState::Bypassed)
                .map_err(|error| {
                    anyhow::anyhow!("Não foi possível desativar o cancelamento de eco: {error}")
                })?;
        }
        Ok(Self {
            pipeline,
            echo_cancellation,
        })
    }
    pub fn process(
        &mut self,
        render: &[f32; BLOCK],
        capture: &[f32; BLOCK],
        output: &mut [f32; BLOCK],
    ) -> Result<bool> {
        anyhow::ensure!(
            render.iter().chain(capture.iter()).all(|v| v.is_finite()),
            "Frame de áudio inválido"
        );
        if self.echo_cancellation {
            self.pipeline
                .handle_render_frame(render)
                .map_err(|e| anyhow::anyhow!("Referência de eco inválida: {e}"))?;
        }
        let produced = self
            .pipeline
            .process_capture_frame(capture, output)
            .map_err(|e| anyhow::anyhow!("Processamento de voz falhou: {e}"))?;
        for sample in output {
            anyhow::ensure!(
                sample.is_finite(),
                "Processamento produziu amostra inválida"
            );
            *sample = sample.clamp(-0.98, 0.98);
        }
        Ok(produced)
    }
    pub fn set_delay(&mut self, delay: i32) -> Result<()> {
        self.pipeline
            .set_delay_ms(delay.clamp(0, 500))
            .map_err(|e| anyhow::anyhow!("Atraso de referência inválido: {e}"))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    fn tone(block: usize, amplitude: f32) -> [f32; BLOCK] {
        std::array::from_fn(|sample| {
            amplitude
                * (std::f32::consts::TAU * 1000.0 * (block * BLOCK + sample) as f32 / 48000.0).sin()
        })
    }
    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }
    #[test]
    fn aec_can_be_bypassed_without_disabling_noise_or_gain_stages() {
        let mut bypass = AudioProcessing::with_echo_cancellation(40, false, false, false).unwrap();
        let mut with_reference =
            AudioProcessing::with_echo_cancellation(40, false, false, false).unwrap();
        let configured = AudioProcessing::with_echo_cancellation(40, false, true, true).unwrap();
        assert!(configured.pipeline.handles().noise_suppression.is_some());
        assert!(configured.pipeline.handles().gain_controller2.is_some());
        let mut a = [0.0; BLOCK];
        let mut b = [0.0; BLOCK];
        for block in 0..100 {
            let capture = tone(block, 0.1);
            assert_eq!(
                bypass.process(&[0.0; BLOCK], &capture, &mut a).unwrap(),
                with_reference
                    .process(&tone(block, 0.8), &capture, &mut b)
                    .unwrap()
            );
            assert_eq!(a, b, "Bypassed AEC must ignore far-end reference");
        }
        let level = rms(&a);
        assert!(
            (0.06..0.08).contains(&level),
            "Normalized 0.1-amplitude PCM unexpectedly attenuated/amplified: {level}"
        );
    }
    #[test]
    fn shared_capture_pipeline_respects_gain_vad_mute_deafen_and_limiter() {
        let control = VoiceControl::default();
        let mut processor = CaptureProcessor::new(false, false, false, -45.0, false).unwrap();
        let mut output = [0.0; BLOCK];
        for block in 0..100 {
            assert!(
                processor
                    .process(&[0.0; BLOCK], &tone(block, 0.1), &mut output, &control)
                    .unwrap()
            );
        }
        let baseline = rms(&output);
        control.set_gain(2.0);
        for block in 100..150 {
            processor
                .process(&[0.0; BLOCK], &tone(block, 0.1), &mut output, &control)
                .unwrap();
        }
        assert!((rms(&output) / baseline - 2.0).abs() < 0.01);
        control.set_gain(0.0);
        processor
            .process(&[0.0; BLOCK], &tone(150, 0.1), &mut output, &control)
            .unwrap();
        assert!(output.iter().all(|sample| *sample == 0.0));
        control.set_gain(2.0);
        for block in 151..170 {
            processor
                .process(&[0.0; BLOCK], &tone(block, 0.9), &mut output, &control)
                .unwrap();
        }
        assert!(
            output
                .iter()
                .all(|sample| sample.is_finite() && sample.abs() <= 0.98)
        );
        control.muted.store(true, Ordering::Release);
        processor
            .process(&[0.0; BLOCK], &tone(170, 0.1), &mut output, &control)
            .unwrap();
        assert!(output.iter().all(|sample| *sample == 0.0));
        control.muted.store(false, Ordering::Release);
        control.deafened.store(true, Ordering::Release);
        processor
            .process(&[0.0; BLOCK], &tone(171, 0.1), &mut output, &control)
            .unwrap();
        assert!(output.iter().all(|sample| *sample == 0.0));
        control.deafened.store(false, Ordering::Release);
        let mut vad = CaptureProcessor::new(false, false, false, -45.0, true).unwrap();
        vad.process(&[0.0; BLOCK], &[0.00001; BLOCK], &mut output, &control)
            .unwrap();
        assert!(output.iter().all(|sample| *sample == 0.0));
        for block in 0..20 {
            vad.process(&[0.0; BLOCK], &tone(block, 0.1), &mut output, &control)
                .unwrap();
        }
        assert!(rms(&output) > 0.05);
        for _ in 0..50 {
            vad.process(&[0.0; BLOCK], &[0.0; BLOCK], &mut output, &control)
                .unwrap();
        }
        assert!(output.iter().all(|sample| *sample == 0.0));
    }
    #[test]
    fn synthetic_voiced_pcm_survives_default_dsp_and_opus_without_silence_or_level_collapse() {
        use crate::codec::{FRAME_SAMPLES, VoiceDecoder, VoiceEncoder};
        let control = VoiceControl::default();
        let mut processor = CaptureProcessor::new(true, true, true, -45.0, false).unwrap();
        let mut encoder = VoiceEncoder::new().unwrap();
        let mut decoder = VoiceDecoder::new().unwrap();
        let mut frame = [0.0; FRAME_SAMPLES];
        let mut count = 0;
        let mut packet = [0u8; 1275];
        let mut decoded = [0.0; FRAME_SAMPLES];
        let mut block = [0.0; BLOCK];
        let mut reference = Vec::new();
        let mut received = Vec::new();
        for index in 0..200 {
            // Generated harmonics with varying pitch/envelope; no recording,
            // physical microphone, network or acoustic-quality claim.
            let capture = std::array::from_fn(|sample| {
                let time = (index * BLOCK + sample) as f32 / 48000.0;
                let phase = std::f32::consts::TAU * 125.0 * time
                    + 5.0 * (1.0 - (std::f32::consts::TAU * 2.0 * time).cos());
                let envelope = 0.55 + 0.45 * (std::f32::consts::TAU * 4.0 * time).sin();
                (1..=5)
                    .map(|harmonic| (phase * harmonic as f32).sin() / harmonic as f32)
                    .sum::<f32>()
                    * 0.12
                    * envelope
            });
            if !processor
                .process(&[0.0; BLOCK], &capture, &mut block, &control)
                .unwrap()
            {
                continue;
            }
            frame[count..count + BLOCK].copy_from_slice(&block);
            count += BLOCK;
            if count == FRAME_SAMPLES {
                reference.extend_from_slice(&frame);
                let size = encoder.encode(&frame, &mut packet).unwrap();
                let samples = decoder.decode(&packet[..size], &mut decoded).unwrap();
                assert_eq!(samples, FRAME_SAMPLES);
                received.extend_from_slice(&decoded);
                count = 0;
            }
        }
        assert!(reference.len() >= 90_000);
        let reference = &reference[48_000..];
        let received = &received[48_000..];
        let reference_rms = rms(reference);
        let decoded_rms = rms(received);
        assert!(
            (0.01..0.5).contains(&reference_rms),
            "DSP normalized PCM level collapsed or clipped: {reference_rms}"
        );
        assert!(
            (0.6..1.4).contains(&(decoded_rms / reference_rms)),
            "Opus level ratio changed unexpectedly: {}",
            decoded_rms / reference_rms
        );
        assert!(
            received
                .iter()
                .all(|sample| sample.is_finite() && sample.abs() < 1.25)
        );
        let mut correlation = 0.0f64;
        for lag in 0..480 {
            let mut cross = 0.0f64;
            let mut input_power = 0.0f64;
            let mut output_power = 0.0f64;
            for sample in 0..12_000 {
                let input = reference[sample] as f64;
                let output = received[sample + lag] as f64;
                cross += input * output;
                input_power += input * input;
                output_power += output * output;
            }
            correlation =
                correlation.max(cross / (input_power * output_power).sqrt().max(f64::EPSILON));
        }
        assert!(
            correlation > 0.8,
            "Synthetic voiced PCM correlation degraded: {correlation}"
        );
        println!(
            "synthetic_pcm_only dsp_rms={reference_rms:.6} decoded_rms={decoded_rms:.6} best_codec_correlation={correlation:.6}"
        );
    }
    #[test]
    fn pipeline_is_bounded_on_silence_and_rejects_nonfinite_input() {
        let mut processor = AudioProcessing::new(40, true, true).unwrap();
        let silence = [0.0; BLOCK];
        let mut output = [0.0; BLOCK];
        let mut produced = 0;
        for _ in 0..50 {
            produced += usize::from(processor.process(&silence, &silence, &mut output).unwrap());
            assert!(output.iter().all(|s| s.is_finite() && s.abs() <= 0.98));
        }
        assert!(produced > 0, "DSP must produce frames after warmup");
        let mut bad = silence;
        bad[0] = f32::NAN;
        assert!(processor.process(&silence, &bad, &mut output).is_err());
    }
}
