import * as T from "three";
import type { Avatar3D, RoomPose } from "../../shared/types";
import { RoomAssets } from "./assets";
import { Resources } from "./resources";
import { playingCue } from "./PlayingCue";
import type { poolStroke } from "../../shared/poolMotion";
import {
  AVATAR_SCALE,
  bindInverses,
  cloneRig,
  kit,
  type ClipName,
  type Prepared,
} from "./avatarKit";
import {
  accessoryParts,
  baseFor,
  brows,
  eyes,
  facialHair,
  fabricBump,
  garments,
  hairParts,
  mouth,
  mouthMap,
  variant,
  type Part,
} from "./avatarParts";
import { boneIK } from "./boneIK";

export type HeldDrink = "can" | "bottle" | "mug";

// Skinned avatar built from the shared CC0 body rig (see avatarKit.ts). The
// public surface matches the previous procedural avatar so scene, preview and
// games keep working: +Z front, feet at y=0, hands index 0 = right, 1 = left.
export class SocialAvatar {
  readonly group = new T.Group();
  readonly handErrors = [0, 0];
  poolAligned = false;
  private r = new Resources();
  private body = new T.Group();
  private rig: T.Object3D;
  private bones = new Map<string, T.Bone>();
  private skeleton: T.Skeleton;
  private mixer: T.AnimationMixer;
  private actions = new Map<string, T.AnimationAction>();
  private current?: T.AnimationAction;
  private currentName = "";
  private p: Prepared;
  private appearance: Avatar3D;
  private scale: number;
  private handFrames: T.Object3D[] = [];
  private poolGrip = new T.Group();
  private poolCue: T.Group;
  private cigarette = new T.Group();
  private smoke: T.Sprite[] = [];
  private drinks = new Map<HeldDrink, T.Group>();
  private held: HeldDrink | null = null;
  private time = 0;
  private seated = 0;
  private floor = 0;
  private lean = 0;
  private forward = 0;
  private animation = "idle";
  private speaking = false;
  private talk = 0;
  private talkTarget = 0;
  private talkAt = 0;
  private blinkAt = 2;
  private speed = 0;
  private lastPosition = new T.Vector3();
  private hasLast = false;
  private emoteWeight = 0;
  private mouthMarker = new T.Object3D();
  constructor(_assets: RoomAssets, a: Avatar3D) {
    this.appearance = a;
    const k = kit();
    this.p = variant(k.bases[baseFor(a)], a.body);
    const p = this.p;
    const { root, bones } = cloneRig(p);
    this.rig = root;
    for (const b of bones) {
      this.bones.set(b.name, b);
      b.userData.restQ = b.quaternion.clone();
    }
    this.skeleton = new T.Skeleton(bones, bindInverses(p, bones));
    this.scale = AVATAR_SCALE * (a.height ?? 1);
    this.group.add(this.body);
    this.body.add(root);
    this.body.scale.setScalar(this.scale);
    // Slightly larger head reads friendlier at social-room distances.
    const head = this.bone("Head");
    const shape =
      a.headShape === "oval"
        ? [0.97, 1.05, 1]
        : a.headShape === "square"
          ? [1.05, 0.98, 1.03]
          : [1.01, 1, 1.01];
    head.scale.set(shape[0] * 1.12, shape[1] * 1.12, shape[2] * 1.12);
    const eyeScale =
      a.eyes === "sleepy"
        ? [1, 0.84]
        : a.eyes === "almond"
          ? [1, 0.93]
          : [1, 1];
    for (const n of ["voxy_eye_l", "voxy_eye_r"]) {
      const b = this.bone(n);
      b.userData.rest = new T.Vector2(eyeScale[0], eyeScale[1]);
    }
    root.updateMatrixWorld(true);
    head.add(this.mouthMarker);
    this.mouthMarker.position.copy(
      head.worldToLocal(
        p.mouth
          .clone()
          .add(new T.Vector3(0, 0, 0.004))
          .multiplyScalar(this.scale),
      ),
    );
    const dressed = garments(p, a);
    this.skinned(dressed.body, this.skinMaterial());
    this.skinned(eyes(p), (p.eyes.material as T.Material).clone());
    for (const part of [
      ...dressed.parts,
      ...hairParts(p, a),
      ...facialHair(p, a),
      brows(p, a),
      ...accessoryParts(p, a),
    ])
      this.skinned(part.geometry, this.material(part));
    const mouthMat = this.r.keep(
      new T.MeshStandardMaterial({
        map: mouthMap(),
        roughness: 0.6,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.skinned(mouth(p), mouthMat).castShadow = false;
    // Hand frames: world-aligned at rest, origin in the palm.
    for (const side of ["r", "l"]) {
      const hand = this.bone(`hand_${side}`),
        middle = this.bone(`middle_01_${side}`);
      const frame = new T.Object3D();
      hand.add(frame);
      frame.quaternion.copy(
        hand.getWorldQuaternion(new T.Quaternion()).invert(),
      );
      frame.position.copy(middle.position).multiplyScalar(0.55);
      // Palm axes from the rest skeleton (world-aligned inside the frame).
      const rest = (n: string) => this.p.rest.get(n)!;
      const finger = rest(`middle_01_${side}`)
        .clone()
        .sub(rest(`hand_${side}`))
        .normalize();
      const thumb = rest(`thumb_01_${side}`)
        .clone()
        .sub(rest(`hand_${side}`));
      const axis = thumb
        .addScaledVector(finger, -thumb.dot(finger))
        .normalize();
      const palm = new T.Vector3().crossVectors(finger, axis).normalize();
      // Palm faces away from the thumb side's cross product on the left hand.
      if (side === "l") palm.negate();
      if (palm.y > 0.3) palm.negate();
      frame.userData = { finger, axis, palm };
      this.handFrames.push(frame);
    }
    this.mixer = new T.AnimationMixer(root);
    for (const [name, clip] of p.clips) {
      const action = this.mixer.clipAction(clip);
      if (name === "Sitting_Enter" || name === "Sitting_Exit") {
        action.setLoop(T.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(name, action);
    }
    this.fade("Idle_Loop", 0);
    this.mixer.update(Math.random() * 2);
    // Held props live in the right hand frame (index 0).
    this.poolGrip.name = "pool-grip";
    this.handFrames[0].add(this.poolGrip);
    this.poolCue = playingCue(this.r, this.poolGrip);
    this.poolCue.visible = false;
    this.buildCigarette();
    for (const kind of ["can", "bottle", "mug"] as HeldDrink[]) {
      const g = this.buildDrink(kind);
      g.visible = false;
      this.group.add(g);
      this.drinks.set(kind, g);
    }
    this.group.traverse((o) => {
      if ((o as T.Mesh).isMesh) {
        o.castShadow = o.castShadow !== false;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
  }
  private bone(name: string) {
    const b = this.bones.get(name);
    if (!b) throw Error(`Osso ausente: ${name}`);
    return b;
  }
  private skinned(geometry: T.BufferGeometry, material: T.Material) {
    const mesh = new T.SkinnedMesh(geometry, material);
    mesh.bind(this.skeleton, this.p.body.bindMatrix.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.rig.add(mesh);
    return mesh;
  }
  private skinMaterial() {
    const source = this.p.body.material as T.MeshStandardMaterial;
    const mat = this.r.keep(source.clone());
    const target = new T.Color(this.appearance.skin);
    const ref = this.p.skinRef;
    mat.color.setRGB(
      target.r / Math.max(0.05, ref.r),
      target.g / Math.max(0.05, ref.g),
      target.b / Math.max(0.05, ref.b),
    );
    mat.roughness = 0.62;
    mat.metalness = 0;
    mat.roughnessMap = null;
    // Gentle subsurface-like warmth: lift the shadowed side a little.
    mat.emissive = target.clone().multiplyScalar(0.04);
    return mat;
  }
  private material(part: Part) {
    const k = kit();
    const mat = this.r.keep(
      new T.MeshStandardMaterial({
        color: part.color,
        roughness: part.roughness,
        metalness: part.metalness ?? 0,
        vertexColors: !!part.geometry.getAttribute("color"),
        side:
          part.kind === "cloth" || part.kind === "hair"
            ? T.DoubleSide
            : T.FrontSide,
        transparent: (part.opacity ?? 1) < 1,
        opacity: part.opacity ?? 1,
      }),
    );
    if (part.kind === "cloth") {
      mat.bumpMap = fabricBump();
      mat.bumpScale = 0.25;
    }
    if (part.kind === "hair" || part.kind === "brow") {
      const source =
        part.map === "hair2"
          ? k.hairMaterial
          : (k.hair.get("Hair_SimpleParted")!.mesh
              .material as T.MeshStandardMaterial);
      mat.map = source.map;
      mat.normalMap = source.normalMap;
      // Source textures are light grey; scale so the chosen colour reads true.
      mat.color.multiplyScalar(1.45);
      mat.roughness = 0.55;
      if (part.kind === "brow") mat.color.multiplyScalar(0.85);
    }
    if (part.kind === "lens") {
      mat.transparent = true;
      mat.opacity = 0.82;
      mat.envMapIntensity = 1.5;
    }
    return mat;
  }
  private buildCigarette() {
    const g = this.cigarette;
    const paper = this.r.cylinder(g, 0, 0, 0, 0.0045, 0.0045, 0.075, "#ece6da");
    paper.rotation.x = Math.PI / 2;
    const filter = this.r.cylinder(
      g,
      0,
      0,
      -0.03,
      0.0047,
      0.0047,
      0.022,
      "#c48f52",
    );
    filter.rotation.x = Math.PI / 2;
    const ember = this.r.cylinder(
      g,
      0,
      0,
      0.039,
      0.0045,
      0.0045,
      0.005,
      "#ff7a3c",
    );
    ember.rotation.x = Math.PI / 2;
    (ember.material as T.MeshStandardMaterial).emissive = new T.Color(
      "#ff5a1c",
    );
    const axes = this.handFrames[0].userData as Record<string, T.Vector3>;
    g.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), axes.finger);
    g.position
      .copy(axes.finger)
      .multiplyScalar(0.045)
      .addScaledVector(axes.palm, 0.012);
    g.visible = false;
    this.handFrames[0].add(g);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d")!,
      gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(230,225,215,.65)");
    gradient.addColorStop(0.4, "rgba(215,212,207,.3)");
    gradient.addColorStop(1, "rgba(215,212,207,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    const map = this.r.keep(new T.CanvasTexture(canvas));
    for (let i = 0; i < 5; i++) {
      const puff = new T.Sprite(
        this.r.keep(
          new T.SpriteMaterial({
            map,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
          }),
        ),
      );
      puff.visible = false;
      this.group.add(puff);
      this.smoke.push(puff);
    }
  }
  // Generic, unbranded containers sized for the hand (metres, unscaled).
  private buildDrink(kind: HeldDrink) {
    const g = new T.Group();
    g.name = `drink-${kind}`;
    const r = this.r;
    const glass = r.keep(
      new T.MeshStandardMaterial({
        color: kind === "bottle" ? "#3f6b3a" : "#e8f0f2",
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: kind === "bottle" ? 0.88 : 0.32,
      }),
    );
    const beer = r.keep(
      new T.MeshStandardMaterial({
        color: "#e3a43a",
        roughness: 0.3,
        emissive: new T.Color("#5a3307"),
        emissiveIntensity: 0.4,
      }),
    );
    const foam = r.material("#f6efe0", 0.9);
    if (kind === "can") {
      const body = r.keep(new T.CylinderGeometry(0.03, 0.03, 0.11, 20));
      const label = r.keep(this.canTexture());
      const m = new T.Mesh(
        body,
        r.keep(
          new T.MeshStandardMaterial({
            map: label,
            roughness: 0.32,
            metalness: 0.75,
          }),
        ),
      );
      g.add(m);
      const lid = new T.Mesh(
        r.keep(new T.CylinderGeometry(0.027, 0.03, 0.008, 20)),
        r.material("#c9ccd1", 0.3, 0.9),
      );
      lid.position.y = 0.059;
      g.add(lid);
    } else if (kind === "bottle") {
      const profile = [
        [0, 0],
        [0.03, 0],
        [0.031, 0.004],
        [0.031, 0.12],
        [0.024, 0.15],
        [0.012, 0.18],
        [0.012, 0.215],
        [0.014, 0.22],
        [0.0, 0.222],
      ].map(([x, y]) => new T.Vector2(x, y));
      const shape = r.keep(new T.LatheGeometry(profile, 18));
      const m = new T.Mesh(shape, glass);
      m.position.y = -0.09;
      g.add(m);
      const label = new T.Mesh(
        r.keep(new T.CylinderGeometry(0.0315, 0.0315, 0.06, 18, 1, true)),
        r.material("#efe3c4", 0.7),
      );
      label.position.y = -0.03;
      g.add(label);
      const cap = new T.Mesh(
        r.keep(new T.CylinderGeometry(0.0135, 0.0135, 0.008, 12)),
        r.material("#c6a64b", 0.35, 0.8),
      );
      cap.position.y = 0.13;
      g.add(cap);
    } else {
      const cup = r.keep(
        new T.CylinderGeometry(0.042, 0.038, 0.13, 20, 1, true),
      );
      const m = new T.Mesh(cup, glass);
      g.add(m);
      const liquid = new T.Mesh(
        r.keep(new T.CylinderGeometry(0.039, 0.035, 0.1, 20)),
        beer,
      );
      liquid.position.y = -0.012;
      g.add(liquid);
      const head = new T.Mesh(
        r.keep(new T.CylinderGeometry(0.041, 0.04, 0.02, 20)),
        foam,
      );
      head.position.y = 0.048;
      g.add(head);
      const handle = new T.Mesh(
        r.keep(new T.TorusGeometry(0.03, 0.008, 8, 16, Math.PI * 1.1)),
        glass,
      );
      handle.rotation.z = -Math.PI / 2 - 0.15;
      handle.position.set(0.05, 0, 0);
      g.add(handle);
    }
    return g;
  }
  private canTexture() {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, "#c9d2d6");
    g.addColorStop(0.5, "#f2f4f5");
    g.addColorStop(1, "#b8c1c6");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#7c72df";
    ctx.fillRect(0, 18, 128, 26);
    ctx.fillStyle = "#f6f1ff";
    ctx.font = "700 15px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("VOXY", 64, 37);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  play(name: string) {
    this.animation = name;
  }
  setSpeaking(value: boolean) {
    this.speaking = value;
  }
  setHeld(kind: HeldDrink | null | undefined) {
    this.held = kind ?? null;
  }
  handWorld(index: number) {
    const frame = this.handFrames[index] ?? this.handFrames[0];
    frame.updateWorldMatrix(true, false);
    return frame.getWorldPosition(new T.Vector3());
  }
  // Point in avatar space (unscaled metres, +Z front) → world.
  private local(x: number, y: number, z: number) {
    return this.group.localToWorld(new T.Vector3(x, y, z));
  }
  private fade(name: ClipName | string, duration = 0.3, timeScale = 1) {
    const next = this.actions.get(name) ?? this.actions.get("Idle_Loop")!;
    next.timeScale = timeScale;
    if (this.current === next) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && duration > 0)
      this.current.crossFadeTo(next, duration, false);
    else this.current?.stop();
    this.current = next;
    this.currentName = name;
  }
  private rotateWorld(bone: T.Object3D, axis: T.Vector3, angle: number) {
    if (Math.abs(angle) < 1e-5) return;
    const parent = bone.parent!;
    const pq = parent.getWorldQuaternion(new T.Quaternion());
    const wq = bone.getWorldQuaternion(new T.Quaternion());
    const rot = new T.Quaternion().setFromAxisAngle(axis, angle);
    bone.quaternion.copy(pq.invert().multiply(rot).multiply(wq));
    bone.updateMatrixWorld(true);
  }
  update(
    dt: number,
    moving: boolean,
    seated: boolean,
    seatHeight = 0.52,
    pose?: RoomPose,
    showSmoke = true,
    poolRig?: ReturnType<typeof poolStroke>,
    carryCue = false,
    cards?: {
      left: { x: number; y: number; z: number };
      right: { x: number; y: number; z: number };
      lean: number;
      forward?: number;
    },
  ) {
    this.time += dt;
    const alpha = 1 - Math.exp(-dt * 10);
    const now = Date.now();
    const raw = pose?.emote && pose.emote !== "none" ? pose.emote : undefined;
    const limit = raw === "smoke" ? 120000 : raw === "drink" ? 4200 : 6000;
    const active = raw && (!pose?.emoteAt || now - pose.emoteAt < limit);
    const emote = active
      ? raw
      : this.animation === "idle" ||
          this.animation === "walk" ||
          this.animation === "sit"
        ? undefined
        : this.animation;
    const t =
      active && pose?.emoteAt
        ? Math.max(0, (now - pose.emoteAt) / 1000)
        : this.time;
    const preview = this.animation;
    moving = moving || preview === "walk";
    seated = seated || preview === "sit";
    // Ground speed from the group's motion (works for remote interpolation).
    this.group.updateWorldMatrix(true, false);
    const position = this.group.getWorldPosition(new T.Vector3());
    if (this.hasLast && dt > 0) {
      const v =
        Math.hypot(
          position.x - this.lastPosition.x,
          position.z - this.lastPosition.z,
        ) / dt;
      this.speed = T.MathUtils.lerp(
        this.speed,
        Math.min(v, 8),
        1 - Math.exp(-dt * 8),
      );
    }
    this.lastPosition.copy(position);
    this.hasLast = true;
    const speed =
      preview === "walk" ? this.p.speeds.walk * this.scale : this.speed;
    const floorSit =
      emote === "sitfloor" && !moving && !seated && !poolRig && !cards;
    this.seated = T.MathUtils.lerp(this.seated, seated ? 1 : 0, alpha);
    this.floor = T.MathUtils.lerp(this.floor, floorSit ? 1 : 0, alpha);
    // ----- base clip
    const walkSpeed = this.p.speeds.walk * this.scale,
      jogSpeed = this.p.speeds.jog * this.scale;
    if (seated || cards || floorSit)
      this.fade(
        this.speaking ? "Sitting_Talking_Loop" : "Sitting_Idle_Loop",
        0.4,
      );
    else if (moving && speed > 0.15) {
      if (speed > (walkSpeed + jogSpeed) / 2)
        this.fade(
          "Jog_Fwd_Loop",
          0.25,
          T.MathUtils.clamp(speed / jogSpeed, 0.7, 1.4),
        );
      else
        this.fade(
          "Walk_Loop",
          0.25,
          T.MathUtils.clamp(speed / walkSpeed, 0.6, 1.6),
        );
    } else if (poolRig) this.fade("Idle_Loop", 0.3);
    else if (emote === "dance") this.fade("Dance_Loop", 0.35);
    else if (emote === "celebrate") this.fade("Jump_Loop", 0.3);
    else if (emote === "laugh" || this.speaking)
      this.fade("Idle_Talking_Loop", 0.45);
    else this.fade("Idle_Loop", 0.45);
    if (this.current && this.currentName.startsWith("Walk"))
      this.current.timeScale = T.MathUtils.clamp(speed / walkSpeed, 0.6, 1.6);
    if (this.current && this.currentName.startsWith("Jog"))
      this.current.timeScale = T.MathUtils.clamp(speed / jogSpeed, 0.7, 1.4);
    this.mixer.update(dt);
    // ----- placement
    const sitOffset = seatHeight - this.p.sitHeight * this.scale;
    this.body.position.y =
      this.seated * sitOffset +
      this.floor * (0.02 - this.p.sitHeight * this.scale) +
      (poolRig ? -0.06 : 0);
    this.body.position.z = this.seated * (-this.p.sitBack * this.scale - 0.04);
    this.rig.updateMatrixWorld(true);
    const up = new T.Vector3(0, 1, 0);
    const yaw = this.group.getWorldQuaternion(new T.Quaternion());
    const right = new T.Vector3(1, 0, 0).applyQuaternion(yaw);
    // ----- torso lean (pool, cards)
    const leanTarget = poolRig ? 1.08 : (cards?.lean ?? 0);
    this.lean = T.MathUtils.lerp(this.lean, leanTarget, alpha);
    this.forward = T.MathUtils.lerp(
      this.forward,
      poolRig ? 0.1 : (cards?.forward ?? 0) * 0.5,
      alpha,
    );
    if (this.lean > 0.002) {
      this.rotateWorld(this.bone("spine_01"), right, this.lean * 0.45);
      this.rotateWorld(this.bone("spine_02"), right, this.lean * 0.3);
      this.rotateWorld(this.bone("spine_03"), right, this.lean * 0.18);
      this.rotateWorld(this.bone("Head"), right, -this.lean * 0.55);
      if (poolRig) {
        this.rotateWorld(this.bone("pelvis"), right, 0.12);
        for (const s of ["l", "r"]) {
          this.rotateWorld(this.bone(`thigh_${s}`), right, -0.22);
          this.rotateWorld(this.bone(`calf_${s}`), right, 0.3);
        }
      }
    }
    this.body.position.z += this.forward;
    this.body.position.x = 0;
    if (!poolRig && !cards) this.poolShift.multiplyScalar(0.8);
    // The source idle looks at the floor; lift the gaze towards people.
    if (!poolRig && !cards) this.rotateWorld(this.bone("Head"), right, -0.13);
    // ----- floor sitting: legs forward along the floor
    if (this.floor > 0.02) {
      for (const s of ["l", "r"]) {
        this.rotateWorld(this.bone(`calf_${s}`), right, -1.2 * this.floor);
        this.rotateWorld(
          this.bone(`thigh_${s}`),
          new T.Vector3(0, 1, 0).applyQuaternion(yaw),
          (s === "l" ? 0.15 : -0.15) * this.floor,
        );
      }
    }
    this.rig.updateMatrixWorld(true);
    // ----- arms
    this.cigarette.visible =
      emote === "smoke" && showSmoke && !poolRig && !cards;
    const drink = !poolRig && !cards ? this.held : null;
    for (const [kind, g] of this.drinks) g.visible = drink === kind;
    this.poolCue.visible = !!poolRig || carryCue;
    this.poolAligned = false;
    const h = this.scale / AVATAR_SCALE;
    const ik = (hand: 0 | 1, target: T.Vector3, weight = 1) => {
      const s = hand === 0 ? "r" : "l";
      return boneIK(
        this.bone(`upperarm_${s}`),
        this.bone(`lowerarm_${s}`),
        this.bone(`hand_${s}`),
        target,
        this.local(hand === 0 ? -0.55 : 0.55, 0.9 * h, -0.45),
        weight,
        this.handFrames[hand],
      );
    };
    if (poolRig) {
      this.cigarette.visible = false;
      const gripHand = poolRig.stance.gripHand,
        bridgeHand = (1 - gripHand) as 0 | 1;
      if (this.poolGrip.parent !== this.handFrames[gripHand])
        this.handFrames[gripHand].add(this.poolGrip);
      const bridge = new T.Vector3(
          poolRig.bridge.x,
          poolRig.bridge.y,
          poolRig.bridge.z,
        ),
        grip = new T.Vector3(poolRig.grip.x, poolRig.grip.y, poolRig.grip.z);
      this.reachFor([
        [bridgeHand, bridge],
        [gripHand as 0 | 1, grip],
      ]);
      this.handErrors[bridgeHand] = ik(bridgeHand, bridge);
      this.handErrors[gripHand] = ik(gripHand as 0 | 1, grip);
      this.poolAligned = this.handErrors.every((e) => e < 0.035);
      this.placeCue(poolRig);
    } else if (cards) {
      this.cigarette.visible = false;
      // Seated: lean the body slightly so both hands reach the table targets.
      this.reachFor(
        [
          [0, new T.Vector3(cards.left.x, cards.left.y, cards.left.z)],
          [1, new T.Vector3(cards.right.x, cards.right.y, cards.right.z)],
        ],
        { x: 0.15, zMin: -0.1, zMax: 0.25, yMin: -0.05, yMax: 0.12 },
      );
      [cards.left, cards.right].forEach((target, i) => {
        this.handErrors[i] = ik(
          i as 0 | 1,
          new T.Vector3(target.x, target.y, target.z),
        );
      });
    } else if (!moving || drink) {
      this.emoteArms(emote, t, ik, drink, seated);
    }
    if (carryCue && !poolRig) this.carryCue();
    // ----- face
    this.updateFace(dt, emote, t);
    this.rig.updateMatrixWorld(true);
    this.updateSmoke(t);
  }
  // Shift/lower the body so both hands can reach their targets (the stance
  // solver was tuned for different proportions). Smoothed for stability.
  private poolShift = new T.Vector3();
  private reachFor(
    targets: [0 | 1, T.Vector3][],
    limit = { x: 0.45, zMin: -0.45, zMax: 0.6, yMin: -0.4, yMax: 0.12 },
  ) {
    const start = this.body.position.clone();
    this.body.position.add(this.poolShift);
    const wanted = this.poolShift.clone();
    for (let iteration = 0; iteration < 4; iteration++) {
      this.rig.updateMatrixWorld(true);
      const delta = new T.Vector3();
      for (const [hand, target] of targets) {
        const s = hand === 0 ? "r" : "l";
        const shoulder = this.bone("upperarm_" + s).getWorldPosition(
            new T.Vector3(),
          ),
          elbow = this.bone("lowerarm_" + s).getWorldPosition(new T.Vector3()),
          wristBone = this.bone("hand_" + s).getWorldPosition(new T.Vector3()),
          palm = this.handFrames[hand].getWorldPosition(new T.Vector3());
        const reach =
          (shoulder.distanceTo(elbow) +
            elbow.distanceTo(wristBone) +
            wristBone.distanceTo(palm)) *
          0.92;
        const to = target.clone().sub(shoulder),
          d = to.length();
        if (d > reach)
          delta.addScaledVector(to, (d - reach) / d / targets.length);
      }
      if (delta.lengthSq() < 1e-8) break;
      // world delta → avatar-local delta (group has no scale)
      const inv = this.group.getWorldQuaternion(new T.Quaternion()).invert();
      const local = delta.applyQuaternion(inv);
      wanted.add(local);
      this.body.position.add(local);
    }
    wanted.x = T.MathUtils.clamp(wanted.x, -limit.x, limit.x);
    wanted.z = T.MathUtils.clamp(wanted.z, limit.zMin, limit.zMax);
    wanted.y = T.MathUtils.clamp(wanted.y, limit.yMin, limit.yMax);
    // Converge quickly but without jitter between frames.
    this.poolShift.lerp(wanted, 0.5);
    this.body.position.copy(start).add(this.poolShift);
    this.rig.updateMatrixWorld(true);
  }
  private emoteArms(
    emote: string | undefined,
    t: number,
    ik: (hand: 0 | 1, target: T.Vector3, weight?: number) => number,
    drink: HeldDrink | null,
    seated: boolean,
  ) {
    const h = this.scale / AVATAR_SCALE;
    const shoulder = 1.6 * h,
      mouthY = (this.p.mouth.y + 0.02) * this.scale,
      mouthZ = this.p.mouth.z * this.scale + (seated ? 0.06 : 0);
    const offsetY = this.body.position.y;
    const L = (x: number, y: number, z: number) =>
      this.local(x, y + offsetY, z);
    const right = new T.Vector3(1, 0, 0).applyQuaternion(
      this.group.getWorldQuaternion(new T.Quaternion()),
    );
    switch (emote) {
      case "wave":
      case "greet": {
        const swing = Math.sin(t * 7) * 0.08;
        this.openHand("r");
        ik(0, L(-0.4 + swing, shoulder + 0.16, 0.16));
        this.rotateWorld(
          this.bone("hand_r"),
          new T.Vector3(0, 0, 1),
          swing * 2,
        );
        break;
      }
      case "celebrate":
        ik(0, L(-0.28, shoulder + 0.5, 0.05));
        ik(1, L(0.28, shoulder + 0.5, 0.05));
        break;
      case "clap": {
        const k = Math.abs(Math.sin(t * 7)) * 0.11;
        ik(0, L(-(0.03 + k), shoulder - 0.32, 0.36));
        ik(1, L(0.03 + k, shoulder - 0.32, 0.36));
        break;
      }
      case "surprise":
        ik(0, L(-0.2, shoulder + 0.12, 0.26));
        ik(1, L(0.2, shoulder + 0.12, 0.26));
        break;
      case "point":
        this.openHand("l");
        ik(1, L(0.12, shoulder - 0.05, 0.62));
        break;
      case "pose":
        ik(0, L(-0.24, shoulder + 0.3, 0.16));
        ik(1, L(0.3, shoulder - 0.62, 0.08));
        break;
      case "smoke": {
        const cycle = (t % 7) / 7;
        const lift = cycle < 0.25 ? Math.sin((cycle / 0.25) * Math.PI) : 0;
        const rest = L(-0.2, shoulder - 0.48, 0.22);
        const lips = L(-0.03, mouthY, mouthZ + 0.08);
        ik(0, rest.lerp(lips, lift));
        break;
      }
      default:
        break;
    }
    if (drink) this.holdDrink(drink, emote, t, ik, seated, shoulder);
    else for (const g of this.drinks.values()) g.visible = false;
  }
  // Containers are placed in avatar space (upright while held, rim on the lips
  // while drinking) and the hand follows through IK, so the prop never floats
  // away from the palm nor crosses the face.
  private holdDrink(
    kind: HeldDrink,
    emote: string | undefined,
    t: number,
    ik: (hand: 0 | 1, target: T.Vector3, weight?: number) => number,
    seated: boolean,
    shoulder: number,
  ) {
    const g = this.drinks.get(kind)!;
    const height = kind === "bottle" ? 0.222 : kind === "mug" ? 0.13 : 0.11;
    const lift = this.body.position.y;
    const hold = new T.Vector3(
      0.17,
      shoulder - 0.43 + lift + (seated ? 0.02 : 0),
      0.3,
    );
    let center = hold.clone(),
      tilt = 0;
    const axis = new T.Vector3(0, 1, 0);
    if (emote === "toast") {
      const k =
        Math.min(1, t / 0.6) * (t < 3.6 ? 1 : Math.max(0, 1 - (t - 3.6) / 0.6));
      center.lerp(new T.Vector3(0.12, shoulder + 0.08 + lift, 0.52), k);
      tilt = -0.25 * k;
    } else if (emote === "drink") {
      // Raise (0-0.9s), sip (0.9-2.6s), lower (2.6-3.5s).
      const k =
        t < 0.9
          ? smooth(t / 0.9)
          : t < 2.6
            ? 1
            : t < 3.5
              ? 1 - smooth((t - 2.6) / 0.9)
              : 0;
      tilt =
        k * (kind === "bottle" ? 1.15 : 1.0) +
        (t > 0.9 && t < 2.6 ? Math.sin((t - 0.9) * 2.4) * 0.1 : 0) * k;
      if (k > 0.01) {
        this.rotateWorld(
          this.bone("Head"),
          new T.Vector3(1, 0, 0).applyQuaternion(
            this.group.getWorldQuaternion(new T.Quaternion()),
          ),
          -0.2 * k,
        );
        this.rig.updateMatrixWorld(true);
      }
      const lips = this.group.worldToLocal(
        this.mouthMarker.getWorldPosition(new T.Vector3()),
      );
      // Top of the container tilts towards the face; rim rests on the lips.
      const tipped = new T.Vector3(0, Math.cos(tilt), -Math.sin(tilt));
      const rim = lips.clone().add(new T.Vector3(0, -0.006, 0.012));
      const sip = rim.addScaledVector(
        tipped,
        -height * (kind === "bottle" ? 0.62 : 0.5),
      );
      center.lerp(sip, k);
    }
    axis.set(0, Math.cos(tilt), -Math.sin(tilt));
    // Grip on the outer side of the container (left hand at +X).
    const radius = kind === "mug" ? 0.042 : 0.031;
    const gripLocal = center
      .clone()
      .add(new T.Vector3(radius + 0.012, -0.004, -0.006));
    ik(1, this.group.localToWorld(gripLocal.clone()));
    g.visible = true;
    if (g.parent !== this.group) this.group.add(g);
    g.position.copy(center);
    g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis);
  }
  private openHand(side: "l" | "r") {
    for (const [name, bone] of this.bones)
      if (
        /^(index|middle|ring|pinky|thumb)_0[1-3]_/.test(name) &&
        name.endsWith(`_${side}`)
      )
        bone.quaternion.copy(bone.userData.restQ as T.Quaternion);
    this.bone(`hand_${side}`).updateMatrixWorld(true);
  }
  private updateFace(dt: number, emote: string | undefined, t: number) {
    const a = this.appearance;
    // Mouth: only while the voice gate is open (real audio activity), or emotes.
    if (this.time > this.talkAt) {
      this.talkAt = this.time + 0.07 + Math.random() * 0.11;
      this.talkTarget = this.speaking ? 0.25 + Math.random() * 0.75 : 0;
    }
    this.talk = T.MathUtils.lerp(
      this.talk,
      this.talkTarget,
      1 - Math.exp(-dt * 22),
    );
    const base = a.face === "bright" ? 0.05 : a.face === "friendly" ? 0.018 : 0;
    const laugh =
      emote === "laugh" ? 0.09 + Math.abs(Math.sin(t * 11)) * 0.09 : 0;
    const surprise = emote === "surprise" ? 0.2 : 0;
    const drinking = emote === "drink" && t > 0.8 && t < 2.7 ? 0.08 : 0;
    const jaw = Math.max(base, laugh, surprise, drinking, this.talk * 0.2);
    this.bone("voxy_jaw").rotation.x = jaw;
    const brow = this.bone("voxy_brow");
    brow.position.y =
      (brow.userData.y ??= brow.position.y) +
      (emote === "surprise"
        ? 0.007
        : a.face === "calm"
          ? -0.0015
          : a.face === "bright"
            ? 0.002
            : 0) +
      (this.speaking ? this.talk * 0.0012 : 0);
    // Blink.
    if (this.time > this.blinkAt + 0.14)
      this.blinkAt = this.time + 2.2 + Math.random() * 3.6;
    const closing =
      this.time > this.blinkAt
        ? Math.sin(((this.time - this.blinkAt) / 0.14) * Math.PI)
        : 0;
    for (const n of ["voxy_eye_l", "voxy_eye_r"]) {
      const b = this.bone(n),
        rest = b.userData.rest as T.Vector2;
      b.scale.set(rest.x, rest.y * (1 - 0.88 * Math.max(0, closing)), rest.x);
    }
  }
  private placeCue(poolRig: ReturnType<typeof poolStroke>) {
    this.group.updateWorldMatrix(true, true);
    this.poolGrip.updateWorldMatrix(true, false);
    const held = this.poolGrip.getWorldPosition(new T.Vector3());
    const rotation = new T.Quaternion().setFromUnitVectors(
      new T.Vector3(0, 0, 1),
      new T.Vector3(poolRig.tip.x, poolRig.tip.y, poolRig.tip.z)
        .sub(held)
        .normalize(),
    );
    const origin = held
      .clone()
      .add(
        new T.Vector3(0, 0, poolRig.stance.gripDistance - 0.8).applyQuaternion(
          rotation,
        ),
      );
    this.poolCue.matrixAutoUpdate = false;
    this.poolCue.matrix.copy(
      this.poolGrip.matrixWorld
        .clone()
        .invert()
        .multiply(
          new T.Matrix4().compose(origin, rotation, new T.Vector3(1, 1, 1)),
        ),
    );
  }
  private carryCue() {
    this.poolGrip.updateWorldMatrix(true, false);
    this.poolCue.matrixAutoUpdate = false;
    this.poolCue.matrix.copy(
      this.poolGrip.matrixWorld
        .clone()
        .invert()
        .multiply(
          new T.Matrix4().compose(
            this.poolGrip
              .getWorldPosition(new T.Vector3())
              .add(new T.Vector3(0, 0.62, 0)),
            new T.Quaternion().setFromUnitVectors(
              new T.Vector3(0, 0, 1),
              new T.Vector3(0, 1, 0),
            ),
            new T.Vector3(1, 1, 1),
          ),
        ),
    );
  }
  private updateSmoke(t: number) {
    const tip = this.cigarette.localToWorld(new T.Vector3(0, 0, 0.042));
    this.group.worldToLocal(tip);
    this.smoke.forEach((puff, i) => {
      puff.visible = this.cigarette.visible;
      if (!puff.visible) return;
      const phase = (t * 0.38 + i / 5) % 1;
      puff.position
        .copy(tip)
        .add(
          new T.Vector3(
            Math.sin(t + i) * phase * 0.08,
            phase * 0.55,
            phase * 0.04,
          ),
        );
      puff.scale.setScalar(0.04 + phase * 0.18);
      puff.material.opacity = 0.3 * Math.sin(phase * Math.PI);
    });
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rig);
    this.skeleton.dispose();
    this.r.dispose();
    this.group.removeFromParent();
  }
}

function smooth(x: number) {
  const t = T.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
