import * as T from "three";
import { POOL } from "../../shared/pool";
import { Resources } from "./resources";
export function playingCue(r: Resources, parent: T.Object3D) {
  const g = new T.Group();
  g.name = "held-pool-cue";
  parent.add(g);
  const tip = 0.8 - POOL.radius * POOL.scale;
  for (const [start, end, r0, r1, color] of [
    [-0.65, 0, 0.024, 0.014, "#664737"],
    [0, tip - 0.026, 0.014, 0.005, "#d8bf8d"],
    [tip - 0.026, tip - 0.006, 0.005, 0.005, "#eee4ca"],
    [tip - 0.006, tip, 0.005, 0.005, "#6babb6"],
  ] as [number, number, number, number, string][]) {
    const part = r.cylinder(
      g,
      0,
      0,
      (start + end) / 2,
      r1,
      r0,
      end - start,
      color,
    );
    part.rotation.x = Math.PI / 2;
  }
  return g;
}
