//! Bounded RFC6184 assembly around the upstream H.264 depacketizer.
//! Only opted-in media peers allocate these buffers; default voice peers reject video.
use anyhow::{Result, ensure};
use bytes::Bytes;
use rtp::{codec::h264::H264Packet, packetizer::Depacketizer};
use std::time::{Duration, Instant};
pub const MAX_VIDEO_FRAME: usize = 4 * 1024 * 1024;
#[derive(Debug)]
pub struct VideoFrame {
    pub stream_id: String,
    pub timestamp: u32,
    pub keyframe: bool,
    pub bytes: Vec<u8>,
}
pub struct VideoAssembler {
    decoder: H264Packet,
    timestamp: Option<u32>,
    sequence: Option<u16>,
    frame: Vec<u8>,
    received: usize,
    fragmenting: bool,
    fragment_header: Option<u8>,
    completed: bool,
    damaged: bool,
    requires_keyframe: bool,
    started: Instant,
}
impl Default for VideoAssembler {
    fn default() -> Self {
        Self {
            decoder: Default::default(),
            timestamp: None,
            sequence: None,
            frame: Vec::new(),
            received: 0,
            fragmenting: false,
            fragment_header: None,
            completed: false,
            damaged: false,
            requires_keyframe: true,
            started: Instant::now(),
        }
    }
}
impl VideoAssembler {
    pub fn request_recovery(&mut self) {
        self.requires_keyframe = true;
    }
    pub fn push(
        &mut self,
        timestamp: u32,
        sequence: u16,
        marker: bool,
        payload: &Bytes,
    ) -> Result<Option<VideoFrame>> {
        ensure!(
            (2..=4096).contains(&payload.len()),
            "Payload de vídeo fora dos limites"
        );
        let changed = self.timestamp != Some(timestamp);
        if changed {
            if self.timestamp.is_some() && !self.completed {
                self.requires_keyframe = true;
            }
            self.decoder = Default::default();
            self.timestamp = Some(timestamp);
            self.frame.clear();
            self.received = 0;
            self.fragmenting = false;
            self.fragment_header = None;
            self.completed = false;
            self.damaged = false;
            self.started = Instant::now();
        }
        if self
            .sequence
            .is_some_and(|last| last.wrapping_add(1) != sequence)
            || self.started.elapsed() > Duration::from_millis(500)
        {
            self.requires_keyframe = true;
            self.damaged = !changed;
            self.decoder = Default::default();
            self.frame.clear();
        }
        self.sequence = Some(sequence);
        if self.damaged || self.completed {
            return Ok(None);
        }
        self.received = self.received.saturating_add(payload.len());
        ensure!(
            self.received <= MAX_VIDEO_FRAME,
            "Frame de vídeo excede o limite"
        );
        let kind = payload[0] & 31;
        ensure!(payload[0] & 0x80 == 0, "Bit NAL inválido");
        match kind {
            24 => {
                let mut offset = 1;
                let mut units = 0;
                while offset < payload.len() {
                    ensure!(offset + 2 <= payload.len(), "STAP-A truncado");
                    let size = u16::from_be_bytes([payload[offset], payload[offset + 1]]) as usize;
                    offset += 2;
                    ensure!(
                        size > 0 && offset + size <= payload.len(),
                        "NAL STAP-A truncado"
                    );
                    ensure!(
                        payload[offset] & 0x80 == 0 && (1..=23).contains(&(payload[offset] & 31)),
                        "NAL STAP-A inválido"
                    );
                    offset += size;
                    units += 1;
                    ensure!(units <= 128, "Muitos NALs no agregado");
                }
                ensure!(!self.fragmenting, "Agregado durante fragmento incompleto");
            }
            28 => {
                ensure!(payload.len() >= 3, "FU-A truncado");
                let start = payload[1] & 0x80 != 0;
                let end = payload[1] & 0x40 != 0;
                ensure!(
                    !(start && end)
                        && payload[1] & 0x20 == 0
                        && (1..=23).contains(&(payload[1] & 31)),
                    "FU-A inválido"
                );
                if start {
                    ensure!(!self.fragmenting, "Fragmento anterior incompleto");
                    self.fragmenting = true;
                    self.fragment_header = Some((payload[0] & 0xe0) | (payload[1] & 31));
                } else if !self.fragmenting {
                    self.damaged = true;
                    self.requires_keyframe = true;
                    return Ok(None);
                }
                ensure!(
                    self.fragment_header == Some((payload[0] & 0xe0) | (payload[1] & 31)),
                    "Cabeçalho FU-A mudou durante fragmentação"
                );
                if end {
                    self.fragmenting = false;
                }
            }
            1..=23 => ensure!(!self.fragmenting, "NAL durante fragmento incompleto"),
            _ => anyhow::bail!("Modo H.264 RTP não suportado"),
        }
        // Validate aggregation lengths before calling upstream (which indexes the length prefix).
        let decoded = self.decoder.depacketize(payload)?;
        ensure!(
            self.frame.len() + decoded.len() <= MAX_VIDEO_FRAME,
            "Frame remontado excede o limite"
        );
        self.frame.extend_from_slice(&decoded);
        if marker {
            ensure!(
                !self.fragmenting && !self.frame.is_empty(),
                "Frame de vídeo incompleto"
            );
            let bytes = std::mem::take(&mut self.frame);
            self.completed = true;
            let keyframe = bytes
                .windows(5)
                .any(|value| value[..4] == [0, 0, 0, 1] && value[4] & 31 == 5);
            if self.requires_keyframe && !keyframe {
                return Ok(None);
            }
            if keyframe {
                self.requires_keyframe = false;
            }
            return Ok(Some(VideoFrame {
                stream_id: String::new(),
                timestamp,
                keyframe,
                bytes,
            }));
        }
        Ok(None)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_frames_and_consumer_overflow_wait_for_idr() {
        let mut assembler = VideoAssembler::default();
        let idr = Bytes::from_static(&[0x65, 1, 2]);
        let delta = Bytes::from_static(&[0x41, 3, 4]);
        assert!(assembler.push(1, u16::MAX, true, &idr).unwrap().is_some());
        assert!(assembler.push(2, 0, false, &delta).unwrap().is_none());
        // A timestamp change without a marker discards an incomplete access unit.
        assert!(assembler.push(3, 1, true, &delta).unwrap().is_none());
        assert!(assembler.push(4, 2, true, &idr).unwrap().is_some());
        assembler.request_recovery();
        assert!(assembler.push(5, 3, true, &delta).unwrap().is_none());
        assert!(assembler.push(6, 4, true, &idr).unwrap().is_some());
        // Never emit a second access unit for the same completed timestamp.
        assert!(assembler.push(6, 5, true, &idr).unwrap().is_none());
        assert!(assembler.push(7, 6, true, &delta).unwrap().is_some());
        // Orphan FU tails cannot make subsequent delta frames decodable.
        assert!(
            assembler
                .push(8, 7, true, &Bytes::from_static(&[28, 0x41, 2]))
                .unwrap()
                .is_none()
        );
        assert!(assembler.push(9, 8, true, &delta).unwrap().is_none());
        assert!(assembler.push(10, 9, true, &idr).unwrap().is_some());
    }
    #[test]
    fn valid_fu_and_stap_reassemble_without_allowing_header_changes() {
        let mut assembler = VideoAssembler::default();
        assert!(
            assembler
                .push(1, 1, false, &Bytes::from_static(&[0x7c, 0x85, 1, 2]))
                .unwrap()
                .is_none()
        );
        let frame = assembler
            .push(1, 2, true, &Bytes::from_static(&[0x7c, 0x45, 3, 4]))
            .unwrap()
            .unwrap();
        assert_eq!(frame.bytes, [0, 0, 0, 1, 0x65, 1, 2, 3, 4]);
        let frame = assembler
            .push(
                2,
                3,
                true,
                &Bytes::from_static(&[24, 0, 2, 0x67, 1, 0, 2, 0x65, 2]),
            )
            .unwrap()
            .unwrap();
        assert!(frame.keyframe);
        assert_eq!(frame.bytes, [0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x65, 2]);
        assert!(
            assembler
                .push(3, 4, false, &Bytes::from_static(&[0x7c, 0x81, 1]))
                .unwrap()
                .is_none()
        );
        assert!(
            assembler
                .push(3, 5, true, &Bytes::from_static(&[0x7c, 0x45, 2]))
                .is_err()
        );
    }
    #[test]
    fn malformed_stap_fragments_loss_and_budget_are_bounded() {
        for data in [
            vec![24, 0, 3, 1, 2],
            vec![24, 0, 1, 1, 0],
            vec![28, 0x85],
            vec![28, 0xc5, 0],
            vec![0x85, 1, 2],
            vec![28, 0xa5, 1],
            vec![24, 0, 1, 0x85],
        ] {
            assert!(
                VideoAssembler::default()
                    .push(1, 1, true, &data.into())
                    .is_err()
            );
        }
        let mut assembler = VideoAssembler::default();
        assert!(
            assembler
                .push(1, 1, false, &Bytes::from_static(&[28, 0x85, 1, 2]))
                .unwrap()
                .is_none()
        );
        assert!(
            assembler
                .push(1, 3, true, &Bytes::from_static(&[28, 0x45, 3, 4]))
                .unwrap()
                .is_none()
        );
        let frame = assembler
            .push(2, 4, true, &Bytes::from_static(&[0x65, 1, 2]))
            .unwrap()
            .unwrap();
        assert!(frame.keyframe);
        assert_eq!(frame.bytes, [0, 0, 0, 1, 0x65, 1, 2]);
        let mut assembler = VideoAssembler::default();
        let mut bytes = vec![0; 4096];
        bytes[0] = 28;
        bytes[1] = 0x85;
        assembler.push(1, 0, false, &bytes.clone().into()).unwrap();
        bytes[1] = 5;
        for sequence in 1..=1024 {
            let result = assembler.push(1, sequence, false, &bytes.clone().into());
            if result.is_err() {
                return;
            }
        }
        panic!("Unbounded fragmented frame accepted");
    }
}
