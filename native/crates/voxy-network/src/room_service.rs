//! User-hosted authoritative rooms over native WebRTC data channels.
//! WSS only carries signed signaling. History and commands never go to the DO.
use crate::{
    framing::{self, Assembler},
    invite::{Invite, SignedSignal},
    peer::{Peer, PeerEvent},
    policy::{NetworkPolicy, RateLimit},
    rendezvous::{self, SignalSocket},
};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use voxy_core::{
    identity::Identity,
    model::Profile,
    room::{Command, RoomHost, Snapshot},
    store::now_ms,
};
use webrtc::{
    data_channel::DataChannel,
    peer_connection::{PeerConnection, RTCIceCandidateInit},
};

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ClientPacket {
    Hello { id: uuid::Uuid, name: String },
    Command { command: Command },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerPacket {
    State {
        snapshot: Box<Snapshot>,
    },
    Reply {
        id: uuid::Uuid,
        value: serde_json::Value,
    },
    Error {
        message: String,
    },
    /// Host-signed member pass for the receiving member (encoded, verified on receipt).
    Pass {
        pass: String,
    },
}
struct Link {
    connection: Arc<dyn PeerConnection>,
    channel: Option<Arc<dyn DataChannel>>,
    assembler: Assembler,
    pending: Vec<RTCIceCandidateInit>,
    sent: u64,
    received: u64,
    remote_nonce: String,
    admitted: bool,
    rate: RateLimit,
    forward: tokio::task::JoinHandle<()>,
}
impl Link {
    async fn close(self) {
        let _ = self.connection.close().await;
        self.forward.abort();
        let _ = self.forward.await;
    }
}
async fn send_signal(
    socket: &mut SignalSocket,
    identity: &Identity,
    invite: &Invite,
    to: &str,
    link: &mut Link,
    payload: serde_json::Value,
) -> Result<()> {
    link.sent += 1;
    let signal = socket.sign(
        identity,
        invite.room,
        to.into(),
        link.sent,
        now_ms() + 30000,
        payload,
    )?;
    socket.send(serde_json::to_string(&signal)?.into()).await?;
    Ok(())
}
pub async fn send_packet(channel: &Arc<dyn DataChannel>, packet: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(packet)?;
    let frames = framing::encode(&bytes)?;
    tokio::time::timeout(Duration::from_secs(3), async {
        for frame in frames {
            channel.send_text(&frame).await?;
        }
        Ok::<_, anyhow::Error>(())
    })
    .await
    .context("O participante não recebeu os dados a tempo")??;
    Ok(())
}
pub(crate) async fn wait_deadline(deadline: Option<tokio::time::Instant>) {
    if let Some(deadline) = deadline {
        tokio::time::sleep_until(deadline).await;
    } else {
        std::future::pending::<()>().await;
    }
}
fn add_link(
    mut peer: Peer,
    key: String,
    events: mpsc::Sender<(String, String, PeerEvent)>,
    remote_nonce: String,
) -> Link {
    let connection = peer.connection.clone();
    let generation = remote_nonce.clone();
    let forward = tokio::spawn(async move {
        while let Some(event) = peer.events.recv().await {
            if events
                .send((key.clone(), generation.clone(), event))
                .await
                .is_err()
            {
                break;
            }
        }
    });
    Link {
        connection,
        channel: None,
        assembler: Assembler::default(),
        pending: vec![],
        sent: 0,
        received: 0,
        remote_nonce,
        admitted: false,
        rate: RateLimit::new(120, 60),
        forward,
    }
}
async fn broadcast(room: &RoomHost, links: &mut HashMap<String, Link>) -> Result<()> {
    for (key, link) in links.iter() {
        if link.admitted
            && let Some(channel) = &link.channel
        {
            let _ = send_packet(
                channel,
                &ServerPacket::State {
                    snapshot: Box::new(room.snapshot_for(key)?),
                },
            )
            .await;
        }
    }
    Ok(())
}

pub async fn host(
    invite: &Invite,
    identity: &Identity,
    room: &mut RoomHost,
    policy: &NetworkPolicy,
    duration: Duration,
) -> Result<()> {
    let mut socket = rendezvous::connect(invite, identity).await?;
    let local_key = URL_SAFE_NO_PAD.encode(identity.public_key());
    let (events, mut receiver) = mpsc::channel(256);
    let mut links: HashMap<String, Link> = HashMap::new();
    let deadline = tokio::time::sleep(duration);
    tokio::pin!(deadline);
    let mut game_deadline: Option<tokio::time::Instant> = None;
    let result = async {
        loop {
            if room.has_games() {
                let target = tokio::time::Instant::now()
                    + Duration::from_millis(if room.games_need_fast_tick() {
                        100
                    } else {
                        1000
                    });
                game_deadline = Some(game_deadline.map_or(target, |existing| existing.min(target)));
            } else {
                game_deadline = None;
            }
            tokio::select! {
                _=&mut deadline=>break,
                _=wait_deadline(game_deadline)=>{game_deadline=None;if room.advance_games(now_ms())?{broadcast(room,&mut links).await?;}},
                message=socket.next()=>{let message=message.context("Sinalização desconectada")??;if !message.is_text(){continue}let value:serde_json::Value=serde_json::from_str(message.to_text()?)?;
                    if value.get("type")==Some(&serde_json::json!("peer-joined")){
                        let key=value["key"].as_str().context("Identidade ausente")?.to_owned();ensure!(URL_SAFE_NO_PAD.decode(&key)?.len()==32,"Chave inválida");let nonce=value["session_nonce"].as_str().context("Sessão ausente")?;ensure!(URL_SAFE_NO_PAD.decode(nonce)?.len()==16,"Sessão inválida");if key==local_key||links.get(&key).is_some_and(|link|link.remote_nonce==nonce){continue;}
                        if let Some(old)=links.remove(&key){old.close().await;room.remove(&key);}ensure!(links.len()<9,"Sala cheia");
                        let peer=Peer::new(policy,true).await?;let offer=peer.offer().await?;let mut link=add_link(peer,key.clone(),events.clone(),value["session_nonce"].as_str().context("Sessão ausente")?.to_string());send_signal(&mut socket,identity,invite,&key,&mut link,serde_json::json!({"description":offer})).await?;links.insert(key,link);
                    }else if value.get("type")==Some(&serde_json::json!("peer-left")){
                        if let Some(key)=value["key"].as_str()&& links.get(key).is_some_and(|link|Some(link.remote_nonce.as_str())==value["session_nonce"].as_str()) && let Some(link)=links.remove(key){link.close().await;room.remove(key);broadcast(room,&mut links).await?;}
                    }else if value.get("type").is_none(){let signal:SignedSignal=serde_json::from_value(value)?;let Some(link)=links.get_mut(&signal.from)else{continue};if signal.session_nonce!=link.remote_nonce || signal.verify(invite.room,&signal.from,&local_key,link.received,now_ms()).is_err(){if let Some(link)=links.remove(&signal.from){link.close().await;}room.remove(&signal.from);continue}link.received=signal.sequence;
                        let apply=async{if let Some(description)=signal.payload.get("description"){link.connection.set_remote_description(serde_json::from_value(description.clone())?).await?;for candidate in link.pending.drain(..){link.connection.add_ice_candidate(candidate).await?;}}else if let Some(candidate)=signal.payload.get("candidate"){let candidate=serde_json::from_value(candidate.clone())?;if link.connection.remote_description().await.is_some(){link.connection.add_ice_candidate(candidate).await?;}else{ensure!(link.pending.len()<128,"Muitos candidatos");link.pending.push(candidate);}}Ok::<_,anyhow::Error>(())}.await;if apply.is_err(){if let Some(link)=links.remove(&signal.from){link.close().await;}room.remove(&signal.from);}
                    }
                },
                event=receiver.recv()=>{let Some((key,generation,event))=event else{break};let Some(link)=links.get_mut(&key)else{continue};if link.remote_nonce!=generation{continue}match event{
                    PeerEvent::Ice(candidate)=>send_signal(&mut socket,identity,invite,&key,link,serde_json::json!({"candidate":candidate})).await?,
                    PeerEvent::DataOpen(channel)=>{if link.channel.is_some(){let _=channel.close().await;}else{link.channel=Some(channel);}},
                    PeerEvent::Data(bytes)=>{
                        if !link.rate.allow(){if let Some(link)=links.remove(&key){link.close().await;}room.remove(&key);continue}
                        let payload=match link.assembler.push(&bytes){Ok(Some(payload))=>payload,Ok(None)=>continue,Err(_)=>{if let Some(link)=links.remove(&key){link.close().await;}room.remove(&key);continue}};
                        let packet:ClientPacket=match serde_json::from_slice(&payload){Ok(packet)=>packet,Err(_)=>{if let Some(link)=links.remove(&key){link.close().await;}room.remove(&key);continue}};
                        let mut changes=false;
                        let result=(||->Result<Option<ServerPacket>>{match packet{ClientPacket::Hello{id,name}=>{ensure!(!link.admitted,"Sessão já autenticada");room.admit(key.clone(),id,name).map(|()|{link.admitted=true;changes=true;None})},ClientPacket::Command{command}=>{ensure!(link.admitted,"Envie o perfil antes de comandos");let id=command.id;let changed=command.action.changes_snapshot();room.handle(&key,command).map(|value|{changes=changed;Some(ServerPacket::Reply{id,value})})}}})();
                        if let Some(channel)=&link.channel{match result{Ok(Some(reply))=>{let _=send_packet(channel,&reply).await;},Ok(None)=>{},Err(error)=>{let _=send_packet(channel,&ServerPacket::Error{message:error.to_string()}).await;}}}
                        if changes{broadcast(room,&mut links).await?;}
                    },PeerEvent::Closed=>{if let Some(link)=links.remove(&key){link.close().await;}room.remove(&key);broadcast(room,&mut links).await?;},_=>{}
                }}
            }
        }
        Ok::<_, anyhow::Error>(())
    };
    let result = result.await;
    for (key, link) in links {
        link.close().await;
        room.remove(&key);
    }
    let _ = socket.close(None).await;
    result
}

/// A bounded command client, also used by integration tests. No microphone opens.
pub async fn join_and_post(
    invite: &Invite,
    identity: &Identity,
    profile: &Profile,
    text: &str,
) -> Result<serde_json::Value> {
    let mut socket = rendezvous::connect(invite, identity).await?;
    let session_signer = socket.signer();
    let local_key = URL_SAFE_NO_PAD.encode(identity.public_key());
    let mut peer = Peer::new(&NetworkPolicy::default(), false).await?;
    let mut assembler = Assembler::default();
    let mut pending = vec![];
    let mut sent = 0;
    let mut received = 0;
    let mut channel = None;
    let mut requested = None;
    let mut host_session = String::new();
    let result = async {
        loop {
            tokio::select! {
                            message=socket.next()=>{let message=message.context("Sinalização desconectada")??;if !message.is_text(){continue}let value:serde_json::Value=serde_json::from_str(message.to_text()?)?;if value.get("type")==Some(&serde_json::json!("welcome")){if let Some(peers)=value["peers"].as_array(){for peer in peers{if peer["key"].as_str()==Some(&invite.host_key){host_session=peer["session_nonce"].as_str().context("Sessão do host ausente")?.into();}}}continue}
            if value.get("type").is_some(){continue}let signal:SignedSignal=serde_json::from_value(value)?;ensure!(signal.session_nonce==host_session,"Sinal de outra geração do host");signal.verify(invite.room,&invite.host_key,&local_key,received,now_ms())?;received=signal.sequence;
                                if let Some(description)=signal.payload.get("description"){let answer=peer.answer(serde_json::from_value(description.clone())?).await?;for candidate in pending.drain(..){peer.connection.add_ice_candidate(candidate).await?;}sent+=1;socket.send(serde_json::to_string(&session_signer.sign(identity,invite.room,invite.host_key.clone(),sent,now_ms()+30000,serde_json::json!({"description":answer}))?)?.into()).await?;}
                                else if let Some(candidate)=signal.payload.get("candidate"){let candidate=serde_json::from_value(candidate.clone())?;if peer.connection.remote_description().await.is_some(){peer.connection.add_ice_candidate(candidate).await?;}else{ensure!(pending.len()<128,"Muitos candidatos");pending.push(candidate);}}
                            },
                            event=peer.events.recv()=>match event{
                                Some(PeerEvent::Ice(candidate))=>{sent+=1;socket.send(serde_json::to_string(&session_signer.sign(identity,invite.room,invite.host_key.clone(),sent,now_ms()+30000,serde_json::json!({"candidate":candidate}))?)?.into()).await?;},
                                Some(PeerEvent::DataOpen(dc))=>{send_packet(&dc,&ClientPacket::Hello{id:profile.id,name:profile.name.clone()}).await?;channel=Some(dc);},
                                Some(PeerEvent::Data(bytes))=>{if let Some(payload)=assembler.push(&bytes)?{match serde_json::from_slice::<ServerPacket>(&payload)?{
                                    ServerPacket::State{snapshot}=>{if requested.is_none(){let text_channel=snapshot.channels.iter().find(|c|c.kind==voxy_core::model::ChannelKind::Text).context("Nenhum canal de texto")?;let command=Command{id:uuid::Uuid::new_v4(),action:voxy_core::room::Action::Message{channel:text_channel.id,text:text.into()}};requested=Some(command.id);send_packet(channel.as_ref().context("Canal indisponível")?,&ClientPacket::Command{command}).await?;}},
                                    ServerPacket::Reply{id,value}=>{ensure!(Some(id)==requested,"Resposta fora da sessão");return Ok::<_,anyhow::Error>(serde_json::json!({"messagePosted":true,"messageId":value["id"],"transport":"native DTLS/SCTP","publicInternet":false}));},ServerPacket::Error{message}=>anyhow::bail!("{message}"),ServerPacket::Pass{..}=>{}
                                }}},None|Some(PeerEvent::Closed)=>anyhow::bail!("Peer desconectado"),_=>{}
                            }
                        }
        }
    };
    let result = tokio::time::timeout(Duration::from_secs(20), result).await;
    let _ = peer.close().await;
    let _ = socket.close(None).await;
    result.context("Entrada na sala excedeu 20 segundos")?
}
