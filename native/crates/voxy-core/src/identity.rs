use anyhow::{Context, Result, ensure};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

/// Persistent signing identity. Debug intentionally exposes no secret material.
pub struct Identity(SigningKey);
impl Identity {
    pub fn seal_local(bytes: &[u8]) -> Result<Vec<u8>> {
        ensure!(bytes.len() <= 131072, "Segredo local excede o limite");
        protect(bytes)
    }
    pub fn open_local(bytes: &[u8]) -> Result<Vec<u8>> {
        ensure!(bytes.len() <= 147456, "Segredo local excede o limite");
        unprotect(bytes)
    }
    pub fn generate() -> Self {
        Self(SigningKey::generate(&mut rand::rngs::OsRng))
    }
    pub fn public_key(&self) -> [u8; 32] {
        self.0.verifying_key().to_bytes()
    }
    pub fn sign(&self, message: &[u8]) -> [u8; 64] {
        self.0.sign(message).to_bytes()
    }
    pub fn verify(key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> Result<()> {
        VerifyingKey::from_bytes(key)?
            .verify(message, &Signature::from_bytes(signature))
            .context("Assinatura inválida")
    }
    pub fn load_or_create(path: &Path) -> Result<Self> {
        if path.exists() {
            let encoded = fs::read(path).context("Não foi possível abrir a identidade")?;
            ensure!(encoded.len() <= 16_384, "Identidade corrompida");
            let mut secret = unprotect(&encoded)?;
            ensure!(
                secret.len() == 32,
                "Identidade corrompida; restaure o backup"
            );
            let key: [u8; 32] = secret.as_slice().try_into()?;
            let identity = Self(SigningKey::from_bytes(&key));
            secret.fill(0);
            return Ok(identity);
        }
        let identity = Self::generate();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut secret = identity.0.to_bytes();
        let encoded = protect(&secret)?;
        secret.fill(0);
        // create_new prevents replacing a persistent identity on races.
        let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
        file.write_all(&encoded)?;
        file.sync_all()?;
        Ok(identity)
    }
}
#[cfg(windows)]
fn protect(bytes: &[u8]) -> Result<Vec<u8>> {
    crypt(bytes, true)
}
#[cfg(windows)]
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>> {
    crypt(bytes, false)
}
#[cfg(windows)]
fn crypt(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into()?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI owns output; LocalFree is required for both encryption and decryption.
    let succeeded = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    ensure!(
        succeeded != 0,
        "DPAPI indisponível; identidade não será substituída"
    );
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}
#[cfg(not(windows))]
fn protect(_: &[u8]) -> Result<Vec<u8>> {
    anyhow::bail!("Armazenamento de identidade disponível somente no Windows")
}
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>> {
    anyhow::bail!("Armazenamento de identidade disponível somente no Windows")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signatures_reject_tampering_and_other_identity() {
        let key = Identity::generate();
        let signed = key.sign(b"session:1");
        assert!(Identity::verify(&key.public_key(), b"session:1", &signed).is_ok());
        assert!(Identity::verify(&key.public_key(), b"session:2", &signed).is_err());
        assert!(
            Identity::verify(&Identity::generate().public_key(), b"session:1", &signed).is_err()
        );
    }
    #[cfg(windows)]
    #[test]
    fn dpapi_survives_reopen_and_never_overwrites_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("identity.bin");
        let key = Identity::load_or_create(&path).unwrap().public_key();
        assert_eq!(key, Identity::load_or_create(&path).unwrap().public_key());
        fs::write(&path, b"broken").unwrap();
        assert!(Identity::load_or_create(&path).is_err());
        assert_eq!(fs::read(path).unwrap(), b"broken");
    }
}
