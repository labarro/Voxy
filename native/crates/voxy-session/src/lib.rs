//! Persistent session process: no window, renderer, world or browser dependency.
mod transport;
use anyhow::{Context, Result, ensure};
use std::{
    path::PathBuf,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::sync::{mpsc, watch};
pub use transport::serve;
use voxy_core::{
    identity::Identity,
    ipc::{Request, State},
    model::Profile,
    room::{Action, Command},
    store::{Store, now_ms},
};
use voxy_network::{
    invite::Invite,
    live::{self, Config, Event, Input},
    policy::{NetworkPolicy, reconnect_delay},
};
use voxy_voice::{
    call::{CallAudio, CallConfig, IncomingVoice},
    control::VoiceControl,
};

fn action(action: Action) -> Input {
    Input::Command(Command {
        id: uuid::Uuid::new_v4(),
        action,
    })
}
async fn send(input: &Option<mpsc::Sender<Input>>, value: Input) -> Result<()> {
    input
        .as_ref()
        .context("Conecte um servidor primeiro")?
        .send(value)
        .await
        .map_err(|_| anyhow::anyhow!("Sessão encerrada"))
}
pub(crate) async fn run(
    path: PathBuf,
    identity: Arc<Identity>,
    mut requests: mpsc::Receiver<Request>,
    states: watch::Sender<State>,
) -> Result<()> {
    let mut state = State {
        phase: "Desconectado".into(),
        ..Default::default()
    };
    let mut ui_detached = false;
    let control = Arc::new(VoiceControl::default());
    let local_id = Store::open(&path.join("voxy.sqlite"))?.profile()?.id;
    let mut recent_server = None;
    let mut network: Option<mpsc::Sender<Input>> = None;
    let mut network_task: Option<tokio::task::JoinHandle<()>> = None;
    let (event_tx, mut events) = mpsc::channel(256);
    let (opened_tx, mut opened) = mpsc::channel::<(u64, Result<CallAudio, String>)>(2);
    let (encoded_tx, mut encoded) = mpsc::channel(8);
    let mut audio: Option<CallAudio> = None;
    let mut audio_generation = 0_u64;
    let mut network_generation = 0_u64;
    let mut stats = tokio::time::interval(Duration::from_secs(1));
    stats.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            request=requests.recv()=>{
                let Some(request)=request else{break};
                state.error=None;
                let shutdown=matches!(request,Request::Shutdown);
                if matches!(request,Request::Detached) && network.is_none(){break}
                if matches!(request,Request::Detached){ui_detached=true;}
                let result=async {match request {
                    Request::Detached=>{},
                    Request::Attached=>{ui_detached=false;},
                    Request::Host{server,endpoint,stun}=>{
                        ensure!(network.is_none(),"Desconecte o servidor atual antes de hospedar");
                        let store=Store::open(&path.join("voxy.sqlite"))?;let profile=store.profile()?;
                        let community=store.communities()?.into_iter().find(|s|s.id==server).context("Servidor não encontrado")?;
                        ensure!(community.owner==profile.id,"Somente o dono pode hospedar este servidor");
                        let invite=Invite::create(&identity,server,&format!("{}/v3/{server}",endpoint.trim_end_matches('/')),now_ms()+86_400_000)?;
                        state.invite=Some(invite.encode()?);
                        let policy=NetworkPolicy{stun_urls:stun,relay_enabled:false};policy.validate()?;
                        let config=Config{invite,host:Some(community),database:path.join("voxy.sqlite"),policy};
                        network_generation+=1;
                        recent_server=None;
                        let (sender,task)=start_network(config,identity.clone(),profile,event_tx.clone(),network_generation);
                        network=Some(sender);network_task=Some(task);state.phase="Conectando à sinalização".into();
                    },
                    Request::Join{invite,stun}=>{
                        ensure!(network.is_none(),"Desconecte o servidor atual antes de entrar");
                        let invite=Invite::parse(&invite,now_ms())?;
                        state.invite=Some(invite.encode()?);
                        let profile=Store::open(&path.join("voxy.sqlite"))?.profile()?;
                        let policy=NetworkPolicy{stun_urls:stun,relay_enabled:false};policy.validate()?;
                        let config=Config{invite,host:None,database:path.join("voxy.sqlite"),policy};
                        network_generation+=1;
                        recent_server=None;
                        let (sender,task)=start_network(config,identity.clone(),profile,event_tx.clone(),network_generation);
                        network=Some(sender);network_task=Some(task);state.phase="Validando convite e conectando".into();
                    },
                    Request::Command{command}=>send(&network,Input::Command(command)).await?,
                    Request::VoiceEnter{channel,profile}=>{
                        ensure!(network.is_some(),"Conecte ao servidor primeiro");
                        let snapshot=state.snapshot.as_ref().context("Aguarde a confirmação do servidor")?;
                        ensure!(snapshot.channels.iter().any(|c|c.id==channel && c.kind==voxy_core::model::ChannelKind::Voice),"Canal de voz não pertence à sessão");
                        profile.validate()?;audio_generation+=1;let generation=audio_generation;
                        audio=None;state.voice=Some(channel);state.microphone_ready=false;
                        state.phase="Abrindo microfone e saída de áudio".into();
                        control.muted.store(state.muted,Ordering::Release);control.deafened.store(state.deafened,Ordering::Release);control.device_failed.store(false,Ordering::Release);control.set_gain(profile.input_volume);
                        let tx=opened_tx.clone();let control=control.clone();
                        tokio::task::spawn_local(async move {
                            let task=tokio::task::spawn_blocking(move||CallAudio::start(audio_config(&profile),control));
                            let result=match tokio::time::timeout(Duration::from_secs(12),task).await {
                                Ok(Ok(Ok(audio)))=>Ok(audio),
                                _=>Err("Não foi possível iniciar o áudio em 12 s. Verifique permissões e dispositivos; tente novamente.".into())
                            };
                            let _=tx.send((generation,result)).await;
                        });
                    },
                    Request::VoiceLeave=>{audio_generation+=1;audio=None;state.voice=None;state.microphone_ready=false;send(&network,action(Action::VoiceLeave)).await?;state.phase="Conectado".into();},
                    Request::Controls{muted,deafened}=>{
                        state.muted=muted;state.deafened=deafened;
                        control.muted.store(muted,Ordering::Release);control.deafened.store(deafened,Ordering::Release);
                        if network.is_some(){send(&network,action(Action::VoiceState{muted,deafened})).await?;}
                    },
                    Request::Volume{peer,volume,muted}=>{
                        ensure!(volume.is_finite() && (0.0..=2.0).contains(&volume),"Volume inválido");
                        let link=state.peers.iter_mut().find(|p|p.id==peer).context("Participante desconectado")?;link.volume=volume;
                        if let Some(audio)=&audio{audio.input.volume(peer,volume,muted)?;}
                        if let Some(member)=state.snapshot.as_ref().and_then(|s|s.members.iter().find(|m|m.public_key==link.key)){
                            let store=Store::open(&path.join("voxy.sqlite"))?;let mut profile=store.profile()?;
                            let volumes=profile.retained.entry("volumes".into()).or_insert_with(||serde_json::json!({}));
                            if let Some(values)=volumes.as_object_mut(){values.insert(member.id.to_string(),serde_json::json!(volume));}store.save_profile(&profile)?;
                        }
                    },
                    Request::Disconnect|Request::Shutdown=>{
                        audio_generation+=1;audio=None;
                        if let Some(sender)=network.take(){let _=sender.send(Input::Stop).await;}
                        if let Some(task)=network_task.take(){let _=tokio::time::timeout(Duration::from_secs(4),task).await;}
                        network_generation+=1;state=State{phase:"Desconectado".into(),..Default::default()};
                    }
                }Ok::<_,anyhow::Error>(())}.await;
                if let Err(error)=result {state.error=Some(error.to_string());}
                states.send_replace(state.clone());
                if shutdown{break}
            },
            result=opened.recv()=>if let Some((generation,result))=result {
                if generation!=audio_generation{continue}
                match result {
                    Ok(mut call)=>{
                        let receiver=call.take_encoded();let sender=encoded_tx.clone();
                        tokio::task::spawn_blocking(move||{while let Ok(frame)=receiver.recv(){let _=sender.try_send((generation,frame.payload));}});
                        for peer in &state.peers{let _=call.input.volume(peer.id,peer.volume,false);}
                        audio=Some(call);state.microphone_ready=true;state.phase="Entrando no canal de voz".into();
                        if let Some(channel)=state.voice{let _=send(&network,action(Action::VoiceJoin{channel})).await;let _=send(&network,action(Action::VoiceState{muted:state.muted,deafened:state.deafened})).await;}
                    },
                    Err(error)=>{state.voice=None;state.microphone_ready=false;state.error=Some(error);state.phase="Falha no áudio — tente novamente".into();}
                }
                states.send_replace(state.clone());
            },
            frame=encoded.recv()=>if let Some((generation,payload))=frame
                && generation==audio_generation && audio.is_some(){state.encoded_frames+=1;if control.may_transmit()&& let Some(network)=&network{let _=network.try_send(Input::Audio(payload));}},
            event=events.recv()=>if let Some((generation,event))=event {
                if generation!=network_generation{continue}
                match event {
                    Event::Ended=>{audio_generation+=1;audio=None;state.voice=None;state.microphone_ready=false;state.snapshot=None;state.peers.clear();network=None;network_task=None;state.phase="Sessão encerrada".into();if ui_detached{break}},
                    Event::Acknowledged(id)=>{state.acknowledged=Some(id);if !state.acknowledgements.contains(&id){state.acknowledgements.push(id);if state.acknowledgements.len()>64{state.acknowledgements.remove(0);}}},
                    Event::Peer(id,key)=>{state.peers.push(voxy_core::ipc::Peer{id,key,volume:1.0});},
                    Event::Phase(phase)=>{state.phase=phase.into();if phase=="Conectando à sinalização"{state.peers.clear();if let Some(audio)=&audio{audio.input.clear();}}},
                    Event::Snapshot(snapshot)=>{
                        if let Ok(profile)=Store::open(&path.join("voxy.sqlite")).and_then(|s|s.profile()){
                            for peer in &mut state.peers {
                                if let Some(member)=snapshot.members.iter().find(|m|m.public_key==peer.key){
                                    let volume=profile.retained.get("volumes").and_then(|v|v.get(member.id.to_string())).and_then(|v|v.as_f64()).unwrap_or(1.0).clamp(0.0,2.0)as f32;
                                    if peer.volume!=volume{peer.volume=volume;if let Some(audio)=&audio{let _=audio.input.volume(peer.id,volume,false);}}
                                }
                            }
                        }
                        if recent_server.as_ref()!=Some(&snapshot.server.name) && let Some(invite)=&state.invite {
                            let _=Store::open(&path.join("voxy.sqlite")).and_then(|store|store.save_recent(&snapshot.server,invite));recent_server=Some(snapshot.server.name.clone());
                        }
                        if state.voice.is_some_and(|id|!snapshot.channels.iter().any(|c|c.id==id)) {audio_generation+=1;audio=None;state.voice=None;state.microphone_ready=false;state.error=Some("O canal de voz foi removido pelo servidor.".into());}
                        if let Some(channel)=state.voice {
                            let own=snapshot.members.iter().find(|m|m.id==local_id);
                            if state.microphone_ready && own.is_some_and(|m|m.voice!=Some(channel)) {let _=send(&network,action(Action::VoiceJoin{channel})).await;}
                            state.phase=if own.is_some_and(|m|m.voice==Some(channel)) && state.microphone_ready {"Em chamada"}else{"Entrando no canal de voz"}.into();
                        }else{state.phase="Conectado".into();}
                        state.snapshot=Some(snapshot);
                    },
                    Event::Audio{peer,sequence,payload}=>{if let Some(audio)=&audio&& audio.input.packet(IncomingVoice{peer,sequence,payload}).is_ok(){state.received_frames+=1;}continue},
                    Event::Sent(count)=>{state.sent_frames+=count;continue},
                    Event::PeerRemoved(peer)=>{state.peers.retain(|p|p.id!=peer);if let Some(audio)=&audio{audio.input.remove(peer);}},
                    Event::Error(error)=>state.error=Some(error.into()),
                }
                states.send_replace(state.clone());
            },
            _=stats.tick(),if audio.is_some()=>{
                state.decoded_frames=control.decoded_frames.load(Ordering::Relaxed);state.playback_samples=control.rendered_samples.load(Ordering::Relaxed);
                state.input_level=control.level();
                if control.device_failed.load(Ordering::Acquire)||audio.as_ref().is_some_and(CallAudio::is_finished){audio_generation+=1;audio=None;state.microphone_ready=false;state.voice=None;state.error=Some("Dispositivo ou processamento de áudio interrompido. Selecione a entrada e tente novamente.".into());let _=send(&network,action(Action::VoiceLeave)).await;}
                states.send_replace(state.clone());
            }
        }
    }
    drop(audio);
    if let Some(network) = network {
        let _ = network.send(Input::Stop).await;
    }
    if let Some(task) = network_task {
        let _ = tokio::time::timeout(Duration::from_secs(4), task).await;
    }
    Ok(())
}
fn audio_config(profile: &Profile) -> CallConfig {
    CallConfig {
        input: profile.input.clone(),
        output: profile.output.clone(),
        noise_suppression: profile
            .retained
            .get("noiseSuppression")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        automatic_gain: profile
            .retained
            .get("autoGainControl")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        voice_detection: profile.voice_detection,
        threshold: profile.voice_threshold,
        ptt_key: profile.ptt_enabled.then(|| profile.ptt_key.clone()),
    }
}
fn start_network(
    config: Config,
    identity: Arc<Identity>,
    profile: Profile,
    events: mpsc::Sender<(u64, Event)>,
    generation: u64,
) -> (mpsc::Sender<Input>, tokio::task::JoinHandle<()>) {
    let (sender, mut receiver) = mpsc::channel(64);
    let task = tokio::task::spawn_local(async move {
        let (tx, mut rx) = mpsc::channel(256);
        let forward = tokio::task::spawn_local(async move {
            while let Some(event) = rx.recv().await {
                if events.send((generation, event)).await.is_err() {
                    break;
                }
            }
        });
        let mut attempt = 0;
        loop {
            let result = live::run(&config, &identity, &profile, &mut receiver, &tx).await;
            if result.is_ok() {
                break;
            }
            if attempt >= 7 {
                let _=tx.send(Event::Error("Reconexão pausada após 8 tentativas. Confira a rede, a sinalização e o convite; desconecte e tente novamente. TURN está desativado.")).await;
                break;
            }
            if now_ms() >= config.invite.expires_at {
                let _ = tx
                    .send(Event::Error(
                        "Convite expirado. Gere um novo convite para reconectar.",
                    ))
                    .await;
                break;
            }
            let _ = tx
                .send(Event::Phase("Conexão interrompida — reconectando"))
                .await;
            tokio::select! {
                _=tokio::time::sleep(reconnect_delay(attempt))=>{},
                command=receiver.recv()=>{if matches!(command,None|Some(Input::Stop)){break}}
            }
            attempt = attempt.saturating_add(1);
        }
        let _ = tx.send(Event::Ended).await;
        drop(tx);
        let _ = forward.await;
    });
    (sender, task)
}
