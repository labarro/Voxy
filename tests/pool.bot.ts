import { PoolGame, POOL, pockets, type PoolState } from "../src/shared/pool";
export function placement(s: PoolState) {
  const target = s.balls.find((b) => b.id && !b.sunk)!;
  for (const pocket of pockets) {
    const n = Math.hypot(pocket.x - target.x, pocket.z - target.z),
      dx = (pocket.x - target.x) / n,
      dz = (pocket.z - target.z) / n;
    for (const distance of [0.42, 0.6, 0.9]) {
      const x = target.x - dx * distance,
        z = target.z - dz * distance;
      const g = new PoolGame();
      g.state = structuredClone(s);
      try {
        g.place(s.players[s.turn], x, z, s.revision);
        return { x, z };
      } catch {}
    }
  }
  for (let x = -1; x < 1; x += 0.2)
    for (let z = -2; z < 2; z += 0.2) {
      const g = new PoolGame();
      g.state = structuredClone(s);
      try {
        g.place(s.players[s.turn], x, z, s.revision);
        return { x, z };
      } catch {}
    }
  throw Error("No legal cue placement");
}
export function chooseShot(s: PoolState) {
  const cue = s.balls[0],
    target = s.balls.find((b) => b.id && !b.sunk)!;
  let best = {
    angle: Math.atan2(target.x - cue.x, -(target.z - cue.z)),
    power: 0.7,
    score: -Infinity,
  };
  const candidates: { angle: number; power: number }[] = [];
  for (const pocket of [...pockets].sort(
    (a, b) =>
      Math.hypot(a.x - target.x, a.z - target.z) -
      Math.hypot(b.x - target.x, b.z - target.z),
  )) {
    const distance = Math.hypot(pocket.x - target.x, pocket.z - target.z),
      gx = target.x - ((pocket.x - target.x) / distance) * POOL.radius * 2,
      gz = target.z - ((pocket.z - target.z) / distance) * POOL.radius * 2,
      angle = Math.atan2(gx - cue.x, -(gz - cue.z));
    for (const power of [0.12, 0.18, 0.24, 0.32, 0.42, 0.55, 0.72])
      for (const offset of [0, -0.025, 0.025])
        candidates.push({ angle: angle + offset, power });
  }
  for (const input of candidates) {
    const g = new PoolGame();
    g.state = structuredClone(s);
    g.shoot(s.players[s.turn], input.angle, input.power, s.revision);
    for (
      let i = 0;
      i < 2600 && ["preparing", "rolling"].includes(g.state.phase);
      i++
    )
      g.step();
    const gain = g.state.scores[s.turn] - s.scores[s.turn],
      score = gain * 100 - (g.state.phase === "placing" ? 20 : 0) - input.power;
    if (score > best.score) best = { ...input, score };
    if (gain > 0 && g.state.phase !== "placing")
      return { ...input, pots: gain };
  }
  return { ...best, pots: 0 };
}
