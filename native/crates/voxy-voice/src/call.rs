//! Duplex audio owner independent of GUI, world, async executor and sockets.
//! Device callbacks only move samples through bounded SPSC queues.
use crate::{
    codec::{FRAME_SAMPLES, VoiceDecoder, VoiceEncoder},
    control::{GlobalPtt, VoiceControl},
    devices::{Capture, Playback},
    dsp::VoiceGate,
    processing::{AudioProcessing, BLOCK},
};
use anyhow::{Result, ensure};
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
}
enum Input {
    Packet(IncomingVoice),
    Mix { peer: u64, volume: f32, muted: bool },
}
#[derive(Clone)]
pub struct VoiceInput(SyncSender<Input>);
impl VoiceInput {
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
            automatic_gain: true,
            voice_detection: false,
            threshold: -45.0,
            ptt_key: None,
        }
    }
}
struct Remote {
    decoder: VoiceDecoder,
    packets: BTreeMap<u16, Vec<u8>>,
    next: Option<u16>,
    volume: f32,
    muted: bool,
    prebuffer: u8,
    last: Instant,
}
impl Remote {
    fn new() -> Result<Self> {
        Ok(Self {
            decoder: VoiceDecoder::new()?,
            packets: Default::default(),
            next: None,
            volume: 1.0,
            muted: false,
            prebuffer: 3,
            last: Instant::now(),
        })
    }
}
pub struct CallAudio {
    pub control: Arc<VoiceControl>,
    pub input: VoiceInput,
    pub encoded: Receiver<EncodedVoice>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<()>>>,
}
impl CallAudio {
    pub fn start(config: CallConfig, control: Arc<VoiceControl>) -> Result<Self> {
        ensure!(
            config.threshold.is_finite() && (-100.0..=0.0).contains(&config.threshold),
            "Sensibilidade inválida"
        );
        let capture = Capture::start(&config.input, control.clone())?;
        let playback = Playback::start(&config.output, control.clone())?;
        let mut encoder = VoiceEncoder::new()?;
        let ptt = if let Some(key) = &config.ptt_key {
            control.ptt.store(true, Ordering::Release);
            Some(GlobalPtt::start(control.clone(), key)?)
        } else {
            control.ptt.store(false, Ordering::Release);
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
                    match AudioProcessing::new(40, config.noise_suppression, config.automatic_gain)
                    {
                        Ok(processor) => processor,
                        Err(error) => {
                            let _ = ready_tx.send(Err(error.to_string()));
                            return Err(error);
                        }
                    };
                let mut ready = Some(ready_tx);
                let mut remotes: BTreeMap<u64, Remote> = BTreeMap::new();
                let mut capture_block = [0.0; BLOCK];
                let mut capture_count = 0;
                let mut render = [0.0; BLOCK];
                let mut processed = [0.0; BLOCK];
                let mut outgoing = [0.0; FRAME_SAMPLES];
                let mut outgoing_count = 0;
                let mut gate = VoiceGate::default();
                let mut packet = [0; 1275];
                let mut next_playout = Instant::now();
                while !stopping.load(Ordering::Acquire)
                    && !worker_control.device_failed.load(Ordering::Acquire)
                {
                    for _ in 0..64 {
                        match in_rx.try_recv() {
                            Ok(Input::Packet(frame)) => {
                                if !remotes.contains_key(&frame.peer) && remotes.len() >= 9 {
                                    continue;
                                }
                                let remote = match remotes.entry(frame.peer) {
                                    std::collections::btree_map::Entry::Occupied(e) => e.into_mut(),
                                    std::collections::btree_map::Entry::Vacant(e) => {
                                        e.insert(Remote::new()?)
                                    }
                                };
                                remote.last = Instant::now();
                                if remote.packets.len() >= 32 {
                                    remote.packets.clear();
                                    remote.next = None;
                                    remote.prebuffer = 3;
                                }
                                if let Some(next) = remote.next
                                    && frame.sequence.wrapping_sub(next) >= 32768
                                {
                                    continue;
                                }
                                if remote.next.is_none() {
                                    remote.next = Some(frame.sequence);
                                }
                                remote
                                    .packets
                                    .entry(frame.sequence)
                                    .or_insert(frame.payload);
                            }
                            Ok(Input::Mix {
                                peer,
                                volume,
                                muted,
                            }) => {
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
                        for remote in remotes.values_mut() {
                            if remote.prebuffer > 0 {
                                remote.prebuffer -= 1;
                                continue;
                            }
                            let Some(next) = remote.next else { continue };
                            let data = remote.packets.remove(&next);
                            remote.next = Some(next.wrapping_add(1));
                            let count = remote
                                .decoder
                                .decode(data.as_deref().unwrap_or_default(), &mut decoded)
                                .unwrap_or(0);
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
                            processor.process(&render, &capture_block, &mut processed)?;
                        worker_control
                            .processed_blocks
                            .fetch_add(1, Ordering::Relaxed);
                        capture_count = 0;
                        if produced {
                            gate.process(
                                &mut processed,
                                config.threshold,
                                config.voice_detection,
                                worker_control.gain(),
                            );
                            if !worker_control.may_transmit() {
                                processed.fill(0.0);
                            }
                            outgoing[outgoing_count..outgoing_count + BLOCK]
                                .copy_from_slice(&processed);
                            outgoing_count += BLOCK;
                            if outgoing_count == FRAME_SAMPLES {
                                let size = encoder.encode(&outgoing, &mut packet)?;
                                // Successful device opening alone does not prove a live
                                // capture path. Report readiness only after an encoded frame.
                                if let Some(sender) = ready.take() {
                                    let _ = sender.send(Ok(()));
                                }
                                let _ = out_tx.try_send(EncodedVoice {
                                    payload: packet[..size].to_vec(),
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
        Ok(Self {
            control,
            input: VoiceInput(in_tx),
            encoded: out_rx,
            stop,
            worker: Some(worker),
        })
    }
    pub fn stop(&mut self) -> Result<()> {
        self.stop.store(true, Ordering::Release);
        self.control.pressed.store(false, Ordering::Release);
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
