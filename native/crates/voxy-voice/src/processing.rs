//! Processing adapter with an explicit render-reference input. Runs off the I/O callback.
//! AEC3's upstream Rust port is experimental; physical certification is still required.
use aec3::{
    nodes::audio::AudioFormat,
    pipelines::linear::{self, LinearPipeline},
};
use anyhow::Result;
pub const BLOCK: usize = 480;
pub struct AudioProcessing {
    pipeline: LinearPipeline,
}
impl AudioProcessing {
    pub fn new(delay_ms: i32, noise: bool, gain: bool) -> Result<Self> {
        let format = AudioFormat::ten_ms(48000, 1);
        let pipeline = linear::builder(format, format)
            .enable_noise_suppression(noise)
            .enable_gain_controller2(gain)
            .enable_post_filter(false)
            .initial_delay_ms(delay_ms.clamp(0, 500))
            .build()
            .map_err(|e| anyhow::anyhow!("Processamento de voz indisponível: {e}"))?;
        Ok(Self { pipeline })
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
        self.pipeline
            .handle_render_frame(render)
            .map_err(|e| anyhow::anyhow!("Referência de eco inválida: {e}"))?;
        let produced = self
            .pipeline
            .process_capture_frame(capture, output)
            .map_err(|e| anyhow::anyhow!("Processamento de voz falhou: {e}"))?;
        for sample in output {
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
