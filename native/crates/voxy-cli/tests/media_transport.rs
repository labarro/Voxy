#[tokio::test]
async fn encoded_voice_frames_cross_real_native_srtp_and_release_connections() {
    use voxy_voice::codec::*;
    let mut encoder = VoiceEncoder::new().unwrap();
    let mut decoder = VoiceDecoder::new().unwrap();
    let mut packets = Vec::new();
    for frame in 0..12 {
        let mut pcm = [0.0; FRAME_SAMPLES];
        for (i, s) in pcm.iter_mut().enumerate() {
            *s = (((frame * FRAME_SAMPLES + i) as f32) * std::f32::consts::TAU * 440.0 / 48000.0)
                .sin()
                * 0.1;
        }
        let mut packet = [0; 1275];
        let size = encoder.encode(&pcm, &mut packet).unwrap();
        packets.push(packet[..size].to_vec());
    }
    let result = voxy_network::peer::local_media_check(&packets)
        .await
        .unwrap();
    assert_eq!(result["framesReceived"], 12);
    let mut output = [0.0; FRAME_SAMPLES];
    for packet in packets {
        assert_eq!(decoder.decode(&packet, &mut output).unwrap(), FRAME_SAMPLES);
    }
    assert!(output.iter().any(|s| s.abs() > 0.005));
    assert!(output.iter().all(|s| s.is_finite()));
}
