import type { PoolState } from "../../shared/pool";
// One snapshot of interpolation delay, no client-side billiards simulation.
export class PoolTimeline {
  private samples: PoolState[] = [];
  private received = 0;
  receive(state: PoolState) {
    const previous = this.samples.at(-1);
    if (
      previous?.clock === state.clock &&
      previous.revision === state.revision &&
      JSON.stringify(previous.aim) === JSON.stringify(state.aim)
    )
      return;
    if (previous && state.clock < previous.clock) this.samples = [];
    this.samples.push(structuredClone(state));
    this.samples = this.samples.slice(-8);
    this.received = performance.now();
  }
  sample() {
    const last = this.samples.at(-1);
    if (!last) return undefined;
    const predicted =
      last.clock + (performance.now() - this.received) / 1000 - 0.12;
    const clock = ["preparing", "rolling"].includes(last.phase)
      ? Math.min(last.clock, predicted)
      : predicted;
    const before =
        [...this.samples].reverse().find((s) => s.clock <= clock) ??
        this.samples[0],
      after = this.samples.find((s) => s.clock >= clock) ?? last;
    const alpha =
      after.clock === before.clock
        ? 1
        : Math.max(
            0,
            Math.min(1, (clock - before.clock) / (after.clock - before.clock)),
          );
    return {
      ...before,
      aim: last.aim,
      shot: last.shot,
      clock: Math.max(before.clock, clock),
      balls: before.balls.map((ball, i) => ({
        ...ball,
        x: ball.x + (after.balls[i].x - ball.x) * alpha,
        z: ball.z + (after.balls[i].z - ball.z) * alpha,
      })),
    };
  }
}
