use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
const CHUNK: usize = 10_000;
const MAX: usize = 2 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Frame {
    id: uuid::Uuid,
    index: usize,
    total: usize,
    hash: String,
    data: String,
}
pub fn encode(bytes: &[u8]) -> Result<Vec<String>> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX,
        "Mensagem excede o limite"
    );
    let id = uuid::Uuid::new_v4();
    let hash = format!("{:x}", Sha256::digest(bytes));
    let total = bytes.len().div_ceil(CHUNK);
    bytes
        .chunks(CHUNK)
        .enumerate()
        .map(|(index, chunk)| {
            Ok(serde_json::to_string(&Frame {
                id,
                index,
                total,
                hash: hash.clone(),
                data: STANDARD.encode(chunk),
            })?)
        })
        .collect()
}
struct Partial {
    id: uuid::Uuid,
    total: usize,
    index: usize,
    hash: String,
    data: Vec<u8>,
    started: Instant,
}
#[derive(Default)]
pub struct Assembler {
    pending: Option<Partial>,
}
impl Assembler {
    pub fn push(&mut self, raw: &[u8]) -> Result<Option<Vec<u8>>> {
        let result = (|| {
            ensure!(raw.len() <= 16_384, "Frame excede o limite");
            let frame: Frame = serde_json::from_slice(raw)?;
            ensure!(
                frame.total > 0
                    && frame.total <= MAX.div_ceil(CHUNK)
                    && frame.index < frame.total
                    && frame.hash.len() == 64,
                "Frame inválido"
            );
            let chunk = STANDARD.decode(&frame.data)?;
            ensure!(!chunk.is_empty() && chunk.len() <= CHUNK, "Chunk inválido");
            if frame.index == 0 {
                ensure!(self.pending.is_none(), "Transferência anterior incompleta");
                self.pending = Some(Partial {
                    id: frame.id,
                    total: frame.total,
                    index: 0,
                    hash: frame.hash.clone(),
                    data: Vec::with_capacity((frame.total * CHUNK).min(MAX)),
                    started: Instant::now(),
                });
            }
            let partial = self
                .pending
                .as_mut()
                .ok_or_else(|| anyhow::anyhow!("Primeiro frame ausente"))?;
            ensure!(
                partial.id == frame.id
                    && partial.total == frame.total
                    && partial.index == frame.index
                    && partial.hash == frame.hash
                    && partial.started.elapsed() < Duration::from_secs(10),
                "Frame fora de ordem ou expirado"
            );
            ensure!(
                partial.data.len() + chunk.len() <= MAX,
                "Mensagem excede o limite"
            );
            partial.data.extend(chunk);
            partial.index += 1;
            if partial.index == partial.total {
                ensure!(
                    format!("{:x}", Sha256::digest(&partial.data)) == partial.hash,
                    "Hash divergente"
                );
                return Ok(Some(self.pending.take().unwrap().data));
            }
            Ok(None)
        })();
        if result.is_err() {
            self.pending = None;
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunked_state_is_bounded_and_tampering_clears_partial() {
        let data = vec![123; 120_000];
        let frames = encode(&data).unwrap();
        let mut assembler = Assembler::default();
        let mut received = None;
        for frame in &frames {
            if let Some(bytes) = assembler.push(frame.as_bytes()).unwrap() {
                received = Some(bytes)
            }
        }
        assert_eq!(received, Some(data));
        assert!(assembler.push(frames[1].as_bytes()).is_err());
        let mut frame: Frame = serde_json::from_str(&frames[0]).unwrap();
        frame.data = STANDARD.encode(vec![1; 10001]);
        assert!(
            assembler
                .push(serde_json::to_string(&frame).unwrap().as_bytes())
                .is_err()
        );
    }
}
