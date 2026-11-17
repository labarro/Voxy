//! Explicit software H.264 Media Foundation MFT adapter. No bundled codec DLLs.
//! Hardware negotiation, RTP, UI and webcam capture are separate integration gates.
use crate::{CaptureFrame, MAX_FRAME_BYTES, MediaRuntime, frame_bytes};
use anyhow::{Context, Result, ensure};
use std::{mem::ManuallyDrop, sync::Arc};
use windows::{
    Win32::{
        Media::MediaFoundation::*,
        System::{
            Com::{CLSCTX_INPROC_SERVER, CoCreateInstance},
            Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BOOL, VT_UI4},
        },
    },
    core::{GUID, Interface},
};

pub const MAX_ENCODED_BYTES: usize = 4 * 1024 * 1024;
fn set_codec_property(
    transform: &IMFTransform,
    key: &GUID,
    value: u32,
    boolean: bool,
) -> Result<()> {
    let api: ICodecAPI = transform.cast()?;
    let variant = VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: if boolean { VT_BOOL } else { VT_UI4 },
                Anonymous: if boolean {
                    VARIANT_0_0_0 {
                        boolVal: windows::Win32::Foundation::VARIANT_BOOL(if value == 0 {
                            0
                        } else {
                            -1
                        }),
                    }
                } else {
                    VARIANT_0_0_0 { ulVal: value }
                },
                ..Default::default()
            }),
        },
    };
    unsafe { api.SetValue(key, &variant)? };
    Ok(())
}
#[derive(Clone, Copy, Debug)]
pub enum EncoderPreference {
    Software,
    RequireHardware,
}
#[derive(Clone, Copy, Debug)]
pub struct VideoFormat {
    pub width: u32,
    pub height: u32,
    pub frames_per_second: u32,
    pub bitrate: u32,
}
impl VideoFormat {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.width.is_multiple_of(2)
                && self.height.is_multiple_of(2)
                && self.width <= 3840
                && self.height <= 2160,
            "H.264 exige dimensões pares de até 3840×2160"
        );
        frame_bytes(self.width, self.height)?;
        ensure!(
            (1..=60).contains(&self.frames_per_second)
                && (128_000..=20_000_000).contains(&self.bitrate),
            "FPS ou bitrate H.264 fora dos limites"
        );
        Ok(())
    }
    pub fn nv12_bytes(&self) -> Result<usize> {
        self.validate()?;
        Ok(self.width as usize * self.height as usize * 3 / 2)
    }
}
#[derive(Clone, Debug)]
pub struct Nv12Frame {
    pub width: u32,
    pub height: u32,
    pub timestamp_us: i64,
    pub pixels: Arc<[u8]>,
}
#[derive(Clone, Debug)]
pub struct EncodedFrame {
    pub timestamp_us: i64,
    pub duration_us: i64,
    pub keyframe: bool,
    pub bytes: Arc<[u8]>,
}

/// Limited-range BT.601 CPU conversion, explicit SDR only. No hidden GPU readback.
pub fn bgra_to_nv12(frame: &CaptureFrame) -> Result<Nv12Frame> {
    let format = VideoFormat {
        width: frame.width,
        height: frame.height,
        frames_per_second: 30,
        bitrate: 1_000_000,
    };
    let length = format.nv12_bytes()?;
    ensure!(
        frame.pixels.len() == frame_bytes(frame.width, frame.height)?,
        "Frame BGRA truncado"
    );
    let width = frame.width as usize;
    let height = frame.height as usize;
    let mut pixels = vec![0; length];
    for y in 0..height {
        for x in 0..width {
            let index = (y * width + x) * 4;
            let b = frame.pixels[index] as i32;
            let g = frame.pixels[index + 1] as i32;
            let r = frame.pixels[index + 2] as i32;
            pixels[y * width + x] =
                (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(16, 235) as u8;
        }
    }
    for y in (0..height).step_by(2) {
        for x in (0..width).step_by(2) {
            let mut rgb = [0i32; 3];
            for dy in 0..2 {
                for dx in 0..2 {
                    let index = ((y + dy) * width + x + dx) * 4;
                    rgb[0] += frame.pixels[index + 2] as i32;
                    rgb[1] += frame.pixels[index + 1] as i32;
                    rgb[2] += frame.pixels[index] as i32;
                }
            }
            let [r, g, b] = rgb.map(|value| value / 4);
            let index = width * height + (y / 2) * width + x;
            pixels[index] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
            pixels[index + 1] =
                (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
        }
    }
    Ok(Nv12Frame {
        width: frame.width,
        height: frame.height,
        timestamp_us: frame.timestamp_us,
        pixels: pixels.into(),
    })
}

struct Foundation<'runtime> {
    _runtime: &'runtime MediaRuntime,
}
impl<'runtime> Foundation<'runtime> {
    fn new(runtime: &'runtime MediaRuntime) -> Result<Self> {
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL)? };
        Ok(Self { _runtime: runtime })
    }
}
impl Drop for Foundation<'_> {
    fn drop(&mut self) {
        let _ = unsafe { MFShutdown() };
    }
}

fn media_type(format: VideoFormat, subtype: &GUID) -> Result<IMFMediaType> {
    let media = unsafe { MFCreateMediaType()? };
    unsafe {
        media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        media.SetUINT64(
            &MF_MT_FRAME_SIZE,
            ((format.width as u64) << 32) | format.height as u64,
        )?;
        media.SetUINT64(
            &MF_MT_FRAME_RATE,
            ((format.frames_per_second as u64) << 32) | 1,
        )?;
        media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        media.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT601.0 as u32)?;
        media.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
    }
    Ok(media)
}
fn sample(bytes: &[u8], timestamp_us: i64, duration_us: i64) -> Result<IMFSample> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_FRAME_BYTES,
        "Amostra de vídeo fora do limite"
    );
    ensure!(
        (0..=i64::MAX / 10).contains(&timestamp_us) && (1..=1_000_000).contains(&duration_us),
        "Timestamp de vídeo inválido"
    );
    let sample = unsafe { MFCreateSample()? };
    let buffer = unsafe { MFCreateMemoryBuffer(bytes.len() as u32)? };
    let mut pointer = std::ptr::null_mut();
    unsafe { buffer.Lock(&mut pointer, None, None)? };
    struct Locked<'a>(&'a IMFMediaBuffer);
    impl Drop for Locked<'_> {
        fn drop(&mut self) {
            let _ = unsafe { self.0.Unlock() };
        }
    }
    {
        let _locked = Locked(&buffer);
        ensure!(!pointer.is_null(), "Buffer de vídeo indisponível");
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer, bytes.len());
        }
    }
    unsafe {
        buffer.SetCurrentLength(bytes.len() as u32)?;
        sample.AddBuffer(&buffer)?;
        sample.SetSampleTime(timestamp_us * 10)?;
        sample.SetSampleDuration(duration_us * 10)?;
    }
    Ok(sample)
}
fn sample_bytes(sample: &IMFSample, maximum: usize) -> Result<Vec<u8>> {
    let buffer = unsafe { sample.ConvertToContiguousBuffer()? };
    let mut pointer = std::ptr::null_mut();
    let mut length = 0;
    unsafe {
        buffer.Lock(&mut pointer, None, Some(&mut length))?;
    }
    struct Locked<'a>(&'a IMFMediaBuffer);
    impl Drop for Locked<'_> {
        fn drop(&mut self) {
            let _ = unsafe { self.0.Unlock() };
        }
    }
    let _locked = Locked(&buffer);
    ensure!(
        length > 0 && length as usize <= maximum && !pointer.is_null(),
        "Saída de vídeo vazia ou maior que o orçamento"
    );
    Ok(unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec())
}
enum Output {
    Sample(IMFSample),
    NeedInput,
    FormatChanged,
}
fn output(transform: &IMFTransform, maximum: usize) -> Result<Output> {
    let info = unsafe { transform.GetOutputStreamInfo(0)? };
    ensure!(
        info.cbSize as usize <= maximum,
        "Codec solicitou buffer acima do limite"
    );
    let supplied = if info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 != 0 {
        None
    } else {
        let sample = unsafe { MFCreateSample()? };
        let buffer = unsafe { MFCreateMemoryBuffer(info.cbSize.max(1))? };
        unsafe { sample.AddBuffer(&buffer)? };
        Some(sample)
    };
    struct Buffer(MFT_OUTPUT_DATA_BUFFER);
    impl Drop for Buffer {
        fn drop(&mut self) {
            unsafe {
                ManuallyDrop::drop(&mut self.0.pSample);
                ManuallyDrop::drop(&mut self.0.pEvents);
            }
        }
    }
    let mut buffer = Buffer(MFT_OUTPUT_DATA_BUFFER {
        dwStreamID: 0,
        pSample: ManuallyDrop::new(supplied),
        dwStatus: 0,
        pEvents: ManuallyDrop::new(None),
    });
    let mut status = 0;
    match unsafe { transform.ProcessOutput(0, std::slice::from_mut(&mut buffer.0), &mut status) } {
        Ok(()) => Ok(Output::Sample(
            buffer
                .0
                .pSample
                .as_ref()
                .context("Codec sem amostra de saída")?
                .clone(),
        )),
        Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => Ok(Output::NeedInput),
        Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => Ok(Output::FormatChanged),
        Err(error) => Err(error.into()),
    }
}

pub struct H264Encoder<'runtime> {
    transform: IMFTransform,
    format: VideoFormat,
    finished: bool,
    _foundation: Foundation<'runtime>,
}
impl<'runtime> H264Encoder<'runtime> {
    pub fn new(
        runtime: &'runtime MediaRuntime,
        format: VideoFormat,
        preference: EncoderPreference,
    ) -> Result<Self> {
        format.validate()?;
        ensure!(
            matches!(preference, EncoderPreference::Software),
            "Encoder por hardware não integrado; fallback software exige escolha explícita"
        );
        let foundation = Foundation::new(runtime)?;
        let transform: IMFTransform =
            unsafe { CoCreateInstance(&CMSH264EncoderMFT, None, CLSCTX_INPROC_SERVER)? };
        let encoded = media_type(format, &MFVideoFormat_H264)?;
        unsafe {
            encoded.SetUINT32(&MF_MT_AVG_BITRATE, format.bitrate)?;
            encoded.SetUINT32(&MF_MT_MPEG2_PROFILE, 66)?;
            transform.SetOutputType(0, &encoded, 0)?;
            transform.SetInputType(0, &media_type(format, &MFVideoFormat_NV12)?, 0)?;
            set_codec_property(&transform, &CODECAPI_AVLowLatencyMode, 1, true)?;
            set_codec_property(
                &transform,
                &CODECAPI_AVEncMPVGOPSize,
                format.frames_per_second,
                false,
            )?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        Ok(Self {
            transform,
            format,
            finished: false,
            _foundation: foundation,
        })
    }
    pub fn encode(&mut self, frame: &Nv12Frame) -> Result<Vec<EncodedFrame>> {
        ensure!(!self.finished, "Encoder já finalizado");
        ensure!(
            frame.width == self.format.width
                && frame.height == self.format.height
                && frame.pixels.len() == self.format.nv12_bytes()?,
            "Frame NV12 não corresponde ao encoder"
        );
        let mut frames = self.available()?;
        let sample = sample(
            &frame.pixels,
            frame.timestamp_us,
            1_000_000 / self.format.frames_per_second as i64,
        )?;
        unsafe { self.transform.ProcessInput(0, &sample, 0)? };
        frames.extend(self.available()?);
        Ok(frames)
    }
    fn available(&mut self) -> Result<Vec<EncodedFrame>> {
        let mut frames = Vec::new();
        let mut bytes_used = 0;
        for _ in 0..128 {
            match output(&self.transform, MAX_ENCODED_BYTES)? {
                Output::NeedInput => return Ok(frames),
                Output::FormatChanged => anyhow::bail!("Encoder mudou formato inesperadamente"),
                Output::Sample(sample) => {
                    let bytes = sample_bytes(&sample, MAX_ENCODED_BYTES)?;
                    bytes_used += bytes.len();
                    ensure!(
                        bytes_used <= MAX_FRAME_BYTES,
                        "Saída acumulada do encoder excede o orçamento"
                    );
                    let timestamp_us = unsafe { sample.GetSampleTime()? } / 10;
                    let duration_us = unsafe { sample.GetSampleDuration()? } / 10;
                    let keyframe = unsafe { sample.GetUINT32(&MFSampleExtension_CleanPoint) }
                        .unwrap_or(0)
                        != 0;
                    frames.push(EncodedFrame {
                        timestamp_us,
                        duration_us,
                        keyframe,
                        bytes: bytes.into(),
                    });
                }
            }
        }
        anyhow::bail!("Codec excedeu o limite de amostras por operação")
    }
    pub fn finish(&mut self) -> Result<Vec<EncodedFrame>> {
        ensure!(!self.finished, "Encoder já finalizado");
        self.finished = true;
        unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
            self.transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
        }
        self.available()
    }
    pub fn request_keyframe(&self) -> Result<()> {
        ensure!(!self.finished, "Encoder já finalizado");
        set_codec_property(&self.transform, &CODECAPI_AVEncVideoForceKeyFrame, 1, false)
    }
    pub fn set_bitrate(&mut self, bitrate: u32) -> Result<()> {
        ensure!(!self.finished, "Encoder já finalizado");
        let format = VideoFormat {
            bitrate,
            ..self.format
        };
        format.validate()?;
        set_codec_property(
            &self.transform,
            &CODECAPI_AVEncCommonMeanBitRate,
            bitrate,
            false,
        )?;
        self.format = format;
        Ok(())
    }
}
impl Drop for H264Encoder<'_> {
    fn drop(&mut self) {
        let _ = unsafe { self.transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0) };
        let _ = unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0)
        };
    }
}

pub struct H264Decoder<'runtime> {
    transform: IMFTransform,
    format: VideoFormat,
    finished: bool,
    _foundation: Foundation<'runtime>,
}
impl<'runtime> H264Decoder<'runtime> {
    pub fn new(runtime: &'runtime MediaRuntime, format: VideoFormat) -> Result<Self> {
        format.validate()?;
        let foundation = Foundation::new(runtime)?;
        let transform: IMFTransform =
            unsafe { CoCreateInstance(&CMSH264DecoderMFT, None, CLSCTX_INPROC_SERVER)? };
        unsafe {
            transform.SetInputType(0, &media_type(format, &MFVideoFormat_H264)?, 0)?;
            transform.SetOutputType(0, &media_type(format, &MFVideoFormat_NV12)?, 0)?;
            set_codec_property(&transform, &CODECAPI_AVLowLatencyMode, 1, false)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        Ok(Self {
            transform,
            format,
            finished: false,
            _foundation: foundation,
        })
    }
    pub fn decode(&mut self, frame: &EncodedFrame) -> Result<Vec<Nv12Frame>> {
        ensure!(!self.finished, "Decoder já finalizado");
        ensure!(
            !frame.bytes.is_empty() && frame.bytes.len() <= MAX_ENCODED_BYTES,
            "Pacote H.264 vazio ou maior que o limite"
        );
        let mut frames = self.available()?;
        unsafe {
            self.transform.ProcessInput(
                0,
                &sample(&frame.bytes, frame.timestamp_us, frame.duration_us)?,
                0,
            )?
        };
        frames.extend(self.available()?);
        Ok(frames)
    }
    fn renegotiate(&self) -> Result<()> {
        for index in 0..64 {
            let Ok(media) = (unsafe { self.transform.GetOutputAvailableType(0, index) }) else {
                break;
            };
            if unsafe { media.GetGUID(&MF_MT_SUBTYPE)? } != MFVideoFormat_NV12 {
                continue;
            }
            let size = unsafe { media.GetUINT64(&MF_MT_FRAME_SIZE)? };
            let width = (size >> 32) as u32;
            let height = size as u32;
            frame_bytes(width, height)?;
            ensure!(
                width == self.format.width && height == self.format.height,
                "Mudança de resolução H.264 exige renegociação explícita"
            );
            unsafe { self.transform.SetOutputType(0, &media, 0)? };
            return Ok(());
        }
        anyhow::bail!("Decoder não oferece saída NV12 compatível")
    }
    fn available(&mut self) -> Result<Vec<Nv12Frame>> {
        let mut frames = Vec::new();
        let mut bytes_used = 0;
        for _ in 0..128 {
            match output(&self.transform, MAX_FRAME_BYTES)? {
                Output::NeedInput => return Ok(frames),
                Output::FormatChanged => self.renegotiate()?,
                Output::Sample(sample) => {
                    let bytes = sample_bytes(&sample, MAX_FRAME_BYTES)?;
                    let media = unsafe { self.transform.GetOutputCurrentType(0)? };
                    let stride = unsafe { media.GetUINT32(&MF_MT_DEFAULT_STRIDE) }
                        .unwrap_or(self.format.width) as usize;
                    let width = self.format.width as usize;
                    let height = self.format.height as usize;
                    ensure!(
                        stride >= width
                            && stride <= 32768
                            && stride * height * 3 / 2 <= bytes.len(),
                        "Stride NV12 incompatível com a saída do decoder"
                    );
                    let length = self.format.nv12_bytes()?;
                    bytes_used += length;
                    ensure!(
                        bytes_used <= MAX_FRAME_BYTES,
                        "Saída acumulada do decoder excede o orçamento"
                    );
                    let mut pixels = vec![0; length];
                    for row in 0..height {
                        pixels[row * width..(row + 1) * width]
                            .copy_from_slice(&bytes[row * stride..row * stride + width]);
                    }
                    for row in 0..height / 2 {
                        let source = stride * height + row * stride;
                        let target = width * height + row * width;
                        pixels[target..target + width]
                            .copy_from_slice(&bytes[source..source + width]);
                    }
                    frames.push(Nv12Frame {
                        width: self.format.width,
                        height: self.format.height,
                        timestamp_us: unsafe { sample.GetSampleTime()? } / 10,
                        pixels: pixels.into(),
                    });
                }
            }
        }
        anyhow::bail!("Decoder excedeu o limite de amostras por operação")
    }
    pub fn finish(&mut self) -> Result<Vec<Nv12Frame>> {
        ensure!(!self.finished, "Decoder já finalizado");
        self.finished = true;
        unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
            self.transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
        }
        self.available()
    }
}
impl Drop for H264Decoder<'_> {
    fn drop(&mut self) {
        let _ = unsafe { self.transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0) };
        let _ = unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0)
        };
    }
}
