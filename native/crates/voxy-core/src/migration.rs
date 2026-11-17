//! Explicit, copy-first legacy import. Never opens the installed profile automatically.
use crate::{
    model::Profile,
    store::{Store, now_ms},
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportReport {
    pub source_hash: String,
    pub backup: String,
    pub profile_imported: bool,
    pub messages_imported: usize,
    pub servers_imported: usize,
    pub channels_imported: usize,
    pub legacy_table_counts: std::collections::BTreeMap<String, i64>,
    pub pending: Vec<String>,
}
pub fn import_legacy(source: &Path, destination: &Path) -> Result<ImportReport> {
    let source = source.canonicalize()?;
    let destination = crate::validate_experimental_path(destination)?;
    ensure!(
        !destination.starts_with(&source) && !source.starts_with(&destination),
        "Origem e destino precisam ser independentes"
    );
    ensure!(
        !destination.exists() || destination.read_dir()?.next().is_none(),
        "O destino deve ser uma pasta experimental vazia"
    );
    // Validate boundaries before creating anything, including an empty directory.
    fs::create_dir_all(&destination)?;
    ensure!(
        fs::metadata(source.join("profile.json"))?.len() <= 1_048_576,
        "Perfil excede o limite"
    );
    let profile_bytes =
        fs::read(source.join("profile.json")).context("Perfil 1.x não encontrado")?;
    ensure!(profile_bytes.len() <= 1_048_576, "Perfil excede o limite");
    let raw: serde_json::Value = serde_json::from_slice(&profile_bytes)?;
    ensure!(
        raw.get("id").and_then(|id| id.as_str()).is_some(),
        "Perfil legado sem identidade; importação cancelada"
    );
    let profile: Profile = serde_json::from_slice(&profile_bytes)?;
    profile.validate()?;
    let source_hash = format!("{:x}", Sha256::digest(&profile_bytes));
    let backup =
        destination
            .join("backups")
            .join(format!("legacy-{}-{}", now_ms(), uuid::Uuid::new_v4()));
    fs::create_dir_all(&backup)?;
    // Source must be closed: SQLite WASM writes complete snapshots. Refuse live WAL state.
    ensure!(
        !source.join("room.sqlite-wal").exists(),
        "Feche o aplicativo 1.x antes de importar"
    );
    let mut manifest = std::collections::BTreeMap::new();
    for name in [
        "profile.json",
        "room.sqlite",
        "profile-identity.bin",
        "host-secret.bin",
        "recent-rooms.json",
        "direct-inbox.json",
        "notifications.json",
        "release-notes.json",
        "remote-release-history.json",
    ] {
        let path = source.join(name);
        if !path.exists() {
            continue;
        }
        ensure!(
            !fs::symlink_metadata(&path)?.file_type().is_symlink(),
            "Backup não aceita links simbólicos"
        );
        let target = backup.join(name);
        fs::copy(&path, &target)?;
        let before = hash_file(&path)?;
        let after = hash_file(&target)?;
        if name == "profile.json" {
            ensure!(
                format!("{before:x}") == source_hash,
                "O perfil mudou durante a importação; feche a versão antiga"
            );
        }
        ensure!(
            before == after,
            "Backup divergiu da origem; feche a versão antiga"
        );
        manifest.insert(name, format!("{before:x}"));
    }
    fs::write(
        backup.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    // SQLite is opened only from the verified backup, never the installed database.
    let legacy_path = backup.join("room.sqlite");
    let legacy = if legacy_path.exists() {
        let legacy = rusqlite::Connection::open_with_flags(
            &legacy_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        legacy.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;")?;
        let integrity: String = legacy.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        ensure!(
            integrity == "ok",
            "Banco legado corrompido; origem preservada"
        );
        let violations: i64 =
            legacy.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })?;
        ensure!(violations == 0, "Banco legado possui referências inválidas");
        Some(legacy)
    } else {
        None
    };
    let db = Store::open(&destination.join("voxy.sqlite"))?;
    let existing: Option<String> = db
        .db
        .query_row("SELECT value FROM settings WHERE key='profile'", [], |r| {
            r.get(0)
        })
        .ok();
    ensure!(
        existing.is_none(),
        "O destino já tem um perfil; use uma pasta experimental vazia"
    );
    db.db.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> Result<ImportReport> {
        db.save_profile(&profile)?;
        let (servers_imported, channels_imported, messages_imported, legacy_table_counts) =
            if let Some(legacy) = &legacy {
                import_history(legacy, &db)?
            } else {
                (0, 0, 0, Default::default())
            };
        let report = ImportReport {
            source_hash: source_hash.clone(),
            backup: backup.display().to_string(),
            profile_imported: true,
            messages_imported,
            servers_imported,
            channels_imported,
            legacy_table_counts,
            pending: vec![
                "Servidores sem dono, imagens, cargos, amigos e DMs preservados no backup; conversão/autorização ainda pendentes"
                    .into(),
                "Identidade DPAPI Electron exige conversor de envelope e associação autenticada"
                    .into(),
                "Seis visuais no Chromium Local Storage exigem exportação específica".into(),
            ],
        };
        db.db.execute(
            "INSERT INTO migration_receipts VALUES(?1,?2,?3)",
            rusqlite::params![source_hash, now_ms(), serde_json::to_string(&report)?],
        )?;
        db.integrity()?;
        Ok(report)
    })();
    match result {
        Ok(report) => {
            db.db.execute_batch("COMMIT")?;
            Ok(report)
        }
        Err(error) => {
            db.db.execute_batch("ROLLBACK")?;
            Err(error)
        }
    }
}
/// Convert stable base tables while retaining identifiers and never claiming unknown owners.
fn import_history(
    legacy: &rusqlite::Connection,
    target: &Store,
) -> Result<(usize, usize, usize, std::collections::BTreeMap<String, i64>)> {
    use rusqlite::params;
    use uuid::Uuid;
    let mut counts = std::collections::BTreeMap::new();
    for name in [
        "servers",
        "channels",
        "messages",
        "images",
        "avatars",
        "roles",
        "member_roles",
        "public_profiles",
        "reactions",
        "friendships",
        "direct_contacts",
        "profile_auth",
        "direct_messages",
        "direct_images",
        "direct_reactions",
    ] {
        let exists: bool = legacy.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
            [name],
            |r| r.get(0),
        )?;
        if exists {
            counts.insert(
                name.to_string(),
                legacy.query_row(&format!("SELECT count(*) FROM \"{name}\""), [], |r| {
                    r.get(0)
                })?,
            );
        }
    }
    if !counts.contains_key("servers") {
        return Ok((0, 0, 0, counts));
    }
    let (mut servers, mut channels, mut messages) = (0, 0, 0);
    let mut statement = legacy.prepare("SELECT id,name,ownerId FROM servers")?;
    let rows = statement.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (id, name, owner) = row?;
        let Some(owner) = owner else { continue };
        ensure!(
            !Uuid::parse_str(&id)?.is_nil() && !Uuid::parse_str(&owner)?.is_nil(),
            "Identificador legado inválido"
        );
        crate::model::validate_text(&name, 60)?;
        target.db.execute(
            "INSERT INTO communities(id,name,owner) VALUES(?1,?2,?3)",
            params![id, name, owner],
        )?;
        servers += 1;
    }
    let mut statement = legacy.prepare("SELECT id,serverId,name,kind FROM channels")?;
    let rows = statement.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (id, server, name, kind) = row?;
        let exists: bool = target.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM communities WHERE id=?1)",
            [&server],
            |r| r.get(0),
        )?;
        if !exists {
            continue;
        }
        ensure!(
            !Uuid::parse_str(&id)?.is_nil(),
            "Identificador de canal inválido"
        );
        crate::model::validate_text(&name, 60)?;
        ensure!(
            kind == "text" || kind == "voice",
            "Tipo de canal legado inválido"
        );
        target.db.execute(
            "INSERT INTO native_channels(id,server_id,name,kind) VALUES(?1,?2,?3,?4)",
            params![id, server, name, kind],
        )?;
        channels += 1;
    }
    let mut statement = legacy.prepare(
        "SELECT id,channelId,author,name,text,time,editedAt FROM messages ORDER BY time,id",
    )?;
    let rows = statement.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, Option<i64>>(6)?,
        ))
    })?;
    for row in rows {
        let (id, channel, author, name, text, time, edited) = row?;
        let exists: bool = target.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM native_channels WHERE id=?1)",
            [&channel],
            |r| r.get(0),
        )?;
        if !exists {
            continue;
        }
        ensure!(
            !Uuid::parse_str(&id)?.is_nil() && !Uuid::parse_str(&author)?.is_nil(),
            "Identificador de mensagem inválido"
        );
        crate::model::validate_text(&name, 60)?;
        ensure!(
            text.chars().count() <= 4000 && !text.contains('\0') && time >= 0,
            "Mensagem legada inválida"
        );
        target.db.execute("INSERT INTO native_messages(id,channel_id,author,name,text,time,edited_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,channel,author,name,text,time,edited])?;
        target.db.execute(
            "INSERT OR IGNORE INTO native_legacy_claims(profile_id) VALUES(?1)",
            [author],
        )?;
        messages += 1;
    }
    let has_reply: bool = legacy.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('messages') WHERE name='replyTo')",
        [],
        |r| r.get(0),
    )?;
    if has_reply {
        let mut query =
            legacy.prepare("SELECT id,replyTo FROM messages WHERE replyTo IS NOT NULL")?;
        for row in query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (message, original) = row?;
            let same:bool=target.db.query_row("SELECT EXISTS(SELECT 1 FROM native_messages a JOIN native_messages b ON a.channel_id=b.channel_id WHERE a.id=?1 AND b.id=?2)",rusqlite::params![message,original],|r|r.get(0))?;
            if same {
                target.db.execute(
                    "INSERT INTO native_replies(message,target) VALUES(?1,?2)",
                    rusqlite::params![message, original],
                )?;
            }
        }
    }
    if counts.contains_key("reactions") {
        let mut query = legacy.prepare("SELECT messageId,memberId,emoji FROM reactions")?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (message, actor, emoji) = row?;
            let exists: bool = target.db.query_row(
                "SELECT EXISTS(SELECT 1 FROM native_messages WHERE id=?1)",
                [&message],
                |r| r.get(0),
            )?;
            if exists {
                ensure!(
                    !Uuid::parse_str(&actor)?.is_nil()
                        && emoji.chars().count() <= 32
                        && !emoji.chars().any(char::is_control),
                    "Reação legada inválida"
                );
                target.db.execute(
                    "INSERT INTO native_reactions(message,actor,emoji) VALUES(?1,?2,?3)",
                    rusqlite::params![message, actor, emoji],
                )?;
                target.db.execute(
                    "INSERT OR IGNORE INTO native_legacy_claims(profile_id) VALUES(?1)",
                    [actor],
                )?;
            }
        }
    }
    Ok((servers, channels, messages, counts))
}
fn hash_file(path: &Path) -> Result<sha2::digest::Output<Sha256>> {
    use std::io::Read;
    let mut input = std::io::BufReader::new(fs::File::open(path)?);
    let mut hash = Sha256::new();
    let mut bytes = [0_u8; 65536];
    loop {
        let count = input.read(&mut bytes)?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    Ok(hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn legacy_fixture(root: &Path) -> (uuid::Uuid, uuid::Uuid) {
        use rusqlite::params;
        let profile = Profile::default();
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join("profile.json"),
            serde_json::to_vec(&profile).unwrap(),
        )
        .unwrap();
        let db = rusqlite::Connection::open(root.join("room.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE servers(id TEXT PRIMARY KEY,name TEXT,ownerId TEXT);CREATE TABLE channels(id TEXT PRIMARY KEY,serverId TEXT,name TEXT,kind TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,channelId TEXT,author TEXT,name TEXT,text TEXT,time INTEGER,editedAt INTEGER);").unwrap();
        let server = uuid::Uuid::new_v4();
        let channel = uuid::Uuid::new_v4();
        let message = uuid::Uuid::new_v4();
        db.execute(
            "INSERT INTO servers VALUES(?1,'Amigos',?2)",
            params![server.to_string(), profile.id.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO servers VALUES(?1,'Sem dono',NULL)",
            [uuid::Uuid::new_v4().to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO channels VALUES(?1,?2,'geral','text')",
            params![channel.to_string(), server.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO messages VALUES(?1,?2,?3,'Pessoa','Histórico real',123,124)",
            params![
                message.to_string(),
                channel.to_string(),
                profile.id.to_string()
            ],
        )
        .unwrap();
        (server, message)
    }
    #[test]
    fn history_import_preserves_ids_authorship_counts_and_source_hash() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("legacy");
        let destination = root.path().join("native");
        let (server, message) = legacy_fixture(&source);
        let before = hash_file(&source.join("room.sqlite")).unwrap();
        let report = import_legacy(&source, &destination).unwrap();
        assert_eq!(
            (
                report.servers_imported,
                report.channels_imported,
                report.messages_imported
            ),
            (1, 1, 1)
        );
        assert_eq!(report.legacy_table_counts["servers"], 2);
        let store = Store::open(&destination.join("voxy.sqlite")).unwrap();
        assert_eq!(store.communities().unwrap()[0].id, server);
        let imported: (String, String, i64) = store
            .db
            .query_row("SELECT id,text,edited_at FROM native_messages", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(
            imported,
            (message.to_string(), "Histórico real".into(), 124)
        );
        assert_eq!(hash_file(&source.join("room.sqlite")).unwrap(), before);
        store.integrity().unwrap();
    }
    #[test]
    fn invalid_history_rolls_back_profile_and_all_converted_rows() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("legacy");
        let destination = root.path().join("native");
        legacy_fixture(&source);
        let db = rusqlite::Connection::open(source.join("room.sqlite")).unwrap();
        db.execute("UPDATE messages SET author='invalid'", [])
            .unwrap();
        drop(db);
        assert!(import_legacy(&source, &destination).is_err());
        let target = Store::open(&destination.join("voxy.sqlite")).unwrap();
        for table in [
            "communities",
            "native_channels",
            "native_messages",
            "settings",
            "migration_receipts",
        ] {
            assert_eq!(
                target
                    .db
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert!(source.join("room.sqlite").exists());
        assert_eq!(destination.join("backups").read_dir().unwrap().count(), 1);
    }
    #[test]
    fn import_preserves_source_and_unknown_appearance_and_refuses_overwrite() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("legacy");
        let dest = root.path().join("native");
        fs::create_dir(&src).unwrap();
        let mut profile = Profile::default();
        profile
            .retained
            .insert("avatar3d".into(), serde_json::json!({"hairStyle":"braids"}));
        let bytes = serde_json::to_vec(&profile).unwrap();
        fs::write(src.join("profile.json"), &bytes).unwrap();
        let nested = src.join("must-not-be-created");
        assert!(import_legacy(&src, &nested).is_err());
        assert!(!nested.exists());
        let report = import_legacy(&src, &dest).unwrap();
        assert!(report.profile_imported);
        assert_eq!(fs::read(src.join("profile.json")).unwrap(), bytes);
        assert_eq!(
            Store::open(&dest.join("voxy.sqlite"))
                .unwrap()
                .profile()
                .unwrap(),
            profile
        );
        assert!(import_legacy(&src, &dest).is_err());
    }
}
