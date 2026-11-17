//! Event driven local session bridge. No render polling or network credentials.
use crate::Msg;
use iced::futures::{SinkExt, Stream};
use voxy_core::ipc::{self, Request};
pub fn stream() -> impl Stream<Item = Msg> {
    iced::stream::channel(16, async |mut output| {
        let directory = match voxy_core::data_directory() {
            Ok(path) => path,
            Err(_) => return,
        };
        let mut spawned = false;
        let mut attempts = 0;
        loop {
            let connection = ipc::connect(&directory).await;
            let (mut reader, mut writer, state) = match connection {
                Ok(connection) => connection,
                Err(_) => {
                    attempts += 1;
                    if attempts >= 30 {
                        let _=output.send(Msg::ServiceError("O núcleo não respondeu em 9 s. Feche e abra o Voxy ou confira a instalação nativa.".into())).await;
                        return;
                    }
                    if !spawned {
                        let executable = std::env::current_exe()
                            .ok()
                            .and_then(|p| p.parent().map(|p| p.join("voxy-core.exe")));
                        if let Some(executable) = executable {
                            let mut command = std::process::Command::new(executable);
                            command
                                .arg("serve")
                                .stdin(std::process::Stdio::null())
                                .stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null());
                            #[cfg(windows)]
                            {
                                use std::os::windows::process::CommandExt;
                                command.creation_flags(0x08000000);
                            }
                            if command.spawn().is_err() {
                                let _=output.send(Msg::ServiceError("Núcleo indisponível. Execute npm run native:build e tente novamente.".into())).await;
                                return;
                            }
                        }
                        spawned = true;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    continue;
                }
            };
            attempts = 0;
            let (sender, mut requests) = tokio::sync::mpsc::channel::<Request>(32);
            if output.send(Msg::ServiceConnected(sender)).await.is_err() {
                return;
            }
            if output
                .send(Msg::ServiceState(Box::new(state)))
                .await
                .is_err()
            {
                return;
            }
            // Reads run in their own task: a partially read frame must never be
            // abandoned by select! when a request is written concurrently.
            enum Incoming {
                State(Box<ipc::State>),
                Video(Vec<u8>),
            }
            let (incoming_tx, mut incoming) = tokio::sync::mpsc::channel::<Incoming>(32);
            let reader_task = tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                while let Ok(prefix) = reader.read_u32().await {
                    if prefix & ipc::VIDEO_FRAME_FLAG != 0 {
                        let size = (prefix & !ipc::VIDEO_FRAME_FLAG) as usize;
                        if size > voxy_network::video::MAX_VIDEO_FRAME + 64 {
                            break;
                        }
                        let mut bytes = vec![0; size];
                        if reader.read_exact(&mut bytes).await.is_err() {
                            break;
                        }
                        // Video is lossy; never let it delay confirmed state.
                        let _ = incoming_tx.try_send(Incoming::Video(bytes));
                    } else {
                        let size = prefix as usize;
                        if size > ipc::MAX_FRAME {
                            break;
                        }
                        let mut bytes = vec![0; size];
                        if reader.read_exact(&mut bytes).await.is_err() {
                            break;
                        }
                        let Ok(state) = serde_json::from_slice::<ipc::State>(&bytes) else {
                            break;
                        };
                        if incoming_tx
                            .send(Incoming::State(Box::new(state)))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            });
            let mut decoders = crate::video::Decoders::new(output.clone());
            loop {
                tokio::select! {
                    message=incoming.recv()=>match message {
                        Some(Incoming::State(state))=>{if output.send(Msg::ServiceState(state)).await.is_err(){reader_task.abort();return}},
                        Some(Incoming::Video(bytes))=>{if let Some((member,keyframe,size,payload))=ipc::decode_video_frame(&bytes){decoders.push(member,keyframe,size,payload.to_vec());}},
                        None=>break,
                    },
                    request=requests.recv()=>match request{Some(request)=>{if ipc::write_frame(&mut writer,&request).await.is_err(){break}},None=>{reader_task.abort();return}}
                }
            }
            reader_task.abort();
            if output
                .send(Msg::ServiceError(
                    "Conexão com o núcleo interrompida. Reconectando…".into(),
                ))
                .await
                .is_err()
            {
                return;
            }
            spawned = false;
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    })
}
