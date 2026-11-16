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
        let report = ImportReport {
            source_hash: source_hash.clone(),
            backup: backup.display().to_string(),
            profile_imported: true,
            messages_imported: 0,
            pending: vec![
                "Histórico/servidores/cargos/amigos/DMs preservados no backup, ainda sem conversão"
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
