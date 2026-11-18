//! Native WebRTC transport. Event queues and send buffers have fixed bounds.
use crate::policy::NetworkPolicy;
use anyhow::{Result, ensure};
use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::{
    data_channel::{DataChannel, DataChannelEvent},
    media_stream::track_remote::{TrackRemote, TrackRemoteEvent},
    peer_connection::*,
};

pub enum PeerEvent {
    Ice(RTCIceCandidateInit),
    State(RTCPeerConnectionState),
    DataOpen(Arc<dyn DataChannel>),
    Data(Vec<u8>),
    Audio {
        sequence: u16,
        payload: Vec<u8>,
    },
    /// Audio of an application or monitor the peer is sharing.
    ShareAudio {
        sequence: u16,
        payload: Vec<u8>,
    },
    Closed,
    VideoError(&'static str),
    /// Assembled H.264 access unit, forwarded from the peer's bounded video queue.
    Video(crate::video::VideoFrame),
}
struct Handler {
    events: mpsc::Sender<PeerEvent>,
    audio_claimed: std::sync::atomic::AtomicBool,
    share_claimed: std::sync::atomic::AtomicBool,
    video: Option<mpsc::Sender<crate::video::VideoFrame>>,
    video_claimed: Arc<std::sync::atomic::AtomicUsize>,
}
#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Ok(candidate) = event.candidate.to_json() {
            let _ = self.events.try_send(PeerEvent::Ice(candidate));
        }
    }
    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        let _ = self.events.try_send(PeerEvent::State(state));
    }
    async fn on_data_channel(&self, channel: Arc<dyn DataChannel>) {
        spawn_channel(channel, self.events.clone());
    }
    async fn on_track(&self, track: Arc<dyn TrackRemote>) {
        if track.kind().await == rtc::rtp_transceiver::rtp_sender::RtpCodecKind::Video {
            let Some(video) = self.video.clone() else {
                track.stop().await;
                return;
            };
            if self
                .video_claimed
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel)
                >= 2
            {
                self.video_claimed
                    .fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
                track.stop().await;
                return;
            }
            let claimed = self.video_claimed.clone();
            let events = self.events.clone();
            tokio::spawn(async move {
                let mut assembler = crate::video::VideoAssembler::default();
                // A bounded 4 MiB IDR may arrive as ~3500 MTU-sized packets in a
                // scheduler burst. Permit one such frame without ending the track.
                let mut rate = crate::policy::RateLimit::new(4096, 5000);
                let stream_id = track.track_id().await;
                let mut verified_codec = false;
                while let Some(event) = track.poll().await {
                    match event {
                        TrackRemoteEvent::OnEnded
                        | TrackRemoteEvent::OnEnding
                        | TrackRemoteEvent::OnError => break,
                        TrackRemoteEvent::OnRtpPacket(packet) => {
                            if !verified_codec {
                                if !track.codec(packet.header.ssrc).await.is_some_and(|codec| {
                                    codec.mime_type.eq_ignore_ascii_case("video/h264")
                                }) {
                                    break;
                                }
                                verified_codec = true;
                            }
                            if !rate.allow() {
                                let _ = events.try_send(PeerEvent::VideoError(
                                    "Vídeo excedeu o limite de pacotes",
                                ));
                                break;
                            }
                            match assembler.push(
                                packet.header.timestamp,
                                packet.header.sequence_number,
                                packet.header.marker,
                                &packet.payload,
                            ) {
                                Ok(Some(mut frame)) => {
                                    frame.stream_id = stream_id.clone();
                                    if let Err(error) = video.try_send(frame) {
                                        match error {
                                            mpsc::error::TrySendError::Closed(_) => break,
                                            mpsc::error::TrySendError::Full(_) => {
                                                assembler.request_recovery()
                                            }
                                        }
                                    }
                                }
                                Ok(None) => {}
                                Err(_) => {
                                    let _ = events.try_send(PeerEvent::VideoError(
                                        "Vídeo H.264 inválido ou fora dos limites",
                                    ));
                                    break;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                track.stop().await;
                claimed.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
            });
            return;
        }
        // One microphone track and one shared-application track per peer.
        let share = track.track_id().await == "share-audio";
        let claimed = if share {
            &self.share_claimed
        } else {
            &self.audio_claimed
        };
        if track.kind().await != rtc::rtp_transceiver::rtp_sender::RtpCodecKind::Audio
            || claimed.swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            track.stop().await;
            return;
        }
        let events = self.events.clone();
        tokio::spawn(async move {
            let mut rate = crate::policy::RateLimit::new(60, 100);
            while let Some(event) = track.poll().await {
                if matches!(
                    event,
                    TrackRemoteEvent::OnEnded
                        | TrackRemoteEvent::OnEnding
                        | TrackRemoteEvent::OnError
                ) {
                    break;
                }
                if let TrackRemoteEvent::OnRtpPacket(packet) = event
                    && packet.payload.len() <= 1275
                {
                    if !rate.allow() {
                        // Scheduler stalls may deliver a burst: drop excess frames,
                        // never permanently silence an otherwise healthy track.
                        continue;
                    }
                    let sequence = packet.header.sequence_number;
                    let payload = packet.payload.to_vec();
                    let _ = events.try_send(if share {
                        PeerEvent::ShareAudio { sequence, payload }
                    } else {
                        PeerEvent::Audio { sequence, payload }
                    });
                }
            }
            track.stop().await;
        });
    }
}
fn spawn_channel(channel: Arc<dyn DataChannel>, events: mpsc::Sender<PeerEvent>) {
    tokio::spawn(async move {
        while let Some(event) = channel.poll().await {
            match event {
                DataChannelEvent::OnOpen => {
                    let _ = events.try_send(PeerEvent::DataOpen(channel.clone()));
                }
                DataChannelEvent::OnMessage(message) => {
                    if message.data.len() > 16_384 {
                        let _ = channel.close().await;
                        break;
                    }
                    if events
                        .try_send(PeerEvent::Data(message.data.to_vec()))
                        .is_err()
                    {
                        let _ = channel.close().await;
                        break;
                    }
                }
                DataChannelEvent::OnClose => {
                    let _ = events.try_send(PeerEvent::Closed);
                    break;
                }
                _ => {}
            }
        }
    });
}
pub struct Peer {
    pub connection: Arc<dyn PeerConnection>,
    pub events: mpsc::Receiver<PeerEvent>,
    pub video: Option<mpsc::Receiver<crate::video::VideoFrame>>,
}
impl Peer {
    pub async fn new(policy: &NetworkPolicy, offerer: bool) -> Result<Self> {
        Self::build(policy, offerer, false).await
    }
    pub async fn with_video(policy: &NetworkPolicy, offerer: bool) -> Result<Self> {
        Self::build(policy, offerer, true).await
    }
    async fn build(policy: &NetworkPolicy, offerer: bool, enable_video: bool) -> Result<Self> {
        policy.validate()?;
        let (events, receiver) = mpsc::channel(128);
        let (video_sender, video_receiver) = if enable_video {
            let (tx, rx) = mpsc::channel(2);
            (Some(tx), Some(rx))
        } else {
            (None, None)
        };
        let config = RTCConfigurationBuilder::default()
            .with_ice_servers(
                policy
                    .stun_urls
                    .iter()
                    .map(|url| RTCIceServer {
                        urls: vec![url.clone()],
                        ..Default::default()
                    })
                    .collect(),
            )
            .build();
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;
        let registry = register_default_interceptors(Registry::new(), &mut media_engine)?;
        let connection: Arc<dyn PeerConnection> = Arc::new(
            PeerConnectionBuilder::new()
                // mDNS (QueryOnly by default) binds the fixed port UDP 5353 for every
                // connection. A fixed-port bind is what makes Windows show the Firewall
                // "allow access" dialog, which needs administrator consent on public
                // networks. Native peers exchange IP candidates; mDNS is not needed.
                .with_setting_engine(
                    webrtc::peer_connection::SettingEngineBuilder::new()
                        .with_multicast_dns_mode(rtc::ice::mdns::MulticastDnsMode::Disabled)
                        .build(),
                )
                .with_media_engine(media_engine)
                .with_interceptor_registry(registry)
                .with_configuration(config)
                .with_handler(Arc::new(Handler {
                    events: events.clone(),
                    audio_claimed: std::sync::atomic::AtomicBool::new(false),
                    share_claimed: std::sync::atomic::AtomicBool::new(false),
                    video: video_sender,
                    video_claimed: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                }))
                .with_udp_addrs(if policy.loopback_only {
                    vec!["127.0.0.1:0"]
                } else {
                    vec!["0.0.0.0:0", "[::]:0"]
                })
                .with_data_channel_send_buffer_limit(256 * 1024)
                .build()
                .await?,
        );
        if offerer {
            let channel = connection
                .create_data_channel("voxy-control-v3", None)
                .await?;
            spawn_channel(channel, events);
        }
        Ok(Self {
            connection,
            events: receiver,
            video: video_receiver,
        })
    }
    pub async fn offer(&self) -> Result<RTCSessionDescription> {
        let desc = self.connection.create_offer(None).await?;
        self.connection.set_local_description(desc.clone()).await?;
        Ok(desc)
    }
    pub async fn answer(&self, offer: RTCSessionDescription) -> Result<RTCSessionDescription> {
        ensure!(offer.sdp.len() <= 65_536, "SDP excede o limite");
        self.connection.set_remote_description(offer).await?;
        let answer = self.connection.create_answer(None).await?;
        self.connection
            .set_local_description(answer.clone())
            .await?;
        Ok(answer)
    }
    pub async fn close(&self) -> Result<()> {
        self.connection.close().await?;
        Ok(())
    }
    /// `kind` is "voice" (microphone) or "share-audio" (shared application).
    pub async fn add_opus_track(&self, kind: &str) -> Result<OpusTrack> {
        ensure!(
            matches!(kind, "voice" | "share-audio"),
            "Tipo de áudio inválido"
        );
        use rtc::{
            media_stream::MediaStreamTrack,
            rtp_transceiver::rtp_sender::{
                RTCRtpCodec, RTCRtpCodingParameters, RTCRtpEncodingParameters, RtpCodecKind,
            },
        };
        let ssrc = rand::random::<u32>().max(1);
        let codec = RTCRtpCodec {
            mime_type: "audio/opus".into(),
            clock_rate: 48_000,
            channels: 2,
            sdp_fmtp_line: "minptime=10;useinbandfec=1".into(),
            ..Default::default()
        };
        let track = Arc::new(
            webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample::new(
                std::time::Instant::now(),
                MediaStreamTrack::new(
                    "voxy-voice".into(),
                    kind.into(),
                    kind.into(),
                    RtpCodecKind::Audio,
                    vec![RTCRtpEncodingParameters {
                        rtp_coding_parameters: RTCRtpCodingParameters {
                            ssrc: Some(ssrc),
                            ..Default::default()
                        },
                        codec,
                        active: true,
                        max_bitrate: 64_000,
                        ..Default::default()
                    }],
                ),
            )?,
        );
        self.connection.add_track(track.clone()).await?;
        Ok(OpusTrack { track, ssrc })
    }
    /// `kind` ("screen" or "camera") becomes the track id the receiver sees.
    pub async fn add_h264_track(&self, kind: &str) -> Result<H264Track> {
        ensure!(
            matches!(kind, "screen" | "camera"),
            "Tipo de vídeo inválido"
        );
        ensure!(
            self.video.is_some(),
            "Peer de voz não habilitou transporte de vídeo"
        );
        use rtc::{
            media_stream::MediaStreamTrack,
            rtp_transceiver::rtp_sender::{
                RTCRtpCodec, RTCRtpCodingParameters, RTCRtpEncodingParameters, RtpCodecKind,
            },
        };
        let ssrc = rand::random::<u32>().max(1);
        let codec = RTCRtpCodec {
            mime_type: "video/H264".into(),
            clock_rate: 90_000,
            channels: 0,
            sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f"
                .into(),
            ..Default::default()
        };
        let track = Arc::new(
            webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample::new(
                std::time::Instant::now(),
                MediaStreamTrack::new(
                    "voxy-video".into(),
                    kind.into(),
                    kind.into(),
                    RtpCodecKind::Video,
                    vec![RTCRtpEncodingParameters {
                        rtp_coding_parameters: RTCRtpCodingParameters {
                            ssrc: Some(ssrc),
                            ..Default::default()
                        },
                        codec,
                        active: true,
                        max_bitrate: 20_000_000,
                        ..Default::default()
                    }],
                ),
            )?,
        );
        self.connection.add_track(track.clone()).await?;
        Ok(H264Track { track, ssrc })
    }
}

#[derive(Clone)]
pub struct H264Track {
    track: Arc<webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample>,
    ssrc: u32,
}
impl H264Track {
    pub async fn send(&self, frame: &[u8], duration: std::time::Duration) -> Result<()> {
        ensure!(
            !frame.is_empty()
                && frame.len() <= crate::video::MAX_VIDEO_FRAME
                && (std::time::Duration::from_millis(1)..=std::time::Duration::from_secs(1))
                    .contains(&duration),
            "Frame H.264 ou duração fora dos limites"
        );
        let now = std::time::Instant::now();
        self.track
            .write_sample(
                self.ssrc,
                102,
                &rtc::media::Sample {
                    data: bytes::Bytes::copy_from_slice(frame),
                    duration,
                    ..rtc::media::Sample::new(now)
                },
                &[],
            )
            .await?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct OpusTrack {
    track: Arc<webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample>,
    ssrc: u32,
}
impl OpusTrack {
    pub async fn send(&self, packet: &[u8]) -> Result<()> {
        ensure!(packet.len() <= 1275, "Pacote Opus excede o limite");
        let now = std::time::Instant::now();
        self.track
            .write_sample(
                self.ssrc,
                111,
                &rtc::media::Sample {
                    data: bytes::Bytes::copy_from_slice(packet),
                    duration: std::time::Duration::from_millis(20),
                    ..rtc::media::Sample::new(now)
                },
                &[],
            )
            .await?;
        Ok(())
    }
}

/// Real UDP/ICE/DTLS/SCTP integration on this machine. No signaling service or VPN.
pub async fn local_transport_check() -> Result<serde_json::Value> {
    use std::time::Duration;
    let mut left = Peer::new(
        &NetworkPolicy {
            loopback_only: true,
            ..Default::default()
        },
        true,
    )
    .await?;
    let mut right = Peer::new(
        &NetworkPolicy {
            loopback_only: true,
            ..Default::default()
        },
        false,
    )
    .await?;
    let result = async {
        let offer = left.offer().await?;
        let answer = right.answer(offer).await?;
        left.connection.set_remote_description(answer).await?;
        let mut sent = false;
        let mut received = false;
        let mut connected = 0;
        while !received {
            tokio::select! {
                event=left.events.recv()=>{match event{Some(PeerEvent::Ice(candidate))=>right.connection.add_ice_candidate(candidate).await?,Some(PeerEvent::DataOpen(channel))=>{channel.send_text("voxy-native-dtls-sctp").await?;sent=true;},Some(PeerEvent::State(RTCPeerConnectionState::Connected))=>connected+=1,None=>anyhow::bail!("Peer fechado"),_=>{}}},
                event=right.events.recv()=>{match event{Some(PeerEvent::Ice(candidate))=>left.connection.add_ice_candidate(candidate).await?,Some(PeerEvent::Data(bytes))=>{ensure!(bytes==b"voxy-native-dtls-sctp","Payload divergente");received=true;},Some(PeerEvent::State(RTCPeerConnectionState::Connected))=>connected+=1,None=>anyhow::bail!("Peer fechado"),_=>{}}}
            }
        }
        Ok::<_, anyhow::Error>(
            serde_json::json!({"transport":"native WebRTC ICE/DTLS/SCTP","payloadSent":sent,"payloadReceived":received,"connectedEvents":connected,"publicInternet":false,"turn":false,"vpn":false}),
        )
    };
    let result = tokio::time::timeout(Duration::from_secs(20), result).await;
    let _ = left.close().await;
    let _ = right.close().await;
    result.map_err(|_| anyhow::anyhow!("Negociação não terminou em 20 segundos"))?
}
pub async fn local_media_check(packets: &[Vec<u8>]) -> Result<serde_json::Value> {
    use std::time::Duration;
    ensure!(
        !packets.is_empty() && packets.len() <= 500,
        "Quantidade de frames inválida"
    );
    let mut left = Peer::new(
        &NetworkPolicy {
            loopback_only: true,
            ..Default::default()
        },
        true,
    )
    .await?;
    let mut right = Peer::new(
        &NetworkPolicy {
            loopback_only: true,
            ..Default::default()
        },
        false,
    )
    .await?;
    let result = async {
        let track = left.add_opus_track("voice").await?;
        let offer = left.offer().await?;
        let answer = right.answer(offer).await?;
        left.connection.set_remote_description(answer).await?;
        let mut ready = false;
        let mut sent = 0;
        let mut received = 0;
        let mut tick = tokio::time::interval(Duration::from_millis(20));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        while received < packets.len() {
            tokio::select! {
                _=tick.tick(),if ready&&sent<packets.len()=>{track.send(&packets[sent]).await?;sent+=1;},
                event=left.events.recv()=>match event{Some(PeerEvent::Ice(candidate))=>right.connection.add_ice_candidate(candidate).await?,Some(PeerEvent::DataOpen(_))=>ready=true,None=>anyhow::bail!("Peer fechado"),_=>{}},
                event=right.events.recv()=>match event{Some(PeerEvent::Ice(candidate))=>left.connection.add_ice_candidate(candidate).await?,Some(PeerEvent::Audio{payload,..})=>{ensure!(payload==packets[received],"Payload Opus recebido divergiu");received+=1;},None=>anyhow::bail!("Peer fechado"),_=>{}}
            }
        }
        Ok::<_, anyhow::Error>(
            serde_json::json!({"transport":"Opus/RTP/SRTP/DTLS/ICE","framesSent":sent,"framesReceived":received,"syntheticAudio":true,"physicalDevices":false,"publicInternet":false}),
        )
    };
    let result = tokio::time::timeout(Duration::from_secs(20), result).await;
    let _ = left.close().await;
    let _ = right.close().await;
    result.map_err(|_| anyhow::anyhow!("Mídia não terminou em 20 segundos"))?
}
#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn actual_native_datachannel_transfers_payload_and_closes() {
        let result = super::local_transport_check().await.unwrap();
        assert_eq!(result["payloadReceived"], true);
    }
}
