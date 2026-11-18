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
        let invite = Self::parse_signed(value)?;
        ensure!(invite.expires_at > now, "Convite expirado");
        ensure!(
            invite.expires_at <= now.saturating_add(MAX_INVITE_LIFETIME_MS),
            "Validade de convite excede sete dias"
        );
        Ok(invite)
    }
    /// Authenticity only (host signature, fields), not expiry. A saved server uses
    /// it to learn room/host/endpoint when a member pass, not the invite, admits it.
    pub fn parse_signed(value: &str) -> Result<Self> {
        ensure!(value.len() <= 8192, "Convite excede o limite");
        let encoded = value
            .strip_prefix("voxy-native://join/")
            .or_else(|| value.strip_prefix("voxy://join/"))
            .context("Convite nativo inválido")?;
        let invite: Self = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded)?)?;
        invite.validate_fields()?;
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
/// Longest member pass the signaling service accepts, and the lifetime issued.
/// Every reconnection while the host is online issues a fresh pass.
pub const MAX_PASS_LIFETIME_MS: i64 = 180 * 24 * 60 * 60 * 1000;
pub const PASS_LIFETIME_MS: i64 = 150 * 24 * 60 * 60 * 1000;
/// Host-signed proof that `member_key` was admitted to `room`. It lets a member
/// reconnect to a saved server after the invite expired or rotated, and only
/// that member: the admission proof must be signed by `member_key`. Raising the
/// room's epoch (on the host) revokes every older pass.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemberPass {
    pub protocol: u16,
    pub room: Uuid,
    pub host_key: String,
    pub signal_url: String,
    pub member_key: String,
    pub epoch: u64,
    pub expires_at: i64,
    pub signature: String,
}
impl MemberPass {
    pub fn create(
        host: &Identity,
        invite: &Invite,
        member_key: &str,
        epoch: u64,
        expires_at: i64,
    ) -> Result<Self> {
        ensure!(
            invite.host_key == URL_SAFE_NO_PAD.encode(host.public_key()),
            "Somente o host emite acessos"
        );
        let mut pass = Self {
            protocol: PROTOCOL,
            room: invite.room,
            host_key: invite.host_key.clone(),
            signal_url: invite.signal_url.clone(),
            member_key: member_key.into(),
            epoch,
            expires_at,
            signature: String::new(),
        };
        pass.validate_fields()?;
        pass.signature = URL_SAFE_NO_PAD.encode(host.sign(&pass.transcript()?));
        Ok(pass)
    }
    fn transcript(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&(
            "voxy-member-pass-v1",
            self.protocol,
            self.room,
            &self.host_key,
            &self.signal_url,
            &self.member_key,
            self.epoch,
            self.expires_at,
        ))?)
    }
    fn validate_fields(&self) -> Result<()> {
        ensure!(
            self.protocol == PROTOCOL && !self.room.is_nil() && self.epoch <= 1_000_000,
            "Acesso salvo inválido"
        );
        // Same endpoint rules as invites: WSS, bound to this room, no credentials.
        let probe = Invite {
            protocol: PROTOCOL,
            room: self.room,
            host_key: self.host_key.clone(),
            signal_url: self.signal_url.clone(),
            capability: URL_SAFE_NO_PAD.encode([0_u8; 32]),
            expires_at: self.expires_at,
            signature: String::new(),
        };
        probe.validate_fields()?;
        ensure!(
            URL_SAFE_NO_PAD.decode(&self.member_key)?.len() == 32
                && URL_SAFE_NO_PAD.decode(&self.host_key)?.len() == 32,
            "Acesso salvo inválido"
        );
        Ok(())
    }
    pub fn encode(&self) -> Result<String> {
        Ok(format!(
            "voxy-pass:{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?)
        ))
    }
    pub fn parse(value: &str, now: i64) -> Result<Self> {
        ensure!(value.len() <= 4096, "Acesso salvo excede o limite");
        let encoded = value
            .strip_prefix("voxy-pass:")
            .context("Acesso salvo inválido")?;
        let pass: Self = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded)?)?;
        pass.validate_fields()?;
        ensure!(pass.expires_at > now, "Acesso salvo expirado");
        ensure!(
            pass.expires_at <= now.saturating_add(MAX_PASS_LIFETIME_MS),
            "Validade do acesso salvo excede o limite"
        );
        let key: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&pass.host_key)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("Chave inválida"))?;
        let signature: [u8; 64] = URL_SAFE_NO_PAD
            .decode(&pass.signature)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("Assinatura inválida"))?;
        Identity::verify(&key, &pass.transcript()?, &signature)?;
        Ok(pass)
    }
}

/// Crockford base32 without I, L, O, U: 8 symbols (40 bits), shown as XXXX-XXXX.
const CODE_ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub fn normalize_code(raw: &str) -> Option<String> {
    let value: String = raw
        .chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .map(|c| match c.to_ascii_uppercase() {
            'I' | 'L' => '1',
            'O' => '0',
            other => other,
        })
        .collect();
    (value.len() == 8 && value.chars().all(|c| CODE_ALPHABET.contains(c)))
        .then(|| format!("{}-{}", &value[..4], &value[4..]))
}
/// A short code typed by hand, a share link (`https://<signal host>/join/CODE`)
/// or `voxy-native://code/CODE`. Returns the signaling base for the link's own
/// host only when it is the trusted endpoint; bare codes use `default_endpoint`.
pub fn code_from_input(input: &str, default_endpoint: &str) -> Option<(String, String)> {
    let input = input.trim();
    if input.starts_with("voxy-native://join/") || input.starts_with("voxy://join/") {
        return None;
    }
    if let Some(code) = input.strip_prefix("voxy-native://code/") {
        return normalize_code(code.trim_end_matches('/')).map(|c| (default_endpoint.into(), c));
    }
    if let Ok(url) = url::Url::parse(input)
        && matches!(url.scheme(), "https" | "http")
    {
        let trusted = url::Url::parse(default_endpoint).ok()?;
        // Plain http links only for a local (ws://) test endpoint.
        if url.scheme() == "http" && trusted.scheme() != "ws" {
            return None;
        }
        // A link never redirects the client to an arbitrary signaling server.
        if url.host_str() != trusted.host_str() || url.port() != trusted.port() {
            return None;
        }
        let code = url.path().strip_prefix("/join/")?;
        return normalize_code(code.trim_end_matches('/')).map(|c| (default_endpoint.into(), c));
    }
    normalize_code(input).map(|c| (default_endpoint.into(), c))
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
    fn member_pass_is_host_signed_member_bound_and_survives_invite_expiry() {
        let host = Identity::generate();
        let member = Identity::generate();
        let room = Uuid::new_v4();
        let invite = Invite::create(
            &host,
            room,
            &format!("wss://signal.example.test/v3/{room}"),
            1_000,
        )
        .unwrap();
        let member_key = URL_SAFE_NO_PAD.encode(member.public_key());
        let pass = MemberPass::create(&host, &invite, &member_key, 2, 5_000).unwrap();
        let encoded = pass.encode().unwrap();
        // The invite has expired; the saved pass and the signed invite still identify the server.
        assert!(Invite::parse(&invite.encode().unwrap(), 2_000).is_err());
        assert_eq!(
            Invite::parse_signed(&invite.encode().unwrap())
                .unwrap()
                .room,
            room
        );
        assert_eq!(MemberPass::parse(&encoded, 2_000).unwrap(), pass);
        assert!(MemberPass::parse(&encoded, 5_000).is_err(), "expired");
        // Only the host can issue, and no field can be altered after signing.
        assert!(MemberPass::create(&member, &invite, &member_key, 0, 5_000).is_err());
        for tamper in [
            |p: &mut MemberPass| p.epoch = 3,
            |p: &mut MemberPass| p.member_key = URL_SAFE_NO_PAD.encode([7u8; 32]),
            |p: &mut MemberPass| p.expires_at += 1,
        ] {
            let mut modified = pass.clone();
            tamper(&mut modified);
            assert!(MemberPass::parse(&modified.encode().unwrap(), 2_000).is_err());
        }
        // Transcript is the exact JSON array the Worker verifies.
        assert_eq!(
            String::from_utf8(pass.transcript().unwrap()).unwrap(),
            format!(
                "[\"voxy-member-pass-v1\",3,\"{room}\",\"{}\",\"wss://signal.example.test/v3/{room}\",\"{member_key}\",2,5000]",
                invite.host_key
            )
        );
    }
    #[test]
    fn short_codes_and_links_are_normalized_and_bound_to_the_trusted_host() {
        let base = "wss://voxy.devbarros.com";
        assert_eq!(normalize_code("k7fx m9pq").as_deref(), Some("K7FX-M9PQ"));
        assert_eq!(normalize_code("K7FX-M9PO").as_deref(), Some("K7FX-M9P0"));
        assert_eq!(normalize_code("K7FX-M9P"), None);
        assert_eq!(normalize_code("K7FX-M9PU"), None);
        for input in [
            "K7FX-M9PQ",
            "https://voxy.devbarros.com/join/K7FX-M9PQ",
            "voxy-native://code/k7fxm9pq",
        ] {
            assert_eq!(
                code_from_input(input, base),
                Some((base.into(), "K7FX-M9PQ".into())),
                "{input}"
            );
        }
        assert_eq!(
            code_from_input("https://evil.example/join/K7FX-M9PQ", base),
            None
        );
        assert_eq!(code_from_input("voxy-native://join/abc", base), None);
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
