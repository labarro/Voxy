//! Native capture backend. No browser, hidden WebView, audio loopback or helper process.
//! CPU BGRA frames are shared with Arc; encoding/network/playback remain separate layers.
use anyhow::{Result, ensure};
use std::sync::Arc;

pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct CaptureFrame {
    pub width: u32,
    pub height: u32,
    pub timestamp_us: i64,
    /// Tightly packed BGRA8 rows; sharing a frame does not duplicate pixel storage.
    pub pixels: Arc<[u8]>,
}

pub fn frame_bytes(width: u32, height: u32) -> Result<usize> {
    ensure!(
        width > 0 && height > 0 && width <= 8192 && height <= 8192,
        "Dimensões de captura inválidas"
    );
    let length = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4));
    ensure!(
        length.is_some_and(|n| n <= MAX_FRAME_BYTES),
        "Frame excede o orçamento de memória"
    );
    Ok(length.unwrap())
}

#[derive(Clone, Copy, Debug)]
pub struct CaptureOptions {
    pub frames_per_second: u32,
    /// True is deliberately rejected until process-exclusion audio is implemented and validated.
    pub include_audio: bool,
}
impl Default for CaptureOptions {
    fn default() -> Self {
        Self {
            frames_per_second: 30,
            include_audio: false,
        }
    }
}
impl CaptureOptions {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            (1..=60).contains(&self.frames_per_second),
            "FPS deve estar entre 1 e 60"
        );
        ensure!(
            !self.include_audio,
            "Áudio de compartilhamento indisponível: isolamento seguro do áudio do Voxy ainda não homologado; use vídeo sem áudio"
        );
        Ok(())
    }
}

#[cfg(windows)]
mod windows_capture;
#[cfg(windows)]
pub use windows_capture::*;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_limits_reject_unsafe_audio_and_unbounded_frames() {
        assert_eq!(frame_bytes(1920, 1080).unwrap(), 8_294_400);
        for size in [(0, 1), (1, 0), (u32::MAX, 1), (8192, 8192)] {
            assert!(frame_bytes(size.0, size.1).is_err());
        }
        assert!(CaptureOptions::default().validate().is_ok());
        assert!(
            CaptureOptions {
                include_audio: true,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        for fps in [0, 61, u32::MAX] {
            assert!(
                CaptureOptions {
                    frames_per_second: fps,
                    ..Default::default()
                }
                .validate()
                .is_err()
            );
        }
    }
}
