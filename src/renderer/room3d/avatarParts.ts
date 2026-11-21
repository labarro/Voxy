import * as T from "three";
import type { Avatar3D } from "../../shared/types";
import {
  EXTRA,
  kit,
  merge,
  regions,
  rigidSkinned,
  shell,
  bodyGeometry,
  weightOf,
  type BodyBase,
  type Prepared,
} from "./avatarKit";

// Appearance → derived geometry. Everything here is cached per body variant
// (base + body type) in Prepared.cache, so several avatars wearing the same
// style share GPU buffers; only materials are per avatar.

export type Part = {
  geometry: T.BufferGeometry;
  color: string;
  roughness: number;
  metalness?: number;
  kind:
    | "cloth"
    | "shoe"
    | "hair"
    | "brow"
    | "eyes"
    | "mouth"
    | "metal"
    | "lens"
    | "plain";
  map?: "hair1" | "hair2";
  opacity?: number;
};

export function baseFor(a: Avatar3D): BodyBase {
  if (a.base) return a.base;
  const hair = a.hairStyle ?? a.hair;
  return ["long", "bob", "ponytail", "braids", "bun", "wavy"].includes(hair) ||
    a.bottom === "skirt"
    ? "f"
    : "m";
}

// ---------------------------------------------------------------- body type
export function variant(p: Prepared, bodyType: Avatar3D["body"]): Prepared {
  const kind = bodyType ?? "classic";
  // The source male body is a superhero build; every male variant softens the
  // traps/deltoids so clothes read as everyday wear.
  if (kind === "classic" && p.base === "f") return p;
  const key = `variant:${kind}`;
  const cached = p.cache.get(key) as Prepared | undefined;
  if (cached) return cached;
  const R = regions(p),
    count = p.world.length / 3;
  const world = new Float32Array(p.world);
  const pelvis = p.rest.get("pelvis")!,
    chest = p.rest.get("spine_03")!;
  for (let i = 0; i < count; i++) {
    const x = world[i * 3],
      y = world[i * 3 + 1],
      z = world[i * 3 + 2];
    let d = 0;
    const neckY = p.rest.get("neck_01")!.y;
    const traps =
      p.base === "m"
        ? Math.max(0, 1 - Math.abs(y - (neckY - 0.03)) / 0.09) *
          Math.min(1, Math.max(0, Math.abs(x) - 0.05) / 0.05)
        : 0;
    const torso = R.torso[i],
      armUpper = R.arm[i] >= 0 && R.arm[i] < 1 ? 1 : 0,
      thigh = R.leg[i] >= 0 && R.leg[i] < 1 ? 1 : 0;
    if (kind === "soft") {
      const belly =
        Math.max(0, 1 - Math.abs(y - (pelvis.y + 0.12)) / 0.2) *
        Math.max(0, z - pelvis.z + 0.02) *
        6;
      d =
        -traps * 0.012 +
        torso * 0.014 +
        belly * 0.03 +
        armUpper * 0.009 +
        thigh * 0.012 +
        (R.head[i] > 0.5 && y < p.mouth.y ? 0.004 : 0);
    } else if (kind === "slim") {
      d = -(torso * 0.007 + armUpper * 0.01 + thigh * 0.006 + traps * 0.024);
    } else if (kind === "classic") {
      d = -(armUpper * 0.008 + traps * 0.02);
    } else if (kind === "athletic") {
      const shoulders = Math.max(0, 1 - Math.abs(y - chest.y) / 0.16);
      d = torso * shoulders * 0.012 + armUpper * 0.01 + thigh * 0.006;
    }
    for (let k = 0; k < 3; k++) world[i * 3 + k] += p.normals[i * 3 + k] * d;
  }
  // Build bind-space positions for the variant.
  const inv = p.body.matrixWorld.clone().invert(),
    v = new T.Vector3(),
    position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    v.fromArray(world, i * 3).applyMatrix4(inv);
    position.set([v.x, v.y, v.z], i * 3);
  }
  const geometry = p.body.geometry.clone();
  geometry.setAttribute("position", new T.BufferAttribute(position, 3));
  geometry.computeVertexNormals();
  const body = p.body.clone() as T.SkinnedMesh;
  body.geometry = geometry;
  const out: Prepared = {
    ...p,
    body,
    world,
    cache: new Map([["regions", R]]),
  };
  kit().geometries.add(geometry);
  p.cache.set(key, out);
  return out;
}

// ------------------------------------------------------------------ garments
type Field = (i: number) => number;

export function garments(p: Prepared, a: Avatar3D) {
  const R = regions(p);
  const top = a.outfitStyle ?? a.outfit,
    bottom = a.bottom ?? "trousers",
    shoes = a.shoes ?? "sneakers";
  const neckRest = p.rest.get("neck_01")!,
    neck = neckRest.y,
    pelvis = p.rest.get("pelvis")!.y;
  const y = (i: number) => p.world[i * 3 + 1],
    x = (i: number) => p.world[i * 3],
    z = (i: number) => p.world[i * 3 + 2];
  const longSleeve = top !== "tee";
  const sleeve = longSleeve ? 1.86 : 0.52;
  const coat = top === "coat";
  const neckline =
    top === "tee"
      ? neck - 0.03
      : top === "hoodie"
        ? neck + 0.012
        : neck - 0.004;
  const hem = coat ? pelvis - 0.2 : pelvis - 0.07;
  const ARM = 0.27,
    LEG = 0.42;
  const OUT = 1;
  // Neckline rises over the shoulders so they stay covered.
  const necklineAt = (i: number) => {
    const r = Math.hypot(x(i), (z(i) - neckRest.z) * 1.25);
    return neckline + T.MathUtils.clamp((r - 0.07) / 0.06, 0, 1) * 0.1;
  };
  const topField: Field = (i) => {
    if (R.hand[i] > 0.45 || R.head[i] > 0.55) return OUT;
    if (R.arm[i] >= 0) return (R.arm[i] - sleeve) * ARM;
    if (R.leg[i] >= 0)
      return coat ? Math.max((R.leg[i] - 0.42) * LEG, hem - y(i)) : OUT;
    return Math.max(y(i) - necklineAt(i), hem - y(i));
  };
  const pantsLen =
    bottom === "shorts" ? 0.72 : bottom === "skirt" ? 0.32 : 1.93;
  const waist = pelvis + 0.11;
  const pantsField: Field = (i) => {
    if (R.hand[i] > 0.45 || R.arm[i] >= 0) return OUT;
    if (R.leg[i] >= 0) return (R.leg[i] - pantsLen) * LEG;
    return y(i) - waist;
  };
  const shoeStart = shoes === "boots" ? 1.5 : shoes === "formal" ? 1.94 : 1.9;
  const shoeField: Field = (i) =>
    R.foot[i] > 0.5
      ? -0.05
      : R.leg[i] >= 0
        ? (shoeStart - R.leg[i]) * LEG
        : OUT;

  const c = (hex: string) => new T.Color(hex);
  const ratio = (target: string, base: string, out: T.Color) => {
    const t = c(target),
      b = c(base);
    out.setRGB(
      t.r / Math.max(0.02, b.r),
      t.g / Math.max(0.02, b.g),
      t.b / Math.max(0.02, b.b),
    );
  };
  const color = a.color,
    pants = a.bottomColor ?? "#30394c",
    shoeColor = a.shoeColor ?? "#e5ded2";
  const thickness = {
    tee: 0.01,
    sweater: 0.011,
    hoodie: 0.015,
    jacket: 0.017,
    shirt: 0.007,
    coat: 0.02,
    suit: 0.014,
    varsity: 0.015,
  }[top];
  const parts: Part[] = [];
  const topGeometry = shell(p, {
    key: `top:${top}`,
    field: topField,
    smooth: 14,
    thickness: (i) => {
      let t = thickness;
      // looser at the belly/back for hoodies and coats
      if ((top === "hoodie" || coat) && R.arm[i] < 0)
        t += 0.006 * Math.max(0, 1 - Math.abs(y(i) - pelvis - 0.12) / 0.25);
      if (R.arm[i] >= 0 && longSleeve) t += 0.004 * Math.min(1, R.arm[i] / 1.6);
      return t;
    },
    color: (i, out) => {
      const front = z(i) > p.rest.get("spine_03")!.z;
      // cuffs, hems and collars
      const cuff = R.arm[i] >= 0 && R.arm[i] > sleeve - 0.12;
      const band = R.arm[i] < 0 && y(i) < hem + 0.045 && !coat;
      const collar = R.arm[i] < 0 && y(i) > neckline - 0.022;
      if (top === "varsity") {
        if (R.arm[i] >= 0) ratio("#ebe4d6", color, out);
        if (cuff || band || collar) out.setRGB(0.55, 0.55, 0.55);
        return;
      }
      if (top === "jacket" || top === "suit" || coat) {
        const open =
          front &&
          R.arm[i] < 0 &&
          Math.abs(x(i)) < 0.012 + Math.max(0, y(i) - neck + 0.3) * 0.16;
        if (open && y(i) > hem + 0.05) {
          ratio(top === "suit" ? "#ece8df" : "#d9d2c4", color, out);
          if (top === "suit" && Math.abs(x(i)) < 0.012 && y(i) < neck - 0.03)
            ratio("#2b2f3a", color, out);
          return;
        }
        if (cuff) out.setScalar(0.8);
        return;
      }
      if (top === "shirt") {
        if (front && Math.abs(x(i)) < 0.009 && R.arm[i] < 0)
          out.setScalar(1.12);
        if (collar) out.setScalar(1.08);
        if (cuff) out.setScalar(0.92);
        return;
      }
      if (top === "hoodie") {
        const pocket =
          front &&
          R.arm[i] < 0 &&
          Math.abs(x(i)) < 0.13 &&
          y(i) > hem + 0.05 &&
          y(i) < hem + 0.17;
        if (pocket) out.setScalar(0.86);
        if (cuff || band) out.setScalar(0.8);
        return;
      }
      if (cuff || band) out.setScalar(top === "sweater" ? 0.78 : 0.88);
      if (collar) out.setScalar(top === "tee" ? 0.82 : 0.78);
    },
  });
  parts.push({
    geometry: topGeometry,
    color,
    roughness: top === "jacket" ? 0.62 : top === "suit" ? 0.7 : 0.92,
    kind: "cloth",
  });
  const pantsGeometry = shell(p, {
    key: `bottom:${bottom}`,
    field: pantsField,
    smooth: 8,
    thickness: (i) =>
      R.leg[i] >= 0 ? 0.008 + 0.004 * Math.min(1, R.leg[i]) : 0.005,
    color: (i, out) => {
      if (R.leg[i] >= 0 && R.leg[i] > pantsLen - 0.06) out.setScalar(0.85);
      if (R.leg[i] < 0 && y(i) > waist - 0.03) out.setScalar(0.8);
    },
  });
  parts.push({
    geometry: pantsGeometry,
    color: pants,
    roughness: 0.9,
    kind: "cloth",
  });
  if (bottom === "skirt")
    parts.push({
      geometry: skirt(p),
      color: pants,
      roughness: 0.9,
      kind: "cloth",
    });
  const shoeGeometry = shell(p, {
    key: `shoes:${shoes}`,
    field: shoeField,
    thickness: (i) => (R.foot[i] > 0.5 ? 0.016 : 0.012),
    smooth: 5,
    flatten: 0.014,
    color: (i, out) => {
      const sole = y(i) < 0.034;
      if (shoes === "sneakers") {
        if (sole) ratio("#f1ede6", shoeColor, out);
        else if (y(i) < 0.05) out.setScalar(0.9);
      } else if (shoes === "boots") {
        if (sole) ratio("#2a211c", shoeColor, out);
        else if (R.leg[i] >= 0 && R.leg[i] < shoeStart + 0.06)
          out.setScalar(0.82);
      } else if (sole) ratio("#1d1a18", shoeColor, out);
    },
  });
  parts.push({
    geometry: shoeGeometry,
    color: shoeColor,
    roughness: shoes === "formal" ? 0.35 : shoes === "boots" ? 0.6 : 0.75,
    kind: "shoe",
  });
  // Collars, hoods and drawstrings.
  const extras: T.BufferGeometry[] = [];
  if (top === "hoodie") extras.push(hood(p));
  if (["shirt", "jacket", "suit", "coat", "varsity"].includes(top))
    extras.push(collar(p, top === "shirt" ? 0.045 : 0.06));
  for (const g of extras)
    parts.push({ geometry: g, color, roughness: 0.9, kind: "cloth" });
  const hideKey = `${top}|${bottom}|${shoes}`;
  const hidden = bodyGeometry(
    p,
    (i) =>
      topField(i) < -0.012 || pantsField(i) < -0.02 || shoeField(i) < -0.02,
    hideKey,
  );
  return { parts, body: hidden };
}

function bone(p: Prepared, name: string) {
  return name.startsWith("voxy_")
    ? p.boneNames.length + EXTRA.indexOf(name)
    : p.index.get(name)!;
}

function cached<T>(p: Prepared, key: string, make: () => T): T {
  const hit = p.cache.get(key) as T | undefined;
  if (hit) return hit;
  const value = make();
  p.cache.set(key, value);
  if (value instanceof T.BufferGeometry) kit().geometries.add(value);
  return value;
}

function skirt(p: Prepared) {
  return cached(p, "skirt", () => {
    const pelvis = p.rest.get("pelvis")!;
    // hip radius from the body at pelvis height
    let rx = 0.15,
      rz = 0.11;
    for (let i = 0; i < p.world.length / 3; i++) {
      const y = p.world[i * 3 + 1];
      if (Math.abs(y - (pelvis.y - 0.04)) < 0.015) {
        rx = Math.max(rx, Math.abs(p.world[i * 3]));
        rz = Math.max(rz, Math.abs(p.world[i * 3 + 2] - pelvis.z));
      }
    }
    const top = pelvis.y + 0.1,
      length = 0.4;
    const g = new T.CylinderGeometry(1, 1, length, 28, 6, true);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const t = 0.5 - pos.getY(i) / length; // 0 top .. 1 bottom
      const flare = 1.03 + t * 0.26;
      pos.setXYZ(
        i,
        pos.getX(i) * (rx + 0.012) * flare,
        top - t * length,
        pos.getZ(i) * (rz + 0.02) * flare,
      );
    }
    g.computeVertexNormals();
    const origin = new T.Vector3(0, 0, pelvis.z);
    const out = rigidSkinned(p, g, origin, (w) => {
      const t = T.MathUtils.clamp((top - w.y) / length, 0, 1);
      const side = w.x > 0 ? "thigh_l" : "thigh_r";
      const lw = Math.min(0.85, t * 1.1) * Math.min(1, Math.abs(w.x) / 0.05);
      return [
        [bone(p, "pelvis"), 1 - lw],
        [bone(p, side), lw],
      ];
    });
    g.dispose();
    const colors = new Float32Array(
      out.getAttribute("position").count * 3,
    ).fill(1);
    out.setAttribute("color", new T.BufferAttribute(colors, 3));
    return out;
  });
}

function neckRing(p: Prepared) {
  const neck = p.rest.get("neck_01")!;
  return { y: neck.y - 0.01, z: neck.z, r: 0.07 };
}
function collar(p: Prepared, height: number) {
  return cached(p, `collar:${height}`, () => {
    const n = neckRing(p);
    const g = new T.CylinderGeometry(
      n.r * 0.92,
      n.r * 1.18,
      height,
      22,
      1,
      true,
      Math.PI * 0.18,
      Math.PI * 1.64,
    );
    g.rotateY(Math.PI);
    g.translate(0, height / 2 - 0.012, 0);
    const out = rigidSkinned(p, g, new T.Vector3(0, n.y, n.z - 0.008), () => [
      [bone(p, "spine_03"), 0.55],
      [bone(p, "neck_01"), 0.45],
    ]);
    g.dispose();
    const colors = new Float32Array(
      out.getAttribute("position").count * 3,
    ).fill(0.92);
    out.setAttribute("color", new T.BufferAttribute(colors, 3));
    return out;
  });
}
function hood(p: Prepared) {
  return cached(p, "hood", () => {
    const n = neckRing(p);
    const g = new T.TorusGeometry(0.105, 0.042, 10, 24, Math.PI * 1.25);
    g.rotateZ(-Math.PI * 0.125);
    g.rotateX(Math.PI / 2 - 0.35);
    g.scale(1.05, 1, 0.9);
    g.rotateY(Math.PI);
    const out = rigidSkinned(
      p,
      g,
      new T.Vector3(0, n.y - 0.03, n.z - 0.045),
      () => [
        [bone(p, "spine_03"), 0.8],
        [bone(p, "neck_01"), 0.2],
      ],
    );
    g.dispose();
    const colors = new Float32Array(
      out.getAttribute("position").count * 3,
    ).fill(0.94);
    out.setAttribute("color", new T.BufferAttribute(colors, 3));
    return out;
  });
}
function drawstrings(p: Prepared) {
  return cached(p, "drawstrings", () => {
    const n = neckRing(p);
    const front = frontAt(p, n.y - 0.07, 0.04);
    const parts = [-1, 1].map((s) => {
      const g = new T.CylinderGeometry(0.0035, 0.0035, 0.13, 5);
      g.translate(s * 0.035, -0.065, front + 0.022);
      return g;
    });
    const g = merge(parts);
    for (const part of parts) part.dispose();
    const out = rigidSkinned(p, g, new T.Vector3(0, n.y - 0.01, 0), () => [
      [bone(p, "spine_03"), 1],
    ]);
    g.dispose();
    const colors = new Float32Array(
      out.getAttribute("position").count * 3,
    ).fill(1.35);
    out.setAttribute("color", new T.BufferAttribute(colors, 3));
    return out;
  });
}
// Front-most body surface z at a height near the midline.
function frontAt(p: Prepared, y: number, halfWidth: number) {
  let best = -Infinity;
  for (let i = 0; i < p.world.length / 3; i++)
    if (
      Math.abs(p.world[i * 3 + 1] - y) < 0.02 &&
      Math.abs(p.world[i * 3]) < halfWidth
    )
      best = Math.max(best, p.world[i * 3 + 2]);
  return best === -Infinity ? 0.1 : best;
}

// --------------------------------------------------------------------- hair
type HairSource =
  | "Hair_SimpleParted"
  | "Hair_Long"
  | "Hair_Buns"
  | "Hair_Buzzed"
  | "Hair_BuzzedFemale"
  | "Hair_Beard"
  | "Eyebrows_Female"
  | "Eyebrows_Regular";

// World-space rest positions of a hair asset placed on this body's head.
function hairWorld(p: Prepared, name: HairSource) {
  return cached(p, `hairworld:${name}`, () => {
    const entry = kit().hair.get(name)!;
    const geo = entry.mesh.geometry.clone();
    const headIndex = entry.names.indexOf("Head");
    const hairInv = entry.mesh.skeleton.boneInverses[headIndex];
    const headRest = new T.Matrix4().compose(
      p.rest.get("Head")!,
      p.restQuat.get("Head")!,
      new T.Vector3(1, 1, 1),
    );
    const m = headRest.multiply(hairInv).multiply(entry.mesh.bindMatrix);
    geo.applyMatrix4(m);
    geo.deleteAttribute("skinIndex");
    geo.deleteAttribute("skinWeight");
    return geo;
  });
}

function headSkinned(p: Prepared, g: T.BufferGeometry, jawBelowMouth = false) {
  const head = bone(p, "Head"),
    jaw = bone(p, "voxy_jaw");
  return rigidSkinned(p, g, new T.Vector3(), (w) => {
    if (!jawBelowMouth || w.y > p.mouth.y - 0.004) return [[head, 1]];
    const t =
      T.MathUtils.clamp((p.mouth.y - w.y) / 0.02, 0, 1) *
      T.MathUtils.clamp(1 - Math.abs(w.x) / 0.07, 0, 1);
    return [
      [head, 1 - t * 0.9],
      [jaw, t * 0.9],
    ];
  });
}

function gradient(
  p: Prepared,
  g: T.BufferGeometry,
  secondary?: string,
  primary?: string,
) {
  const pos = g.getAttribute("position"),
    colors = new Float32Array(pos.count * 3).fill(1);
  if (secondary && primary && secondary !== primary) {
    const a = new T.Color(primary),
      b = new T.Color(secondary);
    const ratio = [
      b.r / Math.max(0.03, a.r),
      b.g / Math.max(0.03, a.g),
      b.b / Math.max(0.03, a.b),
    ];
    const inv = p.body.matrixWorld;
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(inv);
      const t = T.MathUtils.clamp((p.eyeL.y - v.y) / 0.18, 0, 1) * 0.85;
      for (let k = 0; k < 3; k++) colors[i * 3 + k] = 1 + (ratio[k] - 1) * t;
    }
  }
  g.setAttribute("color", new T.BufferAttribute(colors, 3));
  return g;
}

function hatClamp(p: Prepared, g: T.BufferGeometry, hat: string | undefined) {
  if (!hat) return g;
  const out = g.clone(),
    pos = out.getAttribute("position");
  const c = p.headCenter,
    brim = p.eyeL.y + (hat === "beanie" ? 0.03 : 0.045),
    limit = p.headRadius + (hat === "beanie" ? 0.012 : 0.008);
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y < brim - 0.02) continue;
    const d = v.clone().sub(c);
    const len = d.length();
    if (len > limit) d.multiplyScalar(limit / len);
    v.copy(c).add(d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  out.computeVertexNormals();
  return out;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function clumps(
  p: Prepared,
  count: number,
  scale: number,
  lift: number,
  size: number,
  seed: number,
) {
  const random = rng(seed),
    c = p.headCenter,
    r = p.headRadius;
  const parts: T.BufferGeometry[] = [];
  const base = new T.IcosahedronGeometry(1, 1);
  for (let i = 0; i < count; i++) {
    // Uniform-ish points on the upper sphere, excluding the face.
    const u = random() * 2 - 1,
      a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new T.Vector3(Math.cos(a) * s, u, Math.sin(a) * s).normalize();
    if (dir.y < -0.35) continue; // below the ears
    if (dir.z > 0.3 && dir.y < 0.5) continue; // face
    if (dir.y < 0.05 && dir.z > -0.1 && Math.abs(dir.x) > 0.75) continue; // ears
    const g = base.clone();
    const k = size * (0.75 + random() * 0.5);
    g.scale(k, k * (0.8 + random() * 0.4), k);
    g.rotateY(random() * 6.28);
    const point = c
      .clone()
      .add(new T.Vector3(0, lift, -0.01))
      .addScaledVector(dir, r * scale);
    g.translate(point.x, point.y, point.z);
    parts.push(g);
  }
  base.dispose();
  const out = merge(parts);
  for (const g of parts) g.dispose();
  return out;
}

function tube(points: T.Vector3[], r0: number, r1: number, segments = 16) {
  const curve = new T.CatmullRomCurve3(points);
  const g = new T.TubeGeometry(curve, segments, 1, 8, false);
  const pos = g.getAttribute("position"),
    nrm = g.getAttribute("normal");
  // taper by rebuilding radius along the curve
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(i / 9) / segments;
    const center = curve.getPointAt(Math.min(1, seg));
    const r = T.MathUtils.lerp(r0, r1, seg);
    const n = new T.Vector3().fromBufferAttribute(nrm, i);
    pos.setXYZ(i, center.x + n.x * r, center.y + n.y * r, center.z + n.z * r);
  }
  g.computeVertexNormals();
  return g;
}

export function hairParts(p: Prepared, a: Avatar3D): Part[] {
  const style = a.hairStyle ?? a.hair;
  const accessories = new Set(
    a.accessories ?? [a.accessoryStyle ?? a.accessory],
  );
  const hat = ["beanie", "cap", "hat"].find((h) => accessories.has(h as never));
  const key = `hair:${style}:${hat ?? ""}:${a.hairColor}:${a.hairSecondary ?? ""}`;
  const primary = a.hairColor,
    secondary = a.hairSecondary;
  const build = (): { g: T.BufferGeometry; map: "hair1" | "hair2" }[] => {
    const c = p.headCenter,
      r = p.headRadius;
    const out: { g: T.BufferGeometry; map: "hair1" | "hair2" }[] = [];
    const src = (n: HairSource) => hairWorld(p, n).clone();
    const buzz = () =>
      src(p.base === "f" ? "Hair_BuzzedFemale" : "Hair_Buzzed");
    const slick = () => {
      // Long hair pulled tight to the head (base for ponytail/braids).
      const g = src("Hair_Long"),
        pos = g.getAttribute("position");
      const ear = p.eyeL.y - 0.02;
      const v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.y < ear) v.y = ear - (ear - v.y) * 0.08;
        const d = v.clone().sub(c);
        d.y *= 1;
        const len = Math.hypot(d.x, d.z);
        const limit = r + 0.014;
        if (len > limit && v.y < c.y + 0.03) {
          d.x *= limit / len;
          d.z *= limit / len;
        }
        v.copy(c).add(d);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    };
    switch (style) {
      case "short":
        out.push({ g: src("Hair_SimpleParted"), map: "hair1" });
        break;
      case "long":
        out.push({ g: src("Hair_Long"), map: "hair2" });
        break;
      case "bun":
        out.push({ g: src("Hair_Buns"), map: "hair2" });
        break;
      case "buzz":
        out.push({ g: buzz(), map: "hair1" });
        break;
      case "bob": {
        const g = src("Hair_Long"),
          pos = g.getAttribute("position");
        const cut = p.mouth.y - 0.025;
        const v = new T.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (v.y < cut) {
            const t = Math.min(1, (cut - v.y) / 0.25);
            v.y = cut - t * 0.03;
            // curl the ends inwards
            const d = new T.Vector3(v.x - c.x, 0, v.z - c.z);
            d.multiplyScalar(1 + 0.12 * (1 - t) - 0.05 * t);
            v.x = c.x + d.x;
            v.z = c.z + d.z;
          }
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeVertexNormals();
        out.push({ g, map: "hair2" });
        break;
      }
      case "wavy": {
        const g = src("Hair_Long"),
          pos = g.getAttribute("position");
        const v = new T.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const drop = Math.max(0, p.eyeL.y - v.y);
          const amp = Math.min(1, drop / 0.08) * 0.014;
          const d = new T.Vector3(v.x - c.x, 0, v.z - c.z).normalize();
          const wave = Math.sin(drop * 42 + Math.atan2(d.x, d.z) * 3);
          v.x += d.x * wave * amp + d.x * amp * 0.8;
          v.z += d.z * wave * amp + d.z * amp * 0.8;
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeVertexNormals();
        out.push({ g, map: "hair2" });
        break;
      }
      case "ponytail": {
        out.push({ g: slick(), map: "hair2" });
        const back = new T.Vector3(c.x, c.y + 0.01, c.z - r - 0.005);
        const tail = tube(
          [
            back,
            back.clone().add(new T.Vector3(0, -0.03, -0.05)),
            back.clone().add(new T.Vector3(0, -0.14, -0.07)),
            back.clone().add(new T.Vector3(0, -0.27, -0.05)),
          ],
          0.034,
          0.01,
        );
        out.push({ g: tail, map: "hair2" });
        const tie = new T.TorusGeometry(0.03, 0.009, 6, 14);
        tie.rotateX(Math.PI / 2 - 0.6);
        tie.translate(back.x, back.y - 0.018, back.z - 0.03);
        out.push({ g: tie, map: "hair1" });
        break;
      }
      case "braids": {
        out.push({ g: slick(), map: "hair2" });
        for (const s of [-1, 1]) {
          const beads: T.BufferGeometry[] = [];
          const start = new T.Vector3(
            c.x + s * (r * 0.7),
            p.eyeL.y - 0.035,
            c.z - r * 0.55,
          );
          for (let k = 0; k < 11; k++) {
            const b = new T.SphereGeometry(0.022 - k * 0.0011, 8, 6);
            b.scale(1, 1.35, 1);
            b.rotateZ(((k % 2) * 2 - 1) * 0.5);
            b.translate(
              start.x + s * 0.004 * (k % 2) + s * k * 0.004,
              start.y - k * 0.026,
              start.z - k * 0.006,
            );
            beads.push(b);
          }
          const g = merge(beads);
          for (const b of beads) b.dispose();
          out.push({ g, map: "hair2" });
        }
        break;
      }
      case "curly":
        out.push({ g: buzz(), map: "hair2" });
        out.push({ g: clumps(p, 130, 1.0, 0.01, 0.026, 7), map: "hair2" });
        break;
      case "afro":
        out.push({ g: buzz(), map: "hair2" });
        out.push({ g: clumps(p, 170, 1.16, 0.02, 0.04, 11), map: "hair2" });
        break;
      case "crest": {
        out.push({ g: buzz(), map: "hair1" });
        const spikes: T.BufferGeometry[] = [];
        for (let k = 0; k < 8; k++) {
          const t = k / 7;
          const angle = -0.35 + t * 2.1; // forehead → nape
          const dir = new T.Vector3(
            0,
            Math.cos(angle),
            Math.sin(angle) * -1 + 0.0,
          );
          dir.z = Math.cos(angle + Math.PI / 2) * -1;
          const point = c
            .clone()
            .add(
              new T.Vector3(
                0,
                Math.cos(angle) * r * 0.98,
                Math.sin(angle) * -r * 0.98 + (t < 0.2 ? r * 0.1 : 0),
              ),
            );
          const h = 0.075 + Math.sin(t * Math.PI) * 0.035;
          const g = new T.ConeGeometry(0.026, h, 7);
          g.translate(0, h / 2, 0);
          g.rotateX(-angle - 0.25);
          g.translate(point.x, point.y, point.z);
          spikes.push(g);
          void dir;
        }
        const g = merge(spikes);
        for (const s of spikes) s.dispose();
        out.push({ g, map: "hair1" });
        break;
      }
      case "bald":
      default:
        break;
    }
    return out;
  };
  return cached(p, key, () =>
    build().map(({ g, map }) => {
      const clamped = hatClamp(p, g, hat);
      if (clamped !== g) g.dispose();
      const skinned = gradient(p, headSkinned(p, clamped), secondary, primary);
      clamped.dispose();
      kit().geometries.add(skinned);
      return {
        geometry: skinned,
        color: primary,
        roughness: 0.62,
        kind: "hair" as const,
        map,
      };
    }),
  );
}

export function facialHair(p: Prepared, a: Avatar3D): Part[] {
  const kind = a.facialHair ?? "none";
  if (kind === "none") return [];
  const geometry = cached(p, `facial:${kind}`, () => {
    const g = hairWorld(p, "Hair_Beard").clone();
    if (kind === "mustache" || kind === "stubble") {
      const pos = g.getAttribute("position");
      const index = g.getIndex();
      const v = new T.Vector3();
      if (kind === "stubble") {
        // pull the beard volume close to the skin
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const d = v.clone().sub(p.headCenter);
          d.multiplyScalar(0.985);
          v.copy(p.headCenter).add(d);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
      } else if (index) {
        const keep: number[] = [];
        const ok = (i: number) => {
          v.fromBufferAttribute(pos, i);
          return (
            v.y > p.mouth.y - 0.004 &&
            v.y < p.mouth.y + 0.03 &&
            Math.abs(v.x) < 0.045 &&
            v.z > p.mouth.z - 0.03
          );
        };
        for (let t = 0; t < index.count; t += 3)
          if (
            ok(index.getX(t)) &&
            ok(index.getX(t + 1)) &&
            ok(index.getX(t + 2))
          )
            keep.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
        g.setIndex(keep);
      }
    }
    const out = gradient(p, headSkinned(p, g, true));
    g.dispose();
    return out;
  });
  return [
    {
      geometry,
      color: a.hairColor,
      roughness: 0.7,
      kind: "hair",
      map: "hair1",
      opacity: kind === "stubble" ? 0.55 : 1,
    },
  ];
}

export function brows(p: Prepared, a: Avatar3D): Part {
  const kind = a.brows ?? "soft";
  const geometry = cached(p, `brows:${kind}`, () => {
    const g = hairWorld(
      p,
      kind === "bold" ? "Eyebrows_Regular" : "Eyebrows_Female",
    ).clone();
    {
      // Lift the inner ends a touch: a friendlier resting expression.
      const pos = g.getAttribute("position"),
        v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.y += Math.max(0, 1 - Math.abs(v.x) / 0.045) * 0.0035;
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    if (kind === "arched") {
      const pos = g.getAttribute("position"),
        v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const t = Math.abs(v.x) / 0.05;
        v.y += Math.sin(Math.min(1, t) * Math.PI) * 0.004;
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    const browBone = bone(p, "voxy_brow");
    const out = rigidSkinned(p, g, new T.Vector3(), () => [[browBone, 1]]);
    g.dispose();
    out.setAttribute(
      "color",
      new T.BufferAttribute(
        new Float32Array(out.getAttribute("position").count * 3).fill(1),
        3,
      ),
    );
    return out;
  });
  const color = new T.Color(a.hairColor).multiplyScalar(0.75);
  return {
    geometry,
    color: `#${color.getHexString()}`,
    roughness: 0.8,
    kind: "brow",
    map: "hair1",
  };
}

export function eyes(p: Prepared): T.BufferGeometry {
  return cached(p, "eyes", () => {
    const src = p.eyes.geometry.clone();
    const pos = src.getAttribute("position");
    const idx = new Uint16Array(pos.count * 4),
      w = new Float32Array(pos.count * 4);
    const v = new T.Vector3();
    const left = bone(p, "voxy_eye_l"),
      right = bone(p, "voxy_eye_r");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(p.eyes.matrixWorld);
      idx[i * 4] = v.x > 0 ? left : right;
      w[i * 4] = 1;
    }
    // bring positions into the body's bind space
    src.applyMatrix4(
      p.body.matrixWorld.clone().invert().multiply(p.eyes.matrixWorld),
    );
    src.setAttribute("skinIndex", new T.Uint16BufferAttribute(idx, 4));
    src.setAttribute("skinWeight", new T.BufferAttribute(w, 4));
    return src;
  });
}

// Mouth interior: a strip on the lip line, top row on the head and bottom row
// on the jaw. Closed it has no area; opening the jaw reveals it.
export function mouth(p: Prepared) {
  return cached(p, "mouth", () => {
    const cols = 9,
      rows = 3,
      half = 0.026;
    const head = bone(p, "Head"),
      jaw = bone(p, "voxy_jaw");
    const position: number[] = [],
      uv: number[] = [],
      si: number[] = [],
      sw: number[] = [],
      index: number[] = [];
    const count = p.world.length / 3;
    const surface = (x: number) => {
      let best = -Infinity,
        normal = new T.Vector3(0, 0, 1);
      for (let i = 0; i < count; i++) {
        const dx = p.world[i * 3] - x,
          dy = p.world[i * 3 + 1] - p.mouth.y;
        if (
          Math.abs(dx) < 0.006 &&
          Math.abs(dy) < 0.006 &&
          p.world[i * 3 + 2] > best
        ) {
          best = p.world[i * 3 + 2];
          normal = new T.Vector3().fromArray(p.normals, i * 3);
        }
      }
      return { z: best === -Infinity ? p.mouth.z : best, normal };
    };
    const inv = p.body.matrixWorld.clone().invert();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const t = c / (cols - 1),
          x = (t * 2 - 1) * half;
        const s = surface(x);
        const v = new T.Vector3(x, p.mouth.y, s.z).addScaledVector(
          s.normal,
          0.0012,
        );
        v.applyMatrix4(inv);
        position.push(v.x, v.y, v.z);
        uv.push(t, r / (rows - 1));
        const corner = Math.pow(Math.sin(t * Math.PI), 0.7);
        const jw = (r / (rows - 1)) * corner;
        si.push(head, jaw, 0, 0);
        sw.push(1 - jw, jw, 0, 0);
      }
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c,
          b = a + 1,
          d = a + cols,
          e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(position, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setAttribute(
      "normal",
      new T.Float32BufferAttribute(
        new Array(position.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)),
        3,
      ),
    );
    g.setAttribute("skinIndex", new T.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new T.Float32BufferAttribute(sw, 4));
    g.setIndex(index);
    g.computeBoundingSphere();
    g.boundingSphere!.radius = 3;
    return g;
  });
}

let mouthTexture: T.CanvasTexture | undefined;
export function mouthMap() {
  if (mouthTexture) return mouthTexture;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "#f2ece4");
  g.addColorStop(0.22, "#e3d9cf");
  g.addColorStop(0.3, "#3b1715");
  g.addColorStop(0.75, "#5a2224");
  g.addColorStop(1, "#a8505a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  mouthTexture = new T.CanvasTexture(c);
  mouthTexture.colorSpace = T.SRGBColorSpace;
  return mouthTexture;
}

let fabricTexture: T.CanvasTexture | undefined;
export function fabricBump() {
  if (fabricTexture) return fabricTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 128, 128);
  const random = rng(5);
  for (let y = 0; y < 128; y += 2)
    for (let x = 0; x < 128; x += 2) {
      const v = 128 + (random() - 0.5) * 30;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 2, 2);
    }
  fabricTexture = new T.CanvasTexture(c);
  fabricTexture.wrapS = fabricTexture.wrapT = T.RepeatWrapping;
  fabricTexture.repeat.set(24, 24);
  return fabricTexture;
}

// ---------------------------------------------------------------- accessories
export function accessoryParts(p: Prepared, a: Avatar3D): Part[] {
  const list = new Set(a.accessories ?? [a.accessoryStyle ?? a.accessory]);
  list.delete("none" as never);
  const out: Part[] = [];
  const c = p.headCenter,
    r = p.headRadius;
  const eyeY = (p.eyeL.y + p.eyeR.y) / 2,
    eyeX = Math.abs(p.eyeL.x - p.eyeR.x) / 2,
    front = Math.max(p.eyeL.z, p.eyeR.z) + 0.024;
  const head = (g: T.BufferGeometry) => headSkinned(p, g);
  const add = (
    key: string,
    color: string,
    kind: Part["kind"],
    make: () => T.BufferGeometry,
    roughness = 0.5,
    metalness = 0,
  ) =>
    out.push({
      geometry: cached(p, `acc:${key}`, () => {
        const g = make();
        const res = head(g);
        g.dispose();
        res.setAttribute(
          "color",
          new T.BufferAttribute(
            new Float32Array(res.getAttribute("position").count * 3).fill(1),
            3,
          ),
        );
        return res;
      }),
      color,
      roughness,
      metalness,
      kind,
    });
  const frames = (lensFill: boolean) => {
    const parts: T.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const ring = new T.TorusGeometry(0.021, 0.0013, 6, 26);
      ring.scale(1.18, 0.86, 1);
      ring.translate(s * eyeX, eyeY, front);
      parts.push(ring);
      const temple = new T.CylinderGeometry(0.0012, 0.0012, r * 1.05, 5);
      temple.rotateX(Math.PI / 2);
      temple.translate(s * (eyeX + 0.025), eyeY + 0.003, front - r * 0.52);
      parts.push(temple);
      if (lensFill) void 0;
    }
    const bridge = new T.CylinderGeometry(0.0012, 0.0012, eyeX * 2 - 0.05, 5);
    bridge.rotateZ(Math.PI / 2);
    bridge.translate(0, eyeY + 0.004, front);
    parts.push(bridge);
    const g = merge(parts);
    for (const part of parts) part.dispose();
    return g;
  };
  const lenses = () => {
    const parts = [-1, 1].map((s) => {
      const g = new T.CircleGeometry(0.021, 22);
      g.scale(1.18, 0.86, 1);
      g.translate(s * eyeX, eyeY, front + 0.0005);
      return g;
    });
    const g = merge(parts);
    for (const part of parts) part.dispose();
    return g;
  };
  if (list.has("glasses"))
    add("glasses", "#2a2522", "metal", () => frames(false), 0.35, 0.2);
  if (list.has("sunglasses")) {
    add("sun-frame", "#151515", "metal", () => frames(true), 0.3, 0.1);
    add("sun-lens", "#1b2430", "lens", lenses, 0.08, 0.4);
  }
  const ear = (s: number) =>
    new T.Vector3(s * (r + 0.004), eyeY - 0.012, c.z - 0.005);
  if (list.has("headphones") || list.has("headset")) {
    add(
      "phones-band",
      "#26282d",
      "plain",
      () => {
        const band = new T.TorusGeometry(r + 0.03, 0.009, 8, 28, Math.PI);
        band.scale(1, 1.05, 1);
        band.translate(c.x, eyeY - 0.012, c.z - 0.005);
        const cups = [-1, 1].map((s) => {
          const g = new T.CylinderGeometry(0.036, 0.036, 0.026, 18);
          g.rotateZ(Math.PI / 2);
          const e = ear(s);
          g.translate(e.x + s * 0.016, e.y, e.z);
          return g;
        });
        const g = merge([band, ...cups]);
        band.dispose();
        for (const cup of cups) cup.dispose();
        return g;
      },
      0.45,
    );
    add(
      "phones-pad",
      "#8e7cf0",
      "plain",
      () => {
        const pads = [-1, 1].map((s) => {
          const g = new T.CylinderGeometry(0.03, 0.03, 0.006, 16);
          g.rotateZ(Math.PI / 2);
          const e = ear(s);
          g.translate(e.x + s * 0.031, e.y, e.z);
          return g;
        });
        const g = merge(pads);
        for (const pad of pads) pad.dispose();
        return g;
      },
      0.6,
    );
    if (list.has("headset"))
      add("mic", "#1d1e22", "plain", () =>
        tube(
          [
            ear(-1).add(new T.Vector3(-0.02, -0.01, 0.01)),
            new T.Vector3(-r * 0.85, p.mouth.y - 0.005, c.z + r * 0.55),
            new T.Vector3(-0.022, p.mouth.y - 0.004, p.mouth.z + 0.022),
          ],
          0.004,
          0.006,
          12,
        ),
      );
  }
  const hatColor = a.color;
  if (list.has("beanie"))
    add(
      "beanie",
      hatColor,
      "cloth",
      () => {
        const g = new T.SphereGeometry(
          r + 0.016,
          26,
          14,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.55,
        );
        g.scale(1.02, 1.08, 1.04);
        g.translate(c.x, eyeY + 0.012, c.z - 0.006);
        const cuff = new T.CylinderGeometry(
          r + 0.021,
          r + 0.024,
          0.04,
          26,
          1,
          true,
        );
        cuff.translate(c.x, eyeY + 0.044, c.z - 0.006);
        const m = merge([g, cuff]);
        g.dispose();
        cuff.dispose();
        return m;
      },
      0.95,
    );
  if (list.has("cap"))
    add(
      "cap",
      hatColor,
      "cloth",
      () => {
        const crown = new T.SphereGeometry(
          r + 0.012,
          24,
          12,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.5,
        );
        crown.scale(1.02, 0.95, 1.05);
        crown.translate(c.x, eyeY + 0.035, c.z - 0.004);
        const brim = new T.CylinderGeometry(
          0.085,
          0.085,
          0.008,
          22,
          1,
          false,
          -Math.PI / 2,
          Math.PI,
        );
        brim.scale(1, 1, 0.95);
        brim.rotateX(0.12);
        brim.translate(c.x, eyeY + 0.036, c.z + r * 0.88);
        const m = merge([crown, brim]);
        crown.dispose();
        brim.dispose();
        return m;
      },
      0.85,
    );
  if (list.has("hat"))
    add(
      "hat",
      "#3a3330",
      "cloth",
      () => {
        const crown = new T.CylinderGeometry(r * 0.86, r + 0.014, 0.11, 24);
        crown.translate(c.x, eyeY + 0.095, c.z - 0.004);
        const brim = new T.CylinderGeometry(r + 0.075, r + 0.075, 0.008, 28);
        brim.translate(c.x, eyeY + 0.04, c.z - 0.004);
        const band = new T.CylinderGeometry(
          r + 0.016,
          r + 0.016,
          0.022,
          24,
          1,
          true,
        );
        band.translate(c.x, eyeY + 0.056, c.z - 0.004);
        const m = merge([crown, brim, band]);
        crown.dispose();
        brim.dispose();
        band.dispose();
        return m;
      },
      0.8,
    );
  if (list.has("earrings"))
    add(
      "earrings",
      "#e6c26b",
      "metal",
      () => {
        const parts = [-1, 1].map((s) => {
          const g = new T.TorusGeometry(0.009, 0.0022, 6, 14);
          g.rotateY(Math.PI / 2);
          const e = ear(s);
          g.translate(e.x + s * 0.002, e.y - 0.042, e.z + 0.006);
          return g;
        });
        const g = merge(parts);
        for (const part of parts) part.dispose();
        return g;
      },
      0.25,
      0.9,
    );
  // Body-mounted accessories.
  const neck = p.rest.get("neck_01")!;
  if (list.has("necklace"))
    out.push({
      geometry: cached(p, "acc:necklace", () => {
        const ring = new T.TorusGeometry(0.075, 0.0026, 6, 32);
        ring.rotateX(Math.PI / 2 - 0.45);
        ring.translate(0, neck.y - 0.045, neck.z + 0.025);
        const pendant = new T.OctahedronGeometry(0.011);
        pendant.translate(
          0,
          neck.y - 0.085,
          frontAt(p, neck.y - 0.08, 0.03) + 0.018,
        );
        const g = merge([ring, pendant]);
        ring.dispose();
        pendant.dispose();
        const res = rigidSkinned(p, g, new T.Vector3(), () => [
          [bone(p, "spine_03"), 0.7],
          [bone(p, "neck_01"), 0.3],
        ]);
        g.dispose();
        res.setAttribute(
          "color",
          new T.BufferAttribute(
            new Float32Array(res.getAttribute("position").count * 3).fill(1),
            3,
          ),
        );
        return res;
      }),
      color: "#e6c26b",
      roughness: 0.25,
      metalness: 0.9,
      kind: "metal",
    });
  if (list.has("bracelet")) {
    const wrist = p.rest.get("hand_l")!,
      elbow = p.rest.get("lowerarm_l")!;
    out.push({
      geometry: cached(p, "acc:bracelet", () => {
        const dir = wrist.clone().sub(elbow).normalize();
        const g = new T.TorusGeometry(0.036, 0.006, 6, 18);
        g.lookAt(dir);
        const at = wrist.clone().addScaledVector(dir, -0.035);
        g.translate(at.x, at.y, at.z);
        const res = rigidSkinned(p, g, new T.Vector3(), () => [
          [bone(p, "lowerarm_l"), 1],
        ]);
        g.dispose();
        res.setAttribute(
          "color",
          new T.BufferAttribute(
            new Float32Array(res.getAttribute("position").count * 3).fill(1),
            3,
          ),
        );
        return res;
      }),
      color: "#8e7cf0",
      roughness: 0.4,
      kind: "plain",
    });
  }
  if (list.has("backpack")) {
    const chest = p.rest.get("spine_03")!;
    out.push({
      geometry: cached(p, "acc:backpack", () => {
        let back = 0;
        for (let i = 0; i < p.world.length / 3; i++)
          if (
            Math.abs(p.world[i * 3 + 1] - chest.y) < 0.03 &&
            Math.abs(p.world[i * 3]) < 0.06
          )
            back = Math.min(back, p.world[i * 3 + 2] - chest.z);
        const bag = new T.BoxGeometry(0.3, 0.38, 0.13, 3, 3, 2);
        const pos = bag.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          // round the box
          const v = new T.Vector3().fromBufferAttribute(pos, i);
          const k = 1 - 0.18 * (Math.abs(v.x) / 0.15) * (Math.abs(v.z) / 0.065);
          pos.setXYZ(i, v.x * k, v.y, v.z);
        }
        bag.computeVertexNormals();
        bag.translate(0, chest.y - 0.08, chest.z + back - 0.08);
        const straps = [-1, 1].map((s) => {
          const g = new T.TorusGeometry(0.15, 0.012, 5, 16, Math.PI * 0.85);
          g.rotateY(Math.PI / 2);
          g.rotateX(-0.2);
          g.translate(s * 0.095, chest.y - 0.02, chest.z + back * 0.2);
          return g;
        });
        const g = merge([bag, ...straps]);
        bag.dispose();
        for (const s of straps) s.dispose();
        const res = rigidSkinned(p, g, new T.Vector3(), () => [
          [bone(p, "spine_03"), 1],
        ]);
        g.dispose();
        res.setAttribute(
          "color",
          new T.BufferAttribute(
            new Float32Array(res.getAttribute("position").count * 3).fill(1),
            3,
          ),
        );
        return res;
      }),
      color: "#3c4d63",
      roughness: 0.85,
      kind: "cloth",
    });
  }
  return out;
}

export { weightOf };
