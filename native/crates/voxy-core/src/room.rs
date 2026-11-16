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
        self.members.insert(
            key,
            Member {
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
        self.store.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<serde_json::Value> {
            let value = match command.action {
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
