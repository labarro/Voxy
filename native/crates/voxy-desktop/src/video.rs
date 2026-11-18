//! Per-stream H.264 decoding for watched screens. One thread per publisher owns
//! its Media Foundation decoder; frames arrive through a 4-slot queue and, if the
//! UI cannot keep up, are dropped until the next keyframe so P-frames never decode
//! against a missing reference. Idle decoders are released.
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc::{SyncSender, TrySendError, sync_channel},
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone)]
pub struct Frame {
    pub member: uuid::Uuid,
    pub camera: bool,
    pub width: u32,
    pub height: u32,
    pub handle: iced::widget::image::Handle,
    pub decoded: u64,
    pub dropped: u64,
    /// Mean luminance of a coarse 8x8 grid; lets tests check content changes.
    pub signature: Vec<u8>,
    /// Display rate estimated by the UI from frame arrivals (0 until known).
    pub fps: f32,
    pub received: std::time::Instant,
}
struct Stream {
    queue: SyncSender<(bool, (u32, u32), Vec<u8>)>,
    last: Instant,
    awaiting_keyframe: bool,
    dropped: Arc<AtomicU64>,
}
pub struct Decoders {
    streams: HashMap<(uuid::Uuid, bool), Stream>,
    output: iced::futures::channel::mpsc::Sender<crate::Msg>,
}
impl Decoders {
    pub fn new(output: iced::futures::channel::mpsc::Sender<crate::Msg>) -> Self {
        Self {
            streams: HashMap::new(),
            output,
        }
    }
    pub fn push(
        &mut self,
        member: uuid::Uuid,
        camera: bool,
        keyframe: bool,
        size: (u32, u32),
        bytes: Vec<u8>,
    ) {
        let key = (member, camera);
        self.streams
            .retain(|_, stream| stream.last.elapsed() < Duration::from_secs(4));
        if !self.streams.contains_key(&key) && self.streams.len() >= 18 {
            return;
        }
        let output = self.output.clone();
        let stream = self
            .streams
            .entry(key)
            .or_insert_with(|| spawn(member, camera, output));
        stream.last = Instant::now();
        if stream.awaiting_keyframe && !keyframe {
            stream.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        match stream.queue.try_send((keyframe, size, bytes)) {
            Ok(()) => stream.awaiting_keyframe = false,
            Err(TrySendError::Full(_)) => {
                stream.dropped.fetch_add(1, Ordering::Relaxed);
                stream.awaiting_keyframe = true;
            }
            Err(TrySendError::Disconnected(_)) => {
                self.streams.remove(&key);
            }
        }
    }
}
fn spawn(
    member: uuid::Uuid,
    camera: bool,
    output: iced::futures::channel::mpsc::Sender<crate::Msg>,
) -> Stream {
    let (queue, frames) = sync_channel::<(bool, (u32, u32), Vec<u8>)>(4);
    let dropped = Arc::new(AtomicU64::new(0));
    let thread_dropped = dropped.clone();
    let _ = std::thread::Builder::new()
        .name("voxy-video-decode".into())
        .spawn(move || {
            // A malformed stream or decoder fault drops this stream, never the window.
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                decode_loop(member, camera, frames, output, thread_dropped)
            }))
            .is_err()
            {
                voxy_core::log::event("video-decoder", "panic contained; stream dropped");
            }
        });
    Stream {
        queue,
        last: Instant::now(),
        awaiting_keyframe: true,
        dropped,
    }
}
#[cfg(windows)]
fn decode_loop(
    member: uuid::Uuid,
    camera: bool,
    frames: std::sync::mpsc::Receiver<(bool, (u32, u32), Vec<u8>)>,
    mut output: iced::futures::channel::mpsc::Sender<crate::Msg>,
    dropped: Arc<AtomicU64>,
) {
    use voxy_media::{
        MediaRuntime,
        codec::{EncodedFrame, H264Decoder, VideoFormat, nv12_to_rgba},
    };
    let Ok(runtime) = MediaRuntime::new() else {
        return;
    };
    let mut decoder: Option<((u32, u32), H264Decoder)> = None;
    let mut decoded = 0_u64;
    let mut timestamp = 0_i64;
    // Ends when the queue is dropped (stream idle or watcher gone) or times out.
    while let Ok((keyframe, size, bytes)) = frames.recv_timeout(Duration::from_secs(5)) {
        if decoder.as_ref().is_none_or(|(current, _)| *current != size) {
            if !keyframe {
                continue;
            }
            let format = VideoFormat {
                width: size.0,
                height: size.1,
                frames_per_second: 60,
                bitrate: 4_000_000,
            };
            match H264Decoder::new(&runtime, format) {
                Ok(created) => decoder = Some((size, created)),
                Err(_) => return,
            }
        }
        let Some((_, active)) = decoder.as_mut() else {
            continue;
        };
        timestamp += 16_666;
        let frame = EncodedFrame {
            timestamp_us: timestamp,
            duration_us: 16_666,
            keyframe,
            bytes: bytes.into(),
        };
        let Ok(pictures) = active.decode(&frame) else {
            // Corrupt access unit: rebuild on the next keyframe.
            decoder = None;
            continue;
        };
        // Render only the newest picture; older ones would be replaced immediately.
        let Some(picture) = pictures.last() else {
            continue;
        };
        let Ok(rgba) = nv12_to_rgba(picture) else {
            continue;
        };
        decoded += pictures.len() as u64;
        let signature = signature(
            &picture.pixels,
            picture.width as usize,
            picture.height as usize,
        );
        let frame = Frame {
            member,
            camera,
            width: picture.width,
            height: picture.height,
            handle: iced::widget::image::Handle::from_rgba(picture.width, picture.height, rgba),
            decoded,
            dropped: dropped.load(Ordering::Relaxed),
            signature,
            fps: 0.0,
            received: std::time::Instant::now(),
        };
        // A busy UI drops display frames; decoding state stays consistent.
        if let Err(error) = output.try_send(crate::Msg::VideoFrame(Box::new(frame)))
            && error.is_disconnected()
        {
            return;
        }
    }
}
#[cfg(not(windows))]
fn decode_loop(
    _: uuid::Uuid,
    _: bool,
    _: std::sync::mpsc::Receiver<(bool, (u32, u32), Vec<u8>)>,
    _: iced::futures::channel::mpsc::Sender<crate::Msg>,
    _: Arc<AtomicU64>,
) {
}
fn signature(luma: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut cells = Vec::with_capacity(64);
    for gy in 0..8 {
        for gx in 0..8 {
            let (x0, y0) = (gx * width / 8, gy * height / 8);
            let (x1, y1) = ((gx + 1) * width / 8, (gy + 1) * height / 8);
            let mut sum = 0u64;
            let mut count = 0u64;
            for y in (y0..y1).step_by(4) {
                for x in (x0..x1).step_by(4) {
                    sum += luma[y * width + x] as u64;
                    count += 1;
                }
            }
            cells.push((sum / count.max(1)) as u8);
        }
    }
    cells
}
