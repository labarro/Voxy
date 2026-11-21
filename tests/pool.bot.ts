import {
  PoolGame,
  POOL,
  pockets,
  HEAD_STRING,
  FOOT_SPOT,
  legalTargets,
  onEight,
  poolMode,
  type PoolState,
} from "../src/shared/pool";
function canPlace(s: PoolState, x: number, z: number) {
  const g = new PoolGame();
  g.state = structuredClone(s);
  try {
    g.place(s.players[s.turn], x, z, s.revision);
    return true;
  } catch {
    return false;
  }
}
export function placement(s: PoolState) {
  if (poolMode(s) === "eight" && s.opening && canPlace(s, 0.35, 1.6))
    return { x: 0.35, z: 1.6 };
  const targets = legalTargets(s)
    .map((id) => s.balls[id])
    .filter((b) => !b.sunk);
  for (const target of targets)
    for (const pocket of pockets) {
      const n = Math.hypot(pocket.x - target.x, pocket.z - target.z),
        dx = (pocket.x - target.x) / n,
        dz = (pocket.z - target.z) / n;
      for (const distance of [0.42, 0.6, 0.9]) {
        const x = target.x - dx * distance,
          z = target.z - dz * distance;
        if (canPlace(s, x, z)) return { x, z };
      }
    }
  for (let x = -1; x < 1; x += 0.2)
    for (let z = s.ballInHand === "kitchen" ? HEAD_STRING + 0.05 : -2; z < 2; z += 0.2)
      if (canPlace(s, x, z)) return { x, z };
  throw Error("No legal cue placement");
}
function simulate(s: PoolState, input: { angle: number; power: number; call?: number }) {
  const g = new PoolGame();
  g.state = structuredClone(s);
  if (input.call !== undefined) g.state.called = input.call;
  g.shoot(s.players[s.turn], input.angle, input.power, s.revision);
  for (let i = 0; i < 2600 && ["preparing", "rolling"].includes(g.state.phase); i++)
    g.step();
  return g.state;
}
function chooseEight(s: PoolState) {
  const cue = s.balls[0];
  if (s.opening)
    return {
      angle: Math.atan2(FOOT_SPOT.x - cue.x, -(FOOT_SPOT.z - cue.z)),
      power: 1,
      pots: 0,
    };
  const me = s.players[s.turn],
    eight = onEight(s);
  type Candidate = { angle: number; power: number; call?: number; cut: number };
  const candidates: Candidate[] = [];
  for (const id of legalTargets(s)) {
    const target = s.balls[id];
    pockets.forEach((pocket, index) => {
      const distance = Math.hypot(pocket.x - target.x, pocket.z - target.z),
        ux = (pocket.x - target.x) / distance,
        uz = (pocket.z - target.z) / distance,
        gx = target.x - ux * POOL.radius * 2,
        gz = target.z - uz * POOL.radius * 2,
        cx = gx - cue.x,
        cz = gz - cue.z,
        length = Math.hypot(cx, cz),
        cut = (cx * ux + cz * uz) / (length || 1);
      if (cut < 0.3) return;
      const angle = Math.atan2(cx, -cz);
      for (const power of [0.2, 0.32, 0.48, 0.7])
        for (const offset of [0, -0.02, 0.02])
          candidates.push({
            angle: angle + offset,
            power,
            call: eight ? index : undefined,
            cut,
          });
    });
  }
  candidates.sort((a, b) => b.cut - a.cut);
  // Safe fallback: hit the nearest legal ball softly (keeps the cushion rule).
  const nearest = legalTargets(s)
    .map((id) => s.balls[id])
    .sort(
      (a, b) =>
        Math.hypot(a.x - cue.x, a.z - cue.z) - Math.hypot(b.x - cue.x, b.z - cue.z),
    )[0];
  let best: { angle: number; power: number; call?: number; score: number } = {
    angle: Math.atan2(nearest.x - cue.x, -(nearest.z - cue.z)),
    power: 0.45,
    call: eight ? 0 : undefined,
    score: -Infinity,
  };
  for (const input of candidates.slice(0, 90)) {
    const after = simulate(s, input);
    const won = after.phase === "finished" && after.winner === me,
      lost = after.phase === "finished" && after.winner !== me,
      keeps = after.phase !== "finished" && after.players[after.turn] === me,
      foul = after.phase === "placing";
    const score = won ? 1000 : lost ? -1000 : keeps ? 100 : foul ? -40 : -input.power;
    if (score > best.score) best = { ...input, score };
    if (won || keeps) return { ...input, pots: 1 };
  }
  const fallback = simulate(s, best);
  if (best.score < 0 && fallback.phase === "placing") {
    // Try the direct hit on every legal ball before accepting a foul.
    for (const id of legalTargets(s)) {
      const b = s.balls[id];
      for (const power of [0.35, 0.6]) {
        const input = {
          angle: Math.atan2(b.x - cue.x, -(b.z - cue.z)),
          power,
          call: best.call,
        };
        const after = simulate(s, input);
        if (after.phase !== "placing" && !(after.phase === "finished" && after.winner !== me))
          return { ...input, pots: 0 };
      }
    }
  }
  return { ...best, pots: 0 };
}
export function chooseShot(s: PoolState): {
  angle: number;
  power: number;
  pots: number;
  call?: number;
} {
  if (poolMode(s) === "eight") return chooseEight(s);
  const cue = s.balls[0],
    target = s.balls.find((b) => b.id && !b.sunk)!;
  let best: { angle: number; power: number; call?: number; score: number } = {
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
