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
    ServerRename { name: String },
    ChannelRename { id: Uuid, name: String },
    ChannelDelete { id: Uuid },
    FriendRequest { to: Uuid },
    FriendRespond { requester: Uuid, accept: bool },
    FriendRemove { peer: Uuid },
    Direct { to: Uuid, text: String },
    Message { channel: Uuid, text: String },
    Edit { id: Uuid, text: String },
    Delete { id: Uuid },
    ChannelCreate { name: String, kind: ChannelKind },
    VoiceJoin { channel: Uuid },
    VoiceLeave,
    VoiceState { muted: bool, deafened: bool },
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
}
pub struct RoomHost {
    store: Store,
    server: Community,
    owner_key: String,
    members: BTreeMap<String, Member>,
}
impl RoomHost {
    pub fn new(store: Store, server: Community, owner_key: String) -> Result<Self> {
        store.require_owner(server.owner, server.id)?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_member_keys(key TEXT PRIMARY KEY,profile_id TEXT UNIQUE NOT NULL);CREATE TABLE IF NOT EXISTS native_receipts(peer TEXT NOT NULL,id TEXT NOT NULL,response TEXT NOT NULL,time INTEGER NOT NULL,PRIMARY KEY(peer,id));")?;
        store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_names(profile_id TEXT PRIMARY KEY,name TEXT NOT NULL);CREATE TABLE IF NOT EXISTS native_friends(server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,requester TEXT NOT NULL,recipient TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(server,requester,recipient));CREATE TABLE IF NOT EXISTS native_direct(id TEXT PRIMARY KEY,server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,sender TEXT NOT NULL,recipient TEXT NOT NULL,text TEXT NOT NULL,time INTEGER NOT NULL);")?;
        Ok(Self {
            store,
            server,
            owner_key,
            members: Default::default(),
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
        self.members.remove(key);
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
        let mut query=self.store.db.prepare("SELECT id,sender,recipient,text,time FROM native_direct WHERE server=?1 AND (sender=?2 OR recipient=?2) ORDER BY time DESC,id DESC LIMIT 100")?;
        let mut direct = query
            .query_map(rusqlite::params![self.server.id.to_string(), viewer], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })?
            .map(|r| {
                let (id, a, b, text, time) = r?;
                Ok(DirectMessage {
                    id: Uuid::parse_str(&id)?,
                    from: Uuid::parse_str(&a)?,
                    to: Uuid::parse_str(&b)?,
                    text,
                    time,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        direct.reverse();
        let channels = self.store.channels(self.server.id)?;
        let mut messages = Vec::new();
        for channel in &channels {
            if channel.kind == ChannelKind::Text {
                messages.extend(self.store.messages(channel.id, None)?);
            }
        }
        Ok(Snapshot {
            server: self.server.clone(),
            channels,
            members: self.members.values().cloned().collect(),
            messages,
            friends,
            direct,
        })
    }
    pub fn handle(&mut self, key: &str, command: Command) -> Result<serde_json::Value> {
        ensure!(!command.id.is_nil(), "Comando inválido");
        let member = self
            .members
            .get(key)
            .context("Participante não autenticado")?
            .clone();
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
        self.store.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<serde_json::Value> {
            let value = match command.action {
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
                    for peer in self.members.values_mut() {
                        if peer.voice == Some(id) {
                            peer.voice = None;
                        }
                    }
                    serde_json::json!({"deleted":id})
                }
                Action::FriendRequest { to } => {
                    ensure!(to != member.id, "Não é possível adicionar o próprio perfil");
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
                    serde_json::json!({"id":id})
                }
                Action::Message { channel, text } => {
                    self.require_channel(channel)?;
                    serde_json::to_value(self.store.post(
                        channel,
                        member.id,
                        &member.name,
                        &text,
                    )?)?
                }
                Action::Edit { id, text } => {
                    self.require_message(id)?;
                    self.store.edit(id, member.id, &text)?;
                    serde_json::json!({"edited":id})
                }
                Action::Delete { id } => {
                    self.require_message(id)?;
                    self.store.delete_message(id, member.id)?;
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
