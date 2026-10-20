import type { Participant, Signal, Profile } from "../../shared/types";
import { MAX_PARTICIPANTS } from "../../shared/constants";
import { microphoneMuted } from "../../shared/preferences";
import { MicrophonePipeline } from "./microphone";
export const qualities = {
  "720p15": { width: 1280, height: 720, fps: 15, bitrate: 1800000 },
  "720p30": { width: 1280, height: 720, fps: 30, bitrate: 3000000 },
  "1080p30": { width: 1920, height: 1080, fps: 30, bitrate: 5000000 },
  "1080p60": { width: 1920, height: 1080, fps: 60, bitrate: 8000000 },
};
export type Quality = keyof typeof qualities;
export type Diagnostic = {
  id: string;
  connection: string;
  ice: string;
  signaling: string;
  codec?: string;
  kbps?: number;
  width?: number;
  height?: number;
  fps?: number;
  loss?: number;
  rtt?: number;
};
type Peer = {
  pc: RTCPeerConnection;
  mic?: RTCRtpTransceiver;
  video?: RTCRtpTransceiver;
  system?: RTCRtpTransceiver;
  pending: RTCIceCandidateInit[];
  queue: Promise<void>;
  audio: HTMLAudioElement;
  systemAudio: HTMLAudioElement;
  stream: MediaStream;
  monitor?: () => void;
  lastBytes: number;
  lastTime: number;
  restart?: ReturnType<typeof setTimeout>;
};
export type VoiceView = {
  streams: Map<string, MediaStream>;
  speaking: Set<string>;
  diagnostics: Diagnostic[];
  sharing: boolean;
  local?: MediaStream;
  error: string;
  micOpen?: boolean;
  micLevelDb?: number;
};
export class VoiceEngine {
  private peers = new Map<string, Peer>();
  private earlySignals = new Map<string, Signal[]>();
  private microphone?: MediaStream;
  private pipeline?: MicrophonePipeline;
  private preferences?: Profile;
  private sharingPeers = new Set<string>();
  private screen?: MediaStream;
  private context?: AudioContext;
  private stopLocalMeter?: () => void;
  private interval?: ReturnType<typeof setInterval>;
  private active = false;
  private generation = 0;
  private self = "";
  private watching: string | null = null;
  private muted = false;
  private deafened = false;
  private output = "";
  private input = "";
  private quality: Quality = "720p30";
  private volumes = new Map<string, number>();
  private streamVolumes = new Map<string, number>();
  private mutedParticipants = new Map<string, boolean>();
  private peerProfiles = new Map<string, string>();
  private pttEnabled = false;
  private pressed = false;
  private callSounds = true;
  private channel: string | null = null;
  private busy = false;
  view: VoiceView = {
    streams: new Map(),
    speaking: new Set(),
    diagnostics: [],
    sharing: false,
    error: "",
  };
  constructor(
    private send: (signal: Signal) => Promise<void>,
    private update: (view: VoiceView) => void,
    private sharingChanged: (value: boolean) => void,
    private micChanged: (muted: boolean) => void = () => {},
  ) {}
  private publish(patch: Partial<VoiceView> = {}) {
    this.view = { ...this.view, ...patch };
    this.update(this.view);
  }
  private error(e: unknown) {
    this.publish({ error: (e as Error).message || "Falha de mídia." });
  }
  async join(self: string, input: string) {
    this.leave();
    const generation = ++this.generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: input ? { exact: input } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("Entrada na chamada cancelada.");
      }
      this.self = self;
      this.input = input;
      this.active = true;
      this.context = new AudioContext();
      this.pipeline = this.createMicrophone(stream);
      this.microphone = this.pipeline.stream;
      await this.context.resume();
      this.stopLocalMeter = this.meter(this.microphone, self);
      this.applyMicrophone();
      stream.getAudioTracks()[0].onended = () =>
        this.error(
          Error(
            "Microfone desconectado. Selecione outra entrada nas configurações.",
          ),
        );
      this.interval = setInterval(() => void this.stats(), 2000);
      this.publish({ error: "" });
    } catch (e) {
      if (generation === this.generation) this.leave();
      throw e;
    }
  }
  sync(participants: Participant[], selfId: string) {
    if (!this.active || selfId !== this.self) return;
    const me = participants.find((p) => p.id === selfId);
    if (!me?.channelId) {
      this.leave();
      return;
    }
    const sharing = new Set(
      participants
        .filter((p) => p.channelId === me.channelId && p.sharing)
        .map((p) => p.id),
    );
    if (
      this.channel === me.channelId &&
      [...sharing].some((id) => !this.sharingPeers.has(id))
    )
      this.chime("share");
    this.sharingPeers = sharing;
    const ids = new Set(
      participants
        .filter((p) => p.id !== selfId && p.channelId === me.channelId)
        .map((p) => p.id),
    );
    this.peerProfiles = new Map(participants.map((p) => [p.id, p.profile.id]));
    const entered =
      this.channel !== me.channelId ||
      [...ids].some((id) => !this.peers.has(id));
    const left = [...this.peers.keys()].some((id) => !ids.has(id));
    if (entered) this.chime("join");
    if (left) this.chime("leave");
    this.channel = me.channelId;
    for (const id of this.peers.keys()) if (!ids.has(id)) this.remove(id);
    for (const id of ids) if (!this.peers.has(id)) this.create(id);
  }
  private create(id: string) {
    const pc = new RTCPeerConnection({
      iceServers: [],
      bundlePolicy: "max-bundle",
    });
    // Only the elected offerer creates m-lines. The answerer adopts the three
    // incoming transceivers; pre-creating them would leave duplicate, inactive slots.
    if (this.self < id) {
      pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "sendrecv" });
      pc.addTransceiver("audio", { direction: "sendrecv" });
    }
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = this.deafened || this.isParticipantMuted(id);
    audio.volume = this.getVolume(id);
    const systemAudio = new Audio();
    systemAudio.autoplay = true;
    systemAudio.muted = this.deafened || this.watching !== id;
    systemAudio.volume = this.getVolume(id, true);
    const peer: Peer = {
      pc,
      pending: [],
      queue: Promise.resolve(),
      audio,
      systemAudio,
      stream: new MediaStream(),
      lastBytes: 0,
      lastTime: 0,
    };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        void this.send({ to: id, candidate: e.candidate.toJSON() }).catch((e) =>
          this.error(e),
        );
    };
    pc.ontrack = (e) => {
      if (e.transceiver.mid === "0") {
        audio.srcObject = new MediaStream([e.track]);
        void this.applyOutput(audio).catch((e) => this.error(e));
        void audio
          .play()
          .catch(() =>
            this.error(Error("Clique em Retomar áudio para ouvir a chamada.")),
          );
        peer.monitor?.();
        peer.monitor = this.meter(new MediaStream([e.track]), id);
      } else if (e.transceiver.mid === "1") {
        peer.stream.addTrack(e.track);
        this.publish({
          streams: new Map([...this.peers].map(([key, p]) => [key, p.stream])),
        });
      } else {
        systemAudio.srcObject = new MediaStream([e.track]);
        void this.applyOutput(systemAudio).catch((e) => this.error(e));
        e.track.onunmute = () =>
          void systemAudio
            .play()
            .catch(() =>
              this.error(
                Error("Clique em Retomar áudio para ouvir a transmissão."),
              ),
            );
      }
    };
    pc.onconnectionstatechange = () => {
      void this.stats();
      if (pc.connectionState === "connected" && peer.restart) {
        clearTimeout(peer.restart);
        peer.restart = undefined;
      }
      if (
        ["failed", "disconnected"].includes(pc.connectionState) &&
        !peer.restart
      ) {
        peer.restart = setTimeout(() => {
          peer.restart = undefined;
          if (!this.peers.has(id)) return;
          if (this.self < id)
            this.enqueue(peer, async () => {
              await pc.setLocalDescription(
                await pc.createOffer({ iceRestart: true }),
              );
              await this.send({
                to: id,
                description: pc.localDescription!.toJSON(),
              });
            });
          this.error(
            Error(
              "Conexão de mídia interrompida. Verifique Radmin VPN/firewall; tentando recuperar ICE.",
            ),
          );
        }, 4000);
      }
    };
    this.enqueue(peer, async () => {
      if (this.self < id) {
        await this.prepare(peer);
        await pc.setLocalDescription(await pc.createOffer());
        await this.send({ to: id, description: pc.localDescription!.toJSON() });
      }
    });
    const pending = this.earlySignals.get(id) ?? [];
    this.earlySignals.delete(id);
    for (const signal of pending) this.signal(signal);
  }
  private async prepare(p: Peer) {
    [p.mic, p.video, p.system] = p.pc.getTransceivers();
    if (!p.mic || !p.video || !p.system)
      throw Error("Contrato de trilhas de mídia inválido.");
    for (const transceiver of [p.mic, p.video, p.system])
      transceiver.direction = "sendrecv";
    const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs;
    if (codecs)
      p.video.setCodecPreferences([
        ...codecs.filter((c) => c.mimeType === "video/VP8"),
        ...codecs.filter((c) => c.mimeType !== "video/VP8"),
      ]);
    await p.mic.sender.replaceTrack(
      this.microphone?.getAudioTracks()[0] ?? null,
    );
    await p.video.sender.replaceTrack(this.screen?.getVideoTracks()[0] ?? null);
    await p.system.sender.replaceTrack(
      this.screen?.getAudioTracks()[0] ?? null,
    );
  }
  private enqueue(p: Peer, fn: () => Promise<void>) {
    p.queue = p.queue
      .then(async () => {
        if (p.pc.signalingState !== "closed") await fn();
      })
      .catch((e) => {
        if (p.pc.signalingState !== "closed") this.error(e);
      });
  }
  signal(s: Signal) {
    const p = s.from ? this.peers.get(s.from) : undefined;
    if (!p) {
      if (
        this.active &&
        s.from &&
        (this.earlySignals.has(s.from) ||
          this.earlySignals.size < MAX_PARTICIPANTS - 1)
      ) {
        const pending = this.earlySignals.get(s.from) ?? [];
        if (pending.length < 40) {
          pending.push(s);
          this.earlySignals.set(s.from, pending);
        }
      }
      return;
    }
    this.enqueue(p, async () => {
      if (s.description) {
        await p.pc.setRemoteDescription(s.description);
        if (s.description.type === "offer") {
          await this.prepare(p);
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          await this.send({
            to: s.from!,
            description: p.pc.localDescription!.toJSON(),
          });
        }
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c);
        await this.bitrate(p);
      } else if (s.candidate) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(s.candidate);
        else p.pending.push(s.candidate);
      }
    });
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.applyMicrophone();
  }
  isMuted() {
    return microphoneMuted(this.muted, this.pttEnabled, this.pressed);
  }
  private applyMicrophone() {
    const muted = this.isMuted();
    this.microphone?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    if (muted) {
      const speaking = new Set(this.view.speaking);
      speaking.delete(this.self);
      this.publish({ speaking });
    }
    this.publish({ micOpen: !muted });
    this.micChanged(muted);
  }
  configurePreferences(p: Profile) {
    this.preferences = p;
    this.pipeline?.configure(p);
    this.volumes = new Map(Object.entries(p.volumes ?? {}));
    this.streamVolumes = new Map(Object.entries(p.streamVolumes ?? {}));
    this.mutedParticipants = new Map(Object.entries(p.mutedParticipants ?? {}));
    const enabled = !!p.pttEnabled;
    if (enabled !== this.pttEnabled) this.pressed = false;
    this.pttEnabled = enabled;
    this.callSounds = p.callSounds !== false;
    this.applyMicrophone();
    for (const [id, peer] of this.peers) {
      peer.audio.muted = this.deafened || this.isParticipantMuted(id);
      peer.audio.volume = this.getVolume(id);
      peer.systemAudio.volume = this.getVolume(id, true);
    }
  }
  setPttPressed(pressed: boolean) {
    this.pressed = pressed;
    this.applyMicrophone();
  }
  private chime(kind: "join" | "leave" | "share") {
    if (!this.callSounds || this.deafened || !this.context) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.frequency.value = (
        kind === "share"
          ? [660, 880]
          : kind === "join"
            ? [440, 660]
            : [660, 330]
      )[i];
      const start = now + i * 0.1;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.09);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.1);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  }
  setDeafened(value: boolean) {
    this.deafened = value;
    for (const [id, p] of this.peers) {
      p.audio.muted = value || this.isParticipantMuted(id);
      p.systemAudio.muted = value || this.watching !== id;
    }
  }
  setWatching(id: string | null) {
    this.watching = id;
    for (const [key, p] of this.peers)
      p.systemAudio.muted = this.deafened || key !== id;
  }
  isParticipantMuted(id: string) {
    return this.mutedParticipants.get(this.peerProfiles.get(id) ?? id) === true;
  }
  muteParticipant(
    id: string,
    muted: boolean,
    profileId = this.peerProfiles.get(id) ?? id,
  ) {
    this.mutedParticipants.set(profileId, muted);
    const peer = this.peers.get(id);
    if (peer) peer.audio.muted = this.deafened || muted;
  }
  getVolume(id: string, stream = false) {
    return (
      (stream ? this.streamVolumes : this.volumes).get(
        this.peerProfiles.get(id) ?? id,
      ) ?? 1
    );
  }
  volume(id: string, value: number, stream = false) {
    value = Math.min(1, Math.max(0, value));
    (stream ? this.streamVolumes : this.volumes).set(
      this.peerProfiles.get(id) ?? id,
      value,
    );
    const p = this.peers.get(id);
    if (p) (stream ? p.systemAudio : p.audio).volume = value;
  }
  async setOutput(id: string) {
    this.output = id;
    if (
      this.context &&
      "setSinkId" in this.context &&
      (id || (this.context as AudioContext & { sinkId?: string }).sinkId)
    )
      await (
        this.context as AudioContext & {
          setSinkId: (id: string) => Promise<void>;
        }
      ).setSinkId(id);
    await Promise.all(
      [...this.peers.values()].flatMap((p) => [
        this.applyOutput(p.audio),
        this.applyOutput(p.systemAudio),
      ]),
    );
  }
  private async applyOutput(el: HTMLMediaElement) {
    if (!this.output && !el.sinkId) return;
    if ("setSinkId" in el)
      await (
        el as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }
      ).setSinkId(this.output);
  }
  resumeAudio() {
    void this.context?.resume();
    for (const p of this.peers.values()) {
      void p.audio.play().catch((e) => this.error(e));
      if (p.systemAudio.srcObject)
        void p.systemAudio.play().catch((e) => this.error(e));
    }
    this.publish({ error: "" });
  }
  async setInput(id: string) {
    if (!this.active || id === this.input) return;
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: id ? { exact: id } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const pipeline = this.createMicrophone(stream);
    pipeline.stream.getAudioTracks()[0].enabled = !this.isMuted();
    try {
      await Promise.all(
        [...this.peers.values()].map((p) =>
          p.mic?.sender.replaceTrack(pipeline.stream.getAudioTracks()[0]),
        ),
      );
    } catch (e) {
      await Promise.allSettled(
        [...this.peers.values()].map((p) =>
          p.mic?.sender.replaceTrack(
            this.microphone?.getAudioTracks()[0] ?? null,
          ),
        ),
      );
      pipeline.close();
      throw e;
    }
    if (generation !== this.generation) {
      pipeline.close();
      return;
    }
    this.stopLocalMeter?.();
    this.pipeline?.close();
    this.pipeline = pipeline;
    this.microphone = pipeline.stream;
    this.input = id;
    stream.getAudioTracks()[0].onended = () =>
      this.error(Error("Microfone desconectado."));
    this.stopLocalMeter = this.meter(this.microphone, this.self);
  }
  private createMicrophone(raw: MediaStream) {
    try {
      const pipeline = new MicrophonePipeline(this.context!, raw, (db) =>
        this.publish({ micLevelDb: db }),
      );
      if (this.preferences) pipeline.configure(this.preferences);
      return pipeline;
    } catch (e) {
      raw.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }
  async share(source: string, audio: boolean, quality: Quality) {
    if (!this.active || this.busy)
      throw Error("Entre em um canal de voz antes de compartilhar.");
    this.busy = true;
    const generation = this.generation;
    try {
      await this.stopShare();
      await window.voxy.selectSource(source, audio);
      const q = qualities[quality];
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: q.width },
          height: { ideal: q.height },
          frameRate: { ideal: q.fps, max: q.fps },
        },
        audio,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.screen = stream;
      this.quality = quality;
      const track = stream.getVideoTracks()[0];
      track.contentHint = "detail";
      track.onended = () => void this.stopShare();
      await Promise.all(
        [...this.peers.values()].map(async (p) => {
          await p.queue;
          await p.video?.sender.replaceTrack(track);
          await p.system?.sender.replaceTrack(
            stream.getAudioTracks()[0] ?? null,
          );
          await this.bitrate(p);
        }),
      );
      this.publish({
        sharing: true,
        local: stream,
        error:
          audio && !stream.getAudioTracks().length
            ? "A fonte não forneceu áudio do sistema. A tela está sendo transmitida."
            : "",
      });
      this.sharingChanged(true);
    } catch (e) {
      await this.stopShare();
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async setQuality(quality: Quality) {
    this.quality = quality;
    const q = qualities[quality];
    if (this.screen)
      await this.screen.getVideoTracks()[0].applyConstraints({
        width: { ideal: q.width },
        height: { ideal: q.height },
        frameRate: { ideal: q.fps, max: q.fps },
      });
    await Promise.all([...this.peers.values()].map((p) => this.bitrate(p)));
  }
  private async bitrate(p: Peer) {
    if (!p.video) return;
    const params = p.video.sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = qualities[this.quality].bitrate;
    params.encodings[0].maxFramerate = qualities[this.quality].fps;
    params.degradationPreference = "maintain-resolution";
    await p.video.sender.setParameters(params);
  }
  async stopShare() {
    const stream = this.screen;
    this.screen = undefined;
    stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    await Promise.all(
      [...this.peers.values()].map(async (p) => {
        try {
          await p.video?.sender.replaceTrack(null);
          await p.system?.sender.replaceTrack(null);
        } catch {
          /* Peer already closing. */
        }
      }),
    );
    const was = this.view.sharing;
    this.publish({ sharing: false, local: undefined });
    if (was) this.sharingChanged(false);
  }
  private meter(stream: MediaStream, id: string) {
    if (!this.context) return () => {};
    const source = this.context.createMediaStreamSource(stream),
      analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let hold = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const v of buffer) sum += v * v;
      const level = Math.sqrt(sum / buffer.length);
      if (level > 0.022) hold = Date.now() + 220;
      const active = Date.now() < hold && !(id === this.self && this.isMuted());
      if (active !== this.view.speaking.has(id)) {
        const speaking = new Set(this.view.speaking);
        active ? speaking.add(id) : speaking.delete(id);
        this.publish({ speaking });
      }
    }, 100);
    return () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
    };
  }
  private async stats() {
    const diagnostics: Diagnostic[] = [];
    for (const [id, p] of this.peers) {
      const d: Diagnostic = {
        id,
        connection: p.pc.connectionState,
        ice: p.pc.iceConnectionState,
        signaling: p.pc.signalingState,
      };
      try {
        const stats = await p.pc.getStats();
        stats.forEach((s) => {
          if (s.type === "outbound-rtp" && s.kind === "video") {
            if (s.frameWidth) {
              d.width = s.frameWidth;
              d.height = s.frameHeight;
              d.fps = s.framesPerSecond;
            }
            const elapsed = s.timestamp - p.lastTime;
            if (p.lastTime && elapsed > 0)
              d.kbps = Math.round(((s.bytesSent - p.lastBytes) * 8) / elapsed);
            p.lastBytes = s.bytesSent;
            p.lastTime = s.timestamp;
            d.codec = stats.get(s.codecId)?.mimeType;
          }
          if (s.type === "inbound-rtp") {
            d.loss = (d.loss ?? 0) + (s.packetsLost ?? 0);
            if (s.kind === "video" && !d.width) {
              d.width = s.frameWidth;
              d.height = s.frameHeight;
              d.fps = s.framesPerSecond;
              d.codec = stats.get(s.codecId)?.mimeType;
            }
          }
          if (
            s.type === "candidate-pair" &&
            s.state === "succeeded" &&
            s.nominated
          )
            d.rtt =
              typeof s.currentRoundTripTime === "number"
                ? Math.round(s.currentRoundTripTime * 1000)
                : undefined;
        });
      } catch {
        /* Closed during stats. */
      }
      diagnostics.push(d);
    }
    this.publish({ diagnostics });
  }
  private remove(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.restart);
    p.pc.onconnectionstatechange = null;
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.close();
    p.monitor?.();
    p.audio.pause();
    p.audio.srcObject = null;
    p.systemAudio.pause();
    p.systemAudio.srcObject = null;
    this.peers.delete(id);
    const speaking = new Set(this.view.speaking);
    speaking.delete(id);
    this.publish({
      streams: new Map([...this.peers].map(([key, p]) => [key, p.stream])),
      speaking,
    });
  }
  leave() {
    ++this.generation;
    this.active = false;
    this.channel = null;
    this.sharingPeers.clear();
    this.pressed = false;
    this.earlySignals.clear();
    clearInterval(this.interval);
    this.interval = undefined;
    void this.stopShare();
    for (const id of this.peers.keys()) this.remove(id);
    this.stopLocalMeter?.();
    this.stopLocalMeter = undefined;
    this.pipeline?.close();
    this.pipeline = undefined;
    this.microphone?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.microphone = undefined;
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.context = undefined;
    this.publish({
      speaking: new Set(),
      streams: new Map(),
      diagnostics: [],
      micLevelDb: undefined,
      micOpen: false,
    });
  }
}
