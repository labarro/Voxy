//! Offline trust adapter for the existing signed v1 update catalog.
//! No networking, installation, channel switching or modification of the stable updater.
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use std::{fs::File, io::Read, path::Path};

pub const MAX_CATALOG_BYTES: usize = 1024 * 1024;
pub const MAX_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustConfig {
    pub schema: u32,
    pub repository: String,
    pub endpoint: String,
    pub public_keys: Vec<String>,
    pub authenticode_publisher: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReleasePost {
    pub version: String,
    pub date: String,
    pub title: String,
    pub items: Vec<String>,
    pub features: Vec<String>,
    pub improvements: Vec<String>,
    pub fixes: Vec<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReleaseFile {
    pub name: String,
    pub sha512: String,
    pub size: u64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedRelease {
    pub schema: u32,
    pub channel: String,
    pub version: String,
    pub date: String,
    pub repository: String,
    pub files: Vec<ReleaseFile>,
    pub manifest_sha512: String,
    pub releases: Vec<ReleasePost>,
}
/// Construction requires successful signature and schema verification.
#[derive(Debug)]
pub struct VerifiedRelease(SignedRelease);
impl VerifiedRelease {
    pub fn release(&self) -> &SignedRelease {
        &self.0
    }
    /// Reject rollback below the installed version or the highest previously
    /// authenticated catalog. Equality is valid for checks, but not an upgrade.
    pub fn is_upgrade(&self, installed: &str, highest_verified: Option<&str>) -> Result<bool> {
        let candidate = version(&self.0.version)?;
        let installed = version(installed)?;
        ensure!(
            candidate >= installed,
            "Atualização inferior à versão instalada"
        );
        if let Some(previous) = highest_verified {
            ensure!(candidate >= version(previous)?, "Catálogo antigo bloqueado");
        }
        Ok(candidate > installed)
    }
    pub fn artifact_url(&self, name: &str) -> Result<String> {
        ensure!(
            self.0.files.iter().any(|file| file.name == name),
            "Arquivo não consta do catálogo assinado"
        );
        Ok(format!(
            "https://github.com/{}/releases/download/v{}/{}",
            self.0.repository, self.0.version, name
        ))
    }
    pub fn verify_manifest(&self, bytes: &[u8]) -> Result<()> {
        ensure!(
            bytes.len() <= MAX_CATALOG_BYTES,
            "Manifesto excede o limite"
        );
        ensure!(
            STANDARD.encode(Sha512::digest(bytes)) == self.0.manifest_sha512,
            "Manifesto adulterado"
        );
        Ok(())
    }
    /// Reads an existing staged file only. A later installer must reverify at
    /// its own installation boundary; this adapter does not grant installation.
    pub fn verify_artifact(&self, name: &str, path: &Path) -> Result<()> {
        let expected = self
            .0
            .files
            .iter()
            .find(|file| file.name == name)
            .context("Arquivo não autorizado")?;
        ensure!(
            path.file_name().and_then(|name| name.to_str()) == Some(name),
            "Nome do artefato divergente"
        );
        ensure!(
            !std::fs::symlink_metadata(path)?.file_type().is_symlink(),
            "Artefato não pode ser link simbólico"
        );
        let mut file = File::open(path)?;
        let metadata = file.metadata()?;
        ensure!(
            metadata.is_file() && metadata.len() == expected.size,
            "Tamanho do artefato divergente"
        );
        let mut hash = Sha512::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            total += count as u64;
            ensure!(
                total <= expected.size && total <= MAX_ARTIFACT_BYTES,
                "Artefato excede o limite"
            );
            hash.update(&buffer[..count]);
        }
        ensure!(
            total == expected.size && STANDARD.encode(hash.finalize()) == expected.sha512,
            "Integridade do artefato inválida"
        );
        Ok(())
    }
}
#[derive(Deserialize)]
struct Envelope {
    payload: String,
    signature: String,
}

pub fn verify_envelope(bytes: &[u8], trust: &TrustConfig) -> Result<VerifiedRelease> {
    ensure!(bytes.len() <= MAX_CATALOG_BYTES, "Catálogo excede o limite");
    ensure!(
        trust.schema == 1 && valid_repository(&trust.repository),
        "Configuração de confiança inválida"
    );
    ensure!(
        !trust.public_keys.is_empty() && trust.public_keys.len() <= 32,
        "Nenhuma chave de atualização confiável"
    );
    let envelope: Envelope = serde_json::from_slice(bytes)?;
    let payload = canonical_base64(&envelope.payload, MAX_CATALOG_BYTES)?;
    let signature = canonical_base64(&envelope.signature, 64)?;
    let signature = Signature::from_slice(&signature).context("Assinatura inválida")?;
    ensure!(
        trust.public_keys.iter().any(|pem| {
            public_key(pem).is_ok_and(|key| key.verify_strict(&payload, &signature).is_ok())
        }),
        "Assinatura da atualização inválida"
    );
    let release: SignedRelease = serde_json::from_slice(&payload)?;
    ensure!(
        release.schema == 1 && release.channel == "stable",
        "Canal de atualização incompatível"
    );
    version(&release.version)?;
    ensure!(
        valid_date(&release.date) && release.repository == trust.repository,
        "Catálogo pertence a outro aplicativo ou tem data inválida"
    );
    let installer = format!("Voxy-Setup-{}-x64.exe", release.version);
    ensure!(
        release.files.len() == 2,
        "Catálogo exige instalador e blockmap"
    );
    ensure!(
        release.files.iter().filter(|f| f.name == installer).count() == 1
            && release
                .files
                .iter()
                .filter(|f| f.name == format!("{installer}.blockmap"))
                .count()
                == 1,
        "Nomes de artefatos inconsistentes"
    );
    for file in &release.files {
        ensure!(
            (1..=MAX_ARTIFACT_BYTES).contains(&file.size),
            "Tamanho de arquivo inválido"
        );
        ensure!(
            canonical_base64(&file.sha512, 64)?.len() == 64,
            "Hash de arquivo inválido"
        );
    }
    ensure!(
        canonical_base64(&release.manifest_sha512, 64)?.len() == 64,
        "Hash de manifesto inválido"
    );
    ensure!(
        release.releases.len() <= 100
            && release
                .releases
                .iter()
                .any(|post| post.version == release.version),
        "Notas da versão ausentes"
    );
    for post in &release.releases {
        version(&post.version)?;
        ensure!(
            valid_date(&post.date) && post.title.encode_utf16().count() <= 200,
            "Notas inválidas"
        );
        for items in [&post.items, &post.features, &post.improvements, &post.fixes] {
            ensure!(
                items.len() <= 100 && items.iter().all(|item| item.encode_utf16().count() <= 2000),
                "Notas excedem os limites"
            );
        }
    }
    Ok(VerifiedRelease(release))
}
fn canonical_base64(value: &str, limit: usize) -> Result<Vec<u8>> {
    ensure!(
        value.len() <= limit.div_ceil(3) * 4,
        "Campo codificado excede o limite"
    );
    let decoded = STANDARD.decode(value)?;
    ensure!(
        decoded.len() <= limit && STANDARD.encode(&decoded) == value,
        "Base64 não canônico"
    );
    Ok(decoded)
}
fn public_key(pem: &str) -> Result<VerifyingKey> {
    // RFC 8410 SubjectPublicKeyInfo for Ed25519: exact OID, no parameters,
    // 256-bit BIT STRING. Other algorithms and private keys are rejected.
    let contents = pem
        .trim()
        .strip_prefix("-----BEGIN PUBLIC KEY-----")
        .and_then(|s| s.strip_suffix("-----END PUBLIC KEY-----"))
        .context("Chave PEM inválida")?;
    ensure!(contents.len() <= 256, "Chave PEM excede o limite");
    let encoded: String = contents
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    let der = canonical_base64(&encoded, 44)?;
    const PREFIX: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    ensure!(
        der.len() == 44 && der[..12] == PREFIX,
        "Chave deve ser Ed25519 SPKI"
    );
    Ok(VerifyingKey::from_bytes(der[12..].try_into()?)?)
}
fn version(value: &str) -> Result<[u64; 3]> {
    let parts: Vec<_> = value.split('.').collect();
    ensure!(parts.len() == 3, "Versão estável inválida");
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        ensure!(
            !part.is_empty()
                && part.bytes().all(|c| c.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0')),
            "Versão estável inválida"
        );
        result[index] = part.parse()?;
    }
    Ok(result)
}
fn valid_repository(repository: &str) -> bool {
    let parts: Vec<_> = repository.split('/').collect();
    repository.len() <= 200
        && parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && *part != "."
                && *part != ".."
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        })
}
fn valid_date(value: &str) -> bool {
    if value.len() != 10
        || !value.is_ascii()
        || &value[4..5] != "-"
        || &value[7..8] != "-"
        || !value
            .bytes()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let Ok(year) = value[..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<usize>() else {
        return false;
    };
    let Ok(day) = value[8..].parse::<u32>() else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    (1..=12).contains(&month) && day >= 1 && day <= days[month - 1]
}
/// Applies to every redirect as well as the initial metadata URL. Signed asset
/// paths are generated separately by artifact_url; redirects are capped at five.
pub fn validate_transport_url(url: &str, trust: &TrustConfig, redirects: u8) -> Result<()> {
    ensure!(redirects <= 5, "Redirecionamentos excedem o limite");
    let host = https_host(url)?;
    let endpoint = https_host(&trust.endpoint)?;
    ensure!(
        [
            endpoint,
            "github.com",
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com"
        ]
        .contains(&host),
        "Endereço de atualização não autorizado"
    );
    Ok(())
}
fn https_host(url: &str) -> Result<&str> {
    ensure!(
        url.len() <= 16_384
            && !url.contains(['\\', '#'])
            && !url.chars().any(|c| c.is_control() || c.is_whitespace()),
        "URL inválida"
    );
    let rest = url
        .strip_prefix("https://")
        .context("Atualização exige HTTPS")?;
    let authority = rest.split('/').next().context("Host ausente")?;
    let host = authority.strip_suffix(":443").unwrap_or(authority);
    ensure!(
        !host.is_empty()
            && !host.starts_with('.')
            && !host.ends_with('.')
            && !host.contains("..")
            && host
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b".-".contains(&c)),
        "Host de atualização inválido"
    );
    Ok(host)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../tests/fixtures/update-node.json")).unwrap()
    }
    fn trust(fixture: &serde_json::Value) -> TrustConfig {
        serde_json::from_value(fixture["trust"].clone()).unwrap()
    }
    fn signed_modified(modify: impl FnOnce(&mut serde_json::Value)) -> (Vec<u8>, TrustConfig) {
        let fixture = fixture();
        let mut trust = trust(&fixture);
        let release =
            verify_envelope(fixture["valid"].as_str().unwrap().as_bytes(), &trust).unwrap();
        let mut value = serde_json::to_value(release.release()).unwrap();
        modify(&mut value);
        // Fixed TEST-ONLY seed; unrelated to any production signing identity.
        let key = SigningKey::from_bytes(&[42; 32]);
        let mut der = vec![
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0,
        ];
        der.extend_from_slice(key.verifying_key().as_bytes());
        trust.public_keys = vec![format!(
            "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----",
            STANDARD.encode(der)
        )];
        let payload = serde_json::to_vec(&value).unwrap();
        let signature = key.sign(&payload);
        (serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(&payload),"signature":STANDARD.encode(signature.to_bytes())})).unwrap(),trust)
    }
    #[test]
    fn node_legacy_oracle_signature_and_artifact_urls_match() {
        let fixture = fixture();
        let trust = trust(&fixture);
        let verified =
            verify_envelope(fixture["valid"].as_str().unwrap().as_bytes(), &trust).unwrap();
        assert_eq!(verified.release().version, fixture["verifiedVersion"]);
        let name = &verified.release().files[0].name;
        assert_eq!(verified.artifact_url(name).unwrap(), fixture["artifactUrl"]);
        assert!(verified.artifact_url("../installer.exe").is_err());
        for field in ["tampered", "traversal"] {
            assert!(verify_envelope(fixture[field].as_str().unwrap().as_bytes(), &trust).is_err());
        }
        let mut wrong_repository = trust.clone();
        wrong_repository.repository = "other/application".into();
        assert!(
            verify_envelope(
                fixture["valid"].as_str().unwrap().as_bytes(),
                &wrong_repository
            )
            .is_err()
        );
    }
    #[test]
    fn rollback_protection_includes_highest_verified_even_above_installed() {
        let fixture = fixture();
        let verified = verify_envelope(
            fixture["valid"].as_str().unwrap().as_bytes(),
            &trust(&fixture),
        )
        .unwrap();
        assert!(verified.is_upgrade("2.0.0", Some("2.0.1")).unwrap());
        assert!(!verified.is_upgrade("2.0.1", None).unwrap());
        assert!(verified.is_upgrade("2.0.2", None).is_err());
        assert!(verified.is_upgrade("2.0.0", Some("2.0.2")).is_err());
        assert!(verified.is_upgrade("2.0.0-alpha.1", None).is_err());
        assert!(version("02.0.1").is_err());
    }
    #[test]
    fn signed_but_invalid_schema_cannot_authorize_artifacts() {
        for modify in [
            |v: &mut serde_json::Value| v["channel"] = "experimental".into(),
            |v: &mut serde_json::Value| v["version"] = "2.0.1-beta".into(),
            |v: &mut serde_json::Value| v["files"][0]["size"] = (MAX_ARTIFACT_BYTES + 1).into(),
            |v: &mut serde_json::Value| v["files"][0]["name"] = "C:\\temp\\installer.exe".into(),
            |v: &mut serde_json::Value| v["files"][0]["sha512"] = "AAAA".into(),
            |v: &mut serde_json::Value| v["date"] = "2026-02-29".into(),
            |v: &mut serde_json::Value| v["date"] = "ééééé".into(),
            |v: &mut serde_json::Value| v["releases"] = serde_json::json!([]),
        ] {
            let (envelope, trust) = signed_modified(modify);
            assert!(verify_envelope(&envelope, &trust).is_err());
        }
        let (envelope, trust) = signed_modified(|_| {});
        assert!(verify_envelope(&envelope, &trust).is_ok());
        assert!(verify_envelope(&vec![b' '; MAX_CATALOG_BYTES + 1], &trust).is_err());
        assert!(valid_date("2024-02-29"));
        assert!(!valid_date("2025-02-29"));
    }
    #[test]
    fn staged_files_and_manifest_are_verified_without_execution() {
        let fixture = fixture();
        let verified = verify_envelope(
            fixture["valid"].as_str().unwrap().as_bytes(),
            &trust(&fixture),
        )
        .unwrap();
        assert!(
            verified
                .verify_manifest(fixture["manifest"].as_str().unwrap().as_bytes())
                .is_ok()
        );
        assert!(verified.verify_manifest(b"modified").is_err());
        let directory = tempfile::tempdir().unwrap();
        let name = &verified.release().files[0].name;
        let path = directory.path().join(name);
        let contents = fixture["artifact"].as_str().unwrap().as_bytes();
        std::fs::write(&path, contents).unwrap();
        verified.verify_artifact(name, &path).unwrap();
        std::fs::write(&path, vec![b'x'; contents.len()]).unwrap();
        assert!(verified.verify_artifact(name, &path).is_err());
        std::fs::write(&path, b"truncated").unwrap();
        assert!(verified.verify_artifact(name, &path).is_err());
        assert!(
            verified
                .verify_artifact("../../installer.exe", &path)
                .is_err()
        );
    }
    #[test]
    fn every_redirect_requires_exact_https_allowlisted_host() {
        let fixture = fixture();
        let trust = trust(&fixture);
        for url in [
            "https://example.invalid/updates/voxy-release.json",
            "https://github.com:443/example/file",
            "https://release-assets.githubusercontent.com/asset?token=fixture",
        ] {
            validate_transport_url(url, &trust, 5).unwrap();
        }
        for url in [
            "http://github.com/file",
            "https://github.com.evil.invalid/file",
            "https://github.com@evil.invalid/file",
            "https://evil.invalid@github.com/file",
            "https://github.com:444/file",
            "https://github.com\\@evil.invalid/file",
            "https://github.com/%0a/file#fragment",
            "https://github.com./file",
            "https://github.com\n/file",
        ] {
            assert!(validate_transport_url(url, &trust, 0).is_err(), "{url}");
        }
        assert!(validate_transport_url("https://github.com/file", &trust, 6).is_err());
    }
}
