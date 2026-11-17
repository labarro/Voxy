//! Duplex audio owner independent of GUI, world, async executor and sockets.
//! Device callbacks only move samples through bounded SPSC queues.
use crate::{
    codec::{FRAME_SAMPLES, VoiceDecoder, VoiceEncoder},
    control::{GlobalPtt, VoiceControl},
    devices::{Capture, Playback},
    processing::{BLOCK, CaptureProcessor},
};
use anyhow::{Context, Result, ensure};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

pub struct IncomingVoice {
    pub peer: u64,
    pub sequence: u16,
    pub payload: Vec<u8>,
}
pub struct EncodedVoice {
    pub payload: Vec<u8>,
    pub produced_at: Instant,
}

/// Detect callback loss even when the backend fails to deliver an error event.
pub(crate) struct DeviceWatchdog {
    captured: u64,
    rendered: u64,
    capture_progress: Instant,
    render_progress: Instant,
}
impl DeviceWatchdog {
    pub(crate) fn new(now: Instant, control: &VoiceControl) -> Self {
        Self {
            captured: control.captured_samples.load(Ordering::Relaxed),
            rendered: control.rendered_samples.load(Ordering::Relaxed),
            capture_progress: now,
            render_progress: now,
        }
    }
    pub(crate) fn healthy(&mut self, now: Instant, control: &VoiceControl) -> bool {
        let captured = control.captured_samples.load(Ordering::Relaxed);
        let rendered = control.rendered_samples.load(Ordering::Relaxed);
        if captured != self.captured {
            self.capture_progress = now;
            self.captured = captured;
        }
        if rendered != self.rendered {
            self.render_progress = now;
            self.rendered = rendered;
        }
        now.saturating_duration_since(self.capture_progress) < Duration::from_secs(2)
            && now.saturating_duration_since(self.render_progress) < Duration::from_secs(2)
    }
}
enum Input {
    Clear,
    Remove(u64),
    Packet(IncomingVoice),
    Mix { peer: u64, volume: f32, muted: bool },
}
#[derive(Clone)]
pub struct VoiceInput(SyncSender<Input>);
impl VoiceInput {
    pub fn clear(&self) {
        let _ = self.0.try_send(Input::Clear);
    }
    pub fn remove(&self, peer: u64) {
        let _ = self.0.try_send(Input::Remove(peer));
    }
    pub fn packet(&self, packet: IncomingVoice) -> Result<()> {
        ensure!(packet.payload.len() <= 1275, "Pacote de voz inválido");
        self.0
            .try_send(Input::Packet(packet))
            .map_err(|_| anyhow::anyhow!("Fila de voz cheia ou sessão encerrada"))
    }
    pub fn volume(&self, peer: u64, volume: f32, muted: bool) -> Result<()> {
        ensure!(
            volume.is_finite() && (0.0..=2.0).contains(&volume),
            "Volume inválido"
        );
        self.0
            .try_send(Input::Mix {
                peer,
                volume,
                muted,
            })
            .map_err(|_| anyhow::anyhow!("Sessão de voz indisponível"))
    }
}
#[derive(Clone)]
pub struct CallConfig {
    pub input: String,
    pub output: String,
    pub noise_suppression: bool,
    pub echo_cancellation: bool,
    pub automatic_gain: bool,
    pub voice_detection: bool,
    pub threshold: f32,
    pub ptt_key: Option<String>,
}
impl Default for CallConfig {
    fn default() -> Self {
        Self {
            input: String::new(),
            output: String::new(),
            noise_suppression: true,
            echo_cancellation: true,
            automatic_gain: true,
            voice_detection: false,
            threshold: -45.0,
            ptt_key: None,
        }
    }
}
struct Remote {
    decoder: VoiceDecoder,
    jitter: JitterBuffer,
    volume: f32,
    muted: bool,
    last: Instant,
}
impl Remote {
    fn new() -> Result<Self> {
        Ok(Self {
            decoder: VoiceDecoder::new()?,
            jitter: JitterBuffer::default(),
            volume: 1.0,
            muted: false,
            last: Instant::now(),
        })
    }
}

/// Bounded reorder window. After three missing frames, wait for a fresh RTP
/// sequence instead of advancing forever while the sender is muted/PTT closed.
struct JitterBuffer {
    packets: BTreeMap<u16, Vec<u8>>,
    next: Option<u16>,
    prebuffer: u8,
    missing: u8,
}
impl Default for JitterBuffer {
    fn default() -> Self {
        Self {
            packets: BTreeMap::new(),
            next: None,
            prebuffer: 3,
            missing: 0,
        }
    }
}
impl JitterBuffer {
    fn push(&mut self, sequence: u16, payload: Vec<u8>) -> bool {
        if let Some(next) = self.next {
            let ahead = sequence.wrapping_sub(next);
            if ahead >= 32768 {
                return false;
            }
            if ahead > 32 {
                *self = Self::default();
            }
        }
        if self.packets.len() >= 32 {
            *self = Self::default();
        }
        if self.next.is_none() {
            self.next = Some(sequence);
        }
        self.packets.entry(sequence).or_insert(payload);
        true
    }
    fn pop(&mut self) -> Option<Option<Vec<u8>>> {
        if self.prebuffer > 0 {
            self.prebuffer -= 1;
            return None;
        }
        let next = self.next?;
        let data = self.packets.remove(&next);
        self.next = Some(next.wrapping_add(1));
        if data.is_some() {
            self.missing = 0;
        } else {
            self.missing += 1;
            if self.missing >= 3 {
                *self = Self::default();
            }
        }
        Some(data)
    }
}
pub struct CallAudio {
    pub control: Arc<VoiceControl>,
    pub input: VoiceInput,
    pub encoded: Receiver<EncodedVoice>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<()>>>,
    generation: u64,
}
impl CallAudio {
    pub fn is_finished(&self) -> bool {
        self.worker
            .as_ref()
            .is_none_or(|worker| worker.is_finished())
    }
    pub fn take_encoded(&mut self) -> Receiver<EncodedVoice> {
        std::mem::replace(&mut self.encoded, mpsc::channel().1)
    }
    pub fn start(config: CallConfig, control: Arc<VoiceControl>) -> Result<Self> {
        let generation = control
            .audio_generation()
            .checked_add(1)
            .context("Geração de áudio excedida")?;
        control.prepare_audio_generation(generation, config.ptt_key.is_some());
        Self::start_for_generation(config, control, generation)
    }
    pub fn start_for_generation(
        config: CallConfig,
        control: Arc<VoiceControl>,
        generation: u64,
    ) -> Result<Self> {
        ensure!(
            config.threshold.is_finite() && (-100.0..=0.0).contains(&config.threshold),
            "Sensibilidade inválida"
        );
        ensure!(
            control.owns_audio_generation(generation),
            "Abertura de áudio cancelada"
        );
        let capture = Capture::start(&config.input, control.clone())?;
        ensure!(
            control.owns_audio_generation(generation),
            "Abertura de áudio cancelada"
        );
        let playback = Playback::start(&config.output, control.clone())?;
        ensure!(
            control.owns_audio_generation(generation),
            "Abertura de áudio cancelada"
        );
        let mut encoder = VoiceEncoder::new()?;
        let ptt = if let Some(key) = &config.ptt_key {
            Some(GlobalPtt::start_for_generation(
                control.clone(),
                key,
                generation,
            )?)
        } else {
            None
        };
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (in_tx, in_rx) = mpsc::sync_channel(64);
        let (out_tx, out_rx) = mpsc::sync_channel(8);
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let worker_control = control.clone();
        let worker = std::thread::Builder::new()
            .name("voxy-voice-dsp".into())
            .spawn(move || {
                // Move complete device owners, not just their queue fields. Precise closure
                // capture would otherwise drop the CPAL streams when start() returns.
                let mut capture = capture;
                let mut playback = playback;
                let _ptt = ptt;
                let mut processor =
                    match CaptureProcessor::new(config.echo_cancellation, config.noise_suppression, config.automatic_gain,config.threshold,config.voice_detection)
                    {
                        Ok(processor) => processor,
                        Err(error) => {
                            let _ = ready_tx.send(Err(error.to_string()));
                            return Err(error);
                        }
                    };
                let mut ready = Some(ready_tx);
                let mut remotes: BTreeMap<u64, Remote> = BTreeMap::new();
                let mut mixes: BTreeMap<u64, (f32, bool)> = BTreeMap::new();
                let mut capture_block = [0.0; BLOCK];
                let mut capture_count = 0;
                let mut render = [0.0; BLOCK];
                let mut processed = [0.0; BLOCK];
                let mut outgoing = [0.0; FRAME_SAMPLES];
                let mut outgoing_count = 0;
                let mut packet = [0; 1275];
                let mut next_playout = Instant::now();
                let mut device_watchdog = DeviceWatchdog::new(Instant::now(), &worker_control);
                let mut transmitting = false;
                while !stopping.load(Ordering::Acquire)
                    && !worker_control.device_failed.load(Ordering::Acquire)
                    && worker_control.owns_audio_generation(generation)
                {
                    if !device_watchdog.healthy(Instant::now(), &worker_control) {
                        worker_control.device_failed.store(true, Ordering::Release);
                        anyhow::bail!("Captura ou reprodução parou de responder. Selecione o dispositivo novamente.");
                    }
                    for _ in 0..64 {
                        match in_rx.try_recv() {
                            Ok(Input::Clear) => {
                                remotes.clear();
                                mixes.clear();
                            }
                            Ok(Input::Remove(peer)) => {
                                remotes.remove(&peer);
                                mixes.remove(&peer);
                            }
                            Ok(Input::Packet(frame)) => {
                                if !remotes.contains_key(&frame.peer) && remotes.len() >= 9 {
                                    continue;
                                }
                                let remote = match remotes.entry(frame.peer) {
                                    std::collections::btree_map::Entry::Occupied(e) => e.into_mut(),
                                    std::collections::btree_map::Entry::Vacant(e) => {
                                        let mut remote = Remote::new()?;
                                        if let Some((volume, muted)) = mixes.get(&frame.peer) {
                                            remote.volume = *volume;
                                            remote.muted = *muted;
                                        }
                                        e.insert(remote)
                                    }
                                };
                                if remote.jitter.push(frame.sequence, frame.payload) {
                                    remote.last = Instant::now();
                                }
                            }
                            Ok(Input::Mix {
                                peer,
                                volume,
                                muted,
                            }) => {
                                if mixes.contains_key(&peer) || mixes.len() < 9 {
                                    mixes.insert(peer, (volume, muted));
                                }
                                if let Some(remote) = remotes.get_mut(&peer) {
                                    remote.volume = volume;
                                    remote.muted = muted;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    if Instant::now() >= next_playout {
                        let mut mixed = [0.0_f32; FRAME_SAMPLES];
                        let mut decoded = [0.0; FRAME_SAMPLES];
                        remotes.retain(|_, remote| remote.last.elapsed() < Duration::from_secs(10));
                        for (peer, remote) in remotes.iter_mut() {
                            let Some(data) = remote.jitter.pop() else { continue };
                            let count = remote
                                .decoder
                                .decode(data.as_deref().unwrap_or_default(), &mut decoded)
                                .unwrap_or(0);
                            if data.is_some() && count > 0 {
                                worker_control
                                    .decoded_frames
                                    .fetch_add(1, Ordering::Relaxed);
                                let rms = (decoded[..count].iter().map(|s| s * s).sum::<f32>() / count as f32).sqrt();
                                if let Ok(mut levels) = worker_control.peer_levels.try_lock() {
                                    let peak = levels.entry(*peer).or_insert(0.0);
                                    *peak = peak.max(rms);
                                }
                            }
                            if !remote.muted {
                                for (i, sample) in decoded[..count].iter().enumerate() {
                                    mixed[i] += sample * remote.volume;
                                }
                            }
                        }
                        for sample in mixed {
                            let sample = if worker_control.deafened.load(Ordering::Relaxed) {
                                0.0
                            } else {
                                sample.clamp(-0.98, 0.98)
                            };
                            let _ = playback.samples.push(sample);
                        }
                        next_playout += Duration::from_millis(20);
                        if Instant::now().saturating_duration_since(next_playout)
                            > Duration::from_millis(100)
                        {
                            next_playout = Instant::now() + Duration::from_millis(20);
                        }
                    }
                    while capture_count < BLOCK {
                        match capture.samples.pop() {
                            Ok(sample) => {
                                capture_block[capture_count] = sample;
                                capture_count += 1;
                            }
                            Err(_) => break,
                        }
                    }
                    if capture_count == BLOCK {
                        for sample in &mut render {
                            *sample = playback.rendered.pop().unwrap_or(0.0);
                        }
                        let produced =
                            processor.process(&render, &capture_block, &mut processed,&worker_control)?;
                        worker_control
                            .processed_blocks
                            .fetch_add(1, Ordering::Relaxed);
                        capture_count = 0;
                        if produced {
                            outgoing[outgoing_count..outgoing_count + BLOCK]
                                .copy_from_slice(&processed);
                            outgoing_count += BLOCK;
                            if outgoing_count == FRAME_SAMPLES {
                                // Recheck the complete 20ms frame: mute may have
                                // arrived between its two processing blocks.
                                let allowed = worker_control.may_transmit();
                                if !allowed {
                                    outgoing.fill(0.0);
                                    if transmitting {
                                        encoder.reset()?;
                                    }
                                }
                                transmitting = allowed;
                                if allowed {
                                    let rms = (outgoing.iter().map(|s| s * s).sum::<f32>() / FRAME_SAMPLES as f32).sqrt();
                                    let previous = f32::from_bits(worker_control.sent_level_bits.load(Ordering::Relaxed));
                                    if rms > previous {
                                        worker_control.sent_level_bits.store(rms.to_bits(), Ordering::Relaxed);
                                    }
                                }
                                let size = encoder.encode(&outgoing, &mut packet)?;
                                // Successful device opening alone does not prove a live
                                // capture path. Report readiness only after an encoded frame.
                                if let Some(sender) = ready.take() {
                                    let _ = sender.send(Ok(()));
                                }
                                let _ = out_tx.try_send(EncodedVoice {
                                    payload: packet[..size].to_vec(),
                                    produced_at: Instant::now(),
                                });
                                outgoing_count = 0;
                            }
                        }
                    } else {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
                Ok(())
            })?;
        match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = worker.join();
                anyhow::bail!("{error}")
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                let _ = worker.join();
                anyhow::bail!("Processamento de voz não iniciou no prazo")
            }
        }
        if !control.activate_audio_generation(generation) {
            stop.store(true, Ordering::Release);
            let _ = worker.join();
            anyhow::bail!("Abertura de áudio cancelada");
        }
        Ok(Self {
            control,
            input: VoiceInput(in_tx),
            encoded: out_rx,
            stop,
            worker: Some(worker),
            generation,
        })
    }
    pub fn stop(&mut self) -> Result<()> {
        self.stop.store(true, Ordering::Release);
        self.control.cancel_audio_generation(self.generation);
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| anyhow::anyhow!("Processamento de voz encerrou inesperadamente"))??;
        }
        Ok(())
    }
}
impl Drop for CallAudio {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jitter_recovers_after_muted_sender_without_rtp_sequence_advancement() {
        let mut jitter = JitterBuffer::default();
        assert!(jitter.push(100, vec![1]));
        for _ in 0..3 {
            assert!(jitter.pop().is_none());
        }
        assert_eq!(jitter.pop(), Some(Some(vec![1])));
        for _ in 0..3 {
            assert_eq!(jitter.pop(), Some(None));
        }
        // The sender did not emit packets while muted; its next sequence is 101.
        assert!(jitter.push(101, vec![2]));
        for _ in 0..3 {
            assert!(jitter.pop().is_none());
        }
        assert_eq!(jitter.pop(), Some(Some(vec![2])));
    }
    #[test]
    fn jitter_bounds_loss_bursts_and_handles_wrap_reordering_and_duplicates() {
        let mut jitter = JitterBuffer::default();
        assert!(jitter.push(u16::MAX, vec![1]));
        assert!(jitter.push(1, vec![3]));
        assert!(jitter.push(0, vec![2]));
        assert!(jitter.push(0, vec![9]));
        for _ in 0..3 {
            jitter.pop();
        }
        assert_eq!(jitter.pop(), Some(Some(vec![1])));
        assert_eq!(jitter.pop(), Some(Some(vec![2])));
        assert_eq!(jitter.pop(), Some(Some(vec![3])));
        assert!(!jitter.push(0, vec![9]));
        assert!(jitter.push(400, vec![4]));
        for _ in 0..3 {
            jitter.pop();
        }
        assert_eq!(jitter.pop(), Some(Some(vec![4])));
        assert!(jitter.packets.len() <= 32);
    }
    #[test]
    fn callback_watchdog_requires_capture_and_render_progress() {
        let control = VoiceControl::default();
        let now = Instant::now();
        let mut watchdog = DeviceWatchdog::new(now, &control);
        assert!(watchdog.healthy(now + Duration::from_secs(1), &control));
        control.captured_samples.fetch_add(960, Ordering::Relaxed);
        assert!(watchdog.healthy(now + Duration::from_millis(1900), &control));
        // Capture alone cannot mask a stuck output callback.
        assert!(!watchdog.healthy(now + Duration::from_secs(2), &control));
        control.rendered_samples.fetch_add(960, Ordering::Relaxed);
        assert!(watchdog.healthy(now + Duration::from_millis(2100), &control));
        assert!(!watchdog.healthy(now + Duration::from_secs(4), &control));
    }
}
