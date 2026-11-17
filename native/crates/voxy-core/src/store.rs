use crate::model::*;
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, params};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub struct Store {
    pub(crate) db: Connection,
}
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(3))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS native_recent(id TEXT PRIMARY KEY,server TEXT NOT NULL,invite BLOB NOT NULL,seen INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS communities(id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS native_channels(id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('text','voice')));
            CREATE TABLE IF NOT EXISTS native_messages(id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES native_channels(id) ON DELETE CASCADE, author TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, time INTEGER NOT NULL, edited_at INTEGER);
            CREATE INDEX IF NOT EXISTS native_message_page ON native_messages(channel_id,time,id);
            CREATE TABLE IF NOT EXISTS seen_releases(version TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS migration_receipts(source_hash TEXT PRIMARY KEY, imported_at INTEGER NOT NULL, report TEXT NOT NULL);
            PRAGMA user_version=1;")?;
        Ok(Self { db })
    }
    pub fn profile(&self) -> Result<Profile> {
        let raw = self
            .db
            .query_row("SELECT value FROM settings WHERE key='profile'", [], |r| {
                r.get::<_, String>(0)
            });
        match raw {
            Ok(raw) => {
                let profile: Profile = serde_json::from_str(&raw)?;
                profile.validate()?;
                Ok(profile)
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                let profile = Profile::default();
                self.save_profile(&profile)?;
                Ok(profile)
            }
            Err(error) => Err(error.into()),
        }
    }
    pub fn save_profile(&self, profile: &Profile) -> Result<()> {
        profile.validate()?;
        self.db.execute("INSERT INTO settings VALUES('profile',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(profile)?])?;
        Ok(())
    }
    pub fn create_community(&mut self, owner: Uuid, name: &str) -> Result<Community> {
        validate_text(name, 60)?;
        ensure!(!owner.is_nil(), "Proprietário inválido");
        let community = Community {
            id: Uuid::new_v4(),
            name: name.trim().into(),
            owner,
        };
        let transaction = self.db.transaction()?;
        transaction.execute(
            "INSERT INTO communities VALUES(?1,?2,?3)",
            params![community.id.to_string(), community.name, owner.to_string()],
        )?;
        for (name, kind) in [("conversa", "text"), ("Sala dos amigos", "voice")] {
            transaction.execute(
                "INSERT INTO native_channels VALUES(?1,?2,?3,?4)",
                params![
                    Uuid::new_v4().to_string(),
                    community.id.to_string(),
                    name,
                    kind
                ],
            )?;
        }
        transaction.commit()?;
        Ok(community)
    }
    pub fn communities(&self) -> Result<Vec<Community>> {
        let mut stmt = self
            .db
            .prepare("SELECT id,name,owner FROM communities ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        rows.map(|row| {
            let (id, name, owner) = row?;
            Ok(Community {
                id: Uuid::parse_str(&id)?,
                name,
                owner: Uuid::parse_str(&owner)?,
            })
        })
        .collect()
    }
    pub fn rename_community(&self, actor: Uuid, server: Uuid, name: &str) -> Result<()> {
        self.require_owner(actor, server)?;
        validate_text(name, 60)?;
        self.db.execute(
            "UPDATE communities SET name=?1 WHERE id=?2",
            params![name.trim(), server.to_string()],
        )?;
        Ok(())
    }
    pub fn save_recent(&self, server: &Community, invite: &str) -> Result<()> {
        ensure!(invite.len() <= 8192, "Convite excede o limite");
        let sealed = crate::identity::Identity::seal_local(invite.as_bytes())?;
        self.db.execute("INSERT INTO native_recent VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET server=excluded.server,invite=excluded.invite,seen=excluded.seen",params![server.id.to_string(),serde_json::to_string(server)?,sealed,now_ms()])?;
        self.db.execute("DELETE FROM native_recent WHERE id IN (SELECT id FROM native_recent ORDER BY seen DESC LIMIT -1 OFFSET 40)",[])?;
        Ok(())
    }
    pub fn recent_servers(&self) -> Result<Vec<Community>> {
        let mut query = self
            .db
            .prepare("SELECT server FROM native_recent ORDER BY seen DESC LIMIT 40")?;
        query
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|r| Ok(serde_json::from_str(&r?)?))
            .collect()
    }
    pub fn recent_invite(&self, id: Uuid) -> Result<String> {
        let sealed: Vec<u8> = self.db.query_row(
            "SELECT invite FROM native_recent WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        Ok(String::from_utf8(crate::identity::Identity::open_local(
            &sealed,
        )?)?)
    }
    pub fn delete_community(&self, actor: Uuid, server: Uuid) -> Result<()> {
        self.require_owner(actor, server)?;
        self.db
            .execute("DELETE FROM communities WHERE id=?1", [server.to_string()])?;
        Ok(())
    }
    pub fn rename_channel(&self, actor: Uuid, server: Uuid, id: Uuid, name: &str) -> Result<()> {
        self.require_owner(actor, server)?;
        validate_text(name, 60)?;
        ensure!(
            self.db.execute(
                "UPDATE native_channels SET name=?1 WHERE id=?2 AND server_id=?3",
                params![name.trim(), id.to_string(), server.to_string()]
            )? == 1,
            "Canal não pertence ao servidor"
        );
        Ok(())
    }
    pub fn delete_channel(&self, actor: Uuid, server: Uuid, id: Uuid) -> Result<()> {
        self.require_owner(actor, server)?;
        ensure!(
            self.db.execute(
                "DELETE FROM native_channels WHERE id=?1 AND server_id=?2",
                params![id.to_string(), server.to_string()]
            )? == 1,
            "Canal não pertence ao servidor"
        );
        Ok(())
    }
    pub fn channels(&self, server: Uuid) -> Result<Vec<Channel>> {
        let mut stmt = self.db.prepare(
            "SELECT id,name,kind FROM native_channels WHERE server_id=?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([server.to_string()], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        rows.map(|row| {
            let (id, name, kind) = row?;
            Ok(Channel {
                id: Uuid::parse_str(&id)?,
                server_id: server,
                name,
                kind: if kind == "voice" {
                    ChannelKind::Voice
                } else {
                    ChannelKind::Text
                },
            })
        })
        .collect()
    }
    pub fn add_channel(
        &self,
        actor: Uuid,
        server: Uuid,
        name: &str,
        kind: ChannelKind,
    ) -> Result<Channel> {
        validate_text(name, 60)?;
        self.require_owner(actor, server)?;
        let channel = Channel {
            id: Uuid::new_v4(),
            server_id: server,
            name: name.trim().into(),
            kind,
        };
        self.db.execute(
            "INSERT INTO native_channels VALUES(?1,?2,?3,?4)",
            params![
                channel.id.to_string(),
                server.to_string(),
                channel.name,
                if kind == ChannelKind::Voice {
                    "voice"
                } else {
                    "text"
                }
            ],
        )?;
        Ok(channel)
    }
    pub fn require_owner(&self, actor: Uuid, server: Uuid) -> Result<()> {
        let owner: String = self
            .db
            .query_row(
                "SELECT owner FROM communities WHERE id=?1",
                [server.to_string()],
                |r| r.get(0),
            )
            .context("Servidor não encontrado")?;
        ensure!(
            owner == actor.to_string(),
            "Somente o proprietário pode administrar o servidor"
        );
        Ok(())
    }
    pub fn post(&self, channel: Uuid, author: Uuid, name: &str, text: &str) -> Result<Message> {
        validate_text(text, 4000)?;
        validate_text(name, 60)?;
        let kind: String = self.db.query_row(
            "SELECT kind FROM native_channels WHERE id=?1",
            [channel.to_string()],
            |r| r.get(0),
        )?;
        ensure!(kind == "text", "Canal não permite mensagens");
        let message = Message {
            id: Uuid::new_v4(),
            channel_id: channel,
            author,
            name: name.into(),
            text: text.trim().into(),
            time: now_ms(),
            edited_at: None,
        };
        self.db.execute(
            "INSERT INTO native_messages VALUES(?1,?2,?3,?4,?5,?6,NULL)",
            params![
                message.id.to_string(),
                channel.to_string(),
                author.to_string(),
                name,
                message.text,
                message.time
            ],
        )?;
        Ok(message)
    }
    pub fn edit(&self, id: Uuid, actor: Uuid, text: &str) -> Result<()> {
        validate_text(text, 4000)?;
        let changed = self.db.execute(
            "UPDATE native_messages SET text=?1,edited_at=?2 WHERE id=?3 AND author=?4",
            params![text.trim(), now_ms(), id.to_string(), actor.to_string()],
        )?;
        ensure!(changed == 1, "Mensagem inexistente ou autoria inválida");
        Ok(())
    }
    pub fn delete_message(&self, id: Uuid, actor: Uuid) -> Result<()> {
        ensure!(
            self.db.execute(
                "DELETE FROM native_messages WHERE id=?1 AND author=?2",
                params![id.to_string(), actor.to_string()]
            )? == 1,
            "Mensagem inexistente ou autoria inválida"
        );
        Ok(())
    }
    pub fn messages(&self, channel: Uuid, before: Option<(i64, Uuid)>) -> Result<Vec<Message>> {
        let mut stmt=self.db.prepare("SELECT id,author,name,text,time,edited_at FROM native_messages WHERE channel_id=?1 AND (time<?2 OR (time=?2 AND id<?3)) ORDER BY time DESC,id DESC LIMIT 100")?;
        let (time, id) = before
            .map(|(t, i)| (t, i.to_string()))
            .unwrap_or((i64::MAX, "~".into()));
        let rows = stmt.query_map(params![channel.to_string(), time, id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<i64>>(5)?,
            ))
        })?;
        let mut messages: Vec<Message> = rows
            .map(|r| {
                let (id, author, name, text, time, edited_at) = r?;
                Ok(Message {
                    id: Uuid::parse_str(&id)?,
                    channel_id: channel,
                    author: Uuid::parse_str(&author)?,
                    name,
                    text,
                    time,
                    edited_at,
                })
            })
            .collect::<Result<_>>()?;
        messages.reverse();
        Ok(messages)
    }
    pub fn release_seen(&self, version: &str) -> Result<bool> {
        Ok(self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM seen_releases WHERE version=?1)",
            [version],
            |r| r.get(0),
        )?)
    }
    pub fn mark_release(&self, version: &str) -> Result<()> {
        self.db.execute(
            "INSERT OR IGNORE INTO seen_releases VALUES(?1,?2)",
            params![version, now_ms()],
        )?;
        Ok(())
    }
    pub fn integrity(&self) -> Result<()> {
        let result: String = self
            .db
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        ensure!(result == "ok", "Falha de integridade do banco");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn author_and_owner_permissions_survive_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let mut db = Store::open(&path).unwrap();
        let p = db.profile().unwrap();
        let other = Uuid::new_v4();
        let server = db.create_community(p.id, "Amigos").unwrap();
        assert!(
            db.add_channel(other, server.id, "invasão", ChannelKind::Text)
                .is_err()
        );
        let channel = db
            .channels(server.id)
            .unwrap()
            .into_iter()
            .find(|c| c.kind == ChannelKind::Text)
            .unwrap();
        let m = db.post(channel.id, p.id, &p.name, "Olá").unwrap();
        assert!(db.edit(m.id, other, "alterado").is_err());
        assert!(db.delete_message(m.id, other).is_err());
        db.edit(m.id, p.id, "editado").unwrap();
        db.mark_release("2.0.0").unwrap();
        drop(db);
        let db = Store::open(&path).unwrap();
        assert_eq!(db.profile().unwrap().id, p.id);
        assert_eq!(db.messages(channel.id, None).unwrap()[0].text, "editado");
        assert!(db.release_seen("2.0.0").unwrap());
        db.integrity().unwrap();
    }
}
