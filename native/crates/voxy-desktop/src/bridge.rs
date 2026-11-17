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
            loop {
                tokio::select! {
                    state=ipc::read_frame::<ipc::State>(&mut reader,ipc::MAX_FRAME)=>match state {Ok(state)=>{if output.send(Msg::ServiceState(Box::new(state))).await.is_err(){return}},Err(_)=>break},
                    request=requests.recv()=>match request{Some(request)=>{if ipc::write_frame(&mut writer,&request).await.is_err(){break}},None=>return}
                }
            }
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
