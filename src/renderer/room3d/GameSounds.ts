/** Tiny original synthesized cues; no downloads, microphone or voice graph. */
export type GameSoundKind =
  | "raise"
  | "play"
  | "win"
  | "impact"
  | "accept"
  | "clack"
  | "rail"
  | "pocket"
  | "clink"
  | "sip";
export class GameSounds {
  private context?: AudioContext;
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => {});
  }
  play(kind: GameSoundKind, value = 3, gain = 0.5, pan = 0) {
    const c = this.context;
    if (!c || c.state !== "running" || gain <= 0) return;
    if (kind === "clink" || kind === "sip") {
      this.drinks(c, kind, gain, pan);
      return;
    }
    if (kind === "clack" || kind === "rail" || kind === "pocket") {
      this.billiards(c, kind, Math.max(0.15, Math.min(1, value)), gain, pan);
      return;
    }
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
  /** Glass clink for toasts and a soft gulp while sipping. */
  private drinks(
    c: AudioContext,
    kind: "clink" | "sip",
    gain: number,
    pan: number,
  ) {
    const parts: [number, number, number, number][] =
      kind === "clink"
        ? [
            [0, 2650, 0.32, 0.06],
            [0, 3960, 0.22, 0.04],
            [0.09, 2650, 0.25, 0.04],
          ]
        : [
            [0, 210, 0.09, 0.05],
            [0.32, 190, 0.09, 0.045],
          ];
    for (const [delay, freq, duration, level] of parts) {
      const at = c.currentTime + delay,
        osc = c.createOscillator(),
        env = c.createGain(),
        stereo = c.createStereoPanner();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, at);
      if (kind === "sip")
        osc.frequency.exponentialRampToValueAtTime(freq * 0.7, at + duration);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(level * gain, at + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      stereo.pan.value = Math.max(-1, Math.min(1, pan));
      osc.connect(env).connect(stereo).connect(c.destination);
      osc.start(at);
      osc.stop(at + duration + 0.02);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
        stereo.disconnect();
      };
    }
  }
  /** Pool: short ball clack, dull cushion thud, pocket drop with a rattle. */
  private billiards(
    c: AudioContext,
    kind: "clack" | "rail" | "pocket",
    strength: number,
    gain: number,
    pan: number,
  ) {
    const parts: [number, number, number, number, OscillatorType][] =
      kind === "clack"
        ? [
            [0, 2300, 1500, 0.03, "sine"],
            [0, 3600, 2600, 0.018, "sine"],
          ]
        : kind === "rail"
          ? [[0, 150, 70, 0.07, "triangle"]]
          : [
              [0, 210, 80, 0.12, "triangle"],
              [0.07, 420, 260, 0.03, "sine"],
              [0.12, 360, 220, 0.025, "sine"],
            ];
    const level =
      0.07 * gain * (kind === "clack" ? strength : 0.6 + strength * 0.4);
    for (const [delay, from, to, duration, type] of parts) {
      const at = c.currentTime + delay,
        osc = c.createOscillator(),
        env = c.createGain(),
        stereo = c.createStereoPanner();
      osc.type = type;
      osc.frequency.setValueAtTime(from, at);
      osc.frequency.exponentialRampToValueAtTime(to, at + duration);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, level),
        at + 0.003,
      );
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
