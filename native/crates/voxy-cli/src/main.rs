use anyhow::{Context, Result, bail};
use voxy_core::{identity::Identity, store::Store};
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str).unwrap_or("status") {
        "serve" => {
            tokio::task::LocalSet::new()
                .run_until(voxy_session::serve())
                .await?;
        }
        "status" => {
            let directory = voxy_core::data_directory()?;
            let store = Store::open(&directory.join("voxy.sqlite"))?;
            let identity = Identity::load_or_create(&directory.join("identity.dpapi"))?;
            let profile = store.profile()?;
            println!(
                "{}",
                serde_json::json!({"version":voxy_core::VERSION,"appId":voxy_core::APP_ID,"profileId":profile.id,"communities":store.communities()?.len(),"publicKeyBytes":identity.public_key().len(),"guiLoaded":false,"worldLoaded":false,"microphoneOpen":false,"relayEnabled":false})
            );
        }
        "audio-probe" => {
            let seconds = args
                .get(1)
                .map(|s| s.parse::<u64>())
                .transpose()?
                .unwrap_or(5)
                .clamp(1, 60);
            let control = std::sync::Arc::new(voxy_voice::control::VoiceControl::default());
            control
                .muted
                .store(true, std::sync::atomic::Ordering::Release);
            let mut audio =
                voxy_voice::call::CallAudio::start(Default::default(), control.clone())?;
            let end = std::time::Instant::now() + std::time::Duration::from_secs(seconds);
            let mut frames = 0;
            while std::time::Instant::now() < end {
                while audio.encoded.try_recv().is_ok() {
                    frames += 1;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            audio.stop()?;
            anyhow::ensure!(
                frames > 0,
                "Os dispositivos abriram, mas o pipeline não produziu frames; áudio não validado"
            );
            println!(
                "{}",
                serde_json::json!({"deviceStreamsOpened":true,"seconds":seconds,"encodedFrames":frames,"capturedSamples":control.captured_samples.load(std::sync::atomic::Ordering::Relaxed),"renderedSamples":control.rendered_samples.load(std::sync::atomic::Ordering::Relaxed),"processedBlocks":control.processed_blocks.load(std::sync::atomic::Ordering::Relaxed),"recoverableDeviceEvents":control.recoverable_device_events.load(std::sync::atomic::Ordering::Relaxed),"deviceFailed":control.device_failed.load(std::sync::atomic::Ordering::Relaxed),"microphoneMutedBeforeEncode":true,"guiLoaded":false,"networkTransmission":false,"audioRecorded":false,"acousticQualityValidated":false})
            );
        }
        "devices" => {
            let devices = voxy_voice::devices::enumerate()?;
            println!("{}", serde_json::to_string_pretty(&devices)?);
        }
        "network-check" => {
            println!("{}", voxy_network::peer::local_transport_check().await?);
        }
        "signaling-check" => {
            let endpoint = args
                .get(1)
                .context("Informe ws://127.0.0.1:8787 do emulador local")?;
            println!(
                "{}",
                voxy_network::rendezvous::signaling_check(endpoint).await?
            );
        }
        "host" => {
            use voxy_core::{room::RoomHost, store::now_ms};
            let endpoint = args
                .get(1)
                .context("Uso: voxy-core host <wss://sinalização> [nome] [segundos]")?;
            let name = args.get(2).map(String::as_str).unwrap_or("Amigos");
            let seconds = args
                .get(3)
                .map(|s| s.parse::<u64>())
                .transpose()?
                .unwrap_or(3600)
                .clamp(1, 86400);
            let directory = voxy_core::data_directory()?;
            let mut store = Store::open(&directory.join("voxy.sqlite"))?;
            let profile = store.profile()?;
            let identity = Identity::load_or_create(&directory.join("identity.dpapi"))?;
            let server =
                if let Some(server) = store.communities()?.into_iter().find(|s| s.name == name) {
                    server
                } else {
                    store.create_community(profile.id, name)?
                };
            let invite = voxy_network::invite::Invite::create(
                &identity,
                server.id,
                &format!("{}/v3/{}", endpoint.trim_end_matches('/'), server.id),
                now_ms() + (seconds as i64) * 1000,
            )?;
            let key = invite.host_key.clone();
            let mut room = RoomHost::new(store, server, key.clone())?;
            room.admit(key, profile.id, profile.name)?;
            // An invitation is shown only on this explicit hosting command, never in diagnostics.
            println!(
                "{}",
                serde_json::json!({"type":"invite","invite":invite.encode()?,"microphoneOpen":false})
            );
            voxy_network::room_service::host(
                &invite,
                &identity,
                &mut room,
                &Default::default(),
                std::time::Duration::from_secs(seconds),
            )
            .await?;
        }
        "join" => {
            let raw = args
                .get(1)
                .context("Uso: voxy-core join <convite> <mensagem>")?;
            let message = args.get(2).context("Informe a mensagem de texto")?;
            let invite = voxy_network::invite::Invite::parse(raw, voxy_core::store::now_ms())?;
            let directory = voxy_core::data_directory()?;
            let store = Store::open(&directory.join("voxy.sqlite"))?;
            let profile = store.profile()?;
            let identity = Identity::load_or_create(&directory.join("identity.dpapi"))?;
            println!(
                "{}",
                voxy_network::room_service::join_and_post(&invite, &identity, &profile, message)
                    .await?
            );
        }
        "import-legacy" => {
            let source = args.get(1).context(
                "Uso: voxy-core import-legacy <pasta-legada-fechada> <pasta-nativa-vazia>",
            )?;
            let destination = args.get(2).context("Informe uma pasta nativa vazia")?;
            let report = voxy_core::migration::import_legacy(
                std::path::Path::new(source),
                std::path::Path::new(destination),
            )?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        "hold" => {
            let seconds = args
                .get(1)
                .map(|s| s.parse::<u64>())
                .transpose()?
                .unwrap_or(60)
                .min(3600);
            let path = voxy_core::data_directory()?;
            let store = Store::open(&path.join("voxy.sqlite"))?;
            let _identity = Identity::load_or_create(&path.join("identity.dpapi"))?;
            let _profile = store.profile()?;
            println!(
                "{}",
                serde_json::json!({"state":"idle-core","seconds":seconds,"microphoneOpen":false,"guiLoaded":false})
            );
            tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
        }
        "ptt-check" => {
            let key = args.get(1).map(String::as_str).unwrap_or("Mouse4");
            let control = std::sync::Arc::new(voxy_voice::control::VoiceControl::default());
            let _reader = voxy_voice::control::GlobalPtt::start(control.clone(), key)?;
            control
                .ptt
                .store(true, std::sync::atomic::Ordering::Release);
            println!("Leitor PTT nativo ativo por 15 s; microfone fechado. Pressione {key}.");
            let mut last = false;
            for _ in 0..150 {
                let pressed = control.may_transmit();
                if pressed != last {
                    println!("{}", serde_json::json!({"pressed":pressed}));
                    last = pressed;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
        _ => bail!("Comandos: status, devices, network-check, import-legacy, hold, ptt-check"),
    }
    Ok(())
}
