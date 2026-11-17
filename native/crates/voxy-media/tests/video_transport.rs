#![cfg(windows)]
//! Real codec -> RTP/SRTP/DTLS/ICE -> decoder on loopback, synthetic pixels only.
use anyhow::{Result, ensure};
use std::time::Duration;
use voxy_media::{
    MediaRuntime,
    codec::{EncodedFrame, EncoderPreference, H264Decoder, H264Encoder, Nv12Frame, VideoFormat},
};
use voxy_network::{
    peer::{Peer, PeerEvent},
    policy::NetworkPolicy,
};

#[tokio::test(flavor = "current_thread")]
#[ignore = "uses installed Windows H.264 codec and real local ICE/SRTP transport; no screen/webcam/audio capture"]
async fn h264_software_frames_cross_native_srtp_and_decode() -> Result<()> {
    let runtime = MediaRuntime::new()?;
    let format = VideoFormat {
        width: 64,
        height: 64,
        frames_per_second: 30,
        bitrate: 400_000,
    };
    let mut encoder = H264Encoder::new(&runtime, format, EncoderPreference::Software)?;
    let mut encoded = Vec::new();
    for index in 0..16 {
        let mut pixels = vec![80 + index as u8 * 3; 6144];
        pixels[4096..].fill(128);
        encoded.extend(encoder.encode(&Nv12Frame {
            width: 64,
            height: 64,
            timestamp_us: index * 33_333,
            pixels: pixels.into(),
        })?);
    }
    encoded.extend(encoder.finish()?);
    ensure!(
        encoded.len() == 16,
        "Encoder did not produce sixteen frames"
    );
    drop(encoder);
    let mut decoder = H264Decoder::new(&runtime, format)?;
    let mut sender = Peer::with_video(&NetworkPolicy::default(), true).await?;
    let mut receiver = Peer::with_video(&NetworkPolicy::default(), false).await?;
    let mut frames = receiver.video.take().unwrap();
    let track = sender.add_h264_track().await?;
    let result = async {
        let offer = sender.offer().await?;
        let answer = receiver.answer(offer).await?;
        sender.connection.set_remote_description(answer).await?;
        let mut ready = false;
        let mut sent = 0;
        let mut received = 0;
        let mut decoded = Vec::new();
        let mut previous = None;
        let mut stream = None;
        let mut tick = tokio::time::interval(Duration::from_micros(33_333));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        while received < 16 {
            tokio::select! {
                _=tick.tick(),if ready&&sent<encoded.len()=>{track.send(&encoded[sent].bytes,Duration::from_micros(33_333)).await?;sent+=1;},
                event=sender.events.recv()=>match event{Some(PeerEvent::Ice(candidate))=>receiver.connection.add_ice_candidate(candidate).await?,Some(PeerEvent::DataOpen(_))=>ready=true,None=>anyhow::bail!("Sender ended"),_=>{}},
                event=receiver.events.recv()=>match event{Some(PeerEvent::Ice(candidate))=>sender.connection.add_ice_candidate(candidate).await?,None=>anyhow::bail!("Receiver ended"),_=>{}},
                frame=frames.recv()=>{let frame=frame.ok_or_else(||anyhow::anyhow!("Video track ended"))?;
                    ensure!(!frame.stream_id.is_empty(),"Track identity missing");
                    if let Some(id)=&stream{ensure!(id==&frame.stream_id,"Track identity changed");}else{stream=Some(frame.stream_id.clone());}
                    if let Some(timestamp)=previous{ensure!(frame.timestamp.wrapping_sub(timestamp)>0&&frame.timestamp.wrapping_sub(timestamp)<0x80000000,"RTP timestamp regressed");}previous=Some(frame.timestamp);
                    decoded.extend(decoder.decode(&EncodedFrame{timestamp_us:received*33_333,duration_us:33_333,keyframe:frame.keyframe,bytes:frame.bytes.into()})?);received+=1;
                }
            }
        }
        decoded.extend(decoder.finish()?);
        ensure!(
            decoded.len() == 16,
            "SRTP codec roundtrip lost decoded frames"
        );
        let mut total_error = 0f64;
        for (index, frame) in decoded.iter().enumerate() {
            ensure!(frame.pixels.len() == 6144, "NV12 stride changed");
            let expected = 80 + index as u8 * 3;
            let error = frame.pixels[..4096]
                .iter()
                .map(|value| value.abs_diff(expected) as f64)
                .sum::<f64>()
                / 4096.0;
            ensure!(
                error < 6.0,
                "Received luminance differs from generated frame: {error}"
            );
            total_error += error;
        }
        println!(
            "video: 16 generated NV12 frames -> Microsoft software H264 -> native RTP/SRTP/DTLS/ICE -> bounded RFC6184 assembler -> Microsoft NV12 decoder, Y-MAE={:.4}; one loopback machine, no public network, capture, display or hardware codec validation",
            total_error / 16.0
        );
        Ok::<_, anyhow::Error>(())
    };
    let result = tokio::time::timeout(Duration::from_secs(15), result).await;
    let _ = sender.close().await;
    let _ = receiver.close().await;
    result.map_err(|_| anyhow::anyhow!("Video transport timed out"))?
}
