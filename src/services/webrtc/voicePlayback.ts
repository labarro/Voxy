import { peakLimiter } from "./peakLimiter";
// One graph per participant. HTMLMediaElement.volume cannot amplify above 1.
export class VoicePlayback {
  readonly stream: MediaStream;
  private source: MediaStreamAudioSourceNode;
  private gain: GainNode;
  private spatialGain: GainNode;
  private pan: StereoPannerNode;
  private limiter: WaveShaperNode;
  private destination: MediaStreamAudioDestinationNode;
  constructor(
    private context: AudioContext,
    input: MediaStream,
    volume: number,
  ) {
    this.source = context.createMediaStreamSource(input);
    this.gain = context.createGain();
    this.spatialGain = context.createGain();
    this.pan = context.createStereoPanner();
    this.limiter = peakLimiter(context);
    this.destination = context.createMediaStreamDestination();
    this.source
      .connect(this.gain)
      .connect(this.spatialGain)
      .connect(this.pan)
      .connect(this.limiter)
      .connect(this.destination);
    this.stream = this.destination.stream;
    this.gain.gain.value = Math.max(0, Math.min(2, volume));
  }
  volume(value: number) {
    this.gain.gain.setTargetAtTime(
      Math.max(0, Math.min(2, value)),
      this.context.currentTime,
      0.015,
    );
  }
  spatial(gain = 1, pan = 0) {
    this.spatialGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, gain)),
      this.context.currentTime,
      0.06,
    );
    this.pan.pan.setTargetAtTime(
      Math.max(-1, Math.min(1, pan)),
      this.context.currentTime,
      0.06,
    );
  }
  close() {
    this.source.disconnect();
    this.gain.disconnect();
    this.spatialGain.disconnect();
    this.pan.disconnect();
    this.limiter.disconnect();
    this.destination.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
