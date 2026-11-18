//! Loopback-only control socket with mutual Ed25519 challenge authentication.
//! The discovery file contains no bearer credential. The user's private key is DPAPI protected.
use anyhow::{Context, Result, ensure};
use rand::RngCore;
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Semaphore, mpsc, watch},
};
use voxy_core::{
    identity::Identity,
    ipc::{self, Challenge, Endpoint, Request, State},
};
async fn read<T: serde::de::DeserializeOwned>(
    stream: &mut tokio::net::tcp::OwnedReadHalf,
    limit: usize,
) -> Result<T> {
    let size = stream.read_u32().await? as usize;
    ensure!(size <= limit, "Frame IPC excede o limite");
    let mut bytes = vec![0; size];
    stream.read_exact(&mut bytes).await?;
    Ok(serde_json::from_slice(&bytes)?)
}
async fn write(
    stream: &mut tokio::net::tcp::OwnedWriteHalf,
    value: &impl serde::Serialize,
) -> Result<()> {
    let bytes = serde_json::to_vec(value)?;
    ensure!(bytes.len() <= ipc::MAX_FRAME, "Estado IPC excede o limite");
    tokio::time::timeout(Duration::from_secs(3), async {
        stream.write_u32(bytes.len() as u32).await?;
        stream.write_all(&bytes).await
    })
    .await??;
    Ok(())
}
async fn connection(
    stream: TcpStream,
    port: u16,
    identity: Arc<Identity>,
    requests: mpsc::Sender<Request>,
    mut states: watch::Receiver<State>,
    authenticated: Arc<std::sync::atomic::AtomicBool>,
    mut video: tokio::sync::broadcast::Receiver<Arc<Vec<u8>>>,
) -> Result<()> {
    stream.set_nodelay(true)?;
    let (mut reader, mut writer) = stream.into_split();
    let mut nonce = vec![0; 32];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let transcript = serde_json::to_vec(&("voxy-ipc-server-v1", port, &nonce))?;
    write(
        &mut writer,
        &Challenge {
            nonce: nonce.clone(),
            signature: identity.sign(&transcript).to_vec(),
        },
    )
    .await?;
    let proof: Challenge =
        tokio::time::timeout(Duration::from_secs(3), read(&mut reader, 2048)).await??;
    ensure!(proof.nonce.len() == 32, "Nonce IPC inválido");
    let signature: [u8; 64] = proof
        .signature
        .try_into()
        .map_err(|_| anyhow::anyhow!("Assinatura IPC inválida"))?;
    Identity::verify(
        &identity.public_key(),
        &serde_json::to_vec(&("voxy-ipc-client-v1", port, &nonce, &proof.nonce))?,
        &signature,
    )?;
    authenticated.store(true, std::sync::atomic::Ordering::Release);
    requests
        .send(Request::Attached)
        .await
        .context("Sessão encerrada")?;
    let initial = states.borrow_and_update().clone();
    write(&mut writer, &initial).await?;
    loop {
        tokio::select! {
            request=read::<Request>(&mut reader,131072)=>{requests.send(request?).await.context("Núcleo encerrado")?;},
            changed=states.changed()=>{changed?;let state=states.borrow_and_update().clone();write(&mut writer,&state).await?;},
            frame=video.recv()=>match frame {
                Ok(frame)=>{
                    // Binary video frame: flagged length prefix, no JSON. A slow UI
                    // lags the broadcast and skips frames instead of growing memory.
                    ensure!(frame.len()<(ipc::VIDEO_FRAME_FLAG as usize),"Frame de vídeo excede o limite");
                    tokio::time::timeout(Duration::from_secs(1),async{writer.write_u32(frame.len() as u32|ipc::VIDEO_FRAME_FLAG).await?;writer.write_all(&frame).await}).await??;
                },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=>{},
                Err(tokio::sync::broadcast::error::RecvError::Closed)=>std::future::pending::<()>().await,
            }
        }
    }
}
#[cfg(windows)]
struct Instance(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Drop for Instance {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
pub async fn serve() -> Result<()> {
    let path = voxy_core::data_directory()?;
    let identity = Arc::new(Identity::load_or_create(&path.join("identity.dpapi"))?);
    #[cfg(windows)]
    let _instance = {
        use windows_sys::Win32::{
            Foundation::{ERROR_ALREADY_EXISTS, GetLastError},
            System::Threading::CreateMutexW,
        };
        let name = format!("Local\\VoxyNativeSession-{:02x?}", identity.public_key());
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        ensure!(!handle.is_null(), "Mutex de sessão indisponível");
        let instance = Instance(handle);
        ensure!(
            unsafe { GetLastError() } != ERROR_ALREADY_EXISTS,
            "A sessão já está em execução"
        );
        instance
    };
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    let endpoint = Endpoint {
        protocol: ipc::PROTOCOL,
        port,
        pid: std::process::id(),
        version: voxy_core::VERSION.into(),
        executable: std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
    };
    std::fs::write(path.join("session.json"), serde_json::to_vec(&endpoint)?)?;
    let (requests, receiver) = mpsc::channel(64);
    let (states, state_rx) = watch::channel(State::default());
    let (video_frames, _) = tokio::sync::broadcast::channel(8);
    let actor = crate::run(
        path.clone(),
        identity.clone(),
        receiver,
        states,
        video_frames.clone(),
    );
    tokio::pin!(actor);
    let limit = Arc::new(Semaphore::new(8));
    let result = loop {
        tokio::select! {
            result=&mut actor=>break result,
            accepted=listener.accept()=>{let (stream,address)=accepted?;if !address.ip().is_loopback(){continue}let Ok(permit)=limit.clone().try_acquire_owned()else{continue};let identity=identity.clone();let requests=requests.clone();let states=state_rx.clone();let video=video_frames.subscribe();let slots=limit.clone();tokio::task::spawn_local(async move{let authenticated=Arc::new(std::sync::atomic::AtomicBool::new(false));let _=connection(stream,port,identity,requests.clone(),states,authenticated.clone(),video).await;drop(permit);if authenticated.load(std::sync::atomic::Ordering::Acquire)&&slots.available_permits()==8{let _=requests.try_send(Request::Detached);}});}
        }
    };
    let _ = std::fs::remove_file(path.join("session.json"));
    result
}
