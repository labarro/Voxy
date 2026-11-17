//! Persistent authoritative data session and authenticated voice mesh.
//! Media flows directly to each admitted participant, never through signaling.
use crate::{
    framing::Assembler,
    invite::{Invite, SignedSignal},
    peer::{H264Track, OpusTrack, Peer, PeerEvent},
    policy::{NetworkPolicy, RateLimit},
    rendezvous,
    room_service::{ClientPacket, ServerPacket, send_packet},
};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::{SinkExt, StreamExt};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use voxy_core::{
    identity::Identity,
    model::{Community, Profile},
    room::{Command, RoomHost, Snapshot},
    store::{Store, now_ms},
};
use webrtc::{
    data_channel::DataChannel,
    peer_connection::{PeerConnection, RTCIceCandidateInit},
};

pub enum Input {
    Command(Command),
    RotateInvite(Invite),
    Audio(Vec<u8>),
    Stop,
}
pub enum Event {
    Ended,
    Peer(u64, String),
    Phase(&'static str),
    Snapshot(Snapshot),
    Acknowledged(uuid::Uuid),
    Replied(uuid::Uuid, serde_json::Value),
    InviteRotated(Invite),
    Audio {
        peer: u64,
        sequence: u16,
        payload: Vec<u8>,
    },
    Sent(u64),
    PeerRemoved(u64),
    /// Video from a member this participant is watching (host-confirmed).
    /// Shared-application audio from a screen this participant watches.
    ShareAudio {
        peer: u64,
        sequence: u16,
        payload: Vec<u8>,
    },
    Video {
        member: uuid::Uuid,
        camera: bool,
        keyframe: bool,
        bytes: Vec<u8>,
    },
    Links(Vec<voxy_core::ipc::LinkStatus>),
    Error(&'static str),
}
pub struct Config {
    pub invite: Invite,
    pub host: Option<Community>,
    pub database: std::path::PathBuf,
    pub policy: NetworkPolicy,
    /// Evaluated immediately before every outbound audio send. None fails closed.
    /// The session supplies the live mute/deafen/PTT control, independent of snapshots.
    pub microphone_allowed: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    /// Encoded local screen/camera access units. A dedicated bounded queue so video
    /// can never displace voice or control inputs. Held for the duration of a run.
    pub video: Option<Arc<tokio::sync::Mutex<mpsc::Receiver<VideoOut>>>>,
}
/// One encoded H.264 access unit produced by the local publisher.
pub struct VideoOut {
    pub frame: Arc<[u8]>,
    pub duration: Duration,
    /// Camera track instead of screen track.
    pub camera: bool,
    /// Opus packet of the shared application's audio (sent with the screen).
    pub share_audio: bool,
}
struct Link {
    connection: Arc<dyn PeerConnection>,
    track: OpusTrack,
    share_audio: OpusTrack,
    video: H264Track,
    camera: H264Track,
    video_sent: u64,
    video_received: u64,
    channel: Option<Arc<dyn DataChannel>>,
    nonce: String,
    pending: Vec<RTCIceCandidateInit>,
    assembler: Assembler,
    sent: u64,
    received: u64,
    number: u64,
    admitted: bool,
    rate: RateLimit,
    task: tokio::task::JoinHandle<()>,
    created: Instant,
    audio_sent: u64,
    audio_received: u64,
    state: String,
}
impl Link {
    async fn close(self) {
        let _ = self.connection.close().await;
        self.task.abort();
        let _ = self.task.await;
    }
}
async fn create_link(
    policy: &NetworkPolicy,
    key: String,
    nonce: String,
    number: u64,
    offerer: bool,
    tx: mpsc::Sender<(String, u64, PeerEvent)>,
) -> Result<Link> {
    let mut peer = Peer::with_video(policy, offerer).await?;
    let track = peer.add_opus_track("voice").await?;
    let share_audio = peer.add_opus_track("share-audio").await?;
    let video = peer.add_h264_track("screen").await?;
    let camera = peer.add_h264_track("camera").await?;
    let connection = peer.connection.clone();
    let mut frames = peer
        .video
        .take()
        .context("Transporte de vídeo indisponível")?;
    let task = tokio::spawn(async move {
        let mut video_open = true;
        loop {
            let event = tokio::select! {
                event = peer.events.recv() => match event { Some(event) => event, None => break },
                frame = frames.recv(), if video_open => match frame {
                    Some(frame) => PeerEvent::Video(frame),
                    None => { video_open = false; continue }
                },
            };
            // Video is lossy: never block the control/voice path on a slow consumer.
            let result = if matches!(event, PeerEvent::Video(_)) {
                match tx.try_send((key.clone(), number, event)) {
                    Err(mpsc::error::TrySendError::Closed(_)) => Err(()),
                    _ => Ok(()),
                }
            } else {
                tx.send((key.clone(), number, event)).await.map_err(|_| ())
            };
            if result.is_err() {
                break;
            }
        }
    });
    Ok(Link {
        connection,
        track,
        share_audio,
        video,
        camera,
        video_sent: 0,
        video_received: 0,
        channel: None,
        nonce,
        pending: vec![],
        assembler: Assembler::default(),
        sent: 0,
        received: 0,
        number,
        admitted: false,
        rate: RateLimit::new(240, 120),
        task,
        created: Instant::now(),
        audio_sent: 0,
        audio_received: 0,
        state: "new".into(),
    })
}
fn shared_voice(snapshot: &Option<Snapshot>, local: &str, remote: &str) -> bool {
    let Some(snapshot) = snapshot else {
        return false;
    };
    let a = snapshot.members.iter().find(|m| m.public_key == local);
    let b = snapshot.members.iter().find(|m| m.public_key == remote);
    matches!((a,b),(Some(a),Some(b)) if a.voice.is_some() && a.voice==b.voice && !a.deafened && !b.muted && !b.deafened)
}
async fn publish(
    room: &RoomHost,
    links: &HashMap<String, Link>,
    output: &mpsc::Sender<Event>,
) -> Result<Snapshot> {
    let snapshot = room.snapshot()?;
    for (key, link) in links.iter().filter(|(_, l)| l.admitted) {
        if let Some(channel) = &link.channel {
            let _ = send_packet(
                channel,
                &ServerPacket::State {
                    snapshot: Box::new(room.snapshot_for(key)?),
                },
            )
            .await;
        }
    }
    output.send(Event::Snapshot(snapshot.clone())).await.ok();
    Ok(snapshot)
}

pub async fn run(
    config: &Config,
    identity: &Identity,
    profile: &Profile,
    input: &mut mpsc::Receiver<Input>,
    output: &mpsc::Sender<Event>,
) -> Result<()> {
    config.policy.validate()?;
    let local = URL_SAFE_NO_PAD.encode(identity.public_key());
    let is_host = config.host.is_some();
    let mut room = if let Some(server) = &config.host {
        let mut room = RoomHost::new(
            Store::open(&config.database)?,
            server.clone(),
            local.clone(),
        )?;
        room.admit(local.clone(), profile.id, profile.name.clone())?;
        Some(room)
    } else {
        None
    };
    output
        .send(Event::Phase("Conectando à sinalização"))
        .await
        .ok();
    let mut socket = match rendezvous::connect(&config.invite, identity).await {
        Ok(socket) => socket,
        Err(error) => {
            let _ = output.send(Event::Error(signaling_failure(&error))).await;
            return Err(error);
        }
    };
    let signer = socket.signer();
    let (tx, mut rx) = mpsc::channel(256);
    let mut links: HashMap<String, Link> = HashMap::new();
    let mut snapshot = room.as_ref().map(RoomHost::snapshot).transpose()?;
    let mut number = 0;
    let mut maintenance = tokio::time::interval(Duration::from_secs(1));
    maintenance.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut ready = is_host;
    let started = Instant::now();
    let mut rotation: Option<(Invite, Instant)> = None;
    let mut game_deadline: Option<tokio::time::Instant> = None;
    let mut stats_tick = 0_u32;
    let mut video_guard = match &config.video {
        Some(queue) => Some(queue.lock().await),
        None => None,
    };
    let mut video_queue = video_guard.as_deref_mut();
    if let Some(state) = &snapshot {
        output.send(Event::Snapshot(state.clone())).await.ok();
    }
    let result=async {
        loop {
            if room.as_ref().is_some_and(|room|room.games_need_fast_tick()) {
                game_deadline.get_or_insert_with(||tokio::time::Instant::now()+Duration::from_millis(100));
            } else {game_deadline=None;}
            tokio::select! {
                _=crate::room_service::wait_deadline(game_deadline)=>{
                    game_deadline=None;
                    if let Some(room)=room.as_mut() && room.advance_games(now_ms())? {snapshot=Some(publish(room,&links,output).await?);}
                },
                command=input.recv()=>match command {
                    None|Some(Input::Stop)=>break,
                    Some(Input::RotateInvite(replacement))=>{
                        if !is_host || rotation.is_some() || replacement.room!=config.invite.room || replacement.host_key!=local || replacement.signal_url!=config.invite.signal_url {
                            output.send(Event::Error("Renovação de convite recusada: operação inválida ou já pendente")).await.ok();
                        } else {
                            socket.rotate_invite(&replacement,identity).await?;
                            rotation=Some((replacement,Instant::now()));
                        }
                    },
                    Some(Input::Command(command))=>{
                        if let Some(room)=room.as_mut(){
                            let id=command.id;
                            let changes=command.action.changes_snapshot();
                            match room.handle(&local,command){Err(_)=>{output.send(Event::Error("Comando recusado pelo servidor")).await.ok();},Ok(value)=>{output.send(Event::Replied(id,value)).await.ok();output.send(Event::Acknowledged(id)).await.ok();if changes{snapshot=Some(publish(room,&links,output).await?);}}}
                        }else if let Some(channel)=links.get(&config.invite.host_key).and_then(|l|l.channel.as_ref()) {
                            send_packet(channel,&ClientPacket::Command{command}).await?;
                        }else{output.send(Event::Error("O canal ainda está conectando")).await.ok();}
                    },
                    Some(Input::Audio(payload))=>{
                        let mut sent=0;
                        for (key,link) in links.iter_mut() {
                            // Sending is gated by the host's authoritative membership.
                            if config.microphone_allowed.as_ref().is_some_and(|allowed|allowed()) && shared_voice(&snapshot,key,&local) && link.track.send(&payload).await.is_ok(){sent+=1;link.audio_sent+=1;}
                        }
                        if sent>0 {let _=output.try_send(Event::Sent(sent));}
                    }
                },
                video=async {match video_queue.as_mut() {Some(queue)=>queue.recv().await,None=>std::future::pending().await}}=>{
                    let Some(VideoOut{frame,duration,camera,share_audio})=video else {video_queue=None;continue};
                    {
                        // Encode once, send only to links whose member subscribed to this
                        // publisher in the same voice channel (host-confirmed snapshot).
                        let me=snapshot.as_ref().and_then(|s|s.members.iter().find(|m|m.public_key==local)).filter(|m|m.voice.is_some()&&if camera{m.camera}else{m.screen}).cloned();
                        if share_audio {
                            if let Some(me)=&me {
                                for (key,link) in links.iter_mut() {
                                    let watching=snapshot.as_ref().and_then(|s|s.members.iter().find(|m|&m.public_key==key)).is_some_and(|m|m.voice==me.voice&&m.watching.contains(&me.id));
                                    if watching {let _=link.share_audio.send(&frame).await;}
                                }
                            }
                            continue;
                        }
                        if let Some(me)=me {
                            for (key,link) in links.iter_mut() {
                                let watching=snapshot.as_ref().and_then(|s|s.members.iter().find(|m|&m.public_key==key)).is_some_and(|m|m.voice==me.voice&&m.watching.contains(&me.id));
                                let track=if camera{&link.camera}else{&link.video};
                                if watching && track.send(&frame,duration).await.is_ok(){link.video_sent+=1;}
                            }
                        }
                    }
                },
                message=socket.next()=>{
                    let message=message.context("Sinalização encerrada")??;
                    if !message.is_text(){continue}
                    let value:serde_json::Value=serde_json::from_str(message.to_text()?)?;
                    let kind=value["type"].as_str();
                    if kind==Some("invite-revoked"){anyhow::bail!("Convite revogado pelo host; solicite um novo convite");}
                    if kind==Some("invite-rotated") {
                        let (replacement,_)=rotation.take().context("Confirmação de convite sem solicitação pendente")?;
                        ensure!(value["expires_at"].as_i64()==Some(replacement.expires_at),"Confirmação de convite divergente");
                        // Cut the authoritative P2P links too; a revoked guest must not
                        // retain commands or media by ignoring the WebSocket close frame.
                        for (key,link) in links.drain(){
                            output.send(Event::PeerRemoved(link.number)).await.ok();
                            link.close().await;
                            if let Some(room)=room.as_mut(){room.remove(&key);}
                        }
                        if let Some(room)=room.as_ref(){snapshot=Some(publish(room,&links,output).await?);}
                        output.send(Event::InviteRotated(replacement)).await.ok();
                    }
                    let mut discovered=vec![];
                    if kind==Some("welcome") {
                        if let Some(peers)=value["peers"].as_array(){for p in peers {discovered.push(p.clone());}}
                    }else if kind==Some("peer-joined"){discovered.push(value.clone());}
                    for peer in discovered {
                        let key=peer["key"].as_str().context("Identidade ausente")?.to_owned();
                        let nonce=peer["session_nonce"].as_str().context("Sessão ausente")?.to_owned();
                        ensure!(URL_SAFE_NO_PAD.decode(&key)?.len()==32 && URL_SAFE_NO_PAD.decode(&nonce)?.len()==16,"Identidade inválida");
                        if key==local||links.get(&key).is_some_and(|link|link.nonce==nonce){continue}
                        if let Some(old)=links.remove(&key){
                            output.send(Event::PeerRemoved(old.number)).await.ok();old.close().await;
                            if let Some(room)=room.as_mut(){room.remove(&key);}
                        }
                        ensure!(links.len()<9,"Sala cheia");number+=1;
                        // The host initiates its links; other peers elect by public key.
                        let offerer=is_host || (key!=config.invite.host_key && local<key);
                        let mut link=create_link(&config.policy,key.clone(),nonce,number,offerer,tx.clone()).await?;
                        if offerer {
                            let description=link.connection.create_offer(None).await?;
                            link.connection.set_local_description(description.clone()).await?;
                            link.sent+=1;
                            let signal=signer.sign(identity,config.invite.room,key.clone(),link.sent,now_ms()+30000,serde_json::json!({"description":description}))?;
                            socket.send(serde_json::to_string(&signal)?.into()).await?;
                        }
                        output.send(Event::Peer(link.number,key.clone())).await.ok();
                        links.insert(key,link);
                        output.send(Event::Phase("Negociando conexão direta")).await.ok();
                    }
                    if kind==Some("peer-left") {
                        if let Some(key)=value["key"].as_str() && links.get(key).is_some_and(|link|Some(link.nonce.as_str())==value["session_nonce"].as_str()) && let Some(link)=links.remove(key){output.send(Event::PeerRemoved(link.number)).await.ok();link.close().await;if let Some(room)=room.as_mut(){room.remove(key);snapshot=Some(publish(room,&links,output).await?);}else if key==config.invite.host_key{anyhow::bail!("Host offline");}}
                    }else if kind.is_none(){
                        let signal:SignedSignal=serde_json::from_value(value)?;
                        let Some(link)=links.get_mut(&signal.from)else{continue};
                        let apply=async {
                            ensure!(signal.session_nonce==link.nonce,"Sinal de outra sessão");
                            signal.verify(config.invite.room,&signal.from,&local,link.received,now_ms())?;
                            link.received=signal.sequence;
                            if let Some(description)=signal.payload.get("description") {
                                let description:webrtc::peer_connection::RTCSessionDescription=serde_json::from_value(description.clone())?;
                                let offer=description.sdp_type==webrtc::peer_connection::RTCSdpType::Offer;
                                link.connection.set_remote_description(description).await?;
                                for candidate in link.pending.drain(..){link.connection.add_ice_candidate(candidate).await?;}
                                if offer {
                                    let answer=link.connection.create_answer(None).await?;
                                    link.connection.set_local_description(answer.clone()).await?;link.sent+=1;
                                    let reply=signer.sign(identity,config.invite.room,signal.from.clone(),link.sent,now_ms()+30000,serde_json::json!({"description":answer}))?;
                                    socket.send(serde_json::to_string(&reply)?.into()).await?;
                                }
                            }else if let Some(candidate)=signal.payload.get("candidate"){
                                let candidate=serde_json::from_value(candidate.clone())?;
                                if link.connection.remote_description().await.is_some(){link.connection.add_ice_candidate(candidate).await?;}else{ensure!(link.pending.len()<128,"Muitos candidatos");link.pending.push(candidate);}
                            }
                            Ok::<_,anyhow::Error>(())
                        }.await;
                        if apply.is_err(){if let Some(link)=links.remove(&signal.from){link.close().await;}
if let Some(room)=room.as_mut(){room.remove(&signal.from);snapshot=Some(publish(room,&links,output).await?);}}
                    }
                },
                event=rx.recv()=>{
                    let Some((key,generation,event))=event else{break};
                    let Some(link)=links.get_mut(&key)else{continue};
                    if link.number!=generation{continue}
                    match event {
                        PeerEvent::Ice(candidate)=>{
                            link.sent+=1;let signal=signer.sign(identity,config.invite.room,key,link.sent,now_ms()+30000,serde_json::json!({"candidate":candidate}))?;
                            socket.send(serde_json::to_string(&signal)?.into()).await?;
                        },
                        PeerEvent::DataOpen(channel)=>{
                            if link.channel.is_some(){let _=channel.close().await;continue}
                            if !is_host && key==config.invite.host_key {send_packet(&channel,&ClientPacket::Hello{id:profile.id,name:profile.name.clone()}).await?;}
                            link.channel=Some(channel);
                        },
                        PeerEvent::Data(bytes)=>{
                            if !is_host && key!=config.invite.host_key {continue}
                            let packet=if link.rate.allow(){link.assembler.push(&bytes)}else{Err(anyhow::anyhow!("Limite de dados"))};
                            let payload=match packet{Ok(Some(p))=>p,Ok(None)=>continue,Err(_)=>{if let Some(link)=links.remove(&key){link.close().await;}continue}};
                            if let Some(room)=room.as_mut(){
                                let mut changes=false;
                                let result=(||->Result<Option<ServerPacket>> {
                                    match serde_json::from_slice::<ClientPacket>(&payload)? {
                                        ClientPacket::Hello{id,name}=>{ensure!(!link.admitted,"Já autenticado");room.admit(key.clone(),id,name)?;link.admitted=true;changes=true;},
                                        ClientPacket::Command{command}=>{ensure!(link.admitted,"Perfil não admitido");let id=command.id;let changed=command.action.changes_snapshot();let value=room.handle(&key,command)?;changes=changed;return Ok(Some(ServerPacket::Reply{id,value}));}
                                    };Ok(None)
                                })();
                                if let Some(channel)=&link.channel {match result {Ok(Some(reply))=>{let _=send_packet(channel,&reply).await;},Ok(None)=>{},Err(_)=>{let _=send_packet(channel,&ServerPacket::Error{message:"Comando recusado: verifique autoria e permissões".into()}).await;}}}
                                if changes{snapshot=Some(publish(room,&links,output).await?);}
                            }else{
                                match serde_json::from_slice::<ServerPacket>(&payload)? {
                                    ServerPacket::State{snapshot:state}=>{ensure!(state.server.id==config.invite.room && state.members.len()<=10,"Snapshot fora da sessão");ready=true;snapshot=Some(*state.clone());output.send(Event::Snapshot(*state)).await.ok();},
                                    ServerPacket::Error{..}=>{output.send(Event::Error("Comando recusado pelo host")).await.ok();},
                                    ServerPacket::Reply{id,value}=>{output.send(Event::Replied(id,value)).await.ok();output.send(Event::Acknowledged(id)).await.ok();}
                                }
                            }
                        },
                        PeerEvent::Audio{sequence,payload}=>{
                            if shared_voice(&snapshot,&local,&key) {link.audio_received+=1;let _=output.try_send(Event::Audio{peer:link.number,sequence,payload});}
                        },
                        PeerEvent::Closed|PeerEvent::State(webrtc::peer_connection::RTCPeerConnectionState::Failed)=>{
                            if let Some(link)=links.remove(&key){output.send(Event::PeerRemoved(link.number)).await.ok();link.close().await;}
                            if let Some(room)=room.as_mut(){room.remove(&key);snapshot=Some(publish(room,&links,output).await?);}else if key==config.invite.host_key{anyhow::bail!("A conexão direta com o host foi interrompida. Reconectando; redes restritivas podem exigir relay, que permanece desativado");}
                        },
                        PeerEvent::State(state)=>link.state=format!("{state:?}").to_lowercase(),
                        PeerEvent::ShareAudio{sequence,payload}=>{
                            let members=snapshot.as_ref().map(|s|s.members.as_slice()).unwrap_or_default();
                            let me=members.iter().find(|m|m.public_key==local);
                            let publisher=members.iter().find(|m|m.public_key==key);
                            if let (Some(me),Some(publisher))=(me,publisher)
                                && me.voice.is_some() && me.voice==publisher.voice && publisher.screen && me.watching.contains(&publisher.id) && !me.deafened {
                                let _=output.try_send(Event::ShareAudio{peer:link.number,sequence,payload});
                            }
                        },
                        PeerEvent::Video(frame)=>{
                            let members=snapshot.as_ref().map(|s|s.members.as_slice()).unwrap_or_default();
                            let me=members.iter().find(|m|m.public_key==local);
                            let publisher=members.iter().find(|m|m.public_key==key);
                            if let (Some(me),Some(publisher))=(me,publisher)
                                && me.voice.is_some() && me.voice==publisher.voice && me.watching.contains(&publisher.id)
                                && if frame.stream_id=="camera" {publisher.camera} else {publisher.screen} {
                                link.video_received+=1;
                                let _=output.try_send(Event::Video{member:publisher.id,camera:frame.stream_id=="camera",keyframe:frame.keyframe,bytes:frame.bytes});
                            }
                        },
                        _=>{}
                    }
                },
                _=maintenance.tick()=>{
                    stats_tick=stats_tick.wrapping_add(1);
                    if stats_tick.is_multiple_of(2) {let _=output.try_send(Event::Links(link_statuses(&links).await));}
                    if let Some(room)=room.as_mut() && room.has_games() && !room.games_need_fast_tick() && room.advance_games(now_ms())?{snapshot=Some(publish(room,&links,output).await?);}
                    if rotation.as_ref().is_some_and(|(_,started)|started.elapsed()>Duration::from_secs(8)) {anyhow::bail!("Renovação de convite sem confirmação; reconecte antes de compartilhar");}
                    let stale:Vec<_>=links.iter().filter(|(_,l)|l.channel.is_none()&&l.created.elapsed()>Duration::from_secs(20)).map(|(key,_)|key.clone()).collect();
                    for key in stale{if let Some(link)=links.remove(&key){link.close().await;}
if key==config.invite.host_key{output.send(Event::Error("A sinalização conectou, mas a rota P2P não abriu em 20 s. NAT/CGNAT ou firewall podem bloquear a conexão direta; TURN está desativado")).await.ok();anyhow::bail!("Tempo de conexão P2P esgotado");}
output.send(Event::Error("Um participante não conseguiu estabelecer a rota P2P em 20 s; verifique NAT/firewall. TURN permanece desativado")).await.ok();}
                    if !ready && started.elapsed()>Duration::from_secs(20){anyhow::bail!("Host indisponível");}
                }
            }
        }
        Ok(())
    }.await;
    for (_, link) in links {
        link.close().await;
    }
    let _ = socket.close(None).await;
    result
}

/// Transport diagnostics per link from the WebRTC stats of the nominated ICE pair.
/// Never includes SDP, candidate addresses or invite material.
async fn link_statuses(links: &HashMap<String, Link>) -> Vec<voxy_core::ipc::LinkStatus> {
    use webrtc::peer_connection::{RTCStatsReportEntry, StatsSelector};
    let mut statuses = Vec::with_capacity(links.len());
    for (key, link) in links {
        let report = link
            .connection
            .get_stats(Instant::now(), StatsSelector::None)
            .await;
        let pair = report
            .candidate_pairs()
            .filter(|pair| pair.nominated)
            .max_by_key(|pair| pair.bytes_received + pair.bytes_sent);
        let candidate_type = |id: &str| match report.get(id) {
            Some(
                RTCStatsReportEntry::LocalCandidate(c) | RTCStatsReportEntry::RemoteCandidate(c),
            ) => format!("{:?}", c.candidate_type).to_lowercase(),
            _ => String::new(),
        };
        let route = match pair {
            None => "negociando".to_owned(),
            Some(pair) => {
                let (local, remote) = (
                    candidate_type(&pair.local_candidate_id),
                    candidate_type(&pair.remote_candidate_id),
                );
                if local.contains("relay") || remote.contains("relay") {
                    "relay".into()
                } else if local.contains("host") && remote.contains("host") {
                    "direto-lan".into()
                } else {
                    "direto-stun".into()
                }
            }
        };
        statuses.push(voxy_core::ipc::LinkStatus {
            peer: link.number,
            key: key.clone(),
            state: link.state.clone(),
            data_open: link.channel.is_some(),
            route,
            rtt_ms: pair
                .filter(|pair| pair.current_round_trip_time > 0.0)
                .map(|pair| (pair.current_round_trip_time * 1000.0).round() as u32),
            audio_sent: link.audio_sent,
            audio_received: link.audio_received,
            video_sent: link.video_sent,
            video_received: link.video_received,
            bytes_sent: pair.map_or(0, |pair| pair.bytes_sent),
            bytes_received: pair.map_or(0, |pair| pair.bytes_received),
            level: 0.0,
            speaking: false,
        });
    }
    statuses.sort_by_key(|status| status.peer);
    statuses
}

/// Maps signaling admission failures to actionable, non-sensitive diagnostics.
fn signaling_failure(error: &anyhow::Error) -> &'static str {
    let text = error.to_string();
    if text.contains("429") {
        "Sinalização recusou por limite gratuito (salas simultâneas ou admissões diárias). Aguarde alguns minutos; nenhum serviço pago é usado"
    } else if text.contains("403") {
        "Sinalização recusou o convite: expirado, revogado ou inválido. Peça um novo convite ao host"
    } else if text.contains("409") {
        "Host offline ou identidade já conectada nesta sala. Confirme que o host está hospedando e tente novamente"
    } else if text.contains("503") {
        "Sinalização experimental desativada no servidor"
    } else {
        "Não foi possível abrir a sinalização segura. Confira DNS, conexão, TLS e validade do convite; tentando reconectar sem relay pago"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejected_signaling_emits_redacted_diagnostic_before_returning() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0_u8; 8192];
            let _ = stream.read(&mut bytes).await;
            let _ = stream
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
        });
        let identity = Identity::generate();
        let room = uuid::Uuid::new_v4();
        let invite = Invite::create(
            &identity,
            room,
            &format!("ws://127.0.0.1:{port}/v3/{room}"),
            now_ms() + 60000,
        )
        .unwrap();
        let config = Config {
            invite,
            host: None,
            database: Default::default(),
            policy: crate::policy::NetworkPolicy {
                loopback_only: true,
                ..Default::default()
            },
            microphone_allowed: None,
            video: None,
        };
        let (_sender, mut input) = mpsc::channel(8);
        let (output, mut events) = mpsc::channel(8);
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            run(&config, &identity, &Profile::default(), &mut input, &output),
        )
        .await
        .unwrap();
        assert!(result.is_err());
        let mut diagnostic = None;
        while let Ok(event) = events.try_recv() {
            if let Event::Error(message) = event {
                diagnostic = Some(message);
            }
        }
        let message =
            diagnostic.expect("A refused signaling connection must be visible to the session/UI");
        assert!(message.contains("recusou o convite"), "{message}");
        assert!(!message.contains(&config.invite.capability));
        assert!(!message.contains("voxy-native://"));
        server.await.unwrap();
    }
    #[test]
    fn signaling_admission_failures_map_to_actionable_redacted_messages() {
        let quota = signaling_failure(&anyhow::anyhow!("HTTP error: 429 Too Many Requests"));
        assert!(quota.contains("limite gratuito") && quota.contains("nenhum serviço pago"));
        assert!(
            signaling_failure(&anyhow::anyhow!("HTTP error: 409 Conflict"))
                .contains("Host offline")
        );
        assert!(signaling_failure(&anyhow::anyhow!("dns error")).contains("Confira DNS"));
    }
    #[test]
    fn audio_requires_authoritative_shared_channel_and_mute_priority() {
        let mut snapshot = Snapshot {
            server: Community {
                id: uuid::Uuid::new_v4(),
                name: "a".into(),
                owner: uuid::Uuid::new_v4(),
            },
            channels: vec![],
            members: vec![],
            messages: vec![],
            friends: vec![],
            direct: vec![],
            notifications: vec![],
            roles: vec![],
            member_roles: vec![],
            profiles: vec![],
            deleted_messages: vec![],
            games: vec![],
            history_revision: 0,
        };
        let channel = uuid::Uuid::new_v4();
        for key in ["local", "remote"] {
            snapshot.members.push(voxy_core::room::Member {
                public_key: key.into(),
                id: uuid::Uuid::new_v4(),
                name: key.into(),
                voice: Some(channel),
                muted: false,
                deafened: false,
                screen: false,
                camera: false,
                watching: vec![],
                screen_size: None,
                camera_size: None,
            });
        }
        assert!(shared_voice(&Some(snapshot.clone()), "local", "remote"));
        snapshot.members[1].muted = true;
        assert!(!shared_voice(&Some(snapshot.clone()), "local", "remote"));
        snapshot.members[1].muted = false;
        snapshot.members[0].deafened = true;
        assert!(!shared_voice(&Some(snapshot), "local", "remote"));
        assert!(!shared_voice(&None, "local", "remote"));
    }
}
