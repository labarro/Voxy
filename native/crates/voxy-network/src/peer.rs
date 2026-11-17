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
    Audio { sequence: u16, payload: Vec<u8> },
    Closed,
}
struct Handler {
    events: mpsc::Sender<PeerEvent>,
    audio_claimed: std::sync::atomic::AtomicBool,
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
        if track.kind().await != rtc::rtp_transceiver::rtp_sender::RtpCodecKind::Audio
            || self
                .audio_claimed
                .swap(true, std::sync::atomic::Ordering::AcqRel)
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
                    let _ = events.try_send(PeerEvent::Audio {
                        sequence: packet.header.sequence_number,
                        payload: packet.payload.to_vec(),
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
}
impl Peer {
    pub async fn new(policy: &NetworkPolicy, offerer: bool) -> Result<Self> {
        policy.validate()?;
        let (events, receiver) = mpsc::channel(128);
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
                .with_media_engine(media_engine)
                .with_interceptor_registry(registry)
                .with_configuration(config)
                .with_handler(Arc::new(Handler {
                    events: events.clone(),
                    audio_claimed: std::sync::atomic::AtomicBool::new(false),
                }))
                .with_udp_addrs(vec!["0.0.0.0:0", "[::]:0"])
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
    pub async fn add_opus_track(&self) -> Result<OpusTrack> {
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
                    uuid::Uuid::new_v4().to_string(),
                    "microphone".into(),
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
}

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
    let mut left = Peer::new(&NetworkPolicy::default(), true).await?;
    let mut right = Peer::new(&NetworkPolicy::default(), false).await?;
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
    let mut left = Peer::new(&NetworkPolicy::default(), true).await?;
    let mut right = Peer::new(&NetworkPolicy::default(), false).await?;
    let result = async {
        let track = left.add_opus_track().await?;
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
