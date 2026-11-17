//! Camera capture through the Media Foundation Source Reader. Activated only by
//! an explicit user action; dropping the capture shuts the media source down so
//! the device (and its privacy light) is released immediately.
use crate::{CaptureFrame, MediaRuntime, frame_bytes};
use anyhow::{Context, Result, ensure};
use windows::Win32::Media::MediaFoundation::*;

pub struct CameraCapture<'runtime> {
    reader: IMFSourceReader,
    source: IMFMediaSource,
    width: u32,
    height: u32,
    stride: i32,
    _runtime: &'runtime MediaRuntime,
}
impl<'runtime> CameraCapture<'runtime> {
    pub fn start(
        runtime: &'runtime MediaRuntime,
        symbolic_link: &str,
        width: u32,
        height: u32,
        fps: u32,
    ) -> Result<Self> {
        ensure!(
            !symbolic_link.is_empty() && symbolic_link.len() < 4096,
            "Câmera inválida"
        );
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL)? };
        let link: Vec<u16> = symbolic_link.encode_utf16().chain(Some(0)).collect();
        let source = unsafe {
            let mut attributes = None;
            MFCreateAttributes(&mut attributes, 2)?;
            let attributes = attributes.context("Atributos de câmera")?;
            attributes.SetGUID(
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
            )?;
            attributes.SetString(
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
                windows::core::PCWSTR(link.as_ptr()),
            )?;
            MFCreateDeviceSource(&attributes)?
        };
        let reader = unsafe {
            let mut attributes = None;
            MFCreateAttributes(&mut attributes, 1)?;
            let attributes = attributes.context("Atributos do leitor")?;
            // The video processor converts the device format (YUY2/NV12/MJPG) to RGB32.
            attributes.SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1)?;
            MFCreateSourceReaderFromMediaSource(&source, &attributes)?
        };
        let stream = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
        unsafe {
            let requested = MFCreateMediaType()?;
            requested.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            requested.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
            requested.SetUINT64(&MF_MT_FRAME_SIZE, ((width as u64) << 32) | height as u64)?;
            requested.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1)?;
            // Devices that cannot provide the exact size fall back to their native size.
            if reader
                .SetCurrentMediaType(stream, None, &requested)
                .is_err()
            {
                let fallback = MFCreateMediaType()?;
                fallback.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
                fallback.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
                reader.SetCurrentMediaType(stream, None, &fallback)?;
            }
        }
        let current = unsafe { reader.GetCurrentMediaType(stream)? };
        let size = unsafe { current.GetUINT64(&MF_MT_FRAME_SIZE)? };
        let (actual_width, actual_height) = ((size >> 32) as u32, size as u32);
        frame_bytes(actual_width, actual_height)?;
        let stride = unsafe { current.GetUINT32(&MF_MT_DEFAULT_STRIDE) }
            .map(|value| value as i32)
            .unwrap_or(actual_width as i32 * 4);
        ensure!(
            stride.unsigned_abs() >= actual_width * 4,
            "Formato de câmera inesperado"
        );
        Ok(Self {
            reader,
            source,
            width: actual_width,
            height: actual_height,
            stride,
            _runtime: runtime,
        })
    }
    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }
    /// Blocks until the next frame. Returns None for gaps/format notifications.
    pub fn next_frame(&mut self) -> Result<Option<CaptureFrame>> {
        let mut flags = 0u32;
        let mut timestamp = 0i64;
        let mut sample: Option<IMFSample> = None;
        unsafe {
            self.reader.ReadSample(
                MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                0,
                None,
                Some(&mut flags),
                Some(&mut timestamp),
                Some(&mut sample),
            )?
        };
        ensure!(
            flags & (MF_SOURCE_READERF_ERROR.0 as u32 | MF_SOURCE_READERF_ENDOFSTREAM.0 as u32)
                == 0,
            "A câmera parou de enviar imagens"
        );
        let Some(sample) = sample else {
            return Ok(None);
        };
        let buffer = unsafe { sample.ConvertToContiguousBuffer()? };
        let mut pointer = std::ptr::null_mut();
        let mut length = 0u32;
        unsafe { buffer.Lock(&mut pointer, None, Some(&mut length))? };
        struct Unlock<'a>(&'a IMFMediaBuffer);
        impl Drop for Unlock<'_> {
            fn drop(&mut self) {
                let _ = unsafe { self.0.Unlock() };
            }
        }
        let _unlock = Unlock(&buffer);
        let row = self.width as usize * 4;
        let pitch = self.stride.unsigned_abs() as usize;
        ensure!(
            !pointer.is_null() && length as usize >= pitch * (self.height as usize - 1) + row,
            "Quadro de câmera incompleto"
        );
        let bytes = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
        let mut pixels = vec![0u8; frame_bytes(self.width, self.height)?];
        for y in 0..self.height as usize {
            // Negative stride means bottom-up rows.
            let source_row = if self.stride < 0 {
                self.height as usize - 1 - y
            } else {
                y
            };
            let from = &bytes[source_row * pitch..source_row * pitch + row];
            let to = &mut pixels[y * row..(y + 1) * row];
            to.copy_from_slice(from);
            for pixel in to.as_chunks_mut::<4>().0 {
                pixel[3] = 255;
            }
        }
        Ok(Some(CaptureFrame {
            width: self.width,
            height: self.height,
            timestamp_us: timestamp / 10,
            pixels: pixels.into(),
        }))
    }
}
impl Drop for CameraCapture<'_> {
    fn drop(&mut self) {
        unsafe {
            let _ = self.source.Shutdown();
            let _ = MFShutdown();
        }
    }
}
