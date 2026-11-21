import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Shared, read-only data for the skinned Voxy avatars. Bodies, hair, brows and
// animation clips come from CC0 GLBs (see assets/room3d/avatars/LICENSE.txt);
// garments, extra hairstyles and the face rig are derived here once per body
// base and cached. Avatars only clone skeletons and create small materials.

export type BodyBase = "m" | "f";
export const AVATAR_SCALE = 1.1;
export const CLIPS = [
  "Idle_Loop",
  "Idle_Talking_Loop",
  "Walk_Loop",
  "Jog_Fwd_Loop",
  "Sitting_Enter",
  "Sitting_Exit",
  "Sitting_Idle_Loop",
  "Sitting_Talking_Loop",
  "Dance_Loop",
  "Interact",
  "PickUp_Table",
  "Crouch_Idle_Loop",
  "Jump_Loop",
  "Spell_Simple_Idle_Loop",
] as const;
export type ClipName = (typeof CLIPS)[number];
// Extra bones appended after the 65 source joints.
export const EXTRA = ["voxy_jaw", "voxy_eye_r", "voxy_eye_l", "voxy_brow"];

const UV_MOUTH = new T.Vector2(0.188, 0.267),
  UV_EYE_R = new T.Vector2(0.136, 0.177),
  UV_EYE_L = new T.Vector2(0.237, 0.177);

export type Prepared = {
  base: BodyBase;
  template: T.Object3D;
  body: T.SkinnedMesh;
  eyes: T.SkinnedMesh;
  brows: T.SkinnedMesh;
  boneNames: string[];
  index: Map<string, number>;
  rest: Map<string, T.Vector3>;
  restQuat: Map<string, T.Quaternion>;
  world: Float32Array;
  normals: Float32Array;
  toLocal: number;
  headCenter: T.Vector3;
  headRadius: number;
  mouth: T.Vector3;
  eyeL: T.Vector3;
  eyeR: T.Vector3;
  browY: number;
  skinRef: T.Color;
  pelvisHeight: number;
  clips: Map<string, T.AnimationClip>;
  speeds: { walk: number; jog: number };
  sitHeight: number;
  sitBack: number;
  cache: Map<string, unknown>;
  skinIndex: T.BufferAttribute;
  skinWeight: T.BufferAttribute;
};

type Kit = {
  bases: Record<BodyBase, Prepared>;
  hair: Map<string, { mesh: T.SkinnedMesh; names: string[] }>;
  hairMaterial: T.MeshStandardMaterial;
  ownMaterials: T.Material[];
  geometries: Set<T.BufferGeometry>;
  textures: Set<T.Texture>;
  gltfs: GLTF[];
};

let shared: Promise<Kit> | undefined;
let resolved: Kit | undefined;
let users = 0;

export async function acquireKit(): Promise<Kit> {
  users++;
  shared ??= loadKit().then((kit) => (resolved = kit));
  try {
    return await shared;
  } catch (error) {
    users--;
    shared = undefined;
    throw error;
  }
}
export function kit() {
  if (!resolved) throw Error("Modelos de personagem indisponíveis.");
  return resolved;
}
export function releaseKit() {
  if (users <= 0) return;
  users--;
  if (users > 0 || !resolved) return;
  const k = resolved;
  resolved = undefined;
  shared = undefined;
  const drain = (cache: Map<string, unknown>) => {
    for (const value of cache.values()) {
      if (value instanceof T.BufferGeometry) value.dispose();
      else if (Array.isArray(value))
        for (const item of value)
          (item as { geometry?: T.BufferGeometry }).geometry?.dispose();
      else if (value && typeof value === "object" && "cache" in value)
        drain((value as Prepared).cache);
    }
    cache.clear();
  };
  drain(k.bases.m.cache);
  drain(k.bases.f.cache);
  for (const g of k.geometries) g.dispose();
  for (const t of k.textures) {
    t.dispose();
    if (t.image instanceof ImageBitmap) t.image.close();
  }
  for (const m of k.ownMaterials) m.dispose();
}

async function loadKit(): Promise<Kit> {
  const loader = new GLTFLoader(),
    base = new URL("assets/room3d/avatars/", document.baseURI);
  const [m, f, hair, anims] = await Promise.all(
    ["body-m", "body-f", "hair", "animations"].map((name) =>
      loader.loadAsync(new URL(`${name}.glb`, base).href),
    ),
  );
  const geometries = new Set<T.BufferGeometry>(),
    textures = new Set<T.Texture>(),
    ownMaterials: T.Material[] = [];
  for (const g of [m, f, hair, anims])
    for (const scene of g.scenes)
      scene.traverse((o) => {
        const mesh = o as T.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material)
          for (const mat of [mesh.material].flat()) {
            ownMaterials.push(mat);
            for (const v of Object.values(mat))
              if (v instanceof T.Texture) textures.add(v);
          }
      });
  const hairMeshes = new Map<
    string,
    { mesh: T.SkinnedMesh; names: string[] }
  >();
  let hairMaterial: T.MeshStandardMaterial | undefined;
  const known = [
    "Hair_SimpleParted",
    "Hair_Long",
    "Hair_Buns",
    "Hair_BuzzedFemale",
    "Hair_Buzzed",
    "Hair_Beard",
    "Eyebrows_Female",
    "Eyebrows_Regular",
  ];
  // mergeDocuments keeps one glTF scene per source file.
  for (const scene of hair.scenes)
    scene.traverse((o) => {
      const mesh = o as T.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const label = [
        mesh.name,
        mesh.parent?.name ?? "",
        mesh.geometry.name || "",
      ].join("|");
      const name = known.find((n) =>
        label.split("|").some((l) => l === n || l.startsWith(n + "_")),
      );
      if (!name || hairMeshes.has(name)) return;
      // Merged skeletons get unique suffixes ("Head_3"); keep canonical names.
      hairMeshes.set(name, {
        mesh,
        names: mesh.skeleton.bones.map((b) =>
          /^Head(_[0-9]+)?$/.test(b.name) ? "Head" : b.name,
        ),
      });
      if (!hairMaterial && name === "Hair_Long")
        hairMaterial = mesh.material as T.MeshStandardMaterial;
    });
  hairMaterial ??= [...hairMeshes.values()][0].mesh
    .material as T.MeshStandardMaterial;
  const kit: Kit = {
    bases: {
      m: prepare("m", m, anims.animations),
      f: prepare("f", f, anims.animations),
    },
    hair: hairMeshes,
    hairMaterial,
    ownMaterials,
    geometries,
    textures,
    gltfs: [m, f, hair, anims],
  };
  return kit;
}

function prepare(
  base: BodyBase,
  gltf: GLTF,
  source: T.AnimationClip[],
): Prepared {
  const template = gltf.scene;
  template.updateMatrixWorld(true);
  const skinned: T.SkinnedMesh[] = [];
  template.traverse((o) => {
    if ((o as T.SkinnedMesh).isSkinnedMesh) skinned.push(o as T.SkinnedMesh);
  });
  const body = skinned.reduce((a, b) =>
    a.geometry.getAttribute("position").count >
    b.geometry.getAttribute("position").count
      ? a
      : b,
  );
  const eyes = skinned.find(
    (s) => s !== body && /eye/i.test((s.material as T.Material).name),
  )!;
  const brows = skinned.find((s) => s !== body && s !== eyes)!;
  const boneNames = body.skeleton.bones.map((b) => b.name);
  const index = new Map(boneNames.map((n, i) => [n, i]));
  const rest = new Map<string, T.Vector3>(),
    restQuat = new Map<string, T.Quaternion>();
  body.skeleton.bones.forEach((bone, i) => {
    const m = body.skeleton.boneInverses[i].clone().invert();
    m.premultiply(
      body.bindMatrix.clone().invert().premultiply(body.matrixWorld),
    );
    const p = new T.Vector3(),
      q = new T.Quaternion(),
      s = new T.Vector3();
    m.decompose(p, q, s);
    rest.set(bone.name, p);
    restQuat.set(bone.name, q);
  });
  const geo = body.geometry,
    pos = geo.getAttribute("position"),
    nrm = geo.getAttribute("normal"),
    count = pos.count;
  const world = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  const v = new T.Vector3(),
    n = new T.Vector3(),
    nm = new T.Matrix3().getNormalMatrix(body.matrixWorld);
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(body.matrixWorld);
    n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
    world.set([v.x, v.y, v.z], i * 3);
    normals.set([n.x, n.y, n.z], i * 3);
  }
  const toLocal = 1 / new T.Vector3().setFromMatrixScale(body.matrixWorld).x;
  // Head shape from vertices driven by the head bone.
  const skinIndex = geo.getAttribute("skinIndex") as T.BufferAttribute,
    skinWeight = geo.getAttribute("skinWeight") as T.BufferAttribute;
  const head = index.get("Head")!;
  const headBox = new T.Box3();
  for (let i = 0; i < count; i++)
    if (weightOf(skinIndex, skinWeight, i, head) > 0.9)
      headBox.expandByPoint(v.fromArray(world, i * 3));
  const headCenter = headBox.getCenter(new T.Vector3()),
    headSize = headBox.getSize(new T.Vector3());
  const uv = geo.getAttribute("uv");
  const nearestUV = (target: T.Vector2) => {
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i < count; i++) {
      const z = world[i * 3 + 2];
      if (z < headCenter.z) continue;
      const d = (uv.getX(i) - target.x) ** 2 + (uv.getY(i) - target.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return new T.Vector3().fromArray(world, best * 3);
  };
  const mouth = nearestUV(UV_MOUTH);
  mouth.x = 0;
  // Eye centres come from the eyeball mesh itself (left = +X).
  const eyeBox = [new T.Box3(), new T.Box3()];
  const ep = eyes.geometry.getAttribute("position");
  for (let i = 0; i < ep.count; i++) {
    v.fromBufferAttribute(ep, i).applyMatrix4(eyes.matrixWorld);
    eyeBox[v.x > 0 ? 1 : 0].expandByPoint(v);
  }
  const eyeR = eyeBox[0].isEmpty()
      ? nearestUV(UV_EYE_R)
      : eyeBox[0].getCenter(new T.Vector3()),
    eyeL = eyeBox[1].isEmpty()
      ? nearestUV(UV_EYE_L)
      : eyeBox[1].getCenter(new T.Vector3());
  const bb = new T.Box3().setFromBufferAttribute(
    brows.geometry.getAttribute("position") as T.BufferAttribute,
  );
  bb.applyMatrix4(brows.matrixWorld);
  const skinRef = averageSkin(body.material as T.MeshStandardMaterial);
  const pelvisHeight = rest.get("pelvis")!.y;
  const prepared: Prepared = {
    base,
    template,
    body,
    eyes,
    brows,
    boneNames,
    index,
    rest,
    restQuat,
    world,
    normals,
    toLocal,
    headCenter,
    headRadius: Math.max(headSize.x, headSize.z) / 2,
    mouth,
    eyeL,
    eyeR,
    browY: bb.getCenter(new T.Vector3()).y,
    skinRef,
    pelvisHeight,
    clips: new Map(),
    speeds: { walk: 1.3, jog: 3.2 },
    sitHeight: 0.46,
    sitBack: 0,
    cache: new Map(),
    skinIndex,
    skinWeight,
  };
  rigFace(prepared);
  retarget(prepared, source);
  measure(prepared);
  return prepared;
}

export function weightOf(
  idx: T.BufferAttribute,
  w: T.BufferAttribute,
  i: number,
  bone: number,
) {
  let s = 0;
  for (let k = 0; k < 4; k++)
    if (idx.getComponent(i, k) === bone) s += w.getComponent(i, k);
  return s;
}

function averageSkin(mat: T.MeshStandardMaterial) {
  const image = mat.map?.image as ImageBitmap | HTMLImageElement | undefined;
  const out = new T.Color("#c58c6a");
  if (!image) return out;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image as CanvasImageSource, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      if (l < 70 || d[i] < d[i + 2]) continue;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
    if (n) out.setRGB(r / n / 255, g / n / 255, b / n / 255, T.SRGBColorSpace);
  } catch {
    // A tainted or unavailable image keeps the reference tone.
  }
  return out;
}

// Adds jaw/eye/brow influences. The source rig has no facial bones, so lower
// face vertices are partially re-weighted to a jaw hinge behind the mouth.
function rigFace(p: Prepared) {
  const geo = p.body.geometry,
    count = geo.getAttribute("position").count;
  const head = p.index.get("Head")!,
    jaw = p.boneNames.length;
  const idx = p.skinIndex.clone(),
    w = p.skinWeight.clone();
  const m = p.mouth;
  const v = new T.Vector3();
  for (let i = 0; i < count; i++) {
    const hw = weightOf(p.skinIndex, p.skinWeight, i, head);
    if (hw < 0.2) continue;
    v.fromArray(p.world, i * 3);
    if (v.z < m.z - 0.075 || v.y > m.y - 0.0015) continue;
    const below = m.y - v.y;
    if (below > 0.075) continue;
    const lateral = Math.abs(v.x) / 0.055;
    if (lateral > 1) continue;
    const strength =
      smooth(1 - lateral) * smooth(1 - Math.max(0, below - 0.045) / 0.03);
    const jw = hw * Math.min(1, strength * 1.15);
    if (jw <= 0.01) continue;
    for (let k = 0; k < 4; k++)
      if (idx.getComponent(i, k) === head) {
        w.setComponent(i, k, hw - jw);
        break;
      }
    // Put the jaw in the weakest slot.
    let slot = 0;
    for (let k = 1; k < 4; k++)
      if (w.getComponent(i, k) < w.getComponent(i, slot)) slot = k;
    if (w.getComponent(i, slot) > 0.001 && idx.getComponent(i, slot) !== head)
      continue;
    idx.setComponent(i, slot, jaw);
    w.setComponent(i, slot, jw);
  }
  p.skinIndex = idx;
  p.skinWeight = w;
}
function smooth(x: number) {
  const t = T.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function retarget(p: Prepared, source: T.AnimationClip[]) {
  // Clips are authored on the mannequin; keep rotations and scale the root
  // translation to the body's own hip height so feet stay on the floor.
  const pelvisLocal = p.template.getObjectByName("pelvis")!.position.length();
  for (const clip of source) {
    if (!CLIPS.includes(clip.name as ClipName)) continue;
    let sourcePelvis = 0;
    const tracks: T.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const [node, prop] = track.name.split(".");
      if (prop === "quaternion") tracks.push(track);
      else if (node === "pelvis" && prop === "position") {
        const values = track.values;
        sourcePelvis = Math.hypot(values[0], values[1], values[2]);
        tracks.push(track);
      }
    }
    const ratio = sourcePelvis ? pelvisLocal / sourcePelvis : 1;
    const adjusted = tracks.map((t) => {
      if (!t.name.endsWith(".position")) return t;
      const c = t.clone();
      for (let i = 0; i < c.values.length; i++) c.values[i] *= ratio;
      return c;
    });
    p.clips.set(
      clip.name,
      new T.AnimationClip(clip.name, clip.duration, adjusted),
    );
  }
}

function measure(p: Prepared) {
  const root = cloneRig(p).root;
  const mixer = new T.AnimationMixer(root);
  const foot = root.getObjectByName("foot_l")!,
    pelvis = root.getObjectByName("pelvis")!,
    thigh = root.getObjectByName("thigh_l")!,
    calf = root.getObjectByName("calf_l")!;
  const v = new T.Vector3();
  for (const [name, key] of [
    ["Walk_Loop", "walk"],
    ["Jog_Fwd_Loop", "jog"],
  ] as const) {
    const clip = p.clips.get(name);
    if (!clip) continue;
    const action = mixer.clipAction(clip).play();
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i <= 40; i++) {
      mixer.setTime((clip.duration * i) / 40);
      root.updateMatrixWorld(true);
      foot.getWorldPosition(v);
      min = Math.min(min, v.z);
      max = Math.max(max, v.z);
    }
    // In-place clips: during stance the foot sweeps the stride backwards.
    p.speeds[key] = ((max - min) * 2) / clip.duration;
    action.stop();
  }
  const sit = p.clips.get("Sitting_Idle_Loop");
  if (sit) {
    const action = mixer.clipAction(sit).play();
    mixer.setTime(0.1);
    root.updateMatrixWorld(true);
    // Seat contact is below the thighs: average of hip and knee heights minus
    // the thigh half thickness.
    const hip = thigh.getWorldPosition(new T.Vector3()),
      knee = calf.getWorldPosition(new T.Vector3());
    pelvis.getWorldPosition(v);
    p.sitHeight = Math.min(hip.y, knee.y) - 0.075;
    p.sitBack = v.z;
    action.stop();
  }
  mixer.stopAllAction();
}

// Clone bones only (no meshes) with the facial extras appended.
export function cloneRig(p: Prepared) {
  const map = new Map<T.Object3D, T.Object3D>();
  const copy = (o: T.Object3D): T.Object3D => {
    const c = (o as T.Bone).isBone ? new T.Bone() : new T.Object3D();
    c.name = o.name;
    c.position.copy(o.position);
    c.quaternion.copy(o.quaternion);
    c.scale.copy(o.scale);
    map.set(o, c);
    for (const child of o.children)
      if (!(child as T.Mesh).isMesh) c.add(copy(child));
    return c;
  };
  const root = copy(p.template);
  root.updateMatrixWorld(true);
  const bones = p.body.skeleton.bones.map((b) => map.get(b) as T.Bone);
  const headBone = bones[p.index.get("Head")!];
  const headQ = headBone.getWorldQuaternion(new T.Quaternion()).invert();
  const extras = EXTRA.map((name) => {
    const b = new T.Bone();
    b.name = name;
    headBone.add(b);
    b.quaternion.copy(headQ);
    return b;
  });
  const placeAt = (bone: T.Bone, world: T.Vector3) => {
    bone.position.copy(headBone.worldToLocal(world.clone()));
  };
  placeAt(extras[0], new T.Vector3(0, p.mouth.y + 0.035, p.mouth.z - 0.085));
  placeAt(extras[1], p.eyeR);
  placeAt(extras[2], p.eyeL);
  placeAt(extras[3], new T.Vector3(0, p.browY, p.headCenter.z));
  root.updateMatrixWorld(true);
  const all = [...bones, ...extras];
  return { root, bones: all, map };
}

// Inverse bind matrices for the extended skeleton, from the rest pose.
export function bindInverses(p: Prepared, bones: T.Bone[]) {
  const key = "inverses";
  let cached = p.cache.get(key) as T.Matrix4[] | undefined;
  if (!cached) {
    const base = p.body.skeleton.boneInverses.map((m) => m.clone());
    const toBind = p.body.bindMatrix.clone();
    for (let i = base.length; i < bones.length; i++) {
      // bone world (rest) relative to the body's bind space
      bones[i].updateWorldMatrix(true, false);
      const world = bones[i].matrixWorld.clone();
      const rootInv = new T.Matrix4();
      let r: T.Object3D = bones[i];
      while (r.parent) r = r.parent;
      rootInv.copy(r.matrixWorld).invert();
      base.push(
        world
          .premultiply(rootInv)
          .premultiply(p.body.matrixWorld.clone().invert().premultiply(toBind))
          .invert(),
      );
    }
    cached = base;
    p.cache.set(key, cached);
  }
  return cached.map((m) => m.clone());
}

// ----- Geometry derivation -------------------------------------------------

export type Region = {
  arm: Float32Array; // 0 shoulder .. 1 elbow .. 2 wrist, -1 if not arm
  leg: Float32Array; // 0 hip .. 1 knee .. 2 ankle, -1 if not leg
  foot: Float32Array;
  head: Float32Array;
  hand: Float32Array;
  torso: Float32Array;
};

export function regions(p: Prepared): Region {
  const cached = p.cache.get("regions") as Region | undefined;
  if (cached) return cached;
  const count = p.world.length / 3,
    idx = p.skinIndex,
    w = p.skinWeight;
  const groups: Record<string, number[]> = {
    head: ["Head", "neck_01", ...EXTRA],
    hand: p.boneNames.filter((n) =>
      /^(hand|index|middle|pinky|ring|thumb)_/.test(n),
    ),
    lower: ["lowerarm_l", "lowerarm_r"],
    upper: ["upperarm_l", "upperarm_r"],
    clav: ["clavicle_l", "clavicle_r"],
    torso: ["spine_01", "spine_02", "spine_03"],
    pelvis: ["pelvis"],
    thigh: ["thigh_l", "thigh_r"],
    calf: ["calf_l", "calf_r"],
    foot: ["foot_l", "foot_r", "ball_l", "ball_r"],
  } as unknown as Record<string, number[]>;
  const sets: Record<string, Set<number>> = {};
  for (const [k, names] of Object.entries(groups))
    sets[k] = new Set(
      (names as unknown as string[]).map((n) =>
        n.startsWith("voxy_")
          ? p.boneNames.length + EXTRA.indexOf(n)
          : (p.index.get(n) ?? -1),
      ),
    );
  const sum = (i: number, set: Set<number>) => {
    let s = 0;
    for (let k = 0; k < 4; k++)
      if (set.has(idx.getComponent(i, k))) s += w.getComponent(i, k);
    return s;
  };
  const arm = new Float32Array(count).fill(-1),
    leg = new Float32Array(count).fill(-1),
    foot = new Float32Array(count),
    head = new Float32Array(count),
    hand = new Float32Array(count),
    torso = new Float32Array(count);
  const r = p.rest;
  const chain = (names: string[], q: T.Vector3) => {
    const pts = names.map((n) => r.get(n)!);
    let best = Infinity,
      param = 0;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s],
        b = pts[s + 1],
        ab = b.clone().sub(a),
        t = T.MathUtils.clamp(q.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      const d = a.clone().addScaledVector(ab, t).distanceToSquared(q);
      if (d < best) {
        best = d;
        param = s + t;
      }
    }
    return param;
  };
  const q = new T.Vector3();
  for (let i = 0; i < count; i++) {
    q.fromArray(p.world, i * 3);
    const side = q.x > 0 ? "l" : "r";
    const armW = sum(i, sets.upper) + sum(i, sets.lower) + sum(i, sets.hand);
    const legW = sum(i, sets.thigh) + sum(i, sets.calf) + sum(i, sets.foot);
    head[i] = sum(i, sets.head);
    hand[i] = sum(i, sets.hand);
    foot[i] = sum(i, sets.foot);
    torso[i] = sum(i, sets.torso) + sum(i, sets.clav) + sum(i, sets.pelvis);
    if (armW > 0.35)
      arm[i] = chain(
        [`upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`],
        q,
      );
    if (legW > 0.35)
      leg[i] = chain([`thigh_${side}`, `calf_${side}`, `foot_${side}`], q);
  }
  const out = { arm, leg, foot, head, hand, torso };
  p.cache.set("regions", out);
  return out;
}

export type GarmentSpec = {
  key: string;
  // Signed coverage field in metres: negative inside the garment. Hems follow
  // the zero crossing, so edges are clean lines instead of triangle steps.
  field: (i: number) => number;
  thickness: (i: number) => number;
  color?: (i: number, out: T.Color) => void;
  smooth?: number;
  flatten?: number;
};

// Builds a skinned shell over the covered body area. Shells share the body's
// skin weights, so they deform with every animation without extra bones.
export function shell(p: Prepared, spec: GarmentSpec) {
  const key = `shell:${spec.key}`;
  const cached = p.cache.get(key) as T.BufferGeometry | undefined;
  if (cached) return cached;
  const src = p.body.geometry,
    index = src.getIndex()!,
    count = p.world.length / 3;
  const f = new Float32Array(count);
  for (let i = 0; i < count; i++) f[i] = spec.field(i);
  const tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t),
      b = index.getX(t + 1),
      c = index.getX(t + 2);
    if (f[a] < 0 || f[b] < 0 || f[c] < 0) tris.push(a, b, c);
  }
  // Compact vertices.
  const remap = new Map<number, number>(),
    order: number[] = [];
  for (const v of tris)
    if (!remap.has(v)) {
      remap.set(v, order.length);
      order.push(v);
    }
  const n = order.length;
  const position = new Float32Array(n * 3),
    normal = new Float32Array(n * 3),
    uv = new Float32Array(n * 2),
    color = new Float32Array(n * 3),
    skinIndex = new Uint16Array(n * 4),
    skinWeight = new Float32Array(n * 4);
  const suv = src.getAttribute("uv");
  const c = new T.Color();
  // Welded smoothing groups (UV seams duplicate positions).
  const weld = new Map<string, number[]>();
  const keyOf = (i: number) =>
    `${Math.round(p.world[i * 3] * 2000)},${Math.round(p.world[i * 3 + 1] * 2000)},${Math.round(p.world[i * 3 + 2] * 2000)}`;
  const wp = new Float32Array(n * 3),
    wn = new Float32Array(n * 3);
  order.forEach((v, j) => {
    for (let k = 0; k < 3; k++) {
      wp[j * 3 + k] = p.world[v * 3 + k];
      wn[j * 3 + k] = p.normals[v * 3 + k];
    }
    const k = keyOf(v);
    const list = weld.get(k) ?? [];
    list.push(j);
    weld.set(k, list);
  });
  // Average normals across seams so the offset never tears the shell.
  for (const list of weld.values()) {
    if (list.length < 2) continue;
    let x = 0,
      y = 0,
      z = 0;
    for (const j of list) {
      x += wn[j * 3];
      y += wn[j * 3 + 1];
      z += wn[j * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const j of list) wn.set([x / l, y / l, z / l], j * 3);
  }
  for (let j = 0; j < n; j++) {
    const v = order[j],
      t = spec.thickness(v);
    for (let k = 0; k < 3; k++) wp[j * 3 + k] += wn[j * 3 + k] * t;
  }
  // Snap outside vertices of boundary triangles onto the zero crossing.
  const sum = new Float32Array(n * 3),
    hits = new Uint16Array(n);
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const u = tris[t + e];
      if (f[u] < 0) continue;
      for (const o of [tris[t + ((e + 1) % 3)], tris[t + ((e + 2) % 3)]]) {
        if (f[o] >= 0) continue;
        const ju = remap.get(u)!,
          jo = remap.get(o)!,
          k = f[u] / (f[u] - f[o]);
        for (let d = 0; d < 3; d++)
          sum[ju * 3 + d] +=
            wp[ju * 3 + d] + (wp[jo * 3 + d] - wp[ju * 3 + d]) * k;
        hits[ju]++;
      }
    }
  const pinned = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    if (f[order[j]] < 0) continue;
    pinned[j] = 1;
    if (hits[j])
      for (let d = 0; d < 3; d++) wp[j * 3 + d] = sum[j * 3 + d] / hits[j];
  }
  if (spec.smooth) {
    // Taubin smoothing over welded adjacency removes toes/abs detail without
    // shrinking the garment; hem vertices stay pinned on their line.
    const neighbours: Set<number>[] = Array.from(
      { length: n },
      () => new Set(),
    );
    const group = new Int32Array(n);
    let g = 0;
    for (const list of weld.values()) {
      for (const j of list) group[j] = g;
      g++;
    }
    for (let t = 0; t < tris.length; t += 3) {
      const a = remap.get(tris[t])!,
        b = remap.get(tris[t + 1])!,
        cc = remap.get(tris[t + 2])!;
      neighbours[a].add(b).add(cc);
      neighbours[b].add(a).add(cc);
      neighbours[cc].add(a).add(b);
    }
    const tmp = new Float32Array(n * 3);
    // Body surface + normal per shell vertex, for the "drape" constraint.
    const bodyP = new Float32Array(n * 3),
      minT = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      bodyP.set(p.world.subarray(order[j] * 3, order[j] * 3 + 3), j * 3);
      minT[j] = spec.thickness(order[j]) * 0.75;
    }
    for (let it = 0; it < spec.smooth; it++) {
      const factor = 0.6;
      for (let j = 0; j < n; j++) {
        let x = 0,
          y = 0,
          z = 0,
          k = 0;
        for (const o of neighbours[j]) {
          x += wp[o * 3];
          y += wp[o * 3 + 1];
          z += wp[o * 3 + 2];
          k++;
        }
        if (!k || pinned[j]) {
          tmp.set(wp.subarray(j * 3, j * 3 + 3), j * 3);
          continue;
        }
        tmp[j * 3] = wp[j * 3] + (x / k - wp[j * 3]) * factor;
        tmp[j * 3 + 1] = wp[j * 3 + 1] + (y / k - wp[j * 3 + 1]) * factor;
        tmp[j * 3 + 2] = wp[j * 3 + 2] + (z / k - wp[j * 3 + 2]) * factor;
      }
      // Cloth bridges over grooves but never sinks below the body surface.
      for (let j = 0; j < n; j++) {
        if (pinned[j]) continue;
        const d =
          (tmp[j * 3] - bodyP[j * 3]) * wn[j * 3] +
          (tmp[j * 3 + 1] - bodyP[j * 3 + 1]) * wn[j * 3 + 1] +
          (tmp[j * 3 + 2] - bodyP[j * 3 + 2]) * wn[j * 3 + 2];
        if (d < minT[j])
          for (let k = 0; k < 3; k++)
            tmp[j * 3 + k] += wn[j * 3 + k] * (minT[j] - d);
      }
      // keep seam duplicates together
      for (const list of weld.values()) {
        let x = 0,
          y = 0,
          z = 0;
        for (const j of list) {
          x += tmp[j * 3];
          y += tmp[j * 3 + 1];
          z += tmp[j * 3 + 2];
        }
        for (const j of list)
          wp.set([x / list.length, y / list.length, z / list.length], j * 3);
      }
    }
    void group;
  }
  if (spec.flatten !== undefined)
    for (let j = 0; j < n; j++)
      if (wp[j * 3 + 1] < spec.flatten) wp[j * 3 + 1] = spec.flatten - 0.004;
  const inv = p.body.matrixWorld.clone().invert();
  const nInv = new T.Matrix3().getNormalMatrix(inv);
  const tv = new T.Vector3();
  for (let j = 0; j < n; j++) {
    const v = order[j];
    tv.fromArray(wp, j * 3).applyMatrix4(inv);
    position.set([tv.x, tv.y, tv.z], j * 3);
    tv.fromArray(wn, j * 3)
      .applyMatrix3(nInv)
      .normalize();
    normal.set([tv.x, tv.y, tv.z], j * 3);
    uv.set([suv.getX(v), suv.getY(v)], j * 2);
    for (let k = 0; k < 4; k++) {
      skinIndex[j * 4 + k] = p.skinIndex.getComponent(v, k);
      skinWeight[j * 4 + k] = p.skinWeight.getComponent(v, k);
    }
    c.setRGB(1, 1, 1);
    spec.color?.(v, c);
    color.set([c.r, c.g, c.b], j * 3);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(position, 3));
  geo.setAttribute("normal", new T.BufferAttribute(normal, 3));
  geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
  geo.setAttribute("color", new T.BufferAttribute(color, 3));
  geo.setAttribute("skinIndex", new T.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new T.BufferAttribute(skinWeight, 4));
  geo.setIndex(tris.map((v) => remap.get(v)!));
  if (spec.smooth) {
    geo.computeVertexNormals();
    // Seam duplicates share one normal, avoiding faceted stripes.
    const na = geo.getAttribute("normal") as T.BufferAttribute;
    for (const list of weld.values()) {
      if (list.length < 2) continue;
      let x = 0,
        y = 0,
        z = 0;
      for (const j of list) {
        x += na.getX(j);
        y += na.getY(j);
        z += na.getZ(j);
      }
      const l = Math.hypot(x, y, z) || 1;
      for (const j of list) na.setXYZ(j, x / l, y / l, z / l);
    }
  }
  geo.computeBoundingSphere();
  geo.boundingSphere!.radius *= 2;
  p.cache.set(key, geo);
  return geo;
}

// Body geometry with fully covered triangles removed, so skin never pokes
// through garments during extreme poses.
export function bodyGeometry(
  p: Prepared,
  hide: (i: number) => boolean,
  key: string,
) {
  const k = `body:${key}`;
  const cached = p.cache.get(k) as T.BufferGeometry | undefined;
  if (cached) return cached;
  const src = p.body.geometry,
    index = src.getIndex()!;
  const geo = new T.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes))
    geo.setAttribute(name, attr);
  geo.setAttribute("skinIndex", p.skinIndex);
  geo.setAttribute("skinWeight", p.skinWeight);
  const keep: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t),
      b = index.getX(t + 1),
      c = index.getX(t + 2);
    if (!(hide(a) && hide(b) && hide(c))) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.boundingSphere = src.boundingSphere?.clone() ?? null;
  if (geo.boundingSphere) geo.boundingSphere.radius *= 2;
  p.cache.set(k, geo);
  return geo;
}

// ----- Procedural parts skinned to a single bone ---------------------------

// Bakes a rigid geometry authored in head space (metres, +Y up, +Z front,
// origin at the head centre) into the body's bind space, weighted to bones.
export function rigidSkinned(
  p: Prepared,
  geometry: T.BufferGeometry,
  origin: T.Vector3,
  weights: (world: T.Vector3) => [number, number][],
) {
  const g = geometry.index ? geometry : geometry;
  const pos = g.getAttribute("position"),
    nrm = g.getAttribute("normal"),
    n = pos.count;
  const inv = p.body.matrixWorld.clone().invert(),
    nInv = new T.Matrix3().getNormalMatrix(inv);
  const out = new Float32Array(n * 3),
    on = new Float32Array(n * 3),
    si = new Uint16Array(n * 4),
    sw = new Float32Array(n * 4);
  const v = new T.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).add(origin);
    const ws = weights(v);
    ws.forEach(([bone, weight], k) => {
      si[i * 4 + k] = bone;
      sw[i * 4 + k] = weight;
    });
    v.applyMatrix4(inv);
    out.set([v.x, v.y, v.z], i * 3);
    if (nrm) {
      v.fromBufferAttribute(nrm, i).applyMatrix3(nInv).normalize();
      on.set([v.x, v.y, v.z], i * 3);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(out, 3));
  geo.setAttribute("normal", new T.BufferAttribute(on, 3));
  if (g.getAttribute("uv")) geo.setAttribute("uv", g.getAttribute("uv"));
  if (g.getAttribute("color"))
    geo.setAttribute("color", g.getAttribute("color"));
  geo.setAttribute("skinIndex", new T.Uint16BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new T.BufferAttribute(sw, 4));
  if (g.index) geo.setIndex(g.index);
  geo.computeBoundingSphere();
  geo.boundingSphere!.radius *= 2;
  return geo;
}

export function merge(parts: T.BufferGeometry[]) {
  const normalized = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(normalized, false)!;
  for (const g of normalized) if (!parts.includes(g)) g.dispose();
  return out;
}
