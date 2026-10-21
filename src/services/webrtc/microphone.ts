import { peakLimiter } from "./peakLimiter";
import type { Profile } from "../../shared/types";

export function microphoneConstraints(
  p?: Profile,
  input = p?.input ?? "",
): MediaTrackConstraints {
  return {
    deviceId: input ? { exact: input } : undefined,
    echoCancellation: p?.echoCancellation !== false,
    noiseSuppression: p?.noiseSuppression !== false,
    autoGainControl: false,
  };
}

// Threshold is measured before user gain so boosting the volume cannot open
// the gate on background noise. Hysteresis and a hold avoid chopping words.
export class VoiceGate {
  private until = 0;
  private open = false;
  private enabled = false;
  update(db: number, threshold: number, now: number, enabled: boolean) {
    if (enabled !== this.enabled) {
      this.open = false;
      this.until = 0;
      this.enabled = enabled;
    }
    if (!enabled) {
      this.open = true;
      this.until = 0;
      return true;
    }
    if (db >= threshold || (this.open && db >= threshold - 6))
      this.until = now + 250;
    this.open = now < this.until;
    return this.open;
  }
}

export class MicrophonePipeline {
  readonly stream: MediaStream;
  private source: MediaStreamAudioSourceNode;
  private analyser: AnalyserNode;
  private volume: GainNode;
  private gate: GainNode;
  private limiter: WaveShaperNode;
  private destination: MediaStreamAudioDestinationNode;
  private timer: ReturnType<typeof setInterval>;
  private settings: Pick<
    Profile,
    "inputVolume" | "voiceDetection" | "voiceThreshold"
  > = {};
  private detector = new VoiceGate();
  constructor(
    private context: AudioContext,
    readonly raw: MediaStream,
    level: (db: number) => void,
  ) {
    this.source = context.createMediaStreamSource(raw);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.volume = context.createGain();
    this.gate = context.createGain();
    this.gate.gain.value = 0;
    this.limiter = peakLimiter(context);
    this.destination = context.createMediaStreamDestination();
    this.source.connect(this.analyser);
    this.source
      .connect(this.volume)
      .connect(this.gate)
      .connect(this.limiter)
      .connect(this.destination);
    this.stream = this.destination.stream;
    const buffer = new Float32Array(this.analyser.fftSize);
    let ticks = 0;
    let gateOpen = false;
    this.timer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) sum += value * value;
      const db = Math.max(
        -100,
        20 * Math.log10(Math.max(0.00001, Math.sqrt(sum / buffer.length))),
      );
      const open = this.detector.update(
        db,
        this.settings.voiceThreshold ?? -45,
        performance.now(),
        !!this.settings.voiceDetection,
      );
      if (open !== gateOpen) {
        gateOpen = open;
        this.gate.gain.setTargetAtTime(
          open ? 1 : 0,
          context.currentTime,
          open ? 0.005 : 0.015,
        );
      }
      if (++ticks % 2 === 0) level(db);
    }, 50);
  }
  configure(p: Profile) {
    this.settings = p;
    this.volume.gain.setTargetAtTime(
      p.inputVolume ?? 1,
      this.context.currentTime,
      0.015,
    );
  }
  close() {
    clearInterval(this.timer);
    for (const t of this.raw.getTracks()) {
      t.onended = null;
      t.stop();
    }
    this.stream.getTracks().forEach((t) => t.stop());
    this.source.disconnect();
    this.analyser.disconnect();
    this.volume.disconnect();
    this.gate.disconnect();
    this.limiter.disconnect();
    this.destination.disconnect();
  }
}
