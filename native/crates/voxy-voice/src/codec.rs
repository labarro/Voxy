use anyhow::Result;
pub const SAMPLE_RATE: u32 = 48_000;
pub const FRAME_SAMPLES: usize = 960;
pub struct VoiceEncoder(opus::Encoder);
pub struct VoiceDecoder(opus::Decoder);
impl VoiceEncoder {
    pub fn new() -> Result<Self> {
        let mut encoder =
            opus::Encoder::new(SAMPLE_RATE, opus::Channels::Mono, opus::Application::Voip)?;
        encoder.set_bitrate(opus::Bitrate::Bits(32_000))?;
        encoder.set_inband_fec(true)?;
        encoder.set_packet_loss_perc(5)?;
        encoder.set_dtx(true)?;
        Ok(Self(encoder))
    }
    pub fn encode(&mut self, pcm: &[f32; FRAME_SAMPLES], packet: &mut [u8; 1275]) -> Result<usize> {
        Ok(self.0.encode_float(pcm, packet)?)
    }
}
impl VoiceDecoder {
    pub fn new() -> Result<Self> {
        Ok(Self(opus::Decoder::new(SAMPLE_RATE, opus::Channels::Mono)?))
    }
    pub fn decode(&mut self, packet: &[u8], pcm: &mut [f32; FRAME_SAMPLES]) -> Result<usize> {
        Ok(self.0.decode_float(packet, pcm, false)?)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opus_roundtrip_and_packet_loss_concealment_are_finite() {
        let mut encoder = VoiceEncoder::new().unwrap();
        let mut decoder = VoiceDecoder::new().unwrap();
        let mut frame = [0.0; FRAME_SAMPLES];
        for (i, s) in frame.iter_mut().enumerate() {
            *s = (i as f32 * std::f32::consts::TAU * 440.0 / 48000.0).sin() * 0.2;
        }
        let mut packet = [0; 1275];
        let n = encoder.encode(&frame, &mut packet).unwrap();
        let mut output = [0.0; FRAME_SAMPLES];
        assert_eq!(
            decoder.decode(&packet[..n], &mut output).unwrap(),
            FRAME_SAMPLES
        );
        assert!(output.iter().all(|s| s.is_finite()));
        assert_eq!(decoder.decode(&[], &mut output).unwrap(), FRAME_SAMPLES);
    }
}
