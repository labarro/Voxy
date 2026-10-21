import { peakLimiter } from "./peakLimiter";
// One graph per participant. HTMLMediaElement.volume cannot amplify above 1.
export class VoicePlayback {
  readonly stream: MediaStream;
  private source: MediaStreamAudioSourceNode;
  private gain: GainNode;
  private limiter: WaveShaperNode;
  private destination: MediaStreamAudioDestinationNode;
  constructor(
    private context: AudioContext,
    input: MediaStream,
    volume: number,
  ) {
    this.source = context.createMediaStreamSource(input);
    this.gain = context.createGain();
    this.limiter = peakLimiter(context);
    this.destination = context.createMediaStreamDestination();
    this.source
      .connect(this.gain)
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
  close() {
    this.source.disconnect();
    this.gain.disconnect();
    this.limiter.disconnect();
    this.destination.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
