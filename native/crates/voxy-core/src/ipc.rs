//! Versioned local control protocol. Transport authenticates both endpoints.
use crate::{
    model::Profile,
    room::{Command, Snapshot},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
pub const PROTOCOL: u8 = 1;
pub const MAX_FRAME: usize = 2_100_000;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Host {
        server: Uuid,
        endpoint: String,
        stun: Vec<String>,
    },
    Join {
        invite: String,
        stun: Vec<String>,
    },
    Command {
        command: Command,
    },
    VoiceEnter {
        channel: Uuid,
        profile: Profile,
    },
    VoiceLeave,
    RotateInvite {
        valid_for_seconds: u64,
    },
    Controls {
        muted: bool,
        deafened: bool,
    },
    Volume {
        peer: u64,
        volume: f32,
        muted: bool,
    },
    Disconnect,
    Shutdown,
    Detached,
    Attached,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct State {
    #[serde(default)]
    pub peers: Vec<Peer>,
    pub phase: String,
    pub snapshot: Option<Snapshot>,
    pub invite: Option<String>,
    pub voice: Option<Uuid>,
    pub microphone_ready: bool,
    pub muted: bool,
    pub deafened: bool,
    pub error: Option<String>,
    pub received_frames: u64,
    pub sent_frames: u64,
    pub input_level: f32,
    pub acknowledged: Option<Uuid>,
    #[serde(default)]
    pub acknowledgements: Vec<Uuid>,
    #[serde(default)]
    pub command_results: Vec<(Uuid, serde_json::Value)>,
    #[serde(default)]
    pub focus_requested: u64,
    #[serde(default)]
    pub notification_open: Option<Uuid>,
    #[serde(default)]
    pub encoded_frames: u64,
    #[serde(default)]
    pub decoded_frames: u64,
    #[serde(default)]
    pub playback_samples: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub protocol: u8,
    pub port: u16,
    pub pid: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id: u64,
    pub key: String,
    pub volume: f32,
}
#[derive(Serialize, Deserialize)]
pub struct Challenge {
    pub nonce: Vec<u8>,
    pub signature: Vec<u8>,
}

pub async fn read_frame<T: serde::de::DeserializeOwned>(
    reader: &mut (impl tokio::io::AsyncRead + Unpin),
    limit: usize,
) -> anyhow::Result<T> {
    use tokio::io::AsyncReadExt;
    let size = reader.read_u32().await? as usize;
    anyhow::ensure!(size <= limit, "Frame IPC excede o limite");
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes).await?;
    Ok(serde_json::from_slice(&bytes)?)
}
pub async fn write_frame(
    writer: &mut (impl tokio::io::AsyncWrite + Unpin),
    value: &impl Serialize,
) -> anyhow::Result<()> {
    use tokio::io::AsyncWriteExt;
    let bytes = serde_json::to_vec(value)?;
    anyhow::ensure!(bytes.len() <= MAX_FRAME, "Frame IPC excede o limite");
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        writer.write_u32(bytes.len() as u32).await?;
        writer.write_all(&bytes).await
    })
    .await??;
    Ok(())
}
pub async fn connect(
    directory: &std::path::Path,
) -> anyhow::Result<(
    tokio::net::tcp::OwnedReadHalf,
    tokio::net::tcp::OwnedWriteHalf,
    State,
)> {
    use crate::identity::Identity;
    use rand::RngCore;
    let endpoint: Endpoint =
        serde_json::from_slice(&std::fs::read(directory.join("session.json"))?)?;
    anyhow::ensure!(endpoint.protocol == PROTOCOL, "Protocolo IPC incompatível");
    let identity = Identity::load_or_create(&directory.join("identity.dpapi"))?;
    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, endpoint.port)),
    )
    .await??;
    stream.set_nodelay(true)?;
    let (mut reader, mut writer) = stream.into_split();
    let challenge: Challenge = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        read_frame(&mut reader, 2048),
    )
    .await??;
    anyhow::ensure!(challenge.nonce.len() == 32, "Desafio IPC inválido");
    let signature: [u8; 64] = challenge
        .signature
        .try_into()
        .map_err(|_| anyhow::anyhow!("Assinatura IPC inválida"))?;
    Identity::verify(
        &identity.public_key(),
        &serde_json::to_vec(&("voxy-ipc-server-v1", endpoint.port, &challenge.nonce))?,
        &signature,
    )?;
    let mut nonce = vec![0; 32];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let signature = identity
        .sign(&serde_json::to_vec(&(
            "voxy-ipc-client-v1",
            endpoint.port,
            &challenge.nonce,
            &nonce,
        ))?)
        .to_vec();
    write_frame(&mut writer, &Challenge { nonce, signature }).await?;
    let state = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        read_frame(&mut reader, MAX_FRAME),
    )
    .await??;
    Ok((reader, writer, state))
}
