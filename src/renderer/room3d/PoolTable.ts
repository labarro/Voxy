import * as T from "three";
import { POOL, pockets, newPool, type PoolState } from "../../shared/pool";
import { Resources } from "./resources";
import { playingCue } from "./PlayingCue";

export class PoolTable {
  private r = new Resources();
  readonly group = new T.Group();
  private balls: T.Mesh[] = [];
  private sink = new Map<number, number>();
  private guide: T.Line;
  private ghost: T.Mesh;
  private board = document.createElement("canvas");
  private boardTexture: T.CanvasTexture;
  private boardText = "";
  constructor(scene: T.Scene, colliders: T.Object3D[]) {
    const r = this.r,
      g = this.group,
      s = POOL.scale,
      hx = POOL.halfX * s,
      hz = POOL.halfZ * s,
      p = POOL.pocket * s;
    g.position.set(POOL.x, 0, POOL.z);
    scene.add(g);
    const base = r.box(
      g,
      0,
      0.72,
      0,
      hx * 2 + 0.22,
      0.28,
      hz * 2 + 0.22,
      "#594238",
      0.09,
    );
    colliders.push(base);
    r.box(g, 0, 0.57, 0, hx * 2 - 0.15, 0.1, hz * 2 - 0.15, "#302d2d", 0.035);
    for (const x of [-hx + 0.13, hx - 0.13])
      for (const z of [-hz + 0.23, hz - 0.23]) {
        r.box(g, x, 0.3, z, 0.13, 0.6, 0.15, "#3a3534", 0.025);
        r.box(g, x, 0.065, z, 0.17, 0.09, 0.19, "#242a2d", 0.02);
      }
    // A continuous cloth contour has real pocket cut-outs, with separate rail
    // segments stopping before each opening instead of a slab covering holes.
    const shape = new T.Shape();
    shape.moveTo(-hx + p, -hz);
    shape.lineTo(hx - p, -hz);
    shape.quadraticCurveTo(hx - p, -hz + p, hx, -hz + p);
    shape.lineTo(hx, -p);
    shape.absarc(hx, 0, p, -Math.PI / 2, (-3 * Math.PI) / 2, true);
    shape.lineTo(hx, hz - p);
    shape.quadraticCurveTo(hx - p, hz - p, hx - p, hz);
    shape.lineTo(-hx + p, hz);
    shape.quadraticCurveTo(-hx + p, hz - p, -hx, hz - p);
    shape.lineTo(-hx, p);
    shape.absarc(-hx, 0, p, Math.PI / 2, -Math.PI / 2, true);
    shape.lineTo(-hx, -hz + p);
    shape.quadraticCurveTo(-hx + p, -hz + p, -hx + p, -hz);
    const cloth = new T.Mesh(
      r.keep(new T.ShapeGeometry(shape, 14)),
      r.material("#347b70", 0.96),
    );
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.y = POOL.clothY;
    cloth.receiveShadow = true;
    g.add(cloth);
    for (const x of [-hx - 0.065, hx + 0.065])
      for (const z of [-1, 1]) {
        r.box(
          g,
          x,
          0.879,
          z * (hz / 2),
          0.13,
          0.09,
          hz - 0.23,
          "#99734e",
          0.03,
        );
        r.box(
          g,
          x - Math.sign(x) * 0.065,
          0.913,
          z * (hz / 2),
          0.035,
          0.05,
          hz - 0.25,
          "#286759",
          0.01,
        );
      }
    for (const z of [-hz - 0.065, hz + 0.065]) {
      r.box(g, 0, 0.879, z, hx * 2 - 0.25, 0.09, 0.13, "#99734e", 0.03);
      r.box(
        g,
        0,
        0.913,
        z - Math.sign(z) * 0.065,
        hx * 2 - 0.25,
        0.05,
        0.035,
        "#286759",
        0.01,
      );
    }
    for (const pocket of pockets)
      r.cylinder(
        g,
        pocket.x * s,
        0.864,
        pocket.z * s,
        p * 0.94,
        p * 0.72,
        0.075,
        "#101e1e",
      );
    for (const x of [-hx - 0.065, hx + 0.065])
      for (const z of [-0.7, 0.7]) r.sphere(g, x, 0.929, z, 0.011, "#dfcfad");
    const rack = new T.Group();
    rack.name = "cue-rack";
    rack.position.set(2.25, 0, -1.65);
    g.add(rack);
    r.box(rack, 0, 0.08, 0, 0.5, 0.12, 0.3, "#594238", 0.03);
    r.box(rack, 0, 1.12, -0.06, 0.5, 0.08, 0.12, "#594238", 0.02);
    for (const x of [-0.12, 0.12]) {
      const cue = playingCue(r, rack);
      cue.name = "complete-cue";
      cue.position.set(x, 0.5, 0);
      cue.rotation.x = -Math.PI / 2 + 0.025;
    }
    const colors = [
      "#f5eee0",
      "#e2b843",
      "#547eb3",
      "#b7514e",
      "#7f6599",
      "#cd8241",
      "#468875",
      "#763b47",
    ];
    for (const b of newPool().balls) {
      const ball = r.sphere(
        g,
        b.x * s,
        POOL.clothY + POOL.radius * s,
        b.z * s,
        POOL.radius * s,
        colors[b.id],
      );
      if (b.id) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = colors[b.id];
        ctx.fillRect(0, 0, 256, 128);
        for (const x of [64, 192]) {
          ctx.beginPath();
          ctx.arc(x, 64, 22, 0, Math.PI * 2);
          ctx.fillStyle = "#f5eedb";
          ctx.fill();
          ctx.fillStyle = "#253036";
          ctx.font = "bold 30px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(b.id), x, 65);
        }
        ball.material = r.keep(
          new T.MeshStandardMaterial({
            map: r.keep(new T.CanvasTexture(canvas)),
            roughness: 0.24,
          }),
        );
      }
      ball.name = "pool-ball-" + b.id;
      this.balls.push(ball);
    }
    const geo = r.keep(
      new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
    );
    this.guide = new T.Line(
      geo,
      r.keep(
        new T.LineDashedMaterial({
          color: "#e9edc7",
          dashSize: 0.055,
          gapSize: 0.035,
          transparent: true,
          opacity: 0.8,
        }),
      ),
    );
    g.add(this.guide);
    this.ghost = r.sphere(g, 0, 0, 0, POOL.radius * s, "#dbe9cf");
    this.ghost.material = r.keep(
      new T.MeshBasicMaterial({
        color: "#deebd3",
        wireframe: true,
        transparent: true,
        opacity: 0.45,
      }),
    );
    this.guide.visible = this.ghost.visible = false;
    this.board.width = 1024;
    this.board.height = 256;
    this.boardTexture = r.keep(new T.CanvasTexture(this.board));
    r.box(g, 0, 1.25, -hz - 0.18, 1.15, 0.3, 0.055, "#18282d", 0.025);
    for (const x of [-0.45, 0.45])
      r.box(g, x, 1.02, -hz - 0.18, 0.025, 0.2, 0.035, "#6e604a", 0.005);
    const score = new T.Mesh(
      r.keep(new T.PlaneGeometry(1.12, 0.27)),
      r.keep(new T.MeshBasicMaterial({ map: this.boardTexture })),
    );
    score.position.set(0, 1.25, -hz - 0.145);
    g.add(score);
  }
  update(state?: PoolState, dt = 0.025, names: string[] = [], aim?: number) {
    const s = state ?? newPool(),
      scale = POOL.scale;
    for (const b of s.balls) {
      const m = this.balls[b.id];
      const sink = b.sunk
        ? Math.min(1, (this.sink.get(b.id) ?? 0) + dt * 5)
        : 0;
      this.sink.set(b.id, sink);
      m.visible = sink < 1;
      m.position.set(
        b.x * scale,
        POOL.clothY + POOL.radius * scale - sink * 0.18,
        b.z * scale,
      );
      m.rotation.x += (b.vz * dt) / POOL.radius;
      m.rotation.z -= (b.vx * dt) / POOL.radius;
    }
    this.guide.visible = this.ghost.visible =
      aim !== undefined && s.phase === "aiming";
    if (aim !== undefined) {
      const cue = s.balls[0],
        dx = Math.sin(aim),
        dz = -Math.cos(aim);
      let length = 20;
      for (const [v, d, h] of [
        [cue.x, dx, POOL.halfX],
        [cue.z, dz, POOL.halfZ],
      ])
        if (Math.abs(d) > 1e-5)
          length = Math.min(
            length,
            ((d > 0 ? h - POOL.radius : -h + POOL.radius) - v) / d,
          );
      for (const ball of s.balls.slice(1)) {
        if (ball.sunk) continue;
        const x = ball.x - cue.x,
          z = ball.z - cue.z,
          along = x * dx + z * dz,
          perp = x * x + z * z - along * along,
          rr = (POOL.radius * 2) ** 2;
        if (along > 0 && perp < rr)
          length = Math.min(length, along - Math.sqrt(rr - perp));
      }
      const y = POOL.clothY + POOL.radius * scale;
      this.guide.geometry.setFromPoints([
        new T.Vector3(cue.x * scale, y, cue.z * scale),
        new T.Vector3(
          (cue.x + dx * length) * scale,
          y,
          (cue.z + dz * length) * scale,
        ),
      ]);
      this.guide.computeLineDistances();
      this.ghost.position.set(
        (cue.x + dx * length) * scale,
        y,
        (cue.z + dz * length) * scale,
      );
    }
    const text = JSON.stringify([s.scores, s.turn, s.phase, names]);
    if (text !== this.boardText) {
      this.boardText = text;
      const c = this.board.getContext("2d")!;
      c.fillStyle = "#18282d";
      c.fillRect(0, 0, 1024, 256);
      c.textAlign = "center";
      c.fillStyle = "#d8bc85";
      c.font = "26px sans-serif";
      c.fillText("ROTAÇÃO 7", 512, 42);
      for (let i = 0; i < 2; i++) {
        c.fillStyle = s.turn === i ? "#9bdebd" : "#e6e5dc";
        c.font = "bold 70px sans-serif";
        c.fillText(String(s.scores[i]), 256 + i * 512, 130);
        c.font = "27px sans-serif";
        c.fillText((names[i] || "Livre").slice(0, 19), 256 + i * 512, 195);
      }
      this.boardTexture.needsUpdate = true;
    }
  }
  dispose() {
    this.r.dispose();
    this.group.removeFromParent();
  }
}
