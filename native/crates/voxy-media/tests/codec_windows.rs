#![cfg(windows)]
//! Uses generated pixel buffers only; never opens screen, microphone or camera.
use anyhow::{Result, ensure};
use voxy_media::{
    CaptureFrame, MediaRuntime,
    codec::{
        EncodedFrame, EncoderPreference, H264Decoder, H264Encoder, MAX_ENCODED_BYTES, VideoFormat,
        bgra_to_nv12,
    },
};

#[test]
fn conversion_and_codec_input_limits_preserve_sdr_layout() -> Result<()> {
    let frame = CaptureFrame {
        width: 2,
        height: 2,
        timestamp_us: 0,
        pixels: vec![
            0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255,
        ]
        .into(),
    };
    let nv12 = bgra_to_nv12(&frame)?;
    ensure!(
        nv12.pixels.as_ref() == [82, 82, 82, 82, 90, 240],
        "BT.601 limited-range red fixture changed"
    );
    ensure!(
        bgra_to_nv12(&CaptureFrame {
            width: 3,
            ..frame.clone()
        })
        .is_err(),
        "Odd-width accepted"
    );
    ensure!(
        bgra_to_nv12(&CaptureFrame {
            pixels: vec![0; 1].into(),
            ..frame
        })
        .is_err(),
        "Truncated BGRA accepted"
    );
    Ok(())
}

#[test]
#[ignore = "uses the installed Windows software H.264 MFT encoder/decoder on synthetic pixels only"]
fn software_h264_roundtrip_and_malformed_limits() -> Result<()> {
    let runtime = MediaRuntime::new()?;
    let format = VideoFormat {
        width: 64,
        height: 64,
        frames_per_second: 30,
        bitrate: 400_000,
    };
    ensure!(
        H264Encoder::new(&runtime, format, EncoderPreference::RequireHardware).is_err(),
        "Hardware requirement silently fell back"
    );
    let mut encoder = H264Encoder::new(&runtime, format, EncoderPreference::Software)?;
    let mut expected = vec![];
    let mut encoded = vec![];
    for index in 0..16 {
        if index == 8 {
            encoder.set_bitrate(300_000)?;
            encoder.request_keyframe()?;
        }
        let mut pixels = vec![0; 64 * 64 * 4];
        for y in 0..64 {
            for x in 0..64 {
                let offset = (y * 64 + x) * 4;
                let color = if x < 32 {
                    [30, 90, 180, 255]
                } else {
                    [200, 120, 40, 255]
                };
                pixels[offset..offset + 4].copy_from_slice(&color);
            }
        }
        let frame = bgra_to_nv12(&CaptureFrame {
            width: 64,
            height: 64,
            timestamp_us: index * 33_333,
            pixels: pixels.into(),
        })?;
        encoded.extend(encoder.encode(&frame)?);
        expected.push(frame);
    }
    encoded.extend(encoder.finish()?);
    ensure!(
        encoded.len() == 16,
        "Encoder lost input frames: {}",
        encoded.len()
    );
    ensure!(
        encoded.iter().any(|frame| frame.keyframe),
        "Encoder did not identify a keyframe"
    );
    ensure!(
        encoded
            .iter()
            .any(|frame| frame.keyframe && frame.timestamp_us == 8 * 33_333),
        "Requested recovery keyframe missing"
    );
    let bytes = encoded.iter().map(|frame| frame.bytes.len()).sum::<usize>();
    let mut decoder = H264Decoder::new(&runtime, format)?;
    let mut decoded = vec![];
    for frame in &encoded {
        decoded.extend(decoder.decode(frame)?);
    }
    decoded.extend(decoder.finish()?);
    ensure!(
        decoded.len() == 16,
        "Decoder lost frames: {}",
        decoded.len()
    );
    let mut error = 0u64;
    let mut samples = 0u64;
    for frame in &decoded {
        ensure!(
            frame.width == 64 && frame.height == 64 && frame.pixels.len() == 6144,
            "Decoded dimensions/stride incorrect"
        );
        let expected = expected
            .iter()
            .find(|original| original.timestamp_us.abs_diff(frame.timestamp_us) <= 1)
            .ok_or_else(|| anyhow::anyhow!("Timestamp did not survive the round trip"))?;
        for (actual, reference) in frame.pixels.iter().zip(expected.pixels.iter()) {
            error += actual.abs_diff(*reference) as u64;
            samples += 1;
        }
    }
    let mean = error as f64 / samples as f64;
    ensure!(
        mean < 6.0,
        "Decoded NV12 differs too much from synthetic pixels: MAE={mean}"
    );
    let mut malformed = H264Decoder::new(&runtime, format)?;
    for bytes in [vec![], vec![0; MAX_ENCODED_BYTES + 1]] {
        ensure!(
            malformed
                .decode(&EncodedFrame {
                    timestamp_us: 0,
                    duration_us: 33_333,
                    keyframe: true,
                    bytes: bytes.into()
                })
                .is_err(),
            "Oversized/empty H.264 bypassed guard"
        );
    }
    let invalid = malformed.decode(&EncodedFrame {
        timestamp_us: 0,
        duration_us: 33_333,
        keyframe: true,
        bytes: vec![0xff; 128].into(),
    });
    ensure!(
        invalid.as_ref().map_or(true, |frames| frames.is_empty()),
        "Malformed bitstream produced a decoded frame"
    );
    println!(
        "h264: Microsoft software MFT, 16 synthetic NV12 frames encoded/decoded, bytes={bytes}, MAE={mean:.4}, timestamp/stride retained; hardware-required denied, malformed/empty/oversize guarded; no capture, webcam, UI, RTP or hardware-encode validation"
    );
    Ok(())
}

/// 360p (height not a multiple of 16): the decoder pads the output surface to
/// 368 rows. Decoding must keep working and the chroma plane must come from the
/// padded offset, so the top and bottom halves keep their colors.
#[test]
#[ignore = "uses the installed Windows software H.264 MFT encoder/decoder on synthetic pixels only"]
fn software_h264_decodes_heights_not_aligned_to_16() -> Result<()> {
    let runtime = MediaRuntime::new()?;
    let format = VideoFormat {
        width: 640,
        height: 360,
        frames_per_second: 30,
        bitrate: 700_000,
    };
    let mut encoder = H264Encoder::new(&runtime, format, EncoderPreference::Software)?;
    let mut decoder = H264Decoder::new(&runtime, format)?;
    let mut decoded = vec![];
    for index in 0..20 {
        let mut pixels = vec![0; 640 * 360 * 4];
        for y in 0..360 {
            for x in 0..640 {
                let offset = (y * 640 + x) * 4;
                // Blue on top, red at the bottom (BGRA).
                let color = if y < 180 {
                    [200, 40, 30, 255]
                } else {
                    [30, 40, 200, 255]
                };
                pixels[offset..offset + 4].copy_from_slice(&color);
            }
        }
        let nv12 = bgra_to_nv12(&CaptureFrame {
            width: 640,
            height: 360,
            timestamp_us: index * 33_333,
            pixels: pixels.into(),
        })?;
        for frame in encoder.encode(&nv12)? {
            decoded.extend(decoder.decode(&frame)?);
        }
    }
    for frame in encoder.finish()? {
        decoded.extend(decoder.decode(&frame)?);
    }
    ensure!(
        decoded.len() >= 10,
        "360p decoded only {} pictures",
        decoded.len()
    );
    let last = decoded.last().unwrap();
    ensure!(
        last.width == 640 && last.height == 360,
        "wrong picture size"
    );
    // Chroma: V (Cr) is high for red, low for blue.
    let uv = &last.pixels[640 * 360..];
    let v_at = |row: usize| uv[row * 640 + 321] as i32;
    ensure!(
        v_at(20) < 128 && v_at(160) > 128,
        "chroma rows {} / {}",
        v_at(20),
        v_at(160)
    );
    Ok(())
}
