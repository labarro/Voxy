/** Tiny original synthesized cues; no downloads, microphone or voice graph. */
export class GameSounds {
  private context?: AudioContext;
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => {});
  }
  play(
    kind: "raise" | "play" | "win" | "impact" | "accept",
    value = 3,
    gain = 0.5,
    pan = 0,
  ) {
    const c = this.context;
    if (!c || c.state !== "running" || gain <= 0) return;
    const base =
      kind === "raise"
        ? 170 + (value / 3) * 35
        : kind === "win"
          ? 440
          : kind === "accept"
            ? 350
            : kind === "impact"
              ? 140
              : 420;
    const count = kind === "raise" ? 2 : kind === "win" ? 3 : 1,
      duration = kind === "play" || kind === "impact" ? 0.065 : 0.15;
    for (let i = 0; i < count; i++) {
      const at = c.currentTime + i * 0.115,
        osc = c.createOscillator(),
        env = c.createGain(),
        stereo = c.createStereoPanner();
      osc.type = kind === "impact" || kind === "play" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(
        base * (kind === "win" ? [1, 1.25, 1.5][i] : 1 + i * 0.35),
        at,
      );
      osc.frequency.exponentialRampToValueAtTime(
        kind === "impact" ? 55 : base * (1 + i * 0.35),
        at + duration,
      );
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.08 * gain, at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      stereo.pan.value = Math.max(-1, Math.min(1, pan));
      osc.connect(env).connect(stereo).connect(c.destination);
      osc.start(at);
      osc.stop(at + duration + 0.01);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
        stereo.disconnect();
      };
    }
  }
  dispose() {
    void this.context?.close().catch(() => {});
  }
}
