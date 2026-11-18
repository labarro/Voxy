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
        /// Also revoke every saved member access (raises the pass epoch).
        #[serde(default)]
        revoke_members: bool,
    },
    /// Reconnect to a saved server with its stored access; waits while the host is offline.
    Reconnect {
        server: Uuid,
        stun: Vec<String>,
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
    /// Start publishing a window or monitor chosen explicitly by the user.
    ScreenStart {
        source: ScreenSource,
        preset: String,
        /// Share the application's audio (window) or system audio except Voxy (monitor).
        #[serde(default)]
        audio: bool,
    },
    ScreenStop,
    /// Start publishing a camera the user picked explicitly (never automatic).
    CameraStart {
        device: String,
        preset: String,
    },
    CameraStop,
    /// Subscribe to another member's published screen in the same voice channel.
    Watch {
        member: Uuid,
        watching: bool,
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
    /// Direct media links confirmed by the network layer, one per remote participant.
    #[serde(default)]
    pub links: Vec<LinkStatus>,
    /// Local microphone frames are currently leaving the gate with voice energy.
    #[serde(default)]
    pub transmitting: bool,
    #[serde(default)]
    pub reconnects: u32,
    #[serde(default)]
    pub screen: Option<ScreenStatus>,
    #[serde(default)]
    pub camera: Option<ScreenStatus>,
    /// Short code of the hosted invite (XXXX-XXXX), confirmed by the signaling service.
    #[serde(default)]
    pub invite_code: Option<String>,
    /// Saved server whose host is offline; the session retries until cancelled.
    #[serde(default)]
    pub waiting_host: Option<Uuid>,
}
/// A capture source picked in the UI. Handles are re-validated by the session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScreenSource {
    pub kind: String,
    pub handle: u64,
    pub process_id: u32,
    pub label: String,
}
/// Local screen publication status, from the publisher thread counters.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ScreenStatus {
    #[serde(default)]
    pub audio: bool,
    #[serde(default)]
    pub audio_packets: u64,
    pub label: String,
    pub preset: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub captured: u64,
    pub encoded: u64,
    pub dropped: u64,
    pub keyframes: u64,
    pub bitrate_kbps: u32,
    pub sent_kbps: u32,
    pub watchers: u32,
    pub encoder: String,
}
/// Screen presets: (name, width, height, fps, target bitrate). Only these are offered.
pub const SCREEN_PRESETS: [(&str, u32, u32, u32, u32); 4] = [
    ("720p30", 1280, 720, 30, 2_500_000),
    ("720p60", 1280, 720, 60, 3_800_000),
    ("1080p30", 1920, 1080, 30, 4_500_000),
    ("1080p60", 1920, 1080, 60, 6_500_000),
];
/// Camera presets: (name, width, height, fps, target bitrate).
pub const CAMERA_PRESETS: [(&str, u32, u32, u32, u32); 2] = [
    ("360p30", 640, 360, 30, 700_000),
    ("720p30", 1280, 720, 30, 1_800_000),
];
/// Binary IPC video frames set this bit in the u32 length prefix. JSON state
/// frames are bounded by MAX_FRAME, far below it, so the two never collide.
pub const VIDEO_FRAME_FLAG: u32 = 0x8000_0000;
/// Encoded video for the UI: 16-byte member id, keyframe byte, u32 LE width and
/// height (host-confirmed preset), then the H.264 access unit.
pub fn encode_video_frame(
    member: Uuid,
    camera: bool,
    keyframe: bool,
    size: (u32, u32),
    bytes: &[u8],
) -> Vec<u8> {
    let mut frame = Vec::with_capacity(25 + bytes.len());
    frame.extend_from_slice(member.as_bytes());
    frame.push(keyframe as u8 | (camera as u8) << 1);
    frame.extend_from_slice(&size.0.to_le_bytes());
    frame.extend_from_slice(&size.1.to_le_bytes());
    frame.extend_from_slice(bytes);
    frame
}
/// Decoded video frame header: publisher, camera flag, keyframe flag, size, H.264.
pub type VideoFrameParts<'a> = (Uuid, bool, bool, (u32, u32), &'a [u8]);
pub fn decode_video_frame(frame: &[u8]) -> Option<VideoFrameParts<'_>> {
    if frame.len() < 26 {
        return None;
    }
    let member = Uuid::from_slice(&frame[..16]).ok()?;
    let read = |at: usize| u32::from_le_bytes(frame[at..at + 4].try_into().unwrap());
    Some((
        member,
        frame[16] & 2 != 0,
        frame[16] & 1 != 0,
        (read(17), read(21)),
        &frame[25..],
    ))
}
/// Per-participant transport diagnostics. Contains no SDP, address, invite or key
/// material beyond the public identity key already shared in the room snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct LinkStatus {
    pub peer: u64,
    pub key: String,
    pub state: String,
    pub data_open: bool,
    /// "direto-lan", "direto-stun", "relay" or "negociando".
    pub route: String,
    pub rtt_ms: Option<u32>,
    pub audio_sent: u64,
    pub audio_received: u64,
    #[serde(default)]
    pub video_sent: u64,
    #[serde(default)]
    pub video_received: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    /// Received voice level (0..1) over the last report interval; 0 when silent.
    #[serde(default)]
    pub level: f32,
    #[serde(default)]
    pub speaking: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub protocol: u8,
    pub port: u16,
    pub pid: u32,
    /// Version and executable of the core owning this data folder. A UI attaches only
    /// to its own sibling core; older cores write neither field.
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub executable: String,
}
pub fn read_endpoint(directory: &std::path::Path) -> anyhow::Result<Endpoint> {
    Ok(serde_json::from_slice(&std::fs::read(
        directory.join("session.json"),
    )?)?)
}
/// True when the endpoint was written by `expected` (same file, case-insensitive) at this version.
pub fn is_own_core(endpoint: &Endpoint, expected: &std::path::Path) -> bool {
    let normalize = |p: &std::path::Path| {
        std::fs::canonicalize(p)
            .unwrap_or_else(|_| p.to_path_buf())
            .to_string_lossy()
            .to_lowercase()
    };
    endpoint.version == crate::VERSION
        && !endpoint.executable.is_empty()
        && normalize(std::path::Path::new(&endpoint.executable)) == normalize(expected)
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
