/// Gate is evaluated before manual gain, with legacy 6 dB hysteresis / 250 ms hold.
#[derive(Default)]
pub struct VoiceGate {
    open: bool,
    hold_samples: u32,
}
impl VoiceGate {
    pub fn process(
        &mut self,
        frame: &mut [f32],
        threshold_db: f32,
        enabled: bool,
        gain: f32,
    ) -> bool {
        let rms = (frame.iter().map(|v| v * v).sum::<f32>() / frame.len().max(1) as f32).sqrt();
        let db = 20.0 * rms.max(0.00001).log10();
        if !enabled {
            self.open = true;
            self.hold_samples = 0;
        } else {
            if db >= threshold_db || (self.open && db >= threshold_db - 6.0) {
                self.hold_samples = 12_000;
            }
            self.open = self.hold_samples > 0;
            self.hold_samples = self.hold_samples.saturating_sub(frame.len() as u32);
        }
        for sample in frame {
            *sample = if self.open && sample.is_finite() {
                (*sample * gain).clamp(-0.98, 0.98)
            } else {
                0.0
            };
        }
        self.open
    }
}
/// Streaming resampler retains phase across callbacks; fixed state, no allocation.
/// High-quality anti-aliasing resampling is required before audio release approval.
pub struct MonoResampler {
    input_rate: f64,
    output_rate: f64,
    phase: f64,
    last: f32,
}
impl MonoResampler {
    pub fn new(input_rate: u32, output_rate: u32) -> Self {
        Self {
            input_rate: input_rate as f64,
            output_rate: output_rate as f64,
            phase: 0.0,
            last: 0.0,
        }
    }
    pub fn push(&mut self, sample: f32, mut output: impl FnMut(f32)) {
        self.phase += self.output_rate;
        while self.phase >= self.input_rate {
            self.phase -= self.input_rate;
            let t = (1.0 - self.phase / self.output_rate).clamp(0.0, 1.0) as f32;
            output(self.last + (sample - self.last) * t);
        }
        self.last = sample;
    }
}
pub fn spatial_mix(distance: f32, pan: f32, range: f32, volume: f32) -> (f32, f32) {
    if !distance.is_finite()
        || !pan.is_finite()
        || !range.is_finite()
        || !volume.is_finite()
        || range <= 0.0
    {
        return (0.0, 0.0);
    }
    let gain = (1.0 - distance.max(0.0) / range).clamp(0.0, 1.0).powi(2) * volume.clamp(0.0, 2.0);
    let angle = (pan.clamp(-1.0, 1.0) + 1.0) * std::f32::consts::FRAC_PI_4;
    (gain * angle.cos(), gain * angle.sin())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gate_hold_precedes_gain_and_spatial_range_is_bounded() {
        let mut gate = VoiceGate::default();
        let mut quiet = [0.0001; 960];
        assert!(!gate.process(&mut quiet, -45.0, true, 2.0));
        let mut loud = [0.1; 960];
        assert!(gate.process(&mut loud, -45.0, true, 1.0));
        for _ in 0..14 {
            let mut silence = [0.0; 960];
            gate.process(&mut silence, -45.0, true, 1.0);
        }
        assert!(!gate.open);
        assert_eq!(spatial_mix(20.0, 0.0, 10.0, 2.0), (0.0, 0.0));
    }
    #[test]
    fn resampler_has_no_frame_count_drift() {
        let mut r = MonoResampler::new(44100, 48000);
        let mut count = 0;
        for _ in 0..44100 {
            r.push(0.0, |_| count += 1);
        }
        assert_eq!(count, 48000);
    }
}
