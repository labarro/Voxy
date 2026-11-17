use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use voxy_core::identity::Identity;

pub const PROTOCOL: u16 = 3;
pub const MAX_INVITE_LIFETIME_MS: i64 = 7 * 24 * 60 * 60 * 1000;
// Senders issue 30s signals; accept at most 60s to accommodate the 30s admission clock skew.
pub const MAX_SIGNAL_LIFETIME_MS: i64 = 60_000;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invite {
    pub protocol: u16,
    pub room: Uuid,
    pub host_key: String,
    pub signal_url: String,
    pub capability: String,
    pub expires_at: i64,
    pub signature: String,
}
impl Invite {
    pub fn create(identity: &Identity, room: Uuid, url: &str, expires_at: i64) -> Result<Self> {
        let mut token = [0_u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut token);
        let mut invite = Self {
            protocol: PROTOCOL,
            room,
            host_key: URL_SAFE_NO_PAD.encode(identity.public_key()),
            signal_url: url.into(),
            capability: URL_SAFE_NO_PAD.encode(token),
            expires_at,
            signature: String::new(),
        };
        invite.validate_fields()?;
        invite.signature = URL_SAFE_NO_PAD.encode(identity.sign(&invite.transcript()?));
        Ok(invite)
    }
    fn transcript(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&(
            "voxy-invite-v3",
            self.protocol,
            self.room,
            &self.host_key,
            &self.signal_url,
            &self.capability,
            self.expires_at,
        ))?)
    }
    fn validate_fields(&self) -> Result<()> {
        ensure!(
            self.protocol == PROTOCOL && !self.room.is_nil(),
            "Protocolo ou sala inválidos"
        );
        ensure!(self.signal_url.len() <= 2048, "Endpoint excede o limite");
        let url = url::Url::parse(&self.signal_url)?;
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        ensure!(
            url.scheme() == "wss" || (url.scheme() == "ws" && local),
            "Sinalização pública exige WSS"
        );
        ensure!(
            url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
                && url.query().is_none()
                && url.path() == format!("/v3/{}", self.room),
            "Endpoint inválido"
        );
        ensure!(
            URL_SAFE_NO_PAD.decode(&self.capability)?.len() == 32,
            "Convite inválido"
        );
        Ok(())
    }
    pub fn encode(&self) -> Result<String> {
        Ok(format!(
            "voxy-native://join/{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?)
        ))
    }
    pub fn parse(value: &str, now: i64) -> Result<Self> {
        ensure!(value.len() <= 8192, "Convite excede o limite");
        let encoded = value
            .strip_prefix("voxy-native://join/")
            .or_else(|| value.strip_prefix("voxy://join/"))
            .context("Convite nativo inválido")?;
        let invite: Self = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded)?)?;
        invite.validate_fields()?;
        ensure!(invite.expires_at > now, "Convite expirado");
        ensure!(
            invite.expires_at <= now.saturating_add(MAX_INVITE_LIFETIME_MS),
            "Validade de convite excede sete dias"
        );
        let key: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&invite.host_key)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("Chave inválida"))?;
        let signature: [u8; 64] = URL_SAFE_NO_PAD
            .decode(&invite.signature)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("Assinatura inválida"))?;
        Identity::verify(&key, &invite.transcript()?, &signature)?;
        Ok(invite)
    }
}
/// Sign canonical signaling bytes, binding SDP fingerprint/ICE to room, peer and generation.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedSignal {
    pub room: Uuid,
    pub from: String,
    pub to: String,
    pub sequence: u64,
    pub expires_at: i64,
    pub session_nonce: String,
    pub payload: serde_json::Value,
    pub signature: String,
}
impl SignedSignal {
    fn transcript(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&(
            "voxy-signal-v3",
            self.room,
            &self.from,
            &self.to,
            self.sequence,
            self.expires_at,
            &self.session_nonce,
            &self.payload,
        ))?)
    }
    pub fn create(
        identity: &Identity,
        room: Uuid,
        to: String,
        sequence: u64,
        expires_at: i64,
        payload: serde_json::Value,
    ) -> Result<Self> {
        let mut signal = Self {
            room,
            from: URL_SAFE_NO_PAD.encode(identity.public_key()),
            to,
            sequence,
            expires_at,
            session_nonce: {
                let mut nonce = [0_u8; 16];
                rand::rngs::OsRng.fill_bytes(&mut nonce);
                URL_SAFE_NO_PAD.encode(nonce)
            },
            payload,
            signature: String::new(),
        };
        signal.signature = URL_SAFE_NO_PAD.encode(identity.sign(&signal.transcript()?));
        Ok(signal)
    }
    pub fn bind_session(mut self, identity: &Identity, nonce: &str) -> Result<Self> {
        ensure!(
            URL_SAFE_NO_PAD.decode(nonce)?.len() == 16,
            "Sessão de sinalização inválida"
        );
        self.session_nonce = nonce.into();
        self.signature = URL_SAFE_NO_PAD.encode(identity.sign(&self.transcript()?));
        Ok(self)
    }
    pub fn verify(
        &self,
        room: Uuid,
        expected_sender: &str,
        recipient: &str,
        previous: u64,
        now: i64,
    ) -> Result<()> {
        ensure!(
            self.room == room
                && self.from == expected_sender
                && self.to == recipient
                && self.sequence > previous
                && self.expires_at > now
                && self.expires_at <= now.saturating_add(MAX_SIGNAL_LIFETIME_MS),
            "Sinal fora da sessão, expirado ou repetido"
        );
        ensure!(self.transcript()?.len() <= 65_536, "Sinal excede o limite");
        ensure!(
            URL_SAFE_NO_PAD.decode(&self.session_nonce)?.len() == 16,
            "Sessão de sinalização inválida"
        );
        let key: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&self.from)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("Chave inválida"))?;
        let sig: [u8; 64] = URL_SAFE_NO_PAD
            .decode(&self.signature)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("Assinatura inválida"))?;
        Identity::verify(&key, &self.transcript()?, &sig)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invite_is_expiring_authenticated_and_does_not_contain_ip() {
        let key = Identity::generate();
        let room = Uuid::new_v4();
        let invite = Invite::create(
            &key,
            room,
            &format!("wss://signal.example.test/v3/{room}"),
            500,
        )
        .unwrap();
        let encoded = invite.encode().unwrap();
        assert!(Invite::parse(&encoded, 499).is_ok());
        assert!(Invite::parse(&encoded, 500).is_err());
        let mut modified = invite.clone();
        modified.signal_url = "wss://attacker.test".into();
        assert!(Invite::parse(&modified.encode().unwrap(), 0).is_err());
        assert!(Invite::create(&key, Uuid::new_v4(), "ws://public.test", 500).is_err());
    }
    #[test]
    fn signal_binds_payload_peer_session_sequence_and_deadline() {
        let id = Identity::generate();
        let room = Uuid::new_v4();
        let signal = SignedSignal::create(
            &id,
            room,
            "recipient".into(),
            1,
            200,
            serde_json::json!({"sdp":"fingerprint-bound"}),
        )
        .unwrap();
        assert!(
            signal
                .verify(room, &signal.from, "recipient", 0, 100)
                .is_ok()
        );
        assert!(
            signal
                .verify(room, &signal.from, "recipient", 1, 100)
                .is_err()
        );
        let mut modified = signal.clone();
        modified.payload = serde_json::json!({"sdp":"MITM"});
        assert!(
            modified
                .verify(room, &signal.from, "recipient", 0, 100)
                .is_err()
        );
    }
    #[test]
    fn endpoints_and_lifetimes_are_bounded_before_connecting() {
        let id = Identity::generate();
        let room = Uuid::new_v4();
        let endpoint = format!("wss://signal.example.test/v3/{room}");
        for url in [
            format!("{endpoint}?token=secret"),
            format!("{endpoint}#fragment"),
            "wss://signal.example.test/v3/another-room".into(),
            format!("wss://user:password@signal.example.test/v3/{room}"),
        ] {
            assert!(Invite::create(&id, room, &url, 1000).is_err());
        }
        let invite = Invite::create(&id, room, &endpoint, MAX_INVITE_LIFETIME_MS + 2).unwrap();
        assert!(Invite::parse(&invite.encode().unwrap(), 1).is_err());
        assert!(Invite::parse(&invite.encode().unwrap(), 2).is_ok());
        let mut signal = SignedSignal::create(
            &id,
            room,
            "recipient".into(),
            1,
            MAX_SIGNAL_LIFETIME_MS + 2,
            serde_json::json!({"candidate":{}}),
        )
        .unwrap();
        assert!(
            signal
                .verify(room, &signal.from, "recipient", 0, 1)
                .is_err()
        );
        signal.expires_at = 200;
        signal.session_nonce = "AA".into();
        signal.signature = URL_SAFE_NO_PAD.encode(id.sign(&signal.transcript().unwrap()));
        assert!(
            signal
                .verify(room, &signal.from, "recipient", 0, 1)
                .is_err()
        );
    }
}
