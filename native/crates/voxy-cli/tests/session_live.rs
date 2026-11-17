//! Explicit integration against a local Worker emulator; no public service or microphone.
use anyhow::{Context, Result, ensure};
use std::{
    process::{Child, Command as Process, Stdio},
    sync::Arc,
    time::Duration,
};
use tokio::sync::mpsc;
use voxy_core::{
    identity::Identity,
    ipc::{self, Request, State},
    model::ChannelKind,
    room::{Action, Command},
    store::{Store, now_ms},
};
use voxy_network::{
    invite::Invite,
    live::{self, Config, Event, Input},
};
struct ProcessGuard(Child);
fn core_binary() -> std::ffi::OsString {
    std::env::var_os("VOXY_TEST_CORE_BINARY")
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_voxy-core").into())
}
#[cfg(windows)]
fn resource(pid: u32) -> Result<(usize, usize, f64)> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME},
        System::{
            ProcessStatus::{
                GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
            },
            Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
        },
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) };
    ensure!(!handle.is_null(), "Cannot query native session resources");
    let mut memory: PROCESS_MEMORY_COUNTERS_EX = unsafe { std::mem::zeroed() };
    memory.cb = std::mem::size_of_val(&memory) as u32;
    let mut times = [FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    }; 4];
    let ok = unsafe {
        GetProcessMemoryInfo(
            handle,
            (&mut memory as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
            memory.cb,
        )
    } != 0;
    let [created, exit, kernel, user] = &mut times;
    let cpu_ok = unsafe { GetProcessTimes(handle, created, exit, kernel, user) } != 0;
    unsafe {
        CloseHandle(handle);
    }
    ensure!(ok && cpu_ok, "Native process counter failed");
    let seconds = |time: FILETIME| {
        (((time.dwHighDateTime as u64) << 32) | time.dwLowDateTime as u64) as f64 / 10_000_000.
    };
    Ok((
        memory.WorkingSetSize,
        memory.PrivateUsage,
        seconds(times[2]) + seconds(times[3]),
    ))
}
async fn sample_calls(children: &[ProcessGuard]) -> Result<()> {
    #[cfg(windows)]
    if let Ok(directory) = std::env::var("VOXY_TEST_REPORT_DIRECTORY") {
        let cpus = std::thread::available_parallelism()?.get();
        let mut samples = vec![];
        let mut previous = children
            .iter()
            .map(|p| resource(p.0.id()))
            .collect::<Result<Vec<_>>>()?;
        for _ in 0..6 {
            let start = std::time::Instant::now();
            tokio::time::sleep(Duration::from_millis(500)).await;
            let elapsed = start.elapsed().as_secs_f64();
            let mut processes = vec![];
            for (index, child) in children.iter().enumerate() {
                let (working, private, cpu) = resource(child.0.id())?;
                processes.push(serde_json::json!({"participant":index,"workingSetMiB":working as f64/1048576.,"privateMiB":private as f64/1048576.,"cpuMachinePercent":100.*(cpu-previous[index].2)/elapsed/cpus as f64}));
                previous[index] = (working, private, cpu);
            }
            samples.push(serde_json::json!({"processes":processes}));
        }
        let report = serde_json::json!({"measuredAtMs":now_ms(),"build":if std::env::var_os("VOXY_TEST_CORE_BINARY").is_some(){"release override"}else{"debug"},"scenario":"Two native session processes, one peer per participant, both UI clients unloaded, physical default device APIs, remote playback volume zero, local Worker emulator, no recording","logicalCpus":cpus,"samples":samples,"includedVoxyProcesses":2,"testControllerAndRemoteInfrastructureEmulatorExcluded":true,"gpuAndVramMeasured":false,"acousticLatencyMeasured":false,"featureEquivalentToElectron":false});
        std::fs::write(
            std::path::Path::new(&directory).join("call-process-resources.json"),
            serde_json::to_vec_pretty(&report)?,
        )?;
    }
    Ok(())
}
impl Drop for ProcessGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
async fn graceful(children: &mut [ProcessGuard]) -> Result<()> {
    for child in children {
        tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                if child.0.try_wait()?.is_some() {
                    return Ok::<_, anyhow::Error>(());
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await??;
    }
    Ok(())
}
async fn attach(
    path: &std::path::Path,
) -> Result<(
    tokio::net::tcp::OwnedReadHalf,
    tokio::net::tcp::OwnedWriteHalf,
    State,
)> {
    for _ in 0..50 {
        if let Ok(connection) = ipc::connect(path).await {
            return Ok(connection);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    anyhow::bail!("Daemon did not become ready")
}
async fn until(
    reader: &mut tokio::net::tcp::OwnedReadHalf,
    predicate: impl Fn(&State) -> bool,
) -> Result<State> {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let state: State = ipc::read_frame(reader, ipc::MAX_FRAME).await?;
            if predicate(&state) {
                return Ok(state);
            }
        }
    })
    .await?
}
#[tokio::test]
#[ignore = "requires VOXY_TEST_SIGNAL_URL and local Worker emulator"]
async fn independent_session_processes_deliver_chat_survive_ui_detach_and_reject_foreign_identity()
-> Result<()> {
    let endpoint = std::env::var("VOXY_TEST_SIGNAL_URL")?;
    let root = tempfile::tempdir()?;
    let a = root.path().join("host");
    let b = root.path().join("guest");
    let mut store = Store::open(&a.join("voxy.sqlite"))?;
    let profile = store.profile()?;
    let server = store.create_community(profile.id, "Sessão persistente")?;
    drop(store);
    let mut children = vec![];
    for path in [&a, &b] {
        let mut command = Process::new(core_binary());
        command
            .arg("serve")
            .env("VOXY_NATIVE_DATA_DIR", path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        children.push(ProcessGuard(command.spawn()?));
    }
    let (mut ar, mut aw, _) = attach(&a).await?;
    ipc::write_frame(
        &mut aw,
        &Request::Host {
            server: server.id,
            endpoint,
            stun: vec![],
        },
    )
    .await?;
    let state = until(&mut ar, |s| s.snapshot.is_some() && s.invite.is_some()).await?;
    let invitation = state.invite.context("Host invitation missing")?;
    // A directory with another persistent identity cannot authenticate to the daemon.
    let attacker = root.path().join("attacker");
    std::fs::create_dir_all(&attacker)?;
    Identity::load_or_create(&attacker.join("identity.dpapi"))?;
    std::fs::copy(a.join("session.json"), attacker.join("session.json"))?;
    ensure!(
        ipc::connect(&attacker).await.is_err(),
        "Foreign identity authenticated"
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    let (mut br, mut bw, _) = attach(&b).await?;
    ipc::write_frame(
        &mut bw,
        &Request::Join {
            invite: invitation,
            stun: vec![],
        },
    )
    .await?;
    let joined = until(&mut br, |s| {
        s.snapshot.as_ref().is_some_and(|s| s.members.len() == 2)
    })
    .await?;
    let channel = joined
        .snapshot
        .as_ref()
        .unwrap()
        .channels
        .iter()
        .find(|c| c.kind == ChannelKind::Text)
        .unwrap()
        .id;
    let message_command_id = uuid::Uuid::new_v4();
    ipc::write_frame(
        &mut bw,
        &Request::Command {
            command: Command {
                id: message_command_id,
                action: Action::Message {
                    channel,
                    text: "Mensagem entre sessões nativas".into(),
                },
            },
        },
    )
    .await?;
    ipc::write_frame(
        &mut bw,
        &Request::Controls {
            muted: false,
            deafened: false,
        },
    )
    .await?;
    until(&mut br, |s| {
        s.acknowledgements.contains(&message_command_id)
    })
    .await?;
    until(&mut ar, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.messages
                .iter()
                .any(|m| m.text == "Mensagem entre sessões nativas")
        })
    })
    .await?;
    drop(ar);
    drop(aw); // Simulates unloading the entire UI process, not minimizing it.
    let (_, mut aw, state) = attach(&a).await?;
    ensure!(
        state
            .snapshot
            .as_ref()
            .is_some_and(|s| s.members.len() == 2),
        "Session lost on UI detach"
    );
    ipc::write_frame(&mut bw, &Request::Shutdown).await?;
    ipc::write_frame(&mut aw, &Request::Shutdown).await?;
    graceful(&mut children).await?;
    println!(
        "session-processes: authenticated IPC, authoritative chat, UI detach/re-attach, foreign identity denied; no microphone"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires explicit VOXY_TEST_PHYSICAL_AUDIO=1; uses local default audio APIs with remote playback volume zero"]
async fn native_duplex_call_uses_devices_and_survives_ui_unload() -> Result<()> {
    ensure!(
        std::env::var("VOXY_TEST_PHYSICAL_AUDIO").ok().as_deref() == Some("1"),
        "Physical-device API test not enabled"
    );
    let endpoint = std::env::var("VOXY_TEST_SIGNAL_URL")?;
    let root = tempfile::tempdir()?;
    let a = root.path().join("a");
    let b = root.path().join("b");
    let mut store = Store::open(&a.join("voxy.sqlite"))?;
    let pa = store.profile()?;
    let server = store.create_community(pa.id, "Duplex local")?;
    drop(store);
    let pb = Store::open(&b.join("voxy.sqlite"))?.profile()?;
    let mut children = vec![];
    for path in [&a, &b] {
        let mut command = Process::new(core_binary());
        command
            .arg("serve")
            .env("VOXY_NATIVE_DATA_DIR", path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        children.push(ProcessGuard(command.spawn()?));
    }
    let (mut ar, mut aw, _) = attach(&a).await?;
    let (mut br, mut bw, _) = attach(&b).await?;
    ipc::write_frame(
        &mut aw,
        &Request::Host {
            server: server.id,
            endpoint,
            stun: vec![],
        },
    )
    .await?;
    let state = until(&mut ar, |s| s.snapshot.is_some() && s.invite.is_some()).await?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    ipc::write_frame(
        &mut bw,
        &Request::Join {
            invite: state.invite.unwrap(),
            stun: vec![],
        },
    )
    .await?;
    let sa = until(&mut ar, |s| {
        s.snapshot.as_ref().is_some_and(|s| s.members.len() == 2) && s.peers.len() == 1
    })
    .await?;
    let sb = until(&mut br, |s| {
        s.snapshot.as_ref().is_some_and(|s| s.members.len() == 2) && s.peers.len() == 1
    })
    .await?;
    let channel = sa
        .snapshot
        .as_ref()
        .unwrap()
        .channels
        .iter()
        .find(|c| c.kind == ChannelKind::Voice)
        .unwrap()
        .id;
    // Silence playback at the mix stage before starting either capture. No feedback or recording.
    ipc::write_frame(
        &mut aw,
        &Request::Volume {
            peer: sa.peers[0].id,
            volume: 0.0,
            muted: false,
        },
    )
    .await?;
    ipc::write_frame(
        &mut bw,
        &Request::Volume {
            peer: sb.peers[0].id,
            volume: 0.0,
            muted: false,
        },
    )
    .await?;
    until(&mut ar, |s| {
        s.peers.first().is_some_and(|p| p.volume == 0.0)
    })
    .await?;
    until(&mut br, |s| {
        s.peers.first().is_some_and(|p| p.volume == 0.0)
    })
    .await?;
    ipc::write_frame(
        &mut aw,
        &Request::VoiceEnter {
            channel,
            profile: pa,
        },
    )
    .await?;
    ipc::write_frame(
        &mut bw,
        &Request::VoiceEnter {
            channel,
            profile: pb,
        },
    )
    .await?;
    let before = until(&mut ar, |s| {
        s.microphone_ready
            && s.received_frames >= 10
            && s.sent_frames >= 10
            && s.decoded_frames >= 10
            && s.playback_samples > 0
    })
    .await?;
    until(&mut br, |s| {
        s.microphone_ready
            && s.received_frames >= 10
            && s.sent_frames >= 10
            && s.decoded_frames >= 10
            && s.playback_samples > 0
    })
    .await?;
    drop(ar);
    drop(aw);
    drop(br);
    drop(bw);
    sample_calls(&children).await?;
    tokio::time::sleep(Duration::from_millis(1200)).await;
    let (mut ar, mut aw, after) = attach(&a).await?;
    let (mut br, mut bw, _) = attach(&b).await?;
    ensure!(
        after.microphone_ready
            && after.voice == Some(channel)
            && after.encoded_frames > before.encoded_frames
            && after.received_frames > before.received_frames
            && after.decoded_frames > before.decoded_frames,
        "Call stopped when UI unloaded"
    );
    ipc::write_frame(
        &mut aw,
        &Request::Controls {
            muted: true,
            deafened: true,
        },
    )
    .await?;
    until(&mut ar, |s| s.muted && s.deafened).await?;
    ipc::write_frame(&mut aw, &Request::VoiceLeave).await?;
    ipc::write_frame(&mut bw, &Request::VoiceLeave).await?;
    until(&mut ar, |s| !s.microphone_ready && s.voice.is_none()).await?;
    until(&mut br, |s| !s.microphone_ready && s.voice.is_none()).await?;
    ipc::write_frame(&mut aw, &Request::Shutdown).await?;
    ipc::write_frame(&mut bw, &Request::Shutdown).await?;
    graceful(&mut children).await?;
    println!(
        "device-api-duplex: local microphone -> DSP -> Opus/SRTP -> decoder/playback mixer; remote playback volume zero; call kept running after both UI clients unloaded; mute/deafen and leave acknowledged; no audio file, no public network, no acoustic quality certification"
    );
    Ok(())
}
#[tokio::test]
#[ignore = "requires VOXY_TEST_SIGNAL_URL and local Worker emulator"]
async fn authenticated_mesh_transmits_opus_and_isolates_other_voice_channels() -> Result<()> {
    tokio::task::LocalSet::new().run_until(async {
        let endpoint=std::env::var("VOXY_TEST_SIGNAL_URL")?;let root=tempfile::tempdir()?;
        let mut store=Store::open(&root.path().join("host.sqlite"))?;let host=store.profile()?;
        let server=store.create_community(host.id,"Malha Opus")?;
        let voice=store.channels(server.id)?.into_iter().find(|c|c.kind==ChannelKind::Voice).unwrap().id;
        let other=store.add_channel(host.id,server.id,"Outro canal",ChannelKind::Voice)?.id;
        drop(store);
        let identity=Arc::new(Identity::generate());let invite=Invite::create(&identity,server.id,&format!("{endpoint}/v3/{}",server.id),now_ms()+60000)?;
        let mut senders=vec![];let (output,mut events)=mpsc::channel(512);let mut tasks=vec![];
        for index in 0..3 {
            let profile=if index==0{host.clone()}else{Default::default()};
            let identity=if index==0{identity.clone()}else{Arc::new(Identity::generate())};
            let config=Config{invite:invite.clone(),host:(index==0).then(||server.clone()),database:root.path().join("host.sqlite"),policy:Default::default()};
            let (tx,mut rx)=mpsc::channel(64);senders.push(tx);
            let (event_tx,mut event_rx)=mpsc::channel(256);let output=output.clone();
            tasks.push(tokio::task::spawn_local(async move {let forward=tokio::task::spawn_local(async move{while let Some(event)=event_rx.recv().await{if output.send((index,event)).await.is_err(){break}}});let result=live::run(&config,&identity,&profile,&mut rx,&event_tx).await;forward.abort();result}));
            if index==0{tokio::time::sleep(Duration::from_millis(300)).await;}
        }
        tokio::time::timeout(Duration::from_secs(15),async{loop{if let Some((0,Event::Snapshot(snapshot)))=events.recv().await && snapshot.members.len()==3{break}}}).await?;
        for (index,sender) in senders.iter().enumerate(){sender.send(Input::Command(Command{id:uuid::Uuid::new_v4(),action:Action::VoiceJoin{channel:if index==2{other}else{voice}}})).await?;}
        tokio::time::timeout(Duration::from_secs(10),async{let mut ready=[false;3];while !ready.iter().all(|v|*v){if let Some((i,Event::Snapshot(s)))=events.recv().await{ready[i]=s.members.iter().all(|m|m.voice.is_some());}}}).await?;
        let mut encoder=voxy_voice::codec::VoiceEncoder::new()?;let mut bytes=[0;1275];let mut samples=[0.0;960];
        for (i,s) in samples.iter_mut().enumerate(){*s=(i as f32*0.05).sin()*0.1;}
        let size=encoder.encode(&samples,&mut bytes)?;let packet=bytes[..size].to_vec();
        let sender=senders[0].clone();let expected=packet.clone();
        let sending=tokio::task::spawn_local(async move{for _ in 0..12{sender.send(Input::Audio(packet.clone())).await.unwrap();tokio::time::sleep(Duration::from_millis(20)).await;}});
        let deadline=tokio::time::sleep(Duration::from_secs(2));tokio::pin!(deadline);let mut received=0;
        loop {tokio::select!{_= &mut deadline=>break,event=events.recv()=>if let Some((index,Event::Audio{payload,..}))=event{ensure!(index==1,"Audio leaked to another voice channel");ensure!(payload==expected,"Opus payload changed");received+=1;}}}
        sending.await?;ensure!(received>=8,"Insufficient received Opus frames: {received}");
        for sender in senders{let _=sender.send(Input::Stop).await;}
        for task in tasks{task.await??;}
        println!("mesh: {received} native Opus/SRTP frames, 3 authenticated peers, channel isolation; synthetic audio, no physical microphone");
        Ok(())
    }).await
}
