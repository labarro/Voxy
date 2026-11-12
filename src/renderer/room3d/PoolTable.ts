import * as T from "three";
import { POOL, pockets, newPool, type PoolState } from "../../shared/pool";
import { Resources } from "./resources";

export class PoolTable {
  private r = new Resources();
  readonly group = new T.Group();
  private balls: T.Mesh[] = [];
  constructor(scene: T.Scene, colliders: T.Object3D[]) {
    const r = this.r,
      g = this.group;
    g.position.set(POOL.x, 0, POOL.z);
    scene.add(g);
    const base = r.box(g, 0, 0.8, 0, 3, 0.5, 5.1, "#624334", 0.12);
    colliders.push(base);
    r.box(g, 0, 1.07, 0, 2.5, 0.045, 4.6, "#377b70", 0.015);
    for (const x of [-1.38, 1.38])
      r.box(g, x, 1.12, 0, 0.25, 0.22, 5.1, "#926c4a", 0.06);
    for (const z of [-2.43, 2.43])
      r.box(g, 0, 1.12, z, 2.55, 0.22, 0.26, "#926c4a", 0.06);
    for (const x of [-1, 1])
      for (const z of [-1.9, 1.9])
        r.box(g, x, 0.35, z, 0.32, 0.7, 0.32, "#493a34", 0.04);
    for (const p of pockets)
      r.cylinder(g, p.x, 1.103, p.z, 0.21, 0.17, 0.025, "#172e2b");
    // Cues on the wall-side rack; each has a ferrule and tip.
    const rack = new T.Group();
    rack.name = "cue-rack";
    rack.position.set(2.25, 0, -1.65);
    g.add(rack);
    r.box(rack, 0, 0.12, 0, 0.75, 0.18, 0.42, "#624334", 0.04);
    r.box(rack, 0, 1.85, -0.11, 0.75, 0.12, 0.18, "#624334", 0.03);
    for (const x of [-0.2, 0.2]) {
      const cue = new T.Group();
      cue.name = "complete-cue";
      cue.position.set(x, 0.21, 0);
      cue.rotation.x = -0.055;
      rack.add(cue);
      // Local Y is the authored centerline for every touching component.
      r.cylinder(cue, 0, 0.44, 0, 0.023, 0.033, 0.88, "#664737");
      r.cylinder(cue, 0, 1.33, 0, 0.011, 0.023, 0.9, "#d4ba85");
      r.cylinder(cue, 0, 1.795, 0, 0.011, 0.011, 0.03, "#eee1bf");
      r.cylinder(cue, 0, 1.815, 0, 0.011, 0.011, 0.01, "#8eafbd");
    }
    const colors = [
      "#f0ece0",
      "#e6bc56",
      "#6286c0",
      "#c76b64",
      "#9779ad",
      "#d78c51",
      "#61a38a",
      "#a85b6f",
    ];
    for (const b of newPool().balls) {
      const ball = r.sphere(g, b.x, 1.18, b.z, POOL.radius, colors[b.id]);
      this.balls.push(ball);
    }
  }
  update(state?: PoolState, dt = 0.025) {
    const s = state ?? newPool();
    for (const b of s.balls) {
      const m = this.balls[b.id];
      m.visible = !b.sunk;
      m.position.lerp(new T.Vector3(b.x, 1.18, b.z), 1 - Math.exp(-dt * 28));
    }
  }
  dispose() {
    this.r.dispose();
    this.group.removeFromParent();
  }
}
