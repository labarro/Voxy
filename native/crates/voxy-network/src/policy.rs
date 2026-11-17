use anyhow::{Result, ensure};
use std::time::{Duration, Instant};

pub use voxy_core::links::{DEFAULT_SIGNAL_ENDPOINT, DEFAULT_STUN_URL};

/// Relay stays disabled until a provider-side billing cutoff has been verified.
/// A client byte counter is deliberately NOT accepted as a financial safety boundary.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct NetworkPolicy {
    pub stun_urls: Vec<String>,
    pub relay_enabled: bool,
}
impl NetworkPolicy {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.relay_enabled,
            "TURN bloqueado: corte financeiro do provedor ainda não homologado"
        );
        ensure!(
            self.stun_urls.len() <= 4
                && self
                    .stun_urls
                    .iter()
                    .all(|u| u.len() <= 256 && (u.starts_with("stun:") || u.starts_with("stuns:"))),
            "Configuração STUN inválida"
        );
        Ok(())
    }
}
pub struct RateLimit {
    tokens: f64,
    capacity: f64,
    per_second: f64,
    last: Instant,
}
impl RateLimit {
    pub fn new(capacity: u32, per_second: u32) -> Self {
        Self {
            tokens: capacity as f64,
            capacity: capacity as f64,
            per_second: per_second as f64,
            last: Instant::now(),
        }
    }
    pub fn allow(&mut self) -> bool {
        self.at(Instant::now())
    }
    pub fn at(&mut self, now: Instant) -> bool {
        self.tokens = (self.tokens
            + now.saturating_duration_since(self.last).as_secs_f64() * self.per_second)
            .min(self.capacity);
        self.last = now;
        if self.tokens < 1.0 {
            false
        } else {
            self.tokens -= 1.0;
            true
        }
    }
}
pub fn reconnect_delay(attempt: u32) -> Duration {
    Duration::from_millis((500_u64.saturating_mul(1_u64 << attempt.min(4))).min(6_000))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relay_cannot_be_enabled_by_configuration_and_rate_limits_recover() {
        assert!(
            NetworkPolicy {
                stun_urls: vec![],
                relay_enabled: true
            }
            .validate()
            .is_err()
        );
        let mut rate = RateLimit::new(2, 1);
        let now = Instant::now();
        assert!(rate.at(now));
        assert!(rate.at(now));
        assert!(!rate.at(now));
        assert!(rate.at(now + Duration::from_secs(1)));
        assert_eq!(reconnect_delay(100), Duration::from_secs(6));
    }
}
