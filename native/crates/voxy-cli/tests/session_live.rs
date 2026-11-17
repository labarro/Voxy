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
async fn issue(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    reader: &mut tokio::net::tcp::OwnedReadHalf,
    action: Action,
) -> Result<serde_json::Value> {
    let id = uuid::Uuid::new_v4();
    ipc::write_frame(
        writer,
        &Request::Command {
            command: Command { id, action },
        },
    )
    .await?;
    let state = until(reader, |s| {
        s.command_results.iter().any(|(key, _)| *key == id)
    })
    .await?;
    Ok(state
        .command_results
        .into_iter()
        .find(|(key, _)| *key == id)
        .unwrap()
        .1)
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
    let initial_message = until(&mut ar, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.messages
                .iter()
                .any(|m| m.text == "Mensagem entre sessões nativas")
        })
    })
    .await?;
    let original = initial_message
        .snapshot
        .as_ref()
        .unwrap()
        .messages
        .iter()
        .find(|m| m.text == "Mensagem entre sessões nativas")
        .unwrap()
        .id;
    let guest = joined
        .snapshot
        .as_ref()
        .unwrap()
        .members
        .iter()
        .find(|m| m.id != profile.id)
        .unwrap()
        .id;
    let image_fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/image.json"))?;
    let upload = uuid::Uuid::new_v4();
    issue(
        &mut bw,
        &mut br,
        Action::ImageBegin {
            upload,
            target: voxy_core::images::ImageTarget::Channel { channel },
            name: "fixture.png".into(),
            total_bytes: image_fixture["size"].as_u64().unwrap() as u32,
            sha256: image_fixture["sha256"].as_str().unwrap().into(),
        },
    )
    .await?;
    issue(
        &mut bw,
        &mut br,
        Action::ImageChunk {
            upload,
            offset: 0,
            data: image_fixture["data"].as_str().unwrap().into(),
        },
    )
    .await?;
    let image_reply = issue(
        &mut bw,
        &mut br,
        Action::ImageCommit {
            upload,
            text: "Anexo controlado".into(),
        },
    )
    .await?;
    let image = uuid::Uuid::parse_str(
        image_reply["image"]["id"]
            .as_str()
            .context("Image commit metadata missing")?,
    )?;
    until(&mut ar, |state| {
        state.snapshot.as_ref().is_some_and(|snapshot| {
            snapshot.messages.iter().any(|message| {
                message
                    .attachments
                    .iter()
                    .any(|attachment| attachment.id == image)
            })
        })
    })
    .await?;
    let image_bytes = issue(
        &mut aw,
        &mut ar,
        Action::ImageRead {
            id: image,
            offset: 0,
        },
    )
    .await?;
    ensure!(
        image_bytes["done"] == true && image_bytes["data"] == image_fixture["data"],
        "Image bytes changed across IPC/P2P transfer"
    );
    issue(
        &mut aw,
        &mut ar,
        Action::Reply {
            channel,
            target: original,
            text: format!("Resposta @{{{guest}}}"),
        },
    )
    .await?;
    until(&mut br, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.messages.iter().any(|m| m.reply_to == Some(original))
                && s.notifications.iter().any(|n| n.kind == "reply")
        })
    })
    .await?;
    issue(
        &mut bw,
        &mut br,
        Action::React {
            id: original,
            emoji: "👍".into(),
        },
    )
    .await?;
    until(&mut ar, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.messages.iter().any(|m| {
                m.id == original
                    && m.reactions
                        .get("👍")
                        .is_some_and(|actors| actors.contains(&guest))
            })
        })
    })
    .await?;
    let history = issue(
        &mut bw,
        &mut br,
        Action::Search {
            channel,
            text: "Resposta".into(),
            before: None,
        },
    )
    .await?;
    ensure!(
        history.as_array().is_some_and(|rows| rows.len() == 1),
        "Remote search reply was not transported over IPC"
    );
    let role = issue(
        &mut aw,
        &mut ar,
        Action::RoleSave {
            id: None,
            name: "Amigos".into(),
            color: "#123456".into(),
        },
    )
    .await?;
    let role = uuid::Uuid::parse_str(role["role"].as_str().context("Role reply missing")?)?;
    issue(
        &mut aw,
        &mut ar,
        Action::RoleAssign {
            role,
            member: guest,
            assigned: true,
        },
    )
    .await?;
    until(&mut br, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.member_roles
                .iter()
                .any(|r| r.role == role && r.member == guest)
        })
    })
    .await?;
    issue(
        &mut bw,
        &mut br,
        Action::ProfileUpdate {
            name: "Pessoa ausente".into(),
            presence: voxy_core::room::Presence::Away,
            nickname_color: "#112233".into(),
        },
    )
    .await?;
    until(&mut ar, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.profiles
                .iter()
                .any(|p| p.id == guest && p.presence == voxy_core::room::Presence::Away)
        })
    })
    .await?;
    issue(&mut aw, &mut ar, Action::FriendRequest { to: guest }).await?;
    until(&mut br, |s| {
        s.snapshot
            .as_ref()
            .is_some_and(|s| s.friends.iter().any(|f| f.requester == profile.id))
    })
    .await?;
    issue(
        &mut bw,
        &mut br,
        Action::FriendRespond {
            requester: profile.id,
            accept: true,
        },
    )
    .await?;
    until(&mut ar, |s| {
        s.snapshot
            .as_ref()
            .is_some_and(|s| s.friends.iter().any(|f| f.accepted))
    })
    .await?;
    let direct = issue(
        &mut aw,
        &mut ar,
        Action::Direct {
            to: guest,
            text: "DM privada original".into(),
        },
    )
    .await?;
    let direct = uuid::Uuid::parse_str(direct["id"].as_str().context("DM reply missing")?)?;
    until(&mut br, |s| {
        s.snapshot
            .as_ref()
            .is_some_and(|s| s.direct.iter().any(|d| d.id == direct))
    })
    .await?;
    issue(&mut bw, &mut br, Action::DirectRead { id: direct }).await?;
    until(&mut ar, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.direct
                .iter()
                .any(|d| d.id == direct && d.read_at.is_some())
        })
    })
    .await?;
    issue(
        &mut aw,
        &mut ar,
        Action::DirectEdit {
            id: direct,
            text: "DM privada editada".into(),
        },
    )
    .await?;
    until(&mut br, |s| {
        s.snapshot.as_ref().is_some_and(|s| {
            s.direct
                .iter()
                .any(|d| d.id == direct && d.text == "DM privada editada" && d.edited_at.is_some())
        })
    })
    .await?;
    ipc::write_frame(
        &mut bw,
        &Request::Command {
            command: Command {
                id: uuid::Uuid::new_v4(),
                action: Action::DirectEdit {
                    id: direct,
                    text: "Tentativa sem autoria".into(),
                },
            },
        },
    )
    .await?;
    until(&mut br, |s| s.error.is_some()).await?;
    issue(&mut aw, &mut ar, Action::DirectDelete { id: direct }).await?;
    until(&mut br, |s| {
        s.snapshot
            .as_ref()
            .is_some_and(|s| s.direct.iter().all(|d| d.id != direct))
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
        "session-processes: authenticated IPC, chat/replies/reactions/search, roles/presence, friendship/DM edit/read/delete/authorization, private notifications, UI detach/re-attach, foreign identity denied; no microphone"
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
        let mut senders=vec![];let (output,mut events)=mpsc::channel(512);let mut tasks=vec![];let microphone_gate=Arc::new(std::sync::atomic::AtomicBool::new(true));
        for index in 0..3 {
            let profile=if index==0{host.clone()}else{Default::default()};
            let identity=if index==0{identity.clone()}else{Arc::new(Identity::generate())};
            let gate=microphone_gate.clone();let config=Config{invite:invite.clone(),host:(index==0).then(||server.clone()),database:root.path().join("host.sqlite"),policy:Default::default(),microphone_allowed:Some(Arc::new(move||gate.load(std::sync::atomic::Ordering::Acquire)))};
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
        // The transport must consult the live gate even when Opus is already queued.
        microphone_gate.store(false,std::sync::atomic::Ordering::Release);
        for _ in 0..24 {senders[0].send(Input::Audio(expected.clone())).await?;}
        let silence=tokio::time::sleep(Duration::from_millis(500));tokio::pin!(silence);
        loop {tokio::select!{_= &mut silence=>break,event=events.recv()=>ensure!(!matches!(event,Some((_,Event::Audio{..}))),"Queued Opus bypassed the microphone gate")}}
        use voxy_core::game_service::{GameCommand,GameKind};
        for sender in senders.iter().take(2){sender.send(Input::Command(Command{id:uuid::Uuid::new_v4(),action:Action::Game{channel:voice,command:GameCommand::Join{game:GameKind::Pool,seat:None}}})).await?;}
        let revision=tokio::time::timeout(Duration::from_secs(5),async{loop{if let Some((0,Event::Snapshot(snapshot)))=events.recv().await && let Some(game)=snapshot.games.iter().find(|game|game.channel==voice) && game.pool.players.len()==2 {break game.pool.revision;}}}).await?;
        senders[0].send(Input::Command(Command{id:uuid::Uuid::new_v4(),action:Action::Game{channel:voice,command:GameCommand::PoolShoot{angle:0.0,power:0.5,revision}}})).await?;
        // Frequent audio inputs must not starve the authoritative game's fixed deadline.
        let busy_sender=senders[0].clone();let busy_packet=expected.clone();
        let busy=tokio::task::spawn_local(async move{for _ in 0..60{let _=busy_sender.send(Input::Audio(busy_packet.clone())).await;tokio::time::sleep(Duration::from_millis(20)).await;}});
        tokio::time::timeout(Duration::from_secs(5),async{loop{match events.recv().await{
            Some((2,Event::Snapshot(snapshot)))=>ensure!(snapshot.games.is_empty(),"Game leaked across voice channels"),
            Some((1,Event::Snapshot(snapshot)))=>{if let Some(game)=snapshot.games.iter().find(|game|game.channel==voice) && game.pool.clock>0.65 && game.pool.balls.iter().any(|ball|ball.vx.abs()+ball.vz.abs()>0.001){break Ok::<_,anyhow::Error>(());}},
            _=>{}
        }}}).await??;busy.await?;
        let replacement=Invite::create(&identity,server.id,&invite.signal_url,now_ms()+60000)?;
        senders[0].send(Input::RotateInvite(replacement.clone())).await?;
        tokio::time::timeout(Duration::from_secs(10),async{loop{if let Some((0,Event::InviteRotated(value)))=events.recv().await {ensure!(value.capability==replacement.capability,"Rotation acknowledgement mismatch");break Ok::<_,anyhow::Error>(())}}}).await??;
        for sender in senders{let _=sender.send(Input::Stop).await;}
        for (index,task) in tasks.into_iter().enumerate(){let result=task.await?;if index==0{result?;}}
        println!("mesh: {received} native Opus/SRTP frames, 3 authenticated peers, channel isolation; queued Opus denied after gate closed; authoritative pool physics advanced over P2P snapshots during frequent audio input; invite rotation acknowledged and P2P peers revoked; synthetic audio, no physical microphone or 3D renderer");
        Ok(())
    }).await
}

#[tokio::test]
#[ignore = "requires VOXY_TEST_SIGNAL_URL and local Worker emulator"]
async fn reconnecting_identity_keeps_host_and_persistent_chat_across_generations() -> Result<()> {
    tokio::task::LocalSet::new().run_until(async {
        let endpoint=std::env::var("VOXY_TEST_SIGNAL_URL")?;
        let root=tempfile::tempdir()?;
        let database=root.path().join("host.sqlite");
        let mut store=Store::open(&database)?;
        let host_profile=store.profile()?;
        let server=store.create_community(host_profile.id,"Reconexão por identidade")?;
        let channel=store.channels(server.id)?.into_iter().find(|c|c.kind==ChannelKind::Text).unwrap().id;
        drop(store);
        let host_identity=Arc::new(Identity::generate());
        let guest_identity=Arc::new(Identity::generate());
        let guest_profile=voxy_core::model::Profile::default();
        let invite=Invite::create(&host_identity,server.id,&format!("{endpoint}/v3/{}",server.id),now_ms()+60000)?;
        let host_config=Config{invite:invite.clone(),host:Some(server),database:database.clone(),policy:Default::default(),microphone_allowed:None};
        let (host_sender,mut host_input)=mpsc::channel(64);
        let (host_output,mut host_events)=mpsc::channel(256);
        let host=tokio::task::spawn_local(async move{live::run(&host_config,&host_identity,&host_profile,&mut host_input,&host_output).await});
        tokio::time::timeout(Duration::from_secs(5),async{loop{if matches!(host_events.recv().await,Some(Event::Snapshot(_))){break}}}).await?;
        let mut messages=vec![];
        for generation in 0..4 {
            let config=Config{invite:invite.clone(),host:None,database:root.path().join("guest.sqlite"),policy:Default::default(),microphone_allowed:None};
            let (sender,mut input)=mpsc::channel(64);let (output,mut events)=mpsc::channel(256);
            let identity=guest_identity.clone();let profile=guest_profile.clone();
            let guest=tokio::task::spawn_local(async move{live::run(&config,&identity,&profile,&mut input,&output).await});
            tokio::time::timeout(Duration::from_secs(10),async{loop{if let Some(Event::Snapshot(snapshot))=events.recv().await && snapshot.members.len()==2 {for id in &messages{ensure!(snapshot.messages.iter().any(|message|&message.id==id),"History lost after reconnect");}break Ok::<_,anyhow::Error>(());}}}).await??;
            let id=uuid::Uuid::new_v4();
            sender.send(Input::Command(Command{id,action:Action::Message{channel,text:format!("generation-{generation}")}})).await?;
            let message_id=tokio::time::timeout(Duration::from_secs(5),async{loop{if let Some(Event::Replied(reply,value))=events.recv().await && reply==id {break serde_json::from_value::<uuid::Uuid>(value["id"].clone());}}}).await??;
            messages.push(message_id);
            sender.send(Input::Stop).await?;guest.await??;
            ensure!(!host.is_finished(),"Guest reconnection unexpectedly ended host");
            // Do not wait for a host peer-left snapshot: immediately replace the generation.
        }
        host_sender.send(Input::Stop).await?;host.await??;
        let store=Store::open(&database)?;
        ensure!(store.messages(channel,None)?.len()==4,"Chat not persisted across reconnects");
        println!("reconnection: 4 admissions of the same authenticated identity, host kept alive, prior chat restored, four persisted messages; local emulator only");
        Ok(())
    }).await
}
