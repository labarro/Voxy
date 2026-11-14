import { walkable, roomBounds } from "./room3d";
import type { RoomPreset } from "./types";
type P = { x: number; z: number };
const step = 0.35;
export function clearWalk(preset: RoomPreset, a: P, b: P) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.09));
  for (let i = 1; i <= n; i++)
    if (
      !walkable(
        preset,
        a.x + ((b.x - a.x) * i) / n,
        a.z + ((b.z - a.z) * i) / n,
      )
    )
      return false;
  return true;
}
export function walkPath(preset: RoomPreset, from: P, to: P): P[] {
  if (!walkable(preset, to.x, to.z)) return [];
  if (clearWalk(preset, from, to)) return [to];
  const snap = (p: P) => ({
      x: Math.round(p.x / step),
      z: Math.round(p.z / step),
    }),
    world = (p: P) => ({ x: p.x * step, z: p.z * step }),
    key = (p: P) => p.x + ":" + p.z;
  const snapped = snap(from),
    starts = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      const p = { x: snapped.x + dx, z: snapped.z + dz },
        w = world(p);
      if (walkable(preset, w.x, w.z) && clearWalk(preset, from, w))
        starts.push(p);
    }
  starts.sort(
    (a, b) =>
      Math.hypot(world(a).x - from.x, world(a).z - from.z) -
      Math.hypot(world(b).x - from.x, world(b).z - from.z),
  );
  if (!starts.length) return [];
  const start = starts[0],
    end = snap(to),
    open = [start],
    scores = new Map([[key(start), 0]]),
    parents = new Map<string, P>(),
    closed = new Set<string>();
  for (let tries = 0; open.length && tries < 7500; tries++) {
    let best = 0;
    for (let i = 1; i < open.length; i++)
      if (
        scores.get(key(open[i]))! +
          Math.hypot(open[i].x - end.x, open[i].z - end.z) <
        scores.get(key(open[best]))! +
          Math.hypot(open[best].x - end.x, open[best].z - end.z)
      )
        best = i;
    const p = open.splice(best, 1)[0],
      k = key(p);
    if (closed.has(k)) continue;
    closed.add(k);
    if (
      Math.hypot(p.x - end.x, p.z - end.z) <= 1.5 &&
      clearWalk(preset, world(p), to)
    ) {
      const route: P[] = [to];
      let cursor: P | undefined = p;
      while (cursor && key(cursor) !== key(start)) {
        route.unshift(world(cursor));
        cursor = parents.get(key(cursor));
      }
      route.unshift(world(start));
      // Remove redundant waypoints without cutting furniture corners.
      const result: P[] = [];
      let previous = from;
      for (let i = 0; i < route.length; i++) {
        if (i + 1 < route.length && clearWalk(preset, previous, route[i + 1]))
          continue;
        result.push(route[i]);
        previous = route[i];
      }
      return result;
    }
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) {
        if (!dx && !dz) continue;
        const n = { x: p.x + dx, z: p.z + dz },
          w = world(n),
          nk = key(n);
        if (
          closed.has(nk) ||
          w.x < roomBounds.minX ||
          w.x > roomBounds.maxX ||
          w.z < roomBounds.minZ ||
          w.z > roomBounds.maxZ ||
          !walkable(preset, w.x, w.z) ||
          !clearWalk(preset, world(p), w)
        )
          continue;
        const score = scores.get(k)! + Math.hypot(dx, dz);
        if (score < (scores.get(nk) ?? Infinity)) {
          scores.set(nk, score);
          parents.set(nk, p);
          open.push(n);
        }
      }
  }
  return [];
}
