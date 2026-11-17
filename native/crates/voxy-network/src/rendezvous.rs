//! Authenticated outbound WSS rendezvous. No bearer secrets in URLs or logs.
use crate::invite::Invite;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, protocol::WebSocketConfig},
};
use voxy_core::{identity::Identity, store::now_ms};
pub struct SignalSocket {
    inner: WebSocketStream<MaybeTlsStream<TcpStream>>,
    pub session_nonce: String,
}
#[derive(Clone)]
pub struct SignalSigner {
    nonce: String,
}
impl SignalSigner {
    pub fn sign(
        &self,
        identity: &Identity,
        room: uuid::Uuid,
        to: String,
        sequence: u64,
        expires_at: i64,
        payload: serde_json::Value,
    ) -> Result<crate::invite::SignedSignal> {
        crate::invite::SignedSignal::create(identity, room, to, sequence, expires_at, payload)?
            .bind_session(identity, &self.nonce)
    }
}
impl std::ops::Deref for SignalSocket {
    type Target = WebSocketStream<MaybeTlsStream<TcpStream>>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}
impl std::ops::DerefMut for SignalSocket {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}
impl SignalSocket {
    /// Revoke the previous capability without disconnecting the host signaling socket.
    /// The Worker validates the replacement host signature and acknowledges rotation.
    /// Existing guests are disconnected and must receive the replacement invitation.
    pub async fn rotate_invite(&mut self, replacement: &Invite, identity: &Identity) -> Result<()> {
        use futures_util::SinkExt;
        Invite::parse(&replacement.encode()?, now_ms())?;
        ensure!(
            replacement.host_key == URL_SAFE_NO_PAD.encode(identity.public_key()),
            "Somente o host pode renovar convites"
        );
        self.inner
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::json!({
                    "type": "rotate-invite",
                    "session_nonce": self.session_nonce,
                    "invite": replacement.encode()?,
                })
                .to_string()
                .into(),
            ))
            .await?;
        Ok(())
    }
    pub fn signer(&self) -> SignalSigner {
        SignalSigner {
            nonce: self.session_nonce.clone(),
        }
    }
    pub fn sign(
        &self,
        identity: &Identity,
        room: uuid::Uuid,
        to: String,
        sequence: u64,
        expires_at: i64,
        payload: serde_json::Value,
    ) -> Result<crate::invite::SignedSignal> {
        crate::invite::SignedSignal::create(identity, room, to, sequence, expires_at, payload)?
            .bind_session(identity, &self.session_nonce)
    }
}
pub async fn connect(invite: &Invite, identity: &Identity) -> Result<SignalSocket> {
    // Revalidate even programmatically constructed invites before any network I/O.
    Invite::parse(&invite.encode()?, now_ms())?;
    let mut request = invite.signal_url.as_str().into_client_request()?;
    let timestamp = now_ms();
    let key = URL_SAFE_NO_PAD.encode(identity.public_key());
    let mut nonce = [0_u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let nonce = URL_SAFE_NO_PAD.encode(nonce);
    let transcript = serde_json::to_vec(&(
        "voxy-admission-v3",
        invite.room,
        &invite.capability,
        &key,
        &nonce,
        timestamp,
    ))?;
    for (name, value) in [
        ("X-Voxy-Invite", invite.encode()?),
        ("X-Voxy-Peer", key),
        ("X-Voxy-Nonce", nonce.clone()),
        ("X-Voxy-Time", timestamp.to_string()),
        (
            "X-Voxy-Proof",
            URL_SAFE_NO_PAD.encode(identity.sign(&transcript)),
        ),
    ] {
        request
            .headers_mut()
            .insert(name, HeaderValue::from_str(&value)?);
    }
    let config = WebSocketConfig::default()
        .max_message_size(Some(65_536))
        .max_frame_size(Some(65_536));
    let (socket, response) = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        // Test-only DNS bypass: TLS still authenticates the original hostname.
        // Release builds cannot read this override or pin public service IPs.
        #[cfg(debug_assertions)]
        if let Ok(address) = std::env::var("VOXY_TEST_SIGNAL_ADDRESS") {
            let url = url::Url::parse(&invite.signal_url)?;
            ensure!(
                url.scheme() == "wss" && url.host_str() == Some("voxy.devbarros.com"),
                "DNS test override is restricted to the experimental endpoint"
            );
            let ip: std::net::IpAddr = address.parse()?;
            let stream = TcpStream::connect((ip, 443)).await?;
            stream.set_nodelay(true)?;
            return tokio_tungstenite::client_async_tls_with_config(
                request,
                stream,
                Some(config),
                None,
            )
            .await
            .map_err(anyhow::Error::from);
        }
        connect_async_with_config(request, Some(config), true)
            .await
            .map_err(anyhow::Error::from)
    })
    .await
    .context("A sinalização não respondeu em 8 s. Confira a conexão e tente novamente")??;
    ensure!(response.status() == 101, "A sinalização recusou a sessão");
    Ok(SignalSocket {
        inner: socket,
        session_nonce: nonce,
    })
}

/// Integration against local Worker emulator. Owns both peers and closes all paths.
pub async fn signaling_check(endpoint: &str) -> Result<serde_json::Value> {
    use crate::{
        invite::SignedSignal,
        peer::{Peer, PeerEvent},
        policy::NetworkPolicy,
    };
    use futures_util::{SinkExt, StreamExt};
    let room = uuid::Uuid::new_v4();
    let host = Identity::generate();
    let guest = Identity::generate();
    let host_key = URL_SAFE_NO_PAD.encode(host.public_key());
    let guest_key = URL_SAFE_NO_PAD.encode(guest.public_key());
    let invite = Invite::create(
        &host,
        room,
        &format!("{}/v3/{room}", endpoint.trim_end_matches('/')),
        now_ms() + 60000,
    )?;
    let mut hs = connect(&invite, &host).await?;
    let mut gs = connect(&invite, &guest).await?;
    let host_session = hs.session_nonce.clone();
    let guest_session = gs.session_nonce.clone();
    let host_signer = hs.signer();
    let guest_signer = gs.signer();
    let mut a = Peer::new(
        &NetworkPolicy {
            loopback_only: true,
            ..Default::default()
        },
        true,
    )
    .await?;
    let mut b = Peer::new(
        &NetworkPolicy {
            loopback_only: true,
            ..Default::default()
        },
        false,
    )
    .await?;
    let result = async {
        let offer = a.offer().await?;
        let mut a_sequence = 1;
        let mut b_sequence = 0;
        let mut a_received = 0;
        let mut b_received = 0;
        hs.send(tokio_tungstenite::tungstenite::Message::Text(
            serde_json::to_string(&host_signer.sign(
                &host,
                room,
                guest_key.clone(),
                a_sequence,
                now_ms() + 30000,
                serde_json::json!({"description":offer}),
            )?)?
            .into(),
        ))
        .await?;
        let mut pending_a = Vec::new();
        let mut pending_b = Vec::new();
        let mut payload_received = false;
        while !payload_received {
            tokio::select! {
                event=a.events.recv()=>match event{Some(PeerEvent::Ice(candidate))=>{a_sequence+=1;hs.send(serde_json::to_string(&host_signer.sign(&host,room,guest_key.clone(),a_sequence,now_ms()+30000,serde_json::json!({"candidate":candidate}))?)?.into()).await?;},Some(PeerEvent::DataOpen(channel))=>{channel.send_text("voxy-rendezvous-authenticated").await?;},None=>anyhow::bail!("Peer encerrado"),_=>{}},
                event=b.events.recv()=>match event{Some(PeerEvent::Ice(candidate))=>{b_sequence+=1;gs.send(serde_json::to_string(&guest_signer.sign(&guest,room,host_key.clone(),b_sequence,now_ms()+30000,serde_json::json!({"candidate":candidate}))?)?.into()).await?;},Some(PeerEvent::Data(data))=>{ensure!(data==b"voxy-rendezvous-authenticated","Payload divergente");payload_received=true;},None=>anyhow::bail!("Peer encerrado"),_=>{}},
                message=hs.next()=>{let message=message.ok_or_else(||anyhow::anyhow!("Sinalização desconectada"))??;if let Ok(text)=message.to_text(){let value:serde_json::Value=serde_json::from_str(text)?;if value.get("type").is_some(){continue}let signal:SignedSignal=serde_json::from_value(value)?;ensure!(signal.session_nonce==guest_session,"Sinal de outra sessão");signal.verify(room,&guest_key,&host_key,a_received,now_ms())?;a_received=signal.sequence;
                    if let Some(description)=signal.payload.get("description"){a.connection.set_remote_description(serde_json::from_value(description.clone())?).await?;for candidate in pending_a.drain(..){a.connection.add_ice_candidate(candidate).await?;}}
                    else if let Some(candidate)=signal.payload.get("candidate"){let candidate=serde_json::from_value(candidate.clone())?;if a.connection.remote_description().await.is_some(){a.connection.add_ice_candidate(candidate).await?;}else{ensure!(pending_a.len()<128,"Muitos candidatos pendentes");pending_a.push(candidate);}}
                }},
                message=gs.next()=>{let message=message.ok_or_else(||anyhow::anyhow!("Sinalização desconectada"))??;if let Ok(text)=message.to_text(){let value:serde_json::Value=serde_json::from_str(text)?;if value.get("type").is_some(){continue}let signal:SignedSignal=serde_json::from_value(value)?;ensure!(signal.session_nonce==host_session,"Sinal de outra sessão");signal.verify(room,&host_key,&guest_key,b_received,now_ms())?;b_received=signal.sequence;
                    if let Some(description)=signal.payload.get("description"){let answer=b.answer(serde_json::from_value(description.clone())?).await?;for candidate in pending_b.drain(..){b.connection.add_ice_candidate(candidate).await?;}b_sequence+=1;gs.send(serde_json::to_string(&guest_signer.sign(&guest,room,host_key.clone(),b_sequence,now_ms()+30000,serde_json::json!({"description":answer}))?)?.into()).await?;}
                    else if let Some(candidate)=signal.payload.get("candidate"){let candidate=serde_json::from_value(candidate.clone())?;if b.connection.remote_description().await.is_some(){b.connection.add_ice_candidate(candidate).await?;}else{ensure!(pending_b.len()<128,"Muitos candidatos pendentes");pending_b.push(candidate);}}
                }}
            }
        }
        Ok::<_, anyhow::Error>(
            serde_json::json!({"authenticatedSignaling":true,"signedSdpIce":true,"payloadReceived":true,"endpointKind":if is_loopback_endpoint(endpoint){"local-emulator"}else{"public"},"bothPeersOnThisMachine":true,"mediaPathValidated":false,"relay":false}),
        )
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(20), result).await;
    let _ = a.close().await;
    let _ = b.close().await;
    let _ = hs.close(None).await;
    let _ = gs.close(None).await;
    result.map_err(|_| anyhow::anyhow!("Negociação com sinalização excedeu 20 segundos"))?
}

/// Labels diagnostics only; never used for authorization decisions.
fn is_loopback_endpoint(endpoint: &str) -> bool {
    let rest = endpoint.split("://").nth(1).unwrap_or(endpoint);
    rest.starts_with("[::1]")
        || matches!(
            rest.split(['/', ':']).next().unwrap_or_default(),
            "127.0.0.1" | "localhost"
        )
}
