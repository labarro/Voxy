import { POOL, type PoolState } from "./pool";
import type { Avatar3D } from "./types";
export type Point3 = { x: number; y: number; z: number };
const stanceCache = new Map<
  string,
  {
    x: number;
    z: number;
    yaw: number;
    gripHand: 0 | 1;
    cost: number;
    gripDistance: number;
  }
>();
function stanceFor(
  x: number,
  z: number,
  dx: number,
  dz: number,
  appearance?: Avatar3D,
) {
  const height = appearance?.height ?? 1,
    width =
      appearance?.body === "soft"
        ? 1.16
        : appearance?.body === "slim"
          ? 0.87
          : appearance?.body === "athletic"
            ? 1.08
            : 1,
    bend = 1.05 + (height - 1) * 1.2,
    forward = 0.24 + 0.48 * Math.sin(bend),
    shoulderY = height * (0.91 + 0.48 * Math.cos(bend)) - 0.053;
  const cacheKey = [x, z, dx, dz, height, width]
    .map((n) => n.toFixed(5))
    .join("/");
  const cached = stanceCache.get(cacheKey);
  if (cached) return cached;
  const hx = POOL.halfX * POOL.scale + 0.46,
    hz = POOL.halfZ * POOL.scale + 0.46;
  function distance(px: number, pz: number, ox: number, oz: number) {
    let length = Infinity;
    if (Math.abs(ox) > 0.00001)
      length = Math.min(length, ((ox > 0 ? hx : -hx) - px) / ox);
    if (Math.abs(oz) > 0.00001)
      length = Math.min(length, ((oz > 0 ? hz : -hz) - pz) / oz);
    return Math.max(0.65, length + 0.025);
  }
  const candidates: {
    x: number;
    z: number;
    yaw: number;
    gripHand: 0 | 1;
    cost: number;
    gripDistance: number;
  }[] = [];
  let gripDistance = 0.8;
  function add(px: number, pz: number, yaw: number, gripHand: 0 | 1) {
    const bridge = {
        x: x - dx * (gripDistance - 0.52),
        z: z - dz * (gripDistance - 0.52),
      },
      grip = { x: x - dx * gripDistance, z: z - dz * gripDistance };
    let cost = (gripDistance - 0.8) * 0.12;
    for (const [hand, target] of [
      [gripHand, grip],
      [gripHand, { x: grip.x - dx * 0.17, z: grip.z - dz * 0.17 }],
      [1 - gripHand, bridge],
    ] as [number, { x: number; z: number }][]) {
      const side = hand === 0 ? -1 : 1,
        shoulder = {
          x:
            px + side * 0.295 * width * Math.cos(yaw) + forward * Math.sin(yaw),
          z:
            pz - side * 0.295 * width * Math.sin(yaw) + forward * Math.cos(yaw),
        };
      const reach = Math.hypot(
        ((target.x - shoulder.x) * Math.cos(yaw) -
          (target.z - shoulder.z) * Math.sin(yaw)) /
          width,
        (target.x - shoulder.x) * Math.sin(yaw) +
          (target.z - shoulder.z) * Math.cos(yaw),
        (POOL.clothY + POOL.radius * POOL.scale - shoulderY) / height,
      );
      cost += reach * reach + Math.max(0, reach - 0.61) * 10;
    }
    candidates.push({
      x: px + POOL.x,
      z: pz + POOL.z,
      yaw,
      gripHand,
      cost,
      gripDistance,
    });
  }
  for (gripDistance = 0.8; gripDistance <= 1.401; gripDistance += 0.1) {
    const mx = x - dx * (gripDistance - 0.26),
      mz = z - dz * (gripDistance - 0.26);
    for (const sign of [-1, 1]) {
      const fx = dz * sign,
        fz = -dx * sign,
        t = distance(mx, mz, -fx, -fz);
      add(mx - fx * t, mz - fz * t, Math.atan2(fx, fz), sign === 1 ? 1 : 0);
    }
    for (const sign of [-1, 1]) {
      const rightX = dz,
        rightZ = -dx,
        px = x - rightX * 0.3 * sign,
        pz = z - rightZ * 0.3 * sign,
        t = distance(px, pz, -dx, -dz);
      add(px - dx * t, pz - dz * t, Math.atan2(dx, dz), sign === 1 ? 1 : 0);
    }
    for (const side of [-1, 1])
      for (const offset of [-0.5, -0.25, 0, 0.25, 0.5])
        for (const axis of ["x", "z"] as const) {
          const px =
              axis === "x"
                ? side * hx
                : Math.max(-hx, Math.min(hx, mx + offset)),
            pz =
              axis === "z"
                ? side * hz
                : Math.max(-hz, Math.min(hz, mz + offset)),
            yaw = Math.atan2(mx - px, mz - pz);
          for (const twist of [-0.35, 0, 0.35])
            for (const hand of [0, 1] as const) add(px, pz, yaw + twist, hand);
        }
  }
  const result = candidates.sort((a, b) => a.cost - b.cost)[0];
  if (stanceCache.size > 256) stanceCache.clear();
  stanceCache.set(cacheKey, result);
  return result;
}
export function poolStroke(s: PoolState, appearance?: Avatar3D) {
  const age = s.shot ? s.clock - s.shot.started : Infinity,
    active = age >= 0 && age < 1.35;
  const aim = active ? s.shot : s.aim,
    angle = aim?.angle ?? 0,
    power = aim?.power ?? 0.55;
  const ball = active ? s.shot! : s.balls[0],
    d = { x: Math.sin(angle), z: -Math.cos(angle) };
  let draw = 0.025 + Math.sin(s.clock * 3) * 0.012;
  if (active) {
    if (age < 0.43)
      draw = 0.025 + 0.14 * power * Math.sin(((age / 0.43) * Math.PI) / 2);
    else if (age < POOL.contact)
      draw =
        (0.025 + 0.14 * power) *
        (1 - (age - 0.43) / (POOL.contact - 0.43)) ** 2;
    else if (age < 0.8)
      draw = -0.08 * Math.sin((((age - POOL.contact) / 0.15) * Math.PI) / 2);
    else draw = -0.08 * (1 - Math.min(1, (age - 0.8) / 0.55));
  }
  const origin = {
    x: POOL.x + ball.x * POOL.scale,
    y: POOL.clothY + POOL.radius * POOL.scale,
    z: POOL.z + ball.z * POOL.scale,
  };
  const at = (distance: number): Point3 => ({
    x: origin.x - d.x * distance,
    y: origin.y + 0.008 * distance,
    z: origin.z - d.z * distance,
  });
  const stance = stanceFor(
    ball.x * POOL.scale,
    ball.z * POOL.scale,
    d.x,
    d.z,
    appearance,
  );
  return {
    tip: at(POOL.radius * POOL.scale + draw),
    bridge: at(stance.gripDistance - 0.52),
    grip: at(stance.gripDistance + draw),
    origin,
    d,
    angle,
    age,
    active,
    stance,
    actor: aim?.actor,
  };
}
