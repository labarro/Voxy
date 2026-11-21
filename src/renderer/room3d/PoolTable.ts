import * as T from "three";
import {
  POOL,
  pockets,
  newPool,
  ballColor,
  groupOf,
  poolMode,
  HEAD_STRING,
  FOOT_SPOT,
  GROUP_NAMES,
  type PoolState,
} from "../../shared/pool";
import { Resources } from "./resources";
import { playingCue } from "./PlayingCue";

/** Presentation-only events derived from interpolated host snapshots. */
export type PoolSoundEvent = {
  kind: "clack" | "rail" | "pocket";
  x: number;
  z: number;
  strength: number;
};

const S = POOL.scale,
  HX = POOL.halfX * S,
  HZ = POOL.halfZ * S,
  P = POOL.pocket * S,
  R = POOL.radius * S,
  CUSHION = 0.05, // cushion depth behind the nose line (world metres)
  RAIL = 0.13, // visible wood width
  RAIL_TOP = POOL.clothY + 0.075,
  OUTER_X = HX + CUSHION + RAIL,
  OUTER_Z = HZ + CUSHION + RAIL;

function canvasTexture(
  r: Resources,
  size: number,
  draw: (c: CanvasRenderingContext2D, random: () => number) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  draw(canvas.getContext("2d")!, random);
  const texture = r.keep(new T.CanvasTexture(canvas));
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
/** Equirectangular 256×128 ball skin: two number discs on the equator. */
function ballTexture(r: Resources, id: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const c = canvas.getContext("2d")!,
    color = ballColor(id),
    stripe = groupOf(id) === "stripes";
  c.fillStyle = stripe ? "#f6f1e4" : color;
  c.fillRect(0, 0, 256, 128);
  if (stripe) {
    c.fillStyle = color;
    c.fillRect(0, 34, 256, 60);
  }
  for (const x of [64, 192]) {
    c.beginPath();
    c.arc(x, 64, 19, 0, Math.PI * 2);
    c.fillStyle = "#f8f4ea";
    c.fill();
    c.fillStyle = "#16181c";
    c.font = `bold ${id > 9 ? 19 : 23}px "Segoe UI", Arial, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(String(id), x, 65);
    if (id === 6 || id === 9) c.fillRect(x - 6, 77, 12, 2);
  }
  const texture = r.keep(new T.CanvasTexture(canvas));
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
/** Inner outline of the rail: rectangle behind the cushions plus the six pocket cuts. */
function railHole() {
  const e = CUSHION,
    q = Math.sqrt(P * P - e * e),
    points: T.Vector2[] = [];
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    if (a1 > a0) a1 -= Math.PI * 2;
    for (let i = 0; i <= 12; i++) {
      const a = a0 + ((a1 - a0) * i) / 12;
      points.push(new T.Vector2(cx + Math.cos(a) * P, -(cz + Math.sin(a) * P)));
    }
  };
  const at = Math.atan2;
  arc(HX, 0, at(q, e), at(-q, e));
  arc(HX, -HZ, at(q, e), at(-e, -q));
  arc(-HX, -HZ, at(-e, q), at(q, -e));
  arc(-HX, 0, at(-q, -e), at(q, -e));
  arc(-HX, HZ, at(-q, -e), at(e, q));
  arc(HX, HZ, at(e, -q), at(-q, e));
  return new T.Path(points);
}
function roundedRect(hx: number, hz: number, radius: number) {
  const s = new T.Shape();
  s.moveTo(-hx + radius, -hz);
  s.lineTo(hx - radius, -hz);
  s.quadraticCurveTo(hx, -hz, hx, -hz + radius);
  s.lineTo(hx, hz - radius);
  s.quadraticCurveTo(hx, hz, hx - radius, hz);
  s.lineTo(-hx + radius, hz);
  s.quadraticCurveTo(-hx, hz, -hx, hz - radius);
  s.lineTo(-hx, -hz + radius);
  s.quadraticCurveTo(-hx, -hz, -hx + radius, -hz);
  return s;
}

export class PoolTable {
  private r = new Resources();
  readonly group = new T.Group();
  private balls: T.Mesh[] = [];
  private sink = new Map<number, number>();
  private last = new Map<number, { x: number; z: number; vx: number; vz: number; sunk: boolean }>();
  private lastClock = -1;
  private guide: T.Line;
  private ghost: T.Mesh;
  private kitchen: T.Group;
  private calledRing: T.Mesh;
  private board = document.createElement("canvas");
  private boardTexture: T.CanvasTexture;
  private boardText = "";
  constructor(scene: T.Scene, colliders: T.Object3D[]) {
    const r = this.r,
      g = this.group;
    g.position.set(POOL.x, 0, POOL.z);
    g.name = "pool-table";
    scene.add(g);
    const fixed = new T.Group();
    g.add(fixed);

    const walnut = canvasTexture(r, 256, (c, random) => {
      c.fillStyle = "#6a4129";
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i++) {
        const y0 = random() * 256,
          wave = 2 + random() * 5,
          dark = random() > 0.45;
        c.strokeStyle = dark
          ? `rgba(38,20,10,${0.18 + random() * 0.25})`
          : `rgba(170,110,70,${0.08 + random() * 0.12})`;
        c.lineWidth = 0.6 + random() * 2.2;
        c.beginPath();
        for (let x = 0; x <= 256; x += 8) {
          const y = y0 + Math.sin(x / 40 + y0) * wave;
          if (x) c.lineTo(x, y);
          else c.moveTo(x, y);
        }
        c.stroke();
      }
    });
    walnut.repeat.set(2.5, 2.5);
    const wood = r.keep(
      new T.MeshStandardMaterial({
        map: walnut,
        color: "#c8a587",
        roughness: 0.42,
        metalness: 0.02,
      }),
    );
    const darkWood = r.keep(
      new T.MeshStandardMaterial({
        map: walnut,
        color: "#7d5f4c",
        roughness: 0.55,
      }),
    );
    const clothMap = canvasTexture(r, 256, (c, random) => {
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9000; i++) {
        const v = 200 + Math.floor(random() * 55);
        c.fillStyle = `rgba(${v},${v},${v},0.55)`;
        c.fillRect(random() * 256, random() * 256, 1, 1 + random() * 2);
      }
    });
    clothMap.repeat.set(5, 5);
    const cloth = r.keep(
      new T.MeshStandardMaterial({
        map: clothMap,
        color: "#1f6a60",
        roughness: 0.94,
      }),
    );
    const cushionCloth = r.keep(
      new T.MeshStandardMaterial({
        map: clothMap,
        color: "#1b5c53",
        roughness: 0.9,
      }),
    );
    const leather = r.material("#4b2f1d", 0.55);

    // Bed: one cloth sheet under the cushions with six real pocket holes.
    const bed = roundedRect(HX + 0.125, HZ + 0.125, 0.02);
    for (const p of pockets) {
      const hole = new T.Path();
      hole.absarc(p.x * S, -p.z * S, P, 0, Math.PI * 2, true);
      bed.holes.push(hole);
    }
    const felt = new T.Mesh(r.keep(new T.ShapeGeometry(bed, 18)), cloth);
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = POOL.clothY;
    felt.receiveShadow = true;
    fixed.add(felt);

    // Cushions: bevelled extrusions with angled jaws at every pocket mouth.
    const cushionGeometry = (
      a: [number, number],
      b: [number, number],
      out: [number, number],
      jawA: number,
      jawB: number,
    ) => {
      const ux = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]),
        uz = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]),
        w = CUSHION - 0.006;
      const pts: [number, number][] = [
        [a[0] + out[0] * 0.006, a[1] + out[1] * 0.006],
        [b[0] + out[0] * 0.006, b[1] + out[1] * 0.006],
        [b[0] + out[0] * w + ux * jawB * w, b[1] + out[1] * w + uz * jawB * w],
        [a[0] + out[0] * w - ux * jawA * w, a[1] + out[1] * w - uz * jawA * w],
      ];
      const shape = new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z)));
      return r.keep(
        new T.ExtrudeGeometry(shape, {
          depth: 0.046,
          bevelEnabled: true,
          bevelThickness: 0.009,
          bevelSize: 0.006,
          bevelSegments: 2,
          curveSegments: 1,
        }),
      );
    };
    const corner = P * 1.02,
      side = P * 0.86;
    const segments: [
      [number, number],
      [number, number],
      [number, number],
      number,
      number,
    ][] = [];
    for (const sx of [-1, 1]) {
      segments.push([[sx * HX, -HZ + corner], [sx * HX, -side], [sx, 0], 1, 0.4]);
      segments.push([[sx * HX, side], [sx * HX, HZ - corner], [sx, 0], 0.4, 1]);
    }
    for (const sz of [-1, 1])
      segments.push([[-HX + corner, sz * HZ], [HX - corner, sz * HZ], [0, sz], 1, 1]);
    for (const [a, b, out, ja, jb] of segments) {
      const mesh = new T.Mesh(cushionGeometry(a, b, out, ja, jb), cushionCloth);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = POOL.clothY + 0.009;
      mesh.castShadow = mesh.receiveShadow = true;
      fixed.add(mesh);
    }

    // Walnut rail: rounded outer edge, pocket cuts follow the pocket circles.
    const railShape = roundedRect(OUTER_X, OUTER_Z, 0.06);
    railShape.holes.push(railHole());
    const rail = new T.Mesh(
      r.keep(
        new T.ExtrudeGeometry(railShape, {
          depth: RAIL_TOP - 0.012 - 0.885,
          bevelEnabled: true,
          bevelThickness: 0.012,
          bevelSize: 0.012,
          bevelSegments: 3,
          curveSegments: 6,
        }),
      ),
      wood,
    );
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = 0.885;
    rail.castShadow = rail.receiveShadow = true;
    fixed.add(rail);

    // Apron with a moulding, then four turned legs on plinths.
    const apron = r.box(
      fixed,
      0,
      0.76,
      0,
      OUTER_X * 2 - 0.05,
      0.25,
      OUTER_Z * 2 - 0.05,
      darkWood,
      0.04,
    );
    apron.userData.dynamic = true; // stays a standalone collider mesh
    colliders.push(apron);
    r.box(fixed, 0, 0.66, 0, OUTER_X * 2 - 0.02, 0.035, OUTER_Z * 2 - 0.02, wood, 0.015);
    r.box(fixed, 0, 0.875, 0, OUTER_X * 2 - 0.01, 0.03, OUTER_Z * 2 - 0.01, wood, 0.012);
    const leg = r.keep(
      new T.LatheGeometry(
        [
          [0.001, 0],
          [0.085, 0],
          [0.088, 0.035],
          [0.065, 0.07],
          [0.05, 0.13],
          [0.072, 0.21],
          [0.086, 0.29],
          [0.074, 0.37],
          [0.052, 0.44],
          [0.058, 0.5],
          [0.076, 0.55],
          [0.08, 0.64],
          [0.001, 0.64],
        ].map(([x, y]) => new T.Vector2(x, y)),
        18,
      ),
    );
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const m = new T.Mesh(leg, darkWood);
        m.position.set(x * (OUTER_X - 0.13), 0, z * (OUTER_Z - 0.2));
        m.castShadow = true;
        fixed.add(m);
      }
    // Stretcher between the legs for a sturdier silhouette.
    r.box(fixed, 0, 0.12, 0, 0.07, 0.05, OUTER_Z * 2 - 0.42, darkWood, 0.015);

    // Pocket cups: leather liners and a dark bottom under each cloth hole.
    const liner = r.keep(new T.CylinderGeometry(P, P * 0.82, 0.12, 20, 1, true)),
      bottom = r.keep(new T.CircleGeometry(P * 0.82, 20)),
      linerMaterial = r.keep(
        new T.MeshStandardMaterial({
          color: "#21150e",
          roughness: 0.7,
          side: T.BackSide,
        }),
      ),
      dark = r.material("#060505", 1);
    for (const p of pockets) {
      const cup = new T.Mesh(liner, linerMaterial);
      cup.position.set(p.x * S, POOL.clothY - 0.06, p.z * S);
      fixed.add(cup);
      const floor = new T.Mesh(bottom, dark);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(p.x * S, POOL.clothY - 0.118, p.z * S);
      fixed.add(floor);
    }
    // Leather corner caps over the rail around each pocket mouth.
    for (const p of pockets) {
      const isSide = p.z === 0,
        cap = new T.Mesh(
          r.keep(
            new T.RingGeometry(
              P - 0.002,
              P + 0.02,
              20,
              1,
              0,
              isSide ? Math.PI : Math.PI * 1.5,
            ),
          ),
          leather,
        );
      cap.rotation.x = -Math.PI / 2;
      // Ring angles run counter-clockwise from +x in the XZ plane seen from above.
      const facing = isSide
        ? p.x > 0
          ? -Math.PI / 2
          : Math.PI / 2
        : Math.atan2(-Math.sign(p.z), Math.sign(p.x)) - Math.PI * 0.75;
      cap.rotation.z = facing;
      cap.position.set(p.x * S, RAIL_TOP + 0.001, p.z * S);
      fixed.add(cap);
    }
    // Mother-of-pearl diamond sights.
    const diamondShape = new T.Shape([
      new T.Vector2(0, 0.012),
      new T.Vector2(0.007, 0),
      new T.Vector2(0, -0.012),
      new T.Vector2(-0.007, 0),
    ]);
    const sightPositions: [number, number, number][] = [];
    for (const sx of [-1, 1])
      for (const k of [-3, -2, -1, 1, 2, 3])
        sightPositions.push([sx * (HX + CUSHION + RAIL / 2), (k * HZ) / 4, 0]);
    for (const sz of [-1, 1])
      for (const k of [-1, 0, 1])
        sightPositions.push([(k * HX) / 2, sz * (HZ + CUSHION + RAIL / 2), Math.PI / 2]);
    const sights = new T.InstancedMesh(
      r.keep(new T.ShapeGeometry(diamondShape)),
      r.material("#eee4cf", 0.28),
      sightPositions.length,
    );
    const m4 = new T.Matrix4(),
      q = new T.Quaternion();
    sightPositions.forEach(([x, z, yaw], i) => {
      q.setFromEuler(new T.Euler(-Math.PI / 2, 0, yaw));
      m4.compose(new T.Vector3(x, RAIL_TOP + 0.0015, z), q, new T.Vector3(1, 1, 1));
      sights.setMatrixAt(i, m4);
    });
    g.add(sights);
    // Foot spot.
    const spot = new T.Mesh(r.keep(new T.CircleGeometry(0.007, 12)), r.material("#e8e2d0", 0.8));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(FOOT_SPOT.x * S, POOL.clothY + 0.0008, FOOT_SPOT.z * S);
    fixed.add(spot);
    r.batch(fixed);

    // Kitchen highlight for ball in hand behind the head string.
    this.kitchen = new T.Group();
    const kitchenDepth = (POOL.halfZ - HEAD_STRING) * S;
    const area = new T.Mesh(
      r.keep(new T.PlaneGeometry(HX * 2, kitchenDepth)),
      r.keep(
        new T.MeshBasicMaterial({
          color: "#f6e7b8",
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
        }),
      ),
    );
    area.rotation.x = -Math.PI / 2;
    area.position.set(0, POOL.clothY + 0.001, HEAD_STRING * S + kitchenDepth / 2);
    const line = new T.Mesh(
      r.keep(new T.PlaneGeometry(HX * 2, 0.006)),
      r.keep(new T.MeshBasicMaterial({ color: "#f6e7b8", transparent: true, opacity: 0.7 })),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, POOL.clothY + 0.0015, HEAD_STRING * S);
    this.kitchen.add(area, line);
    this.kitchen.visible = false;
    g.add(this.kitchen);
    this.calledRing = new T.Mesh(
      r.keep(new T.RingGeometry(P * 1.02, P * 1.22, 28)),
      r.keep(
        new T.MeshBasicMaterial({
          color: "#f2c45a",
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      ),
    );
    this.calledRing.rotation.x = -Math.PI / 2;
    this.calledRing.visible = false;
    g.add(this.calledRing);

    // Cue rack: both cues stand in the base cups and lean on the top bar.
    const rack = new T.Group();
    rack.name = "cue-rack";
    rack.position.set(2.25, 0, -1.65);
    g.add(rack);
    r.box(rack, 0, 0.06, 0, 0.5, 0.12, 0.24, darkWood, 0.03);
    r.box(rack, 0, 0.62, -0.1, 0.06, 1.24, 0.04, darkWood, 0.012);
    r.box(rack, 0, 1.16, -0.065, 0.5, 0.06, 0.07, darkWood, 0.02);
    for (const x of [-0.12, 0.12]) {
      const cue = playingCue(r, rack);
      cue.name = "complete-cue";
      // The butt (local z = -0.65) rests on the base top at y = 0.12.
      cue.position.set(x, 0.12 + 0.65 * Math.cos(0.05), 0);
      cue.rotation.x = -Math.PI / 2 - 0.05;
    }

    // Balls: shared sphere geometry, one 256×128 skin per numbered ball.
    const sphere = r.keep(new T.SphereGeometry(R, 32, 20)),
      cueMaterial = r.keep(
        new T.MeshStandardMaterial({ color: "#f7f3ea", roughness: 0.16 }),
      );
    for (let id = 0; id <= 15; id++) {
      const material = id
        ? r.keep(
            new T.MeshStandardMaterial({
              map: ballTexture(r, id),
              roughness: 0.16,
            }),
          )
        : cueMaterial;
      const ball = new T.Mesh(sphere, material);
      ball.castShadow = true;
      ball.name = "pool-ball-" + id;
      // Number discs start facing up with a deterministic twist.
      ball.quaternion
        .setFromEuler(new T.Euler(-Math.PI / 2 + ((id * 0.37) % 0.5) - 0.25, 0, 0))
        .premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), id * 2.1));
      ball.visible = false;
      g.add(ball);
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
    this.ghost = new T.Mesh(
      sphere,
      r.keep(
        new T.MeshBasicMaterial({
          color: "#deebd3",
          wireframe: true,
          transparent: true,
          opacity: 0.45,
        }),
      ),
    );
    g.add(this.ghost);
    this.guide.visible = this.ghost.visible = false;

    // Scoreboard on the foot rail.
    this.board.width = 1024;
    this.board.height = 256;
    this.boardTexture = r.keep(new T.CanvasTexture(this.board));
    this.boardTexture.colorSpace = T.SRGBColorSpace;
    const boardZ = -OUTER_Z + RAIL / 2;
    r.box(g, 0, 1.25, boardZ - 0.035, 1.17, 0.32, 0.05, darkWood, 0.02);
    for (const x of [-0.45, 0.45])
      r.box(g, x, (RAIL_TOP + 1.1) / 2, boardZ - 0.035, 0.025, 1.1 - RAIL_TOP, 0.025, darkWood, 0);
    const score = new T.Mesh(
      r.keep(new T.PlaneGeometry(1.12, 0.28)),
      r.keep(new T.MeshBasicMaterial({ map: this.boardTexture })),
    );
    score.position.set(0, 1.25, boardZ - 0.008);
    g.add(score);
  }
  /** Updates the presentation and returns sound events for this frame. */
  update(
    state?: PoolState,
    dt = 0.025,
    names: string[] = [],
    aim?: number,
  ): PoolSoundEvent[] {
    const s = state ?? newPool(),
      events: PoolSoundEvent[] = [],
      fresh = s.clock !== this.lastClock,
      rolling = s.phase === "rolling";
    if (fresh && s.clock < this.lastClock) this.last.clear();
    const present = new Set(s.balls.map((b) => b.id));
    this.balls.forEach((m, id) => {
      if (!present.has(id)) m.visible = false;
    });
    let clack = 0,
      clackAt: PoolSoundEvent | undefined;
    for (const b of s.balls) {
      const m = this.balls[b.id];
      if (!m) continue;
      const before = this.last.get(b.id);
      const x = b.x * S,
        z = b.z * S;
      if (b.sunk) {
        const progress = Math.min(1, (this.sink.get(b.id) ?? 0) + dt * 4);
        this.sink.set(b.id, progress);
        if (fresh && before && !before.sunk && rolling)
          events.push({ kind: "pocket", x: b.x, z: b.z, strength: 1 });
        const pocket = pockets.reduce((best, p) =>
          Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(best.x - b.x, best.z - b.z) ? p : best,
        );
        m.visible = progress < 1;
        m.position.set(
          T.MathUtils.lerp(x, pocket.x * S, progress),
          POOL.clothY + R - progress * 0.12,
          T.MathUtils.lerp(z, pocket.z * S, progress),
        );
      } else {
        this.sink.set(b.id, 0);
        m.visible = true;
        // Rolling without slipping: rotate around the axis perpendicular to
        // the interpolated displacement on the cloth.
        const dx = x - m.position.x,
          dz = z - m.position.z,
          distance = Math.hypot(dx, dz);
        if (m.position.y > 0 && distance > 1e-6 && distance < 0.4)
          m.quaternion.premultiply(
            new T.Quaternion().setFromAxisAngle(
              new T.Vector3(dz / distance, 0, -dx / distance),
              distance / R,
            ),
          );
        m.position.set(x, POOL.clothY + R, z);
        if (fresh && rolling && before && !before.sunk) {
          const change = Math.hypot(b.vx - before.vx, b.vz - before.vz),
            speedUp =
              Math.hypot(b.vx, b.vz) - Math.hypot(before.vx, before.vz);
          if (change > 0.35 || speedUp > 0.12) {
            const nearRail =
              Math.abs(b.x) > POOL.halfX - POOL.radius - 0.08 ||
              Math.abs(b.z) > POOL.halfZ - POOL.radius - 0.08;
            if (nearRail && speedUp <= 0.12)
              events.push({ kind: "rail", x: b.x, z: b.z, strength: Math.min(1, change / 3) });
            else if (change > clack) {
              clack = change;
              clackAt = { kind: "clack", x: b.x, z: b.z, strength: Math.min(1, change / 3) };
            }
          }
        }
      }
      if (fresh) this.last.set(b.id, { x: b.x, z: b.z, vx: b.vx, vz: b.vz, sunk: b.sunk });
    }
    if (clackAt) events.push(clackAt);
    this.lastClock = s.clock;
    this.kitchen.visible = s.phase === "placing" && s.ballInHand === "kitchen";
    this.calledRing.visible = s.called !== undefined && s.phase !== "finished";
    if (s.called !== undefined) {
      const p = pockets[s.called];
      this.calledRing.position.set(p.x * S, POOL.clothY + 0.002, p.z * S);
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
      const y = POOL.clothY + R;
      this.guide.geometry.setFromPoints([
        new T.Vector3(cue.x * S, y, cue.z * S),
        new T.Vector3((cue.x + dx * length) * S, y, (cue.z + dz * length) * S),
      ]);
      this.guide.computeLineDistances();
      this.ghost.position.set(
        (cue.x + dx * length) * S,
        y,
        (cue.z + dz * length) * S,
      );
    }
    this.drawBoard(s, names);
    return events;
  }
  private drawBoard(s: PoolState, names: string[]) {
    const eight = poolMode(s) === "eight";
    const text = JSON.stringify([s.scores, s.turn, s.phase, names, s.mode, s.groups, s.winner]);
    if (text === this.boardText) return;
    this.boardText = text;
    const c = this.board.getContext("2d")!;
    c.fillStyle = "#17110d";
    c.fillRect(0, 0, 1024, 256);
    c.strokeStyle = "#8a6a4a";
    c.lineWidth = 4;
    c.strokeRect(8, 8, 1008, 240);
    c.textAlign = "center";
    c.fillStyle = "#d9b77e";
    c.font = "600 28px 'Segoe UI', sans-serif";
    c.fillText(eight ? "BOLA 8" : "ROTAÇÃO 7", 512, 46);
    for (let i = 0; i < 2; i++) {
      const cx = 256 + i * 512,
        playing = s.phase !== "waiting" && s.phase !== "finished";
      c.fillStyle =
        s.winner && s.winner === s.players[i]
          ? "#f2c45a"
          : playing && s.turn === i
            ? "#9bdebd"
            : "#ece6da";
      c.font = "bold 66px 'Segoe UI', sans-serif";
      const group = s.groups?.[i];
      c.fillText(
        eight ? (group ? `${s.scores[i]}/7` : "—") : String(s.scores[i]),
        cx,
        128,
      );
      c.font = "28px 'Segoe UI', sans-serif";
      c.fillText((names[i] || "Livre").slice(0, 19), cx, 180);
      if (eight) {
        c.font = "22px 'Segoe UI', sans-serif";
        c.fillStyle = "#b9aa92";
        c.fillText(group ? GROUP_NAMES[group] : "Mesa aberta", cx, 218);
      }
    }
    this.boardTexture.needsUpdate = true;
  }
  dispose() {
    this.r.dispose();
    this.group.removeFromParent();
  }
}
