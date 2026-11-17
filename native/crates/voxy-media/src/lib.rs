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

/// Fits a BGRA frame into an even `width`x`height` canvas, preserving aspect ratio
/// with black bars. Downscaling is bilinear (fixed point); smaller sources are
/// centred without upscaling so text stays sharp. One allocation per frame.
pub fn fit_bgra(frame: &CaptureFrame, width: u32, height: u32) -> Result<CaptureFrame> {
    let output = frame_bytes(width, height)?;
    ensure!(
        frame.pixels.len() == frame_bytes(frame.width, frame.height)?,
        "Frame BGRA inconsistente"
    );
    if frame.width == width && frame.height == height {
        return Ok(frame.clone());
    }
    let scale = (width as f64 / frame.width as f64)
        .min(height as f64 / frame.height as f64)
        .min(1.0);
    let (w, h) = (
        ((frame.width as f64 * scale).round() as u32).clamp(1, width),
        ((frame.height as f64 * scale).round() as u32).clamp(1, height),
    );
    let (left, top) = ((width - w) / 2, (height - h) / 2);
    let mut pixels = vec![0u8; output];
    for alpha in pixels.as_chunks_mut::<4>().0 {
        alpha[3] = 255;
    }
    let source = &frame.pixels;
    let stride = frame.width as usize * 4;
    for y in 0..h {
        let fy =
            ((y as u64 * 2 + 1) * frame.height as u64 * 256 / (h as u64 * 2)).saturating_sub(128);
        let y0 = ((fy >> 8) as u32).min(frame.height - 1) as usize;
        let y1 = (y0 + 1).min(frame.height as usize - 1);
        let wy = (fy & 255) as u32;
        let row = ((top + y) as usize * width as usize + left as usize) * 4;
        for x in 0..w {
            let fx = ((x as u64 * 2 + 1) * frame.width as u64 * 256 / (w as u64 * 2))
                .saturating_sub(128);
            let x0 = ((fx >> 8) as u32).min(frame.width - 1) as usize;
            let x1 = (x0 + 1).min(frame.width as usize - 1);
            let wx = (fx & 255) as u32;
            let at = row + x as usize * 4;
            for channel in 0..4 {
                let p = |xx: usize, yy: usize| source[yy * stride + xx * 4 + channel] as u32;
                let top_mix = p(x0, y0) * (256 - wx) + p(x1, y0) * wx;
                let bottom_mix = p(x0, y1) * (256 - wx) + p(x1, y1) * wx;
                pixels[at + channel] =
                    ((top_mix * (256 - wy) + bottom_mix * wy + 32768) >> 16) as u8;
            }
        }
    }
    Ok(CaptureFrame {
        width,
        height,
        timestamp_us: frame.timestamp_us,
        pixels: pixels.into(),
    })
}

#[cfg(windows)]
mod windows_capture;
#[cfg(windows)]
pub use windows_capture::*;
#[cfg(windows)]
pub mod codec;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fit_preserves_aspect_letterboxes_and_never_upscales() {
        let solid = |w: u32, h: u32| CaptureFrame {
            width: w,
            height: h,
            timestamp_us: 7,
            pixels: vec![200u8; frame_bytes(w, h).unwrap()].into(),
        };
        // 2560x1440 -> 1280x720 exact 16:9 downscale fills the canvas.
        let fitted = fit_bgra(&solid(2560, 1440), 1280, 720).unwrap();
        assert_eq!(
            (fitted.width, fitted.height, fitted.timestamp_us),
            (1280, 720, 7)
        );
        assert!(fitted.pixels.as_chunks::<4>().0.iter().all(|p| p[0] == 200));
        // A small 4:3 window is centred without upscaling.
        let small = fit_bgra(&solid(640, 480), 1280, 720).unwrap();
        let at = |x: usize, y: usize| small.pixels[(y * 1280 + x) * 4];
        assert_eq!((at(0, 0), at(640, 360), at(1279, 719)), (0, 200, 0));
        assert_eq!(at(320, 120), 200);
        assert_eq!(at(319, 120), 0);
        // Tall source gets pillarboxed.
        let tall = fit_bgra(&solid(1000, 2000), 1280, 720).unwrap();
        assert_eq!(tall.pixels[(360 * 1280) * 4], 0);
        assert_eq!(tall.pixels[(360 * 1280 + 640) * 4], 200);
    }
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
