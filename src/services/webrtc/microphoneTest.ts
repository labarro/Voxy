import type { Profile } from "../../shared/types";
import { MicrophonePipeline, microphoneConstraints } from "./microphone";

// No peer connection or signaling reference: this stream can only be monitored locally.
export class MicrophoneTest {
  private generation = 0;
  private context?: AudioContext;
  private pipeline?: MicrophonePipeline;
  private audio?: HTMLAudioElement;
  async start(
    profile: Profile,
    level: (db: number) => void,
    ended: () => void,
  ) {
    this.stop();
    const generation = this.generation;
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: microphoneConstraints(profile),
      video: false,
    });
    if (generation !== this.generation) {
      raw.getTracks().forEach((t) => t.stop());
      return;
    }
    try {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.pipeline = new MicrophonePipeline(this.context, raw, level);
      this.pipeline.configure(profile);
      this.audio = new Audio();
      this.audio.srcObject = this.pipeline.stream;
      if (profile.output && "setSinkId" in this.audio)
        await this.audio.setSinkId(profile.output);
      if (generation !== this.generation) return;
      await this.context.resume();
      await this.audio.play();
      raw.getAudioTracks()[0].onended = () => {
        this.stop();
        ended();
      };
    } catch (e) {
      raw.getTracks().forEach((t) => t.stop());
      if (generation === this.generation) this.stop();
      throw e;
    }
  }
  configure(profile: Profile) {
    this.pipeline?.configure(profile);
  }
  stop() {
    ++this.generation;
    this.audio?.pause();
    if (this.audio) this.audio.srcObject = null;
    this.audio = undefined;
    this.pipeline?.close();
    this.pipeline = undefined;
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
  }
}
