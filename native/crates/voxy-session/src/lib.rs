//! Persistent session process: no window, renderer, world or browser dependency.
mod notifications;
mod transport;
mod tray;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
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
    control::{GlobalShortcuts, ShortcutAction, VoiceControl, virtual_key},
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
    let mut notification_tracker = notifications::Tracker::default();
    let mut ui_detached = true;
    let control = Arc::new(VoiceControl::default());
    control.prepare_audio_generation(0, false);
    let mut tray = match tray::Tray::start(control.clone()) {
        Ok(tray) => tray,
        Err(error) => {
            state.error = Some(format!("Bandeja indisponível: {error}"));
            None
        }
    };
    let initial_profile = Store::open(&path.join("voxy.sqlite"))?.profile()?;
    let local_id = initial_profile.id;
    let mut shortcuts = match configure_shortcuts(&initial_profile) {
        Ok(shortcuts) => shortcuts,
        Err(error) => {
            state.error = Some(error.to_string());
            None
        }
    };
    let mut shortcut_poll = tokio::time::interval(Duration::from_millis(20));
    shortcut_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
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
            tray_action=async {match &mut tray { Some((_,events))=>events.recv().await, None=>std::future::pending().await }}=>{
                match tray_action {
                    Some(tray::TrayAction::Open)|Some(tray::TrayAction::OpenNotification(_))=>{
                        if let Some(tray::TrayAction::OpenNotification(id))=tray_action {state.notification_open=Some(id);}
                        if ui_detached {
                            match std::env::current_exe().and_then(|exe| {
                                std::process::Command::new(exe.with_file_name("voxy-desktop.exe"))
                                    .env("VOXY_NATIVE_DATA_DIR",&path)
                                    .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn()
                            }) {Ok(_)=>{},Err(error)=>state.error=Some(format!("Não foi possível abrir a interface: {error}"))}
                        }else{state.focus_requested=state.focus_requested.wrapping_add(1);}
                    },
                    Some(tray::TrayAction::ToggleMute)|Some(tray::TrayAction::ToggleDeafen)=>{
                        if matches!(tray_action,Some(tray::TrayAction::ToggleMute)){state.muted = !state.muted;}else{state.deafened = !state.deafened;}
                        control.muted.store(state.muted,Ordering::Release);control.deafened.store(state.deafened,Ordering::Release);
                        if network.is_some() && let Err(error)=send(&network,action_voice_state(&state)).await {state.error=Some(error.to_string());}
                    },
                    Some(tray::TrayAction::Exit)=>{control.muted.store(true,Ordering::Release);break},
                    None=>{tray=None;state.error=Some("Bandeja do Windows encerrou inesperadamente".into());}
                }
                if tray.as_ref().is_some_and(|(tray,_)|tray.take_overflow()) {
                    if let Some((_,events))=&mut tray {while events.try_recv().is_ok(){}}
                    state.muted=true;control.muted.store(true,Ordering::Release);
                    state.error=Some("Comandos da bandeja excederam o limite; microfone foi silenciado por segurança".into());
                    if network.is_some(){let _=send(&network,action_voice_state(&state)).await;}
                }
                states.send_replace(state.clone());
            },
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
                        let gate=control.clone();
                        let config=Config{invite,host:Some(community),database:path.join("voxy.sqlite"),policy,microphone_allowed:Some(Arc::new(move||gate.may_transmit()))};
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
                        let gate=control.clone();
                        let config=Config{invite,host:None,database:path.join("voxy.sqlite"),policy,microphone_allowed:Some(Arc::new(move||gate.may_transmit()))};
                        network_generation+=1;
                        recent_server=None;
                        let (sender,task)=start_network(config,identity.clone(),profile,event_tx.clone(),network_generation);
                        network=Some(sender);network_task=Some(task);state.phase="Validando convite e conectando".into();
                    },
                    Request::Command{command}=>send(&network,Input::Command(command)).await?,
                    Request::RotateInvite{valid_for_seconds}=>{
                        ensure!((60..=86_400).contains(&valid_for_seconds),"Validade deve ser de 60 segundos a 24 horas");
                        let snapshot=state.snapshot.as_ref().context("Aguarde a confirmação do servidor")?;
                        ensure!(snapshot.server.owner==local_id,"Somente o dono pode renovar o convite");
                        let previous=Invite::parse(state.invite.as_deref().context("Convite ativo indisponível")?,now_ms())?;
                        ensure!(previous.host_key==URL_SAFE_NO_PAD.encode(identity.public_key()),"Somente o processo host pode renovar o convite");
                        let replacement=Invite::create(&identity,previous.room,&previous.signal_url,now_ms()+(valid_for_seconds as i64)*1000)?;
                        send(&network,Input::RotateInvite(replacement)).await?;
                        state.phase="Revogando convite anterior e aguardando confirmação".into();
                    },
                    Request::VoiceEnter{channel,profile}=>{
                        ensure!(network.is_some(),"Conecte ao servidor primeiro");
                        let snapshot=state.snapshot.as_ref().context("Aguarde a confirmação do servidor")?;
                        ensure!(snapshot.channels.iter().any(|c|c.id==channel && c.kind==voxy_core::model::ChannelKind::Voice),"Canal de voz não pertence à sessão");
                        profile.validate()?;
                        let configured_shortcuts=configure_shortcuts(&profile)?;
                        shortcuts=configured_shortcuts;
                        audio_generation+=1;control.prepare_audio_generation(audio_generation,profile.ptt_enabled);let generation=audio_generation;
                        audio=None;state.voice=Some(channel);state.microphone_ready=false;
                        state.phase="Abrindo microfone e saída de áudio".into();
                        control.muted.store(state.muted,Ordering::Release);control.deafened.store(state.deafened,Ordering::Release);control.device_failed.store(false,Ordering::Release);control.set_gain(profile.input_volume);
                        let tx=opened_tx.clone();let control=control.clone();
                        tokio::task::spawn_local(async move {
                            let worker_control=control.clone();
                            let task=tokio::task::spawn_blocking(move||CallAudio::start_for_generation(audio_config(&profile),worker_control,generation));
                            let result=match tokio::time::timeout(Duration::from_secs(12),task).await {
                                Ok(Ok(Ok(audio)))=>Ok(audio),
                                _=>Err("Não foi possível iniciar o áudio em 12 s. Verifique permissões e dispositivos; tente novamente.".into())
                            };
                            let _=tx.send((generation,result)).await;
                        });
                    },
                    Request::VoiceLeave=>{audio_generation+=1;control.prepare_audio_generation(audio_generation,control.ptt.load(Ordering::Acquire));audio=None;state.voice=None;state.microphone_ready=false;send(&network,action(Action::VoiceLeave)).await?;state.phase="Conectado".into();},
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
                        audio_generation+=1;control.prepare_audio_generation(audio_generation,control.ptt.load(Ordering::Acquire));audio=None;
                        if let Some(sender)=network.take(){let _=sender.send(Input::Stop).await;}
                        if let Some(task)=network_task.take(){let _=tokio::time::timeout(Duration::from_secs(4),task).await;}
                        network_generation+=1;state=State{phase:"Desconectado".into(),muted:state.muted,deafened:state.deafened,..Default::default()};
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
                        tokio::task::spawn_blocking(move||{while let Ok(frame)=receiver.recv(){let _=sender.try_send((generation,frame));}});
                        for peer in &state.peers{let _=call.input.volume(peer.id,peer.volume,false);}
                        audio=Some(call);state.microphone_ready=true;state.phase="Entrando no canal de voz".into();
                        if let Some(channel)=state.voice{let _=send(&network,action(Action::VoiceJoin{channel})).await;let _=send(&network,action(Action::VoiceState{muted:state.muted,deafened:state.deafened})).await;}
                    },
                    Err(error)=>{state.voice=None;state.microphone_ready=false;state.error=Some(error);state.phase="Falha no áudio — tente novamente".into();}
                }
                states.send_replace(state.clone());
            },
            frame=encoded.recv()=>if let Some((generation,frame))=frame
                && generation==audio_generation && audio.is_some(){state.encoded_frames+=1;if frame.produced_at.elapsed()<Duration::from_millis(100)&&control.may_transmit()&& let Some(network)=&network{let _=network.try_send(Input::Audio(frame.payload));}},
            _=shortcut_poll.tick(),if shortcuts.is_some()=>{
                let mut changed=false;
                if let Some((_,receiver))=&shortcuts {
                    for _ in 0..8 {
                        let Ok(action)=receiver.try_recv() else {break};
                        changed=true;
                        match action {
                            ShortcutAction::ToggleMute=>state.muted = !state.muted,
                            ShortcutAction::ToggleDeafen=>state.deafened = !state.deafened,
                        }
                        control.muted.store(state.muted,Ordering::Release);
                        control.deafened.store(state.deafened,Ordering::Release);
                        if network.is_some() && let Err(error)=send(&network,action_voice_state(&state)).await {state.error=Some(error.to_string());}
                    }
                }
                if changed {states.send_replace(state.clone());}
            },
            event=events.recv()=>if let Some((generation,event))=event {
                if generation!=network_generation{continue}
                match event {
                    Event::Ended=>{audio_generation+=1;control.prepare_audio_generation(audio_generation,control.ptt.load(Ordering::Acquire));audio=None;state.voice=None;state.microphone_ready=false;state.snapshot=None;state.peers.clear();network=None;network_task=None;state.phase="Sessão encerrada".into();if ui_detached{break}},
                    Event::Acknowledged(id)=>{state.acknowledged=Some(id);if !state.acknowledgements.contains(&id){state.acknowledgements.push(id);if state.acknowledgements.len()>64{state.acknowledgements.remove(0);}}},
                    Event::Replied(id,value)=>{
                        state.acknowledged=Some(id);
                        if !state.acknowledgements.contains(&id){state.acknowledgements.push(id);if state.acknowledgements.len()>64{state.acknowledgements.remove(0);}}
                        state.command_results.retain(|(previous,_)|*previous!=id);
                        state.command_results.push((id,value));
                        if state.command_results.len()>1{state.command_results.remove(0);}
                    },
                    Event::InviteRotated(invite)=>{
                        match invite.encode(){Ok(encoded)=>{
                            if let Some(snapshot)=&state.snapshot {let _=Store::open(&path.join("voxy.sqlite")).and_then(|s|s.save_recent(&snapshot.server,&encoded));}
                            state.invite=Some(encoded);
                            state.phase="Convite renovado; convidados anteriores devem entrar novamente".into();
                        },Err(error)=>state.error=Some(error.to_string())}
                    },
                    Event::Peer(id,key)=>{state.peers.push(voxy_core::ipc::Peer{id,key,volume:1.0});},
                    Event::Phase(phase)=>{state.phase=phase.into();if phase=="Conectando à sinalização"{state.peers.clear();if let Some(audio)=&audio{audio.input.clear();}}},
                    Event::Snapshot(snapshot)=>{
                        if let Ok(profile)=Store::open(&path.join("voxy.sqlite")).and_then(|s|s.profile()){
                            if let Some(alert)=notification_tracker.observe(&snapshot,&profile,now_ms(),ui_detached)
                                && let Some((tray,_))=&tray
                                && let Err(error)=tray.notify(alert.id,&alert.title,&alert.body,alert.sound) {state.error=Some(error.to_string());}
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
                        if state.voice.is_some_and(|id|!snapshot.channels.iter().any(|c|c.id==id)) {audio_generation+=1;control.prepare_audio_generation(audio_generation,control.ptt.load(Ordering::Acquire));audio=None;state.voice=None;state.microphone_ready=false;state.error=Some("O canal de voz foi removido pelo servidor.".into());}
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
                if control.device_failed.load(Ordering::Acquire)||audio.as_ref().is_some_and(CallAudio::is_finished){audio_generation+=1;control.prepare_audio_generation(audio_generation,control.ptt.load(Ordering::Acquire));audio=None;state.microphone_ready=false;state.voice=None;state.error=Some("Dispositivo ou processamento de áudio interrompido. Selecione a entrada e tente novamente.".into());let _=send(&network,action(Action::VoiceLeave)).await;}
                states.send_replace(state.clone());
            }
        }
    }
    control.muted.store(true, Ordering::Release);
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
fn action_voice_state(state: &State) -> Input {
    action(Action::VoiceState {
        muted: state.muted,
        deafened: state.deafened,
    })
}
type ShortcutReader = (GlobalShortcuts, std::sync::mpsc::Receiver<ShortcutAction>);
fn shortcut_chord(profile: &Profile, field: &str) -> Result<Option<(String, i32)>> {
    let Some(value) = profile.retained.get(field).filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let key = value
        .get("key")
        .and_then(|v| v.as_str())
        .context("Tecla de atalho inválida")?;
    ensure!(
        !key.starts_with("Control")
            && !key.starts_with("Alt")
            && !key.starts_with("Shift")
            && !key.starts_with("Meta"),
        "Atalho exige uma tecla além do modificador"
    );
    let physical = virtual_key(key).context("Tecla de atalho não suportada")?;
    let mut parts = Vec::new();
    for (field, name) in [("ctrl", "Control"), ("alt", "Alt"), ("shift", "Shift")] {
        if value
            .get(field)
            .and_then(|v| v.as_bool())
            .context("Modificador de atalho inválido")?
        {
            parts.push(name);
        }
    }
    parts.push(key);
    Ok(Some((parts.join("+"), physical)))
}
fn configure_shortcuts(profile: &Profile) -> Result<Option<ShortcutReader>> {
    let mute = shortcut_chord(profile, "muteShortcut")?;
    let deafen = shortcut_chord(profile, "deafenShortcut")?;
    let mut reserved = Vec::new();
    if profile.ptt_enabled {
        reserved.push(virtual_key(&profile.ptt_key).context("Tecla PTT inválida")?);
    }
    for (_, physical) in mute.iter().chain(deafen.iter()) {
        ensure!(
            !reserved.contains(physical),
            "PTT, mudo e ensurdecer devem usar teclas físicas diferentes"
        );
        reserved.push(*physical);
    }
    if mute.is_none() && deafen.is_none() {
        return Ok(None);
    }
    Ok(Some(GlobalShortcuts::start(
        mute.as_ref().map(|(chord, _)| chord.as_str()),
        deafen.as_ref().map(|(chord, _)| chord.as_str()),
    )?))
}
fn start_network(
    mut config: Config,
    identity: Arc<Identity>,
    profile: Profile,
    events: mpsc::Sender<(u64, Event)>,
    generation: u64,
) -> (mpsc::Sender<Input>, tokio::task::JoinHandle<()>) {
    let (sender, mut receiver) = mpsc::channel(64);
    let task = tokio::task::spawn_local(async move {
        let (tx, mut rx) = mpsc::channel(256);
        let (rotated_tx, mut rotated_rx) = watch::channel(None);
        let forward = tokio::task::spawn_local(async move {
            while let Some(event) = rx.recv().await {
                if let Event::InviteRotated(invite) = &event {
                    rotated_tx.send_replace(Some(invite.clone()));
                }
                if events.send((generation, event)).await.is_err() {
                    break;
                }
            }
        });
        let mut attempt = 0;
        loop {
            let result = live::run(&config, &identity, &profile, &mut receiver, &tx).await;
            // Barrier: all confirmed rotations must reach the forwarding task
            // before deciding which capability/expiry to use for reconnection.
            match tokio::time::timeout(Duration::from_secs(1), tx.reserve_many(256)).await {
                Ok(Ok(permits)) => drop(permits),
                _ => break,
            }
            if let Some(invite) = rotated_rx.borrow_and_update().clone() {
                config.invite = invite;
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_shortcuts_preserve_modifiers_and_reject_physical_key_conflicts() {
        let mut profile = Profile::default();
        profile.retained.insert(
            "muteShortcut".into(),
            serde_json::json!({"key":"KeyM", "ctrl":true,"alt":false,"shift":true}),
        );
        assert_eq!(
            shortcut_chord(&profile, "muteShortcut").unwrap(),
            Some(("Control+Shift+KeyM".into(), 77))
        );
        profile.ptt_enabled = true;
        profile.ptt_key = "KeyM".into();
        assert!(configure_shortcuts(&profile).is_err());
        profile.ptt_key = "Enter".into();
        profile.retained.insert(
            "muteShortcut".into(),
            serde_json::json!({"key":"NumpadEnter", "ctrl":true,"alt":false,"shift":false}),
        );
        assert!(configure_shortcuts(&profile).is_err());
        profile.retained.insert(
            "muteShortcut".into(),
            serde_json::json!({"key":"ControlLeft", "ctrl":false,"alt":false,"shift":false}),
        );
        assert!(configure_shortcuts(&profile).is_err());
    }
}
