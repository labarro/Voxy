//! Authoritative room domain: transport identity, never a payload-supplied actor.
use crate::{
    model::*,
    store::{Store, now_ms},
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Member {
    pub public_key: String,
    pub id: Uuid,
    pub name: String,
    pub voice: Option<Uuid>,
    pub muted: bool,
    pub deafened: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub id: Uuid,
    pub action: Action,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Action {
    ImageBegin {
        upload: Uuid,
        target: crate::images::ImageTarget,
        name: String,
        total_bytes: u32,
        sha256: String,
    },
    ImageChunk {
        upload: Uuid,
        offset: u32,
        data: String,
    },
    ImageCancel {
        upload: Uuid,
    },
    ImageCommit {
        upload: Uuid,
        text: String,
    },
    ImageRead {
        id: Uuid,
        offset: u32,
    },
    Game {
        channel: Uuid,
        command: crate::game_service::GameCommand,
    },
    ServerRename {
        name: String,
    },
    ChannelRename {
        id: Uuid,
        name: String,
    },
    ChannelDelete {
        id: Uuid,
    },
    FriendRequest {
        to: Uuid,
    },
    FriendRespond {
        requester: Uuid,
        accept: bool,
    },
    FriendRemove {
        peer: Uuid,
    },
    Direct {
        to: Uuid,
        text: String,
    },
    DirectEdit {
        id: Uuid,
        text: String,
    },
    DirectDelete {
        id: Uuid,
    },
    DirectRead {
        id: Uuid,
    },
    Message {
        channel: Uuid,
        text: String,
    },
    Reply {
        channel: Uuid,
        text: String,
        target: Uuid,
    },
    React {
        id: Uuid,
        emoji: String,
    },
    History {
        channel: Uuid,
        before: Option<(i64, Uuid)>,
    },
    Search {
        channel: Uuid,
        text: String,
        before: Option<(i64, Uuid)>,
    },
    NotificationRead {
        id: Uuid,
    },
    RoleSave {
        id: Option<Uuid>,
        name: String,
        color: String,
    },
    RoleDelete {
        id: Uuid,
    },
    RoleAssign {
        role: Uuid,
        member: Uuid,
        assigned: bool,
    },
    ProfileUpdate {
        name: String,
        presence: Presence,
        nickname_color: String,
    },
    Edit {
        id: Uuid,
        text: String,
    },
    Delete {
        id: Uuid,
    },
    ChannelCreate {
        name: String,
        kind: ChannelKind,
    },
    VoiceJoin {
        channel: Uuid,
    },
    VoiceLeave,
    VoiceState {
        muted: bool,
        deafened: bool,
    },
}
impl Action {
    pub fn changes_snapshot(&self) -> bool {
        !matches!(
            self,
            Self::ImageBegin { .. }
                | Self::ImageChunk { .. }
                | Self::ImageCancel { .. }
                | Self::ImageRead { .. }
                | Self::History { .. }
                | Self::Search { .. }
        )
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub server: Community,
    pub channels: Vec<Channel>,
    pub members: Vec<Member>,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub friends: Vec<Friendship>,
    #[serde(default)]
    pub direct: Vec<DirectMessage>,
    #[serde(default)]
    pub notifications: Vec<Notification>,
    #[serde(default)]
    pub roles: Vec<Role>,
    #[serde(default)]
    pub member_roles: Vec<MemberRole>,
    #[serde(default)]
    pub profiles: Vec<PublicProfile>,
    #[serde(default)]
    pub deleted_messages: Vec<Uuid>,
    #[serde(default)]
    pub games: Vec<crate::game_service::GameView>,
    #[serde(default)]
    pub history_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub position: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberRole {
    pub role: Uuid,
    pub member: Uuid,
}
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    #[default]
    Online,
    Away,
    Busy,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicProfile {
    pub id: Uuid,
    pub name: String,
    pub presence: Presence,
    pub nickname_color: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: Uuid,
    pub kind: String,
    pub sender: Uuid,
    pub message: Option<Uuid>,
    pub channel: Option<Uuid>,
    pub time: i64,
    pub read: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Friendship {
    pub requester: Uuid,
    pub recipient: Uuid,
    pub accepted: bool,
    pub requester_name: String,
    pub recipient_name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectMessage {
    pub id: Uuid,
    pub from: Uuid,
    pub to: Uuid,
    pub text: String,
    pub time: i64,
    #[serde(default)]
    pub edited_at: Option<i64>,
    #[serde(default)]
    pub read_at: Option<i64>,
    #[serde(default)]
    pub attachments: Vec<crate::images::ImageMetadata>,
}
pub struct RoomHost {
    store: Store,
    server: Community,
    owner_key: String,
    members: BTreeMap<String, Member>,
    games: crate::game_service::GameService,
    uploads: crate::images::Uploads,
}
fn validate_color(color: &str, allow_empty: bool) -> Result<()> {
    ensure!(
        (allow_empty && color.is_empty())
            || (color.len() == 7
                && color.starts_with('#')
                && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)),
        "Cor deve usar #RRGGBB"
    );
    Ok(())
}
impl RoomHost {
    pub fn new(store: Store, server: Community, owner_key: String) -> Result<Self> {
        store.require_owner(server.owner, server.id)?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_member_keys(key TEXT PRIMARY KEY,profile_id TEXT UNIQUE NOT NULL);CREATE TABLE IF NOT EXISTS native_receipts(peer TEXT NOT NULL,id TEXT NOT NULL,response TEXT NOT NULL,time INTEGER NOT NULL,PRIMARY KEY(peer,id));")?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_names(profile_id TEXT PRIMARY KEY,name TEXT NOT NULL);CREATE TABLE IF NOT EXISTS native_friends(server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,requester TEXT NOT NULL,recipient TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(server,requester,recipient));CREATE TABLE IF NOT EXISTS native_direct(id TEXT PRIMARY KEY,server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,sender TEXT NOT NULL,recipient TEXT NOT NULL,text TEXT NOT NULL,time INTEGER NOT NULL);")?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_direct_status(message TEXT PRIMARY KEY REFERENCES native_direct(id) ON DELETE CASCADE,edited_at INTEGER,read_at INTEGER);
            CREATE TABLE IF NOT EXISTS native_notifications(id TEXT PRIMARY KEY,server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,recipient TEXT NOT NULL,kind TEXT NOT NULL,sender TEXT NOT NULL,message TEXT,channel TEXT,time INTEGER NOT NULL,read INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS native_notification_recipient ON native_notifications(server,recipient,time);")?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_roles(id TEXT PRIMARY KEY,server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT NOT NULL,position INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS native_role_members(role TEXT NOT NULL REFERENCES native_roles(id) ON DELETE CASCADE,member TEXT NOT NULL,PRIMARY KEY(role,member));
            CREATE TABLE IF NOT EXISTS native_public_profiles(server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,member TEXT NOT NULL,presence TEXT NOT NULL,color TEXT NOT NULL,PRIMARY KEY(server,member));")?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_deleted_messages(id TEXT PRIMARY KEY,server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,time INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS native_deleted_server ON native_deleted_messages(server,time);")?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_history_revision(server TEXT PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0);")?;
        store.db.execute(
            "INSERT OR IGNORE INTO native_history_revision(server) VALUES(?1)",
            [server.id.to_string()],
        )?;
        crate::images::initialize_direct(&store)?;
        Ok(Self {
            store,
            server,
            owner_key,
            members: Default::default(),
            games: Default::default(),
            uploads: Default::default(),
        })
    }
    pub fn admit(&mut self, key: String, id: Uuid, name: String) -> Result<()> {
        validate_text(&name, 60)?;
        ensure!(
            !id.is_nil() && key.len() >= 32 && key.len() <= 128,
            "Identidade inválida"
        );
        ensure!(self.members.len() < crate::MAX_PARTICIPANTS, "Sala cheia");
        ensure!(!self.members.contains_key(&key), "Identidade já conectada");
        if id == self.server.owner {
            ensure!(
                key == self.owner_key,
                "Não é possível assumir a identidade do proprietário"
            );
        }
        let binding: Option<String> = self
            .store
            .db
            .query_row(
                "SELECT profile_id FROM native_member_keys WHERE key=?1",
                [&key],
                |r| r.get(0),
            )
            .ok();
        if let Some(binding) = binding {
            ensure!(binding == id.to_string(), "Chave vinculada a outro perfil");
        } else {
            let legacy: bool = self.store.db.query_row(
                "SELECT EXISTS(SELECT 1 FROM native_legacy_claims WHERE profile_id=?1)",
                [id.to_string()],
                |r| r.get(0),
            )?;
            ensure!(
                !legacy || id == self.server.owner,
                "Identidade legada reservada; associação autenticada de credenciais necessária"
            );
            let previous: bool = self.store.db.query_row(
                "SELECT EXISTS(SELECT 1 FROM native_member_keys WHERE profile_id=?1)",
                [id.to_string()],
                |r| r.get(0),
            )?;
            ensure!(!previous, "Perfil já vinculado a outra chave");
            self.store.db.execute(
                "INSERT INTO native_member_keys VALUES(?1,?2)",
                rusqlite::params![key, id.to_string()],
            )?;
        }
        self.store.db.execute("INSERT INTO native_names VALUES(?1,?2) ON CONFLICT(profile_id) DO UPDATE SET name=excluded.name",rusqlite::params![id.to_string(),name])?;
        self.members.insert(
            key.clone(),
            Member {
                public_key: key,
                id,
                name,
                voice: None,
                muted: false,
                deafened: false,
            },
        );
        Ok(())
    }
    pub fn remove(&mut self, key: &str) {
        if let Some(member) = self.members.get(key) {
            self.uploads.remove_owner(member.id);
        }
        self.members.remove(key);
    }
    pub fn advance_games(&mut self, now: i64) -> Result<bool> {
        let mut online: BTreeMap<Uuid, std::collections::BTreeSet<String>> = BTreeMap::new();
        for member in self.members.values() {
            if let Some(channel) = member.voice {
                online
                    .entry(channel)
                    .or_default()
                    .insert(member.id.to_string());
            }
        }
        self.games.advance(&online, now)
    }
    pub fn has_games(&self) -> bool {
        self.games.has_games()
    }
    pub fn games_need_fast_tick(&self) -> bool {
        self.games.needs_fast_tick()
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        self.snapshot_for(&self.owner_key)
    }
    pub fn snapshot_for(&self, key: &str) -> Result<Snapshot> {
        let viewer = self
            .members
            .get(key)
            .context("Participante não autenticado")?
            .id
            .to_string();
        let mut query=self.store.db.prepare("SELECT requester,recipient,accepted,COALESCE(a.name,requester),COALESCE(b.name,recipient) FROM native_friends f LEFT JOIN native_names a ON a.profile_id=f.requester LEFT JOIN native_names b ON b.profile_id=f.recipient WHERE server=?1 AND (requester=?2 OR recipient=?2)")?;
        let friends = query
            .query_map(rusqlite::params![self.server.id.to_string(), viewer], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, bool>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .map(|r| {
                let (a, b, accepted, requester_name, recipient_name) = r?;
                Ok(Friendship {
                    requester: Uuid::parse_str(&a)?,
                    recipient: Uuid::parse_str(&b)?,
                    accepted,
                    requester_name,
                    recipient_name,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let mut query=self.store.db.prepare("SELECT d.id,sender,recipient,text,time,s.edited_at,s.read_at FROM native_direct d LEFT JOIN native_direct_status s ON s.message=d.id WHERE server=?1 AND (sender=?2 OR recipient=?2) ORDER BY time DESC,d.id DESC LIMIT 100")?;
        let mut direct = query
            .query_map(rusqlite::params![self.server.id.to_string(), viewer], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<i64>>(6)?,
                ))
            })?
            .map(|r| {
                let (id, a, b, text, time, edited_at, read_at) = r?;
                Ok(DirectMessage {
                    id: Uuid::parse_str(&id)?,
                    from: Uuid::parse_str(&a)?,
                    to: Uuid::parse_str(&b)?,
                    text,
                    time,
                    edited_at,
                    read_at,
                    attachments: Default::default(),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        direct.reverse();
        for message in &mut direct {
            message.attachments = crate::images::attachments(&self.store, message.id, true)?;
        }
        crate::store::bound_history(&mut direct, 256 * 1024)?;
        let channels = self.store.channels(self.server.id)?;
        let mut messages = Vec::new();
        for channel in &channels {
            if channel.kind == ChannelKind::Text {
                messages.extend(self.store.messages(channel.id, None)?);
                messages.sort_by_key(|m| (m.time, m.id));
                crate::store::bound_history(&mut messages, 384 * 1024)?;
            }
        }
        Ok(Snapshot {
            server: self.server.clone(),
            channels,
            members: self.members.values().cloned().collect(),
            messages,
            friends,
            direct,
            notifications: self.notifications(&viewer)?,
            roles: self.roles()?,
            member_roles: self.member_roles()?,
            profiles: self.profiles()?,
            deleted_messages: self.deleted_messages()?,
            games: self.games.views(
                self.members.get(key).and_then(|member| member.voice),
                self.members.get(key).map(|member| member.id),
            )?,
            history_revision: self.store.db.query_row(
                "SELECT revision FROM native_history_revision WHERE server=?1",
                [self.server.id.to_string()],
                |r| r.get(0),
            )?,
        })
    }
    pub fn handle(&mut self, key: &str, command: Command) -> Result<serde_json::Value> {
        ensure!(!command.id.is_nil(), "Comando inválido");
        let member = self
            .members
            .get(key)
            .context("Participante não autenticado")?
            .clone();
        if let Action::Game {
            channel,
            command: game_command,
        } = command.action
        {
            ensure!(
                self.require_channel(channel)?.kind == ChannelKind::Voice
                    && member.voice == Some(channel),
                "Entre no canal de voz da mesa para participar"
            );
            return self
                .games
                .handle(channel, member.id, command.id, game_command, now_ms());
        }
        // Read-only history is bounded and must not bloat durable replay receipts.
        match &command.action {
            Action::ImageBegin {
                upload,
                target,
                name,
                total_bytes,
                sha256,
            } => {
                self.require_image_target(member.id, target)?;
                let received = self.uploads.begin(
                    member.id,
                    *upload,
                    target.clone(),
                    name.clone(),
                    *total_bytes,
                    sha256.clone(),
                    now_ms(),
                )?;
                return Ok(serde_json::json!({"upload":upload,"received":received}));
            }
            Action::ImageChunk {
                upload,
                offset,
                data,
            } => {
                let received = self
                    .uploads
                    .chunk(member.id, *upload, *offset, data, now_ms())?;
                return Ok(serde_json::json!({"upload":upload,"received":received}));
            }
            Action::ImageCancel { upload } => {
                self.uploads.cancel(member.id, *upload)?;
                return Ok(serde_json::json!({"cancelled":upload}));
            }
            Action::ImageRead { id, offset } => {
                return crate::images::read_chunk(
                    &self.store,
                    self.server.id,
                    member.id,
                    *id,
                    *offset,
                );
            }
            Action::History { channel, before } => {
                self.require_channel(*channel)?;
                return Ok(serde_json::to_value(
                    self.store.messages(*channel, *before)?,
                )?);
            }
            Action::Search {
                channel,
                text,
                before,
            } => {
                self.require_channel(*channel)?;
                return Ok(serde_json::to_value(
                    self.store.search_messages(*channel, text, *before)?,
                )?);
            }
            _ => {}
        }
        let previous = self.store.db.query_row(
            "SELECT response FROM native_receipts WHERE peer=?1 AND id=?2",
            rusqlite::params![key, command.id.to_string()],
            |r| r.get::<_, String>(0),
        );
        if let Ok(value) = previous {
            return Ok(serde_json::from_str(&value)?);
        }
        let previous_members = self.members.clone();
        let previous_server = self.server.clone();
        let committed_upload = match &command.action {
            Action::ImageCommit { upload, .. } => Some(*upload),
            _ => None,
        };
        self.store.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<serde_json::Value> {
            let value = match command.action {
                Action::ImageBegin { .. }
                | Action::ImageChunk { .. }
                | Action::ImageCancel { .. }
                | Action::ImageRead { .. } => {
                    unreachable!("Ephemeral image transfer handled outside persistent receipts")
                }
                Action::ImageCommit { upload, text } => {
                    ensure!(
                        text.chars().count() <= 4000 && !text.contains('\0'),
                        "Legenda excede o limite"
                    );
                    let (target, image) = self.uploads.finish(member.id, upload, now_ms())?;
                    self.require_image_target(member.id, &target)?;
                    let id = Uuid::new_v4();
                    match target {
                        crate::images::ImageTarget::Channel { channel } => {
                            self.store.db.execute(
                                "INSERT INTO native_messages VALUES(?1,?2,?3,?4,?5,?6,NULL)",
                                rusqlite::params![
                                    id.to_string(),
                                    channel.to_string(),
                                    member.id.to_string(),
                                    member.name,
                                    text.trim(),
                                    now_ms()
                                ],
                            )?;
                            crate::images::persist(
                                &self.store,
                                self.server.id,
                                member.id,
                                id,
                                false,
                                &image,
                            )?;
                            self.notify_mentions(&Message {
                                id,
                                channel_id: channel,
                                author: member.id,
                                name: member.name.clone(),
                                text: text.trim().into(),
                                time: now_ms(),
                                edited_at: None,
                                reply_to: None,
                                reactions: Default::default(),
                                attachments: vec![image.metadata.clone()],
                            })?;
                        }
                        crate::images::ImageTarget::Direct { to } => {
                            self.store.db.execute(
                                "INSERT INTO native_direct VALUES(?1,?2,?3,?4,?5,?6)",
                                rusqlite::params![
                                    id.to_string(),
                                    self.server.id.to_string(),
                                    member.id.to_string(),
                                    to.to_string(),
                                    text.trim(),
                                    now_ms()
                                ],
                            )?;
                            crate::images::persist(
                                &self.store,
                                self.server.id,
                                member.id,
                                id,
                                true,
                                &image,
                            )?;
                            self.notify(to, "direct", member.id, Some(id), None)?;
                        }
                    }
                    serde_json::json!({"id":id,"image":image.metadata})
                }
                Action::Game { .. } => {
                    unreachable!("game command handled outside persistent social transaction")
                }
                Action::RoleSave { id, name, color } => {
                    self.store.require_owner(member.id, self.server.id)?;
                    validate_text(&name, 60)?;
                    validate_color(&color, false)?;
                    let id = if let Some(id) = id {
                        ensure!(
                            self.roles()?.iter().any(|r| r.id == id),
                            "Cargo não pertence ao servidor"
                        );
                        self.store.db.execute(
                            "UPDATE native_roles SET name=?1,color=?2 WHERE id=?3 AND server=?4",
                            rusqlite::params![
                                name.trim(),
                                color,
                                id.to_string(),
                                self.server.id.to_string()
                            ],
                        )?;
                        id
                    } else {
                        let roles = self.roles()?;
                        ensure!(roles.len() < 50, "Limite de 50 cargos por servidor");
                        let position = roles.iter().map(|r| r.position).max().unwrap_or(-1) + 1;
                        let id = Uuid::new_v4();
                        self.store.db.execute(
                            "INSERT INTO native_roles VALUES(?1,?2,?3,?4,?5)",
                            rusqlite::params![
                                id.to_string(),
                                self.server.id.to_string(),
                                name.trim(),
                                color,
                                position
                            ],
                        )?;
                        id
                    };
                    serde_json::json!({"role":id})
                }
                Action::RoleDelete { id } => {
                    self.store.require_owner(member.id, self.server.id)?;
                    ensure!(
                        self.store.db.execute(
                            "DELETE FROM native_roles WHERE id=?1 AND server=?2",
                            rusqlite::params![id.to_string(), self.server.id.to_string()]
                        )? == 1,
                        "Cargo não pertence ao servidor"
                    );
                    serde_json::json!({"deleted":id})
                }
                Action::RoleAssign {
                    role,
                    member: target,
                    assigned,
                } => {
                    self.store.require_owner(member.id, self.server.id)?;
                    ensure!(
                        self.roles()?.iter().any(|r| r.id == role),
                        "Cargo não pertence ao servidor"
                    );
                    let known: bool = self.store.db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM native_member_keys WHERE profile_id=?1)",
                        [target.to_string()],
                        |r| r.get(0),
                    )?;
                    ensure!(known, "Participante não conhecido pelo host");
                    if assigned {
                        self.store.db.execute(
                            "INSERT OR IGNORE INTO native_role_members VALUES(?1,?2)",
                            rusqlite::params![role.to_string(), target.to_string()],
                        )?;
                    } else {
                        self.store.db.execute(
                            "DELETE FROM native_role_members WHERE role=?1 AND member=?2",
                            rusqlite::params![role.to_string(), target.to_string()],
                        )?;
                    }
                    serde_json::json!({"role":role,"member":target,"assigned":assigned})
                }
                Action::ProfileUpdate {
                    name,
                    presence,
                    nickname_color,
                } => {
                    validate_text(&name, 60)?;
                    validate_color(&nickname_color, true)?;
                    self.store.db.execute("INSERT INTO native_public_profiles VALUES(?1,?2,?3,?4) ON CONFLICT(server,member) DO UPDATE SET presence=excluded.presence,color=excluded.color",rusqlite::params![self.server.id.to_string(),member.id.to_string(),serde_json::to_string(&presence)?,nickname_color])?;
                    self.store.db.execute(
                        "UPDATE native_names SET name=?1 WHERE profile_id=?2",
                        rusqlite::params![name.trim(), member.id.to_string()],
                    )?;
                    self.members.get_mut(key).unwrap().name = name.trim().into();
                    serde_json::json!({"profile":member.id})
                }
                Action::ServerRename { name } => {
                    self.store
                        .rename_community(member.id, self.server.id, &name)?;
                    self.server.name = name.trim().into();
                    serde_json::json!({"renamed":self.server.id})
                }
                Action::ChannelRename { id, name } => {
                    self.require_channel(id)?;
                    self.store
                        .rename_channel(member.id, self.server.id, id, &name)?;
                    serde_json::json!({"renamed":id})
                }
                Action::ChannelDelete { id } => {
                    self.require_channel(id)?;
                    self.store.delete_channel(member.id, self.server.id, id)?;
                    self.invalidate_history()?;
                    for peer in self.members.values_mut() {
                        if peer.voice == Some(id) {
                            peer.voice = None;
                        }
                    }
                    serde_json::json!({"deleted":id})
                }
                Action::FriendRequest { to } => {
                    ensure!(to != member.id, "Não é possível adicionar o próprio perfil");
                    for participant in [member.id, to] {
                        let count:i64=self.store.db.query_row("SELECT count(*) FROM native_friends WHERE server=?1 AND (requester=?2 OR recipient=?2)",rusqlite::params![self.server.id.to_string(),participant.to_string()],|r|r.get(0))?;
                        ensure!(count < 1000, "Limite de amizades atingido");
                    }
                    let known: bool = self.store.db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM native_member_keys WHERE profile_id=?1)",
                        [to.to_string()],
                        |r| r.get(0),
                    )?;
                    ensure!(known, "Perfil ainda não conhecido por este host");
                    let exists:bool=self.store.db.query_row("SELECT EXISTS(SELECT 1 FROM native_friends WHERE server=?1 AND ((requester=?2 AND recipient=?3) OR (requester=?3 AND recipient=?2)))",rusqlite::params![self.server.id.to_string(),member.id.to_string(),to.to_string()],|r|r.get(0))?;
                    ensure!(!exists, "Amizade ou solicitação já existente");
                    self.store.db.execute(
                        "INSERT INTO native_friends VALUES(?1,?2,?3,0)",
                        rusqlite::params![
                            self.server.id.to_string(),
                            member.id.to_string(),
                            to.to_string()
                        ],
                    )?;
                    self.notify(to, "friend-request", member.id, None, None)?;
                    serde_json::json!({"requested":to})
                }
                Action::FriendRespond { requester, accept } => {
                    let sql = if accept {
                        "UPDATE native_friends SET accepted=1 WHERE server=?1 AND requester=?2 AND recipient=?3 AND accepted=0"
                    } else {
                        "DELETE FROM native_friends WHERE server=?1 AND requester=?2 AND recipient=?3 AND accepted=0"
                    };
                    ensure!(
                        self.store.db.execute(
                            sql,
                            rusqlite::params![
                                self.server.id.to_string(),
                                requester.to_string(),
                                member.id.to_string()
                            ]
                        )? == 1,
                        "Solicitação não encontrada"
                    );
                    if accept {
                        self.notify(requester, "friend-accepted", member.id, None, None)?;
                    }
                    serde_json::json!({"accepted":accept})
                }
                Action::FriendRemove { peer } => {
                    self.store.db.execute("DELETE FROM native_friends WHERE server=?1 AND ((requester=?2 AND recipient=?3) OR (requester=?3 AND recipient=?2))",rusqlite::params![self.server.id.to_string(),member.id.to_string(),peer.to_string()])?;
                    serde_json::json!({"removed":peer})
                }
                Action::Direct { to, text } => {
                    validate_text(&text, 4000)?;
                    let friends:bool=self.store.db.query_row("SELECT EXISTS(SELECT 1 FROM native_friends WHERE server=?1 AND accepted=1 AND ((requester=?2 AND recipient=?3) OR (requester=?3 AND recipient=?2)))",rusqlite::params![self.server.id.to_string(),member.id.to_string(),to.to_string()],|r|r.get(0))?;
                    ensure!(friends, "Aceite a amizade antes da mensagem privada");
                    let id = Uuid::new_v4();
                    self.store.db.execute(
                        "INSERT INTO native_direct VALUES(?1,?2,?3,?4,?5,?6)",
                        rusqlite::params![
                            id.to_string(),
                            self.server.id.to_string(),
                            member.id.to_string(),
                            to.to_string(),
                            text.trim(),
                            now_ms()
                        ],
                    )?;
                    self.notify(to, "direct", member.id, Some(id), None)?;
                    serde_json::json!({"id":id})
                }
                Action::DirectEdit { id, text } => {
                    validate_text(&text, 4000)?;
                    ensure!(self.store.db.execute("UPDATE native_direct SET text=?1 WHERE id=?2 AND server=?3 AND sender=?4", rusqlite::params![text.trim(),id.to_string(),self.server.id.to_string(),member.id.to_string()])? == 1, "Mensagem privada inexistente ou autoria inválida");
                    self.store.db.execute("INSERT INTO native_direct_status(message,edited_at) VALUES(?1,?2) ON CONFLICT(message) DO UPDATE SET edited_at=excluded.edited_at",rusqlite::params![id.to_string(),now_ms()])?;
                    serde_json::json!({"edited":id})
                }
                Action::DirectDelete { id } => {
                    ensure!(
                        self.store.db.execute(
                            "DELETE FROM native_direct WHERE id=?1 AND server=?2 AND sender=?3",
                            rusqlite::params![
                                id.to_string(),
                                self.server.id.to_string(),
                                member.id.to_string()
                            ]
                        )? == 1,
                        "Mensagem privada inexistente ou autoria inválida"
                    );
                    self.store.db.execute(
                        "DELETE FROM native_notifications WHERE server=?1 AND message=?2",
                        rusqlite::params![self.server.id.to_string(), id.to_string()],
                    )?;
                    serde_json::json!({"deleted":id})
                }
                Action::DirectRead { id } => {
                    let allowed: bool = self.store.db.query_row("SELECT EXISTS(SELECT 1 FROM native_direct WHERE id=?1 AND server=?2 AND recipient=?3)",rusqlite::params![id.to_string(),self.server.id.to_string(),member.id.to_string()],|r|r.get(0))?;
                    ensure!(
                        allowed,
                        "Mensagem privada não recebida por este participante"
                    );
                    self.store.db.execute("INSERT INTO native_direct_status(message,read_at) VALUES(?1,?2) ON CONFLICT(message) DO UPDATE SET read_at=COALESCE(native_direct_status.read_at,excluded.read_at)",rusqlite::params![id.to_string(),now_ms()])?;
                    self.store.db.execute("UPDATE native_notifications SET read=1 WHERE server=?1 AND recipient=?2 AND message=?3",rusqlite::params![self.server.id.to_string(),member.id.to_string(),id.to_string()])?;
                    serde_json::json!({"read":id})
                }
                Action::Message { channel, text } => {
                    self.require_channel(channel)?;
                    let message = self.store.post(channel, member.id, &member.name, &text)?;
                    self.notify_mentions(&message)?;
                    serde_json::to_value(message)?
                }
                Action::Reply {
                    channel,
                    text,
                    target,
                } => {
                    self.require_channel(channel)?;
                    let message =
                        self.store
                            .reply(channel, member.id, &member.name, &text, target)?;
                    let author: String = self.store.db.query_row(
                        "SELECT author FROM native_messages WHERE id=?1",
                        [target.to_string()],
                        |r| r.get(0),
                    )?;
                    self.notify(
                        Uuid::parse_str(&author)?,
                        "reply",
                        member.id,
                        Some(message.id),
                        Some(channel),
                    )?;
                    self.notify_mentions(&message)?;
                    serde_json::to_value(message)?
                }
                Action::React { id, emoji } => {
                    self.require_message(id)?;
                    self.store.react(id, member.id, &emoji)?;
                    serde_json::json!({"reacted":id})
                }
                Action::History { channel, before } => {
                    self.require_channel(channel)?;
                    serde_json::to_value(self.store.messages(channel, before)?)?
                }
                Action::Search {
                    channel,
                    text,
                    before,
                } => {
                    self.require_channel(channel)?;
                    serde_json::to_value(self.store.search_messages(channel, &text, before)?)?
                }
                Action::NotificationRead { id } => {
                    ensure!(self.store.db.execute("UPDATE native_notifications SET read=1 WHERE id=?1 AND server=?2 AND recipient=?3",rusqlite::params![id.to_string(),self.server.id.to_string(),member.id.to_string()])? == 1, "Notificação não pertence a este participante");
                    serde_json::json!({"read":id})
                }
                Action::Edit { id, text } => {
                    self.require_message(id)?;
                    self.store.edit(id, member.id, &text)?;
                    self.invalidate_history()?;
                    serde_json::json!({"edited":id})
                }
                Action::Delete { id } => {
                    self.require_message(id)?;
                    self.store.delete_message(id, member.id)?;
                    self.invalidate_history()?;
                    self.store.db.execute(
                        "INSERT INTO native_deleted_messages VALUES(?1,?2,?3)",
                        rusqlite::params![id.to_string(), self.server.id.to_string(), now_ms()],
                    )?;
                    self.store.db.execute("DELETE FROM native_deleted_messages WHERE id IN (SELECT id FROM native_deleted_messages WHERE server=?1 ORDER BY time DESC,id DESC LIMIT -1 OFFSET 500)",[self.server.id.to_string()])?;
                    self.store.db.execute(
                        "DELETE FROM native_notifications WHERE server=?1 AND message=?2",
                        rusqlite::params![self.server.id.to_string(), id.to_string()],
                    )?;
                    serde_json::json!({"deleted":id})
                }
                Action::ChannelCreate { name, kind } => serde_json::to_value(
                    self.store
                        .add_channel(member.id, self.server.id, &name, kind)?,
                )?,
                Action::VoiceJoin { channel } => {
                    ensure!(
                        self.require_channel(channel)?.kind == ChannelKind::Voice,
                        "Canal de voz inválido"
                    );
                    self.members.get_mut(key).unwrap().voice = Some(channel);
                    serde_json::json!({"voice":channel})
                }
                Action::VoiceLeave => {
                    self.members.get_mut(key).unwrap().voice = None;
                    serde_json::json!({"voice":null})
                }
                Action::VoiceState { muted, deafened } => {
                    let member = self.members.get_mut(key).unwrap();
                    member.muted = muted;
                    member.deafened = deafened;
                    serde_json::json!({"muted":muted,"deafened":deafened})
                }
            };
            self.store.db.execute(
                "INSERT INTO native_receipts VALUES(?1,?2,?3,?4)",
                rusqlite::params![
                    key,
                    command.id.to_string(),
                    serde_json::to_string(&value)?,
                    now_ms()
                ],
            )?;
            self.store.db.execute("DELETE FROM native_receipts WHERE rowid IN (SELECT rowid FROM native_receipts ORDER BY time DESC LIMIT -1 OFFSET 1024)",[])?;
            Ok(value)
        })();
        match result {
            Ok(value) => {
                self.store.db.execute_batch("COMMIT")?;
                if let Some(upload) = committed_upload {
                    self.uploads.cancel(member.id, upload)?;
                }
                for (key, previous) in &previous_members {
                    if self.members.get(key).and_then(|m| m.voice) != previous.voice
                        && let Some(channel) = previous.voice
                    {
                        self.games.leave_channel(channel, previous.id);
                    }
                }
                Ok(value)
            }
            Err(error) => {
                self.store.db.execute_batch("ROLLBACK")?;
                self.members = previous_members;
                self.server = previous_server;
                Err(error)
            }
        }
    }
    fn require_channel(&self, id: Uuid) -> Result<Channel> {
        self.store
            .channels(self.server.id)?
            .into_iter()
            .find(|c| c.id == id)
            .context("Canal não pertence a este servidor")
    }
    fn require_image_target(&self, actor: Uuid, target: &crate::images::ImageTarget) -> Result<()> {
        match target {
            crate::images::ImageTarget::Channel { channel } => ensure!(
                self.require_channel(*channel)?.kind == ChannelKind::Text,
                "Canal não permite imagens"
            ),
            crate::images::ImageTarget::Direct { to } => {
                ensure!(*to != actor, "Destinatário inválido");
                let friends:bool=self.store.db.query_row("SELECT EXISTS(SELECT 1 FROM native_friends WHERE server=?1 AND accepted=1 AND ((requester=?2 AND recipient=?3) OR (requester=?3 AND recipient=?2)))",rusqlite::params![self.server.id.to_string(),actor.to_string(),to.to_string()],|row|row.get(0))?;
                ensure!(friends, "Aceite a amizade antes da imagem privada");
            }
        }
        Ok(())
    }
    fn invalidate_history(&self) -> Result<()> {
        self.store.db.execute(
            "UPDATE native_history_revision SET revision=revision+1 WHERE server=?1",
            [self.server.id.to_string()],
        )?;
        Ok(())
    }
    fn roles(&self) -> Result<Vec<Role>> {
        let mut query = self.store.db.prepare(
            "SELECT id,name,color,position FROM native_roles WHERE server=?1 ORDER BY position,id",
        )?;
        query
            .query_map([self.server.id.to_string()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .map(|r| {
                let (id, name, color, position) = r?;
                Ok(Role {
                    id: Uuid::parse_str(&id)?,
                    name,
                    color,
                    position,
                })
            })
            .collect()
    }
    fn deleted_messages(&self) -> Result<Vec<Uuid>> {
        let mut query = self.store.db.prepare("SELECT id FROM native_deleted_messages WHERE server=?1 ORDER BY time DESC,id DESC LIMIT 500")?;
        query
            .query_map([self.server.id.to_string()], |r| r.get::<_, String>(0))?
            .map(|r| Ok(Uuid::parse_str(&r?)?))
            .collect()
    }
    fn member_roles(&self) -> Result<Vec<MemberRole>> {
        let mut query = self.store.db.prepare("SELECT m.role,m.member FROM native_role_members m JOIN native_roles r ON r.id=m.role WHERE r.server=?1 ORDER BY m.role,m.member")?;
        query
            .query_map([self.server.id.to_string()], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .map(|r| {
                let (role, member) = r?;
                Ok(MemberRole {
                    role: Uuid::parse_str(&role)?,
                    member: Uuid::parse_str(&member)?,
                })
            })
            .collect()
    }
    fn profiles(&self) -> Result<Vec<PublicProfile>> {
        self.members.values().map(|member| {
            use rusqlite::OptionalExtension;
            let settings: Option<(String,String)> = self.store.db.query_row("SELECT presence,color FROM native_public_profiles WHERE server=?1 AND member=?2",rusqlite::params![self.server.id.to_string(),member.id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            let (presence,nickname_color) = match settings { Some((presence,color)) => (serde_json::from_str(&presence)?,color),None => (Presence::Online,String::new()) };
            Ok(PublicProfile { id:member.id,name:member.name.clone(),presence,nickname_color })
        }).collect()
    }
    fn notify(
        &self,
        recipient: Uuid,
        kind: &str,
        sender: Uuid,
        message: Option<Uuid>,
        channel: Option<Uuid>,
    ) -> Result<()> {
        if recipient == sender {
            return Ok(());
        }
        self.store.db.execute(
            "INSERT INTO native_notifications VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                self.server.id.to_string(),
                recipient.to_string(),
                kind,
                sender.to_string(),
                message.map(|v| v.to_string()),
                channel.map(|v| v.to_string()),
                now_ms()
            ],
        )?;
        // Bound persisted inbox and snapshot independently; old alerts are never replayed as events.
        self.store.db.execute("DELETE FROM native_notifications WHERE id IN (SELECT id FROM native_notifications WHERE server=?1 AND recipient=?2 ORDER BY time DESC,id DESC LIMIT -1 OFFSET 500)",rusqlite::params![self.server.id.to_string(),recipient.to_string()])?;
        Ok(())
    }
    fn notify_mentions(&self, message: &Message) -> Result<()> {
        let mut seen = std::collections::BTreeSet::new();
        for rest in message.text.split("@{").skip(1) {
            let Some((id, _)) = rest.split_once('}') else {
                continue;
            };
            let Ok(id) = Uuid::parse_str(id) else {
                continue;
            };
            if !seen.insert(id) {
                continue;
            }
            let known: bool = self.store.db.query_row(
                "SELECT EXISTS(SELECT 1 FROM native_names WHERE profile_id=?1)",
                [id.to_string()],
                |r| r.get(0),
            )?;
            if known {
                self.notify(
                    id,
                    "mention",
                    message.author,
                    Some(message.id),
                    Some(message.channel_id),
                )?;
            }
        }
        Ok(())
    }
    fn notifications(&self, viewer: &str) -> Result<Vec<Notification>> {
        let mut query = self.store.db.prepare("SELECT id,kind,sender,message,channel,time,read FROM native_notifications WHERE server=?1 AND recipient=?2 ORDER BY time DESC,id DESC LIMIT 100")?;
        query
            .query_map(rusqlite::params![self.server.id.to_string(), viewer], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, bool>(6)?,
                ))
            })?
            .map(|r| {
                let (id, kind, sender, message, channel, time, read) = r?;
                Ok(Notification {
                    id: Uuid::parse_str(&id)?,
                    kind,
                    sender: Uuid::parse_str(&sender)?,
                    message: message.map(|v| Uuid::parse_str(&v)).transpose()?,
                    channel: channel.map(|v| Uuid::parse_str(&v)).transpose()?,
                    time,
                    read,
                })
            })
            .collect()
    }
    fn require_message(&self, id: Uuid) -> Result<()> {
        let channel: String = self.store.db.query_row(
            "SELECT channel_id FROM native_messages WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        self.require_channel(Uuid::parse_str(&channel)?)?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imported_authors_cannot_be_claimed_by_new_remote_keys() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(&root.path().join("imported.db")).unwrap();
        let owner = store.profile().unwrap().id;
        let server = store.create_community(owner, "Imported").unwrap();
        let legacy = Uuid::new_v4();
        store
            .db
            .execute(
                "INSERT INTO native_legacy_claims VALUES(?1)",
                [legacy.to_string()],
            )
            .unwrap();
        let mut room = RoomHost::new(store, server, "h".repeat(43)).unwrap();
        assert!(
            room.admit("g".repeat(43), legacy, "Impostor".into())
                .is_err()
        );
        assert!(
            room.admit("g".repeat(43), Uuid::new_v4(), "Novo perfil".into())
                .is_ok()
        );
    }
    fn cmd(action: Action) -> Command {
        Command {
            id: Uuid::new_v4(),
            action,
        }
    }
    #[test]
    fn game_authority_scopes_voice_channels_hands_replay_and_departure() {
        use crate::game_service::{GameCommand, GameKind};
        use voxy_games::{chess, pool, truco};
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(&root.path().join("games.db")).unwrap();
        let owner = store.profile().unwrap().id;
        let server = store.create_community(owner, "Games").unwrap();
        let channel = store
            .channels(server.id)
            .unwrap()
            .into_iter()
            .find(|c| c.kind == ChannelKind::Voice)
            .unwrap()
            .id;
        let other = store
            .add_channel(owner, server.id, "Other", ChannelKind::Voice)
            .unwrap()
            .id;
        let h = "h".repeat(43);
        let keys: Vec<_> = (0..5).map(|i| format!("{i}").repeat(43)).collect();
        let players: Vec<_> = (0..5).map(|_| Uuid::new_v4()).collect();
        let mut room = RoomHost::new(store, server, h.clone()).unwrap();
        room.admit(h.clone(), owner, "Host".into()).unwrap();
        for i in 0..5 {
            room.admit(keys[i].clone(), players[i], format!("Player {i}"))
                .unwrap();
        }
        let game = |command| cmd(Action::Game { channel, command });
        assert!(
            room.handle(
                &keys[0],
                game(GameCommand::Join {
                    game: GameKind::Truco,
                    seat: Some(0)
                })
            )
            .is_err()
        );
        for key in &keys {
            room.handle(key, cmd(Action::VoiceJoin { channel }))
                .unwrap();
        }
        room.handle(&h, cmd(Action::VoiceJoin { channel: other }))
            .unwrap();
        for (i, key) in keys.iter().take(4).enumerate() {
            let command = game(GameCommand::Join {
                game: GameKind::Truco,
                seat: Some(i),
            });
            let response = room.handle(key, command.clone()).unwrap();
            assert_eq!(room.handle(key, command).unwrap(), response);
        }
        room.advance_games(now_ms() + 4000).unwrap();
        assert!(room.snapshot_for(&h).unwrap().games.is_empty());
        assert!(
            room.snapshot_for(&keys[4]).unwrap().games[0]
                .truco
                .hand
                .is_empty()
        );
        let mut cards = std::collections::BTreeSet::new();
        for key in keys.iter().take(4) {
            let view = room.snapshot_for(key).unwrap().games.remove(0);
            assert_eq!(view.truco.hand.len(), 3);
            assert!(view.truco.partner_hand.is_none());
            for card in view.truco.hand.into_iter().flatten() {
                assert!(cards.insert(serde_json::to_string(&card).unwrap()));
            }
        }
        let revision = room.snapshot_for(&keys[0]).unwrap().games[0]
            .truco
            .state
            .revision;
        assert!(
            room.handle(
                &keys[4],
                game(GameCommand::Truco {
                    revision,
                    action: truco::Action::Raise
                })
            )
            .is_err()
        );
        assert!(
            room.handle(
                &keys[1],
                game(GameCommand::Truco {
                    revision,
                    action: truco::Action::Play {
                        index: 0,
                        covered: false
                    }
                })
            )
            .is_err()
        );
        room.handle(
            &keys[0],
            game(GameCommand::Truco {
                revision,
                action: truco::Action::Raise,
            }),
        )
        .unwrap();
        room.handle(&keys[1], cmd(Action::VoiceLeave)).unwrap();
        assert_eq!(
            room.snapshot_for(&keys[0]).unwrap().games[0]
                .truco
                .state
                .winner,
            Some(0)
        );
        assert!(room.snapshot_for(&keys[1]).unwrap().games.is_empty());
        for (i, key) in keys.iter().take(2).enumerate() {
            room.handle(key, cmd(Action::VoiceJoin { channel }))
                .unwrap();
            room.handle(
                key,
                game(GameCommand::Join {
                    game: GameKind::Chess,
                    seat: Some(i),
                }),
            )
            .unwrap();
            room.handle(
                key,
                game(GameCommand::Join {
                    game: GameKind::Pool,
                    seat: None,
                }),
            )
            .unwrap();
        }
        let views = room.snapshot_for(&keys[0]).unwrap().games.remove(0);
        assert!(
            room.handle(
                &keys[4],
                game(GameCommand::Chess {
                    revision: views.chess.revision,
                    action: chess::Action::Resign
                })
            )
            .is_err()
        );
        assert!(
            room.handle(
                &keys[4],
                game(GameCommand::PoolShoot {
                    angle: 0.0,
                    power: 1.0,
                    revision: views.pool.revision
                })
            )
            .is_err()
        );
        room.handle(
            &keys[0],
            game(GameCommand::PoolShoot {
                angle: 0.0,
                power: 1.0,
                revision: views.pool.revision,
            }),
        )
        .unwrap();
        room.advance_games(now_ms() + 100).unwrap();
        assert_eq!(
            room.snapshot_for(&keys[0]).unwrap().games[0].pool.phase,
            pool::Phase::Preparing
        );
        room.remove(&keys[1]);
        room.advance_games(now_ms() + 200).unwrap();
        let view = room.snapshot_for(&keys[0]).unwrap().games.remove(0);
        assert!(view.chess.paused);
        assert_eq!(view.pool.phase, pool::Phase::Finished);
        room.advance_games(now_ms() + 61000).unwrap();
        assert_eq!(
            room.snapshot_for(&keys[0]).unwrap().games[0].chess.winner,
            Some(0)
        );
    }
    #[test]
    fn roles_are_persistent_labels_without_administrative_powers() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("roles.db");
        let mut store = Store::open(&path).unwrap();
        let owner = store.profile().unwrap().id;
        let server = store.create_community(owner, "Social").unwrap();
        let other = store.create_community(owner, "Other").unwrap();
        let h = "h".repeat(43);
        let g = "g".repeat(43);
        let guest = Uuid::new_v4();
        let mut room = RoomHost::new(store, server.clone(), h.clone()).unwrap();
        room.admit(h.clone(), owner, "Host".into()).unwrap();
        room.admit(g.clone(), guest, "Guest".into()).unwrap();
        assert!(
            room.handle(
                &g,
                cmd(Action::RoleSave {
                    id: None,
                    name: "Admin".into(),
                    color: "#ffffff".into()
                })
            )
            .is_err()
        );
        assert!(
            room.handle(
                &h,
                cmd(Action::RoleSave {
                    id: None,
                    name: "Invalid".into(),
                    color: "red".into()
                })
            )
            .is_err()
        );
        room.handle(
            &h,
            cmd(Action::RoleSave {
                id: None,
                name: "Amigos".into(),
                color: "#12AbEF".into(),
            }),
        )
        .unwrap();
        let role = room.snapshot().unwrap().roles[0].id;
        assert!(
            room.handle(
                &h,
                cmd(Action::RoleAssign {
                    role: Uuid::new_v4(),
                    member: guest,
                    assigned: true
                })
            )
            .is_err()
        );
        room.handle(
            &h,
            cmd(Action::RoleAssign {
                role,
                member: guest,
                assigned: true,
            }),
        )
        .unwrap();
        assert!(
            room.handle(&g, cmd(Action::RoleDelete { id: role }))
                .is_err()
        );
        assert!(
            room.handle(
                &g,
                cmd(Action::ServerRename {
                    name: "Admin?".into()
                })
            )
            .is_err()
        );
        room.handle(
            &g,
            cmd(Action::ProfileUpdate {
                name: "Nova Guest".into(),
                presence: Presence::Busy,
                nickname_color: "#123456".into(),
            }),
        )
        .unwrap();
        let profile = room
            .snapshot()
            .unwrap()
            .profiles
            .into_iter()
            .find(|p| p.id == guest)
            .unwrap();
        assert_eq!(profile.presence, Presence::Busy);
        assert_eq!(profile.name, "Nova Guest");
        let mut other_room = RoomHost::new(Store::open(&path).unwrap(), other, h.clone()).unwrap();
        other_room.admit(h.clone(), owner, "Host".into()).unwrap();
        assert!(other_room.snapshot().unwrap().roles.is_empty());
        assert!(
            other_room
                .handle(&h, cmd(Action::RoleDelete { id: role }))
                .is_err()
        );
        drop(other_room);
        drop(room);
        let mut room = RoomHost::new(Store::open(&path).unwrap(), server, h.clone()).unwrap();
        room.admit(h.clone(), owner, "Host".into()).unwrap();
        room.admit(g.clone(), guest, "Nova Guest".into()).unwrap();
        assert_eq!(room.snapshot().unwrap().member_roles[0].member, guest);
        assert_eq!(
            room.snapshot()
                .unwrap()
                .profiles
                .into_iter()
                .find(|p| p.id == guest)
                .unwrap()
                .presence,
            Presence::Busy
        );
        room.handle(&h, cmd(Action::RoleDelete { id: role }))
            .unwrap();
        assert!(room.snapshot().unwrap().member_roles.is_empty());
    }
    #[test]
    fn replies_reactions_history_and_private_notifications_survive_reopen() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("social.db");
        let mut store = Store::open(&path).unwrap();
        let owner = store.profile().unwrap().id;
        let server = store.create_community(owner, "Social").unwrap();
        let foreign = store.create_community(owner, "Other").unwrap();
        let foreign_channel = store
            .channels(foreign.id)
            .unwrap()
            .into_iter()
            .find(|c| c.kind == ChannelKind::Text)
            .unwrap()
            .id;
        let channel = store
            .channels(server.id)
            .unwrap()
            .into_iter()
            .find(|c| c.kind == ChannelKind::Text)
            .unwrap()
            .id;
        let h = "h".repeat(43);
        let g = "g".repeat(43);
        let guest = Uuid::new_v4();
        let mut room = RoomHost::new(store, server.clone(), h.clone()).unwrap();
        room.admit(h.clone(), owner, "Host".into()).unwrap();
        room.admit(g.clone(), guest, "Guest".into()).unwrap();
        let original: Message = serde_json::from_value(
            room.handle(
                &h,
                cmd(Action::Message {
                    channel,
                    text: "primeira".into(),
                }),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(
            room.handle(
                &g,
                cmd(Action::Reply {
                    channel: foreign_channel,
                    target: original.id,
                    text: "vazamento".into()
                })
            )
            .is_err()
        );
        let reply: Message = serde_json::from_value(
            room.handle(
                &g,
                cmd(Action::Reply {
                    channel,
                    target: original.id,
                    text: format!("resposta @{{{owner}}} @{{{owner}}}"),
                }),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(reply.reply_to, Some(original.id));
        let reaction = cmd(Action::React {
            id: reply.id,
            emoji: "❤️".into(),
        });
        room.handle(&h, reaction.clone()).unwrap();
        room.handle(&h, reaction).unwrap();
        assert!(
            room.handle(
                &g,
                cmd(Action::React {
                    id: reply.id,
                    emoji: "invalid".into()
                })
            )
            .is_err()
        );
        let snapshot = room.snapshot_for(&h).unwrap();
        assert_eq!(snapshot.notifications.len(), 2); // one reply plus one deduplicated mention
        assert!(room.snapshot_for(&g).unwrap().notifications.is_empty());
        assert_eq!(
            snapshot
                .messages
                .iter()
                .find(|m| m.id == reply.id)
                .unwrap()
                .reactions["❤️"],
            vec![owner]
        );
        let alert = snapshot.notifications[0].id;
        assert!(
            room.handle(&g, cmd(Action::NotificationRead { id: alert }))
                .is_err()
        );
        room.handle(&h, cmd(Action::NotificationRead { id: alert }))
            .unwrap();
        let search: Vec<Message> = serde_json::from_value(
            room.handle(
                &g,
                cmd(Action::Search {
                    channel,
                    text: "resposta".into(),
                    before: None,
                }),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].reply_to, Some(original.id));
        let history: Vec<Message> = serde_json::from_value(
            room.handle(
                &g,
                cmd(Action::History {
                    channel,
                    before: Some((reply.time, reply.id)),
                }),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(
            history
                .iter()
                .all(|m| (m.time, m.id) < (reply.time, reply.id))
        );
        drop(room);
        let store = Store::open(&path).unwrap();
        store.integrity().unwrap();
        let mut room = RoomHost::new(store, server, h.clone()).unwrap();
        room.admit(h.clone(), owner, "Host".into()).unwrap();
        room.admit(g.clone(), guest, "Guest".into()).unwrap();
        assert!(
            room.snapshot_for(&h)
                .unwrap()
                .notifications
                .iter()
                .any(|n| n.id == alert && n.read)
        );
        assert_eq!(
            room.snapshot_for(&h)
                .unwrap()
                .messages
                .iter()
                .find(|m| m.id == reply.id)
                .unwrap()
                .reply_to,
            Some(original.id)
        );
        room.handle(&h, cmd(Action::Delete { id: original.id }))
            .unwrap();
        assert!(
            room.snapshot_for(&g)
                .unwrap()
                .deleted_messages
                .contains(&original.id)
        );
        assert_eq!(room.snapshot_for(&h).unwrap().messages[0].reply_to, None);
        room.handle(&g, cmd(Action::Delete { id: reply.id }))
            .unwrap();
        assert!(room.snapshot_for(&h).unwrap().notifications.is_empty());
    }
    #[test]
    fn direct_edits_reads_and_deletes_require_the_correct_participant() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(&root.path().join("private.db")).unwrap();
        let owner = store.profile().unwrap().id;
        let server = store.create_community(owner, "Social").unwrap();
        let h = "h".repeat(43);
        let g = "g".repeat(43);
        let guest = Uuid::new_v4();
        let mut room = RoomHost::new(store, server, h.clone()).unwrap();
        room.admit(h.clone(), owner, "Host".into()).unwrap();
        room.admit(g.clone(), guest, "Guest".into()).unwrap();
        room.handle(&h, cmd(Action::FriendRequest { to: guest }))
            .unwrap();
        room.handle(
            &g,
            cmd(Action::FriendRespond {
                requester: owner,
                accept: true,
            }),
        )
        .unwrap();
        room.handle(
            &h,
            cmd(Action::Direct {
                to: guest,
                text: "privada".into(),
            }),
        )
        .unwrap();
        let id = room.snapshot_for(&g).unwrap().direct[0].id;
        assert!(room.handle(&h, cmd(Action::DirectRead { id })).is_err());
        assert!(
            room.handle(
                &g,
                cmd(Action::DirectEdit {
                    id,
                    text: "invasão".into()
                })
            )
            .is_err()
        );
        assert!(room.handle(&g, cmd(Action::DirectDelete { id })).is_err());
        room.handle(&g, cmd(Action::DirectRead { id })).unwrap();
        let read_at = room.snapshot_for(&h).unwrap().direct[0].read_at;
        room.handle(&g, cmd(Action::DirectRead { id })).unwrap();
        assert_eq!(read_at, room.snapshot_for(&h).unwrap().direct[0].read_at);
        room.handle(
            &h,
            cmd(Action::DirectEdit {
                id,
                text: "corrigida".into(),
            }),
        )
        .unwrap();
        let message = &room.snapshot_for(&g).unwrap().direct[0];
        assert_eq!(message.text, "corrigida");
        assert!(message.edited_at.is_some());
        assert!(message.read_at.is_some());
        room.handle(&h, cmd(Action::DirectDelete { id })).unwrap();
        assert!(room.snapshot_for(&g).unwrap().direct.is_empty());
        assert!(
            !room
                .snapshot_for(&g)
                .unwrap()
                .notifications
                .iter()
                .any(|n| n.message == Some(id))
        );
    }
    #[test]
    fn friendship_consent_direct_privacy_and_administration_are_authoritative() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(&root.path().join("test.sqlite")).unwrap();
        let owner = store.profile().unwrap();
        let server = store.create_community(owner.id, "Privado").unwrap();
        let host_key = "h".repeat(43);
        let a_key = "a".repeat(43);
        let b_key = "b".repeat(43);
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let mut room = RoomHost::new(store, server, host_key.clone()).unwrap();
        for (key, id, name) in [
            (&host_key, owner.id, "Host"),
            (&a_key, a, "Ana"),
            (&b_key, b, "Bia"),
        ] {
            room.admit(key.clone(), id, name.into()).unwrap();
        }
        let command = |action| Command {
            id: Uuid::new_v4(),
            action,
        };
        assert!(
            room.handle(
                &a_key,
                command(Action::Direct {
                    to: b,
                    text: "antes de aceitar".into()
                })
            )
            .is_err()
        );
        room.handle(&a_key, command(Action::FriendRequest { to: b }))
            .unwrap();
        assert!(room.snapshot().unwrap().friends.is_empty());
        assert_eq!(room.snapshot_for(&b_key).unwrap().friends.len(), 1);
        assert!(
            room.handle(
                &a_key,
                command(Action::FriendRespond {
                    requester: a,
                    accept: true
                })
            )
            .is_err()
        );
        room.handle(
            &b_key,
            command(Action::FriendRespond {
                requester: a,
                accept: true,
            }),
        )
        .unwrap();
        room.handle(
            &a_key,
            command(Action::Direct {
                to: b,
                text: "somente para Bia".into(),
            }),
        )
        .unwrap();
        assert_eq!(room.snapshot_for(&b_key).unwrap().direct.len(), 1);
        assert!(room.snapshot().unwrap().direct.is_empty());
        assert!(
            room.handle(
                &a_key,
                command(Action::ServerRename {
                    name: "Impostor".into()
                })
            )
            .is_err()
        );
        room.handle(
            &host_key,
            command(Action::ServerRename {
                name: "Novo nome".into(),
            }),
        )
        .unwrap();
        assert_eq!(room.snapshot().unwrap().server.name, "Novo nome");
        room.handle(&b_key, command(Action::FriendRemove { peer: a }))
            .unwrap();
        assert!(
            room.handle(
                &a_key,
                command(Action::Direct {
                    to: b,
                    text: "após remover".into()
                })
            )
            .is_err()
        );
        assert_eq!(room.snapshot_for(&a_key).unwrap().direct.len(), 1);
    }
    #[test]
    fn room_rejects_identity_spoof_and_cross_server_commands_and_deduplicates() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("room.db")).unwrap();
        let owner = store.profile().unwrap();
        let a = store.create_community(owner.id, "A").unwrap();
        let b = store.create_community(owner.id, "B").unwrap();
        let b_channel = store
            .channels(b.id)
            .unwrap()
            .into_iter()
            .find(|c| c.kind == ChannelKind::Text)
            .unwrap()
            .id;
        let a_channel = store
            .channels(a.id)
            .unwrap()
            .into_iter()
            .find(|c| c.kind == ChannelKind::Text)
            .unwrap()
            .id;
        let host_key = "h".repeat(43);
        let guest_key = "g".repeat(43);
        let mut room = RoomHost::new(store, a, host_key.clone()).unwrap();
        assert!(
            room.admit(guest_key.clone(), owner.id, "Impostor".into())
                .is_err()
        );
        room.admit(host_key.clone(), owner.id, "Host".into())
            .unwrap();
        room.admit(guest_key.clone(), Uuid::new_v4(), "Guest".into())
            .unwrap();
        let command = Command {
            id: Uuid::new_v4(),
            action: Action::Message {
                channel: a_channel,
                text: "uma vez".into(),
            },
        };
        let first = room.handle(&guest_key, command.clone()).unwrap();
        assert_eq!(first, room.handle(&guest_key, command).unwrap());
        assert_eq!(room.snapshot().unwrap().messages.len(), 1);
        assert!(
            room.handle(
                &guest_key,
                Command {
                    id: Uuid::new_v4(),
                    action: Action::Message {
                        channel: b_channel,
                        text: "invasão".into()
                    }
                }
            )
            .is_err()
        );
        assert!(
            room.handle(
                &guest_key,
                Command {
                    id: Uuid::new_v4(),
                    action: Action::ChannelCreate {
                        name: "admin".into(),
                        kind: ChannelKind::Text
                    }
                }
            )
            .is_err()
        );
    }
}
