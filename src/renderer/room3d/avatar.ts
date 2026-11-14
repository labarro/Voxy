import * as T from "three";
import type { Avatar3D, RoomPose } from "../../shared/types";
import { RoomAssets } from "./assets";
import { Resources } from "./resources";
import { armIK } from "./ArmIK";
import { playingCue } from "./PlayingCue";
import type { poolStroke } from "../../shared/poolMotion";
import {
  surface,
  smoothRadialNormals,
  profileGeometry,
  skinnedLimb,
  swept,
  buildHair,
  buildFace,
} from "./characterGeometry";

// Models use a single +Z front and articulated local joints. Facial details are
// placed on the ellipsoid surface instead of fixed offsets outside a GLB head.
export class SocialAvatar {
  readonly group = new T.Group();
  private r = new Resources();
  private body = new T.Group();
  private spine = new T.Group();
  private poolCue!: T.Group;
  private poolGrip = new T.Group();
  private ankles: T.Group[] = [];
  readonly handErrors = [0, 0];
  poolAligned = false;
  private head = new T.Group();
  private floorBlend = 0;
  private arms: T.Group[] = [];
  private legs: T.Group[] = [];
  private shins: T.Object3D[] = [];
  private skeletons: T.Skeleton[] = [];
  private skirt?: T.Group;
  private skirtStanding?: T.Mesh;
  private forearms: T.Object3D[] = [];
  private cigarette = new T.Group();
  private smoke: T.Sprite[] = [];
  private time = 0;
  private seated = 0;
  private animation = "idle";
  private appearance: Avatar3D;
  constructor(_assets: RoomAssets, a: Avatar3D) {
    this.appearance = a;
    const r = this.r,
      outfit = a.outfitStyle ?? a.outfit;
    this.group.add(this.body);
    this.body.scale.set(
      a.body === "soft"
        ? 1.16
        : a.body === "slim"
          ? 0.87
          : a.body === "athletic"
            ? 1.08
            : 1,
      a.height ?? 1,
      1,
    );
    const cloth = a.color,
      pants = a.bottomColor ?? "#30394c",
      shoe = a.shoeColor ?? "#e5ded2";
    const coat = ["coat", "suit"].includes(outfit);
    surface(
      r,
      this.body,
      [
        [coat ? 0.82 : 0.9, 0.21, 0.15],
        [coat ? 0.85 : 0.94, coat ? 0.3 : 0.26, 0.18],
        [1.05, 0.27, 0.185],
        [1.2, 0.27, 0.19],
        [1.35, a.body === "athletic" ? 0.335 : 0.305, 0.19],
        [1.43, 0.29, 0.16],
        [1.49, 0.135, 0.105],
        [1.5, 0.105, 0.09],
      ],
      cloth,
      24,
    );
    if (coat)
      for (const side of [-1, 1]) {
        const lapel = r.keep(new T.BufferGeometry());
        lapel.setAttribute(
          "position",
          new T.Float32BufferAttribute(
            [
              side * 0.07,
              1.47,
              0.13,
              side * 0.18,
              1.34,
              0.17,
              side * 0.11,
              1.21,
              0.195,
              side * 0.04,
              1.32,
              0.206,
            ],
            3,
          ),
        );
        lapel.setIndex([0, 1, 3, 1, 2, 3]);
        lapel.computeVertexNormals();
        const mat = r.keep(r.material("#d8d5ca").clone());
        mat.side = T.DoubleSide;
        this.body.add(new T.Mesh(lapel, mat));
      }
    if (["jacket", "varsity", "shirt", "suit", "coat"].includes(outfit)) {
      r.box(
        this.body,
        0,
        1.23,
        0.213,
        0.025,
        0.46,
        0.025,
        outfit === "shirt" ? "#e4d7be" : "#d2ba87",
        0,
      );
      for (const x of [-0.16, 0.16])
        r.box(this.body, x, 1.12, 0.21, 0.12, 0.11, 0.03, cloth, 0.01);
      for (const y of [1.13, 1.26, 1.39])
        r.sphere(this.body, 0.025, y, 0.228, 0.017, "#e3d6ba");
    }
    if (outfit === "tee")
      r.box(this.body, 0, 1.28, 0.211, 0.24, 0.15, 0.025, "#e8dccd", 0.02);
    if (outfit === "hoodie") {
      const hood = r.sphere(this.body, 0, 1.49, -0.13, 0.26, cloth);
      hood.scale.set(1, 0.65, 0.65);
      for (const x of [-0.08, 0.08])
        r.box(this.body, x, 1.37, 0.19, 0.018, 0.22, 0.018, "#eadcc8", 0);
      r.box(this.body, 0, 1.08, 0.18, 0.31, 0.13, 0.04, cloth, 0.02);
    }
    r.cylinder(this.body, 0, 1.53, 0, 0.105, 0.12, 0.16, a.skin);
    this.head.position.y = 1.82;
    this.body.add(this.head);
    const rx =
      a.headShape === "square" ? 0.335 : a.headShape === "oval" ? 0.29 : 0.32;
    const ry = a.headShape === "oval" ? 0.385 : 0.34,
      rz = 0.295;
    const power = a.headShape === "square" ? 2.6 : 2;
    const geometry = r.keep(new T.SphereGeometry(1, 28, 20)),
      positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const shape = (v: number) =>
        Math.sign(v) * Math.pow(Math.abs(v), 2 / power);
      positions.setXYZ(
        i,
        shape(positions.getX(i)) * rx,
        shape(positions.getY(i)) * ry,
        shape(positions.getZ(i)) * rz,
      );
    }
    geometry.computeVertexNormals();
    smoothRadialNormals(geometry, 28);
    const skull = new T.Mesh(geometry, r.material(a.skin, 0.83));
    skull.castShadow = skull.receiveShadow = true;
    this.head.add(skull);
    for (const side of [-1, 1]) {
      const ear = r.sphere(
        this.head,
        side * (rx - 0.012),
        -0.025,
        -0.005,
        0.062,
        a.skin,
      );
      ear.scale.set(0.65, 1, 0.55);
    }
    buildFace(r, this.head, a, rx, ry, rz, power);
    const nose = r.sphere(
      this.head,
      0,
      -0.044,
      rz - 0.012,
      a.nose === "round" ? 0.049 : 0.037,
      a.skin,
    );
    nose.scale.set(a.nose === "wide" ? 1.25 : 0.82, 0.8, 0.42);
    const accessories = new Set(
      a.accessories ?? [a.accessoryStyle ?? a.accessory],
    );
    const hat = ["beanie", "cap", "hat"].find((x) => accessories.has(x as any));
    const hair = a.hairStyle ?? a.hair;
    const cap = (
      y: number,
      sx: number,
      sy: number,
      sz: number,
      color = a.hairColor,
    ) => {
      const m = r.sphere(this.head, 0, y, -0.025, 1, color);
      m.scale.set(sx, sy, sz);
      return m;
    };
    buildHair(r, this.head, a, rx, ry, rz, !!hat);
    // Headwear takes priority over tall hairstyles; one item per conflict group.
    if (hat) {
      cap(0.28, rx + 0.04, 0.16, rz + 0.04, cloth);
      if (hat === "beanie")
        r.cylinder(this.head, 0, 0.23, 0, rx + 0.035, rx + 0.035, 0.09, cloth);
      if (hat === "cap")
        r.box(this.head, 0, 0.22, 0.32, 0.45, 0.045, 0.3, cloth, 0.015);
      if (hat === "hat") {
        const brim = r.cylinder(
          this.head,
          0,
          0.23,
          0,
          0.49,
          0.49,
          0.045,
          cloth,
        );
        brim.scale.z = 0.86;
      }
    }
    const glasses = accessories.has("sunglasses")
      ? "sunglasses"
      : accessories.has("glasses")
        ? "glasses"
        : null;
    if (glasses) {
      for (const x of [-0.12, 0.12]) {
        if (glasses === "sunglasses")
          r.box(this.head, x, 0.04, 0.296, 0.19, 0.12, 0.025, "#292b35", 0.02);
        else {
          const rim = new T.Mesh(
            r.keep(new T.TorusGeometry(0.085, 0.012, 6, 20)),
            r.material("#bd9864", 0.35, 0.6),
          );
          rim.position.set(x, 0.04, 0.3);
          this.head.add(rim);
        }
        const side = Math.sign(x);
        swept(
          r,
          this.head,
          [
            [side * 0.205, 0.04, 0.3],
            [side * (rx * 0.87 + 0.025), 0.04, 0.21],
            [side * (rx + 0.018), 0.015, 0],
          ],
          [0.008, 0.008, 0.007],
          "#bd9864",
          6,
          18,
        );
      }
      r.box(this.head, 0, 0.05, 0.305, 0.075, 0.015, 0.015, "#bd9864", 0);
    }
    if (accessories.has("headphones") || accessories.has("headset")) {
      const padding = hat
        ? 0.025
        : hair === "afro"
          ? 0.14
          : hair === "curly"
            ? 0.085
            : 0.025;
      const radius = rx + padding + 0.035;
      for (const x of [-radius, radius]) {
        const cup = r.sphere(this.head, x, 0, 0, 0.105, "#a294ca");
        cup.scale.set(0.5, 1, 1);
      }
      const band = new T.Mesh(
        r.keep(new T.TorusGeometry(radius, 0.022, 8, 32, Math.PI)),
        r.material("#a294ca"),
      );
      band.scale.y = (hat ? 0.49 : ry + padding * 0.8 + 0.035) / radius;
      this.head.add(band);
      if (accessories.has("headset")) {
        swept(
          r,
          this.head,
          [
            [radius, -0.035, 0.035],
            [radius * 0.8, -0.1, 0.23],
            [0.13, -0.12, 0.34],
          ],
          [0.01, 0.009, 0.009],
          "#423e55",
          7,
          22,
        );
        const mic = r.sphere(this.head, 0.13, -0.12, 0.34, 0.023, "#423e55");
        mic.scale.x = 1.4;
      }
    }
    if (accessories.has("earrings"))
      for (const x of [-rx, rx]) {
        const ring = new T.Mesh(
          r.keep(new T.TorusGeometry(0.045, 0.009, 6, 16)),
          r.material("#d9b76c", 0.3, 0.6),
        );
        ring.position.set(x, -0.105, 0.025);
        this.head.add(ring);
      }
    if (accessories.has("necklace")) {
      const chain = new T.Mesh(
        r.keep(new T.TorusGeometry(0.145, 0.009, 6, 24)),
        r.material("#d9b76c", 0.3, 0.6),
      );
      chain.position.set(0, 1.42, 0.15);
      chain.scale.y = 0.7;
      this.body.add(chain);
    }
    if (accessories.has("backpack")) {
      surface(
        r,
        this.body,
        [
          [0.94, 0.13, 0.08, -0.27],
          [0.99, 0.22, 0.11, -0.28],
          [1.26, 0.235, 0.12, -0.29],
          [1.45, 0.2, 0.1, -0.27],
          [1.49, 0.12, 0.06, -0.25],
        ],
        "#856a52",
        24,
      );
      for (const side of [-1, 1])
        swept(
          r,
          this.body,
          [
            [side * 0.18, 1.4, -0.23],
            [side * 0.18, 1.47, 0],
            [side * 0.18, 1.26, 0.16],
            [side * 0.18, 0.99, 0.15],
          ],
          [0.019, 0.019, 0.018, 0.018],
          "#856a52",
          7,
          24,
        );
    }
    for (const side of [-1, 1]) {
      const arm = new T.Group();
      arm.position.set(side * 0.295, 1.43, 0);
      arm.rotation.z = side * 0.16;
      this.body.add(arm);
      this.arms.push(arm);
      const sleeve = outfit === "varsity" ? "#e6d9c4" : cloth;
      const limb = skinnedLimb(
        r,
        arm,
        0.62,
        0.27,
        [
          [0.07, 0.004, 0.004],
          [0.045, 0.075, 0.075],
          [0, 0.107, 0.105],
          [-0.1, 0.105, 0.1],
          [-0.2, 0.093, 0.09],
          [-0.27, 0.085, 0.085],
          [-0.34, 0.082, 0.082],
          [-0.43, 0.075, 0.075],
          [-0.49, 0.069, 0.067],
          [-0.515, 0.084, 0.075],
          [-0.565, 0.086, 0.078],
          [-0.6, 0.06, 0.065],
          [-0.625, 0.002, 0.002],
        ],
        (y) =>
          y < -0.495 ? a.skin : outfit === "tee" && y < -0.19 ? a.skin : sleeve,
      );
      this.forearms.push(limb.lower);
      this.skeletons.push(limb.skeleton);
      if (accessories.has("bracelet") && side === 1)
        r.cylinder(limb.lower, 0, -0.22, 0, 0.078, 0.078, 0.025, "#d9b76c");
      const leg = new T.Group();
      leg.position.set(side * 0.14, 0.96, 0);
      this.body.add(leg);
      this.legs.push(leg);
      const bare = a.bottom === "shorts" || a.bottom === "skirt";
      const legLimb = skinnedLimb(
        r,
        leg,
        0.86,
        0.39,
        [
          [0.065, 0.006, 0.006],
          [0.035, 0.105, 0.12],
          [-0.05, 0.13, 0.135],
          [-0.19, 0.124, 0.13],
          [-0.3, 0.113, 0.12],
          [-0.39, 0.104, 0.11],
          [-0.47, 0.106, 0.11],
          [-0.6, 0.094, 0.1],
          [-0.73, 0.079, 0.085],
          [-0.82, 0.07, 0.078],
          [-0.86, 0.003, 0.003],
        ],
        (y) =>
          a.bottom === "skirt" ? a.skin : bare && y < -0.31 ? a.skin : pants,
      );
      this.shins.push(legLimb.lower);
      this.skeletons.push(legLimb.skeleton);
      const shin = legLimb.lower,
        boot = a.shoes === "boots";
      // A shaped last with instep, heel and a rounded toe, plus a thin sole.
      surface(
        r,
        shin,
        [
          [boot ? -0.26 : -0.38, 0.067, 0.078, 0],
          [boot ? -0.28 : -0.39, 0.085, 0.105, 0.018],
          [-0.425, 0.107, 0.17, 0.064],
          [-0.465, 0.11, 0.185, 0.075],
          [-0.485, 0.095, 0.17, 0.075],
          [-0.492, 0.001, 0.001, 0.075],
        ],
        shoe,
        20,
      );
      const sole = surface(
        r,
        shin,
        [
          [-0.47, 0.11, 0.183, 0.075],
          [-0.493, 0.108, 0.18, 0.075],
          [-0.5, 0.095, 0.16, 0.075],
          [-0.502, 0.001, 0.001, 0.075],
        ],
        a.shoes === "formal" ? "#3b3332" : "#d5d0c6",
        20,
      );
      sole.name = "shoe-sole";
      sole.userData.dynamic = true;
      if (a.shoes === "sneakers" || !a.shoes)
        for (const z of [0.09, 0.14])
          swept(
            r,
            shin,
            [
              [-0.045, -0.424, z],
              [0, -0.415, z + 0.004],
              [0.045, -0.424, z],
            ],
            [0.006, 0.006, 0.006],
            "#f3eee6",
            5,
            8,
          );
    }
    if (a.bottom === "skirt") {
      this.skirt = new T.Group();
      this.skirt.position.y = 0.985;
      this.body.add(this.skirt);
      const rings = Array.from({ length: 10 }, (_, i) => {
        const t = i / 9;
        return [-t * 0.45, 0.25 + 0.13 * t, 0.2 + 0.12 * t] as [
          number,
          number,
          number,
        ];
      });
      const geometry = r.keep(profileGeometry(rings, 24)),
        base = geometry.getAttribute("position");
      geometry.morphAttributes.position = [];
      geometry.morphAttributes.normal = [];
      for (const hip of [0.74, 0.7]) {
        const draped = base.clone(),
          h = a.height ?? 1,
          drop = (hip - (0.502 * h + 0.03)) / h;
        for (let i = 0; i < base.count; i++) {
          const t = -base.getY(i) / 0.45,
            phi = ((i % 25) / 24) * Math.PI * 2,
            front = T.MathUtils.smoothstep(Math.cos(phi), -0.15, 0.35);
          draped.setXYZ(
            i,
            base.getX(i),
            front * (0.14 - (drop + 0.06) * t) + (1 - front) * (-0.12 * t),
            Math.cos(phi) * (0.2 + 0.12 * t + 0.18 * t * front),
          );
        }
        const target = geometry.clone();
        target.morphAttributes = {};
        target.setAttribute("position", draped);
        target.computeVertexNormals();
        smoothRadialNormals(target, 24);
        geometry.morphAttributes.position.push(draped);
        geometry.morphAttributes.normal.push(
          target.getAttribute("normal").clone(),
        );
        target.dispose();
      }
      const mat = r.keep(r.material(pants).clone());
      mat.side = T.DoubleSide;
      this.skirtStanding = new T.Mesh(geometry, mat);
      this.skirtStanding.name = "continuous-skirt-drape";
      this.skirtStanding.castShadow = this.skirtStanding.receiveShadow = true;
      this.skirtStanding.userData.dynamic = true;
      this.skirt.add(this.skirtStanding);
    }
    const hand = this.forearms[1];
    hand.add(this.cigarette);
    this.cigarette.position.set(0, -0.3, 0.1);
    this.cigarette.rotation.x = Math.PI / 2;
    r.cylinder(this.cigarette, 0, 0, 0, 0.014, 0.014, 0.18, "#e5ded0");
    r.cylinder(this.cigarette, 0, -0.07, 0, 0.015, 0.015, 0.045, "#b68b57");
    r.cylinder(this.cigarette, 0, 0.09, 0, 0.014, 0.014, 0.012, "#ce7654");
    this.cigarette.visible = false;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d")!,
      gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(230,225,215,.65)");
    gradient.addColorStop(0.4, "rgba(215,212,207,.3)");
    gradient.addColorStop(1, "rgba(215,212,207,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    const smokeMap = r.keep(new T.CanvasTexture(canvas));
    for (let i = 0; i < 5; i++) {
      const material = r.keep(
        new T.SpriteMaterial({
          map: smokeMap,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        }),
      );
      const puff = new T.Sprite(material);
      this.body.add(puff);
      this.smoke.push(puff);
    }
    if (this.skirtStanding) this.skirtStanding.userData.dynamic = true;
    for (const shin of this.shins) {
      const ankle = new T.Group();
      ankle.position.y = -0.485;
      for (const child of [...shin.children]) {
        ankle.add(child);
        child.position.y += 0.485;
      }
      shin.add(ankle);
      this.ankles.push(ankle);
    }
    r.batch(this.body);
    // Preserve the pelvis/legs while bending the torso. The standing bind pose
    // is unchanged; clothes, head and both arm skeletons share this spine pivot.
    this.spine.position.y = 0.95;
    for (const child of [...this.body.children])
      if (
        !this.legs.includes(child as T.Group) &&
        child !== this.skirt &&
        !this.smoke.includes(child as T.Sprite)
      ) {
        this.spine.add(child);
        child.position.y -= 0.95;
      }
    this.body.add(this.spine);
    this.poolGrip.position.y = -0.35;
    this.forearms[1].add(this.poolGrip);
    this.poolCue = playingCue(r, this.poolGrip);
    this.poolCue.visible = false;
  }
  play(name: string) {
    this.animation = name;
  }
  handWorld(index: number) {
    this.forearms[index].updateWorldMatrix(true, false);
    return this.forearms[index].localToWorld(new T.Vector3(0, -0.35, 0));
  }
  update(
    dt: number,
    moving: boolean,
    seated: boolean,
    seatHeight = 0.74,
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
    const alpha = 1 - Math.exp(-dt * 12),
      active =
        pose?.emote &&
        pose.emote !== "none" &&
        (!pose.emoteAt ||
          Date.now() - pose.emoteAt < (pose.emote === "smoke" ? 120000 : 6000));
    const emote = active
      ? pose!.emote
      : this.animation === "idle"
        ? "none"
        : this.animation;
    const t =
      active && pose?.emoteAt
        ? Math.max(0, (Date.now() - pose.emoteAt) / 1000)
        : this.time;
    const floorSit =
      emote === "sitfloor" && !moving && !seated && !poolRig && !cards;
    this.floorBlend = T.MathUtils.lerp(
      this.floorBlend,
      floorSit ? 1 : 0,
      alpha,
    );
    this.seated = T.MathUtils.lerp(
      this.seated,
      seated || floorSit ? 1 : 0,
      alpha,
    );
    this.spine.rotation.x = T.MathUtils.lerp(
      this.spine.rotation.x,
      poolRig
        ? 1.05 + ((this.appearance.height ?? 1) - 1) * 1.2
        : (cards?.lean ?? 0),
      alpha,
    );
    this.spine.position.z = T.MathUtils.lerp(
      this.spine.position.z,
      poolRig
        ? 0.24
        : cards?.forward !== undefined
          ? cards.forward +
            (1 - (this.appearance.height ?? 1)) *
              0.9 *
              Math.min(1, cards.forward / 0.2)
          : 0,
      alpha,
    );
    this.head.rotation.x = T.MathUtils.lerp(
      this.head.rotation.x,
      poolRig ? -0.45 : cards ? -cards.lean : 0,
      alpha,
    );
    if (this.skirtStanding?.morphTargetInfluences) {
      const normalSeat = T.MathUtils.clamp((seatHeight - 0.7) / 0.04, 0, 1);
      this.skirtStanding.morphTargetInfluences[0] = this.seated * normalSeat;
      this.skirtStanding.morphTargetInfluences[1] =
        this.seated * (1 - normalSeat);
    }
    const avatarHeight = this.appearance.height ?? 1;
    const seatedBend = Math.acos(
      T.MathUtils.clamp(
        (seatHeight - (0.502 * avatarHeight + 0.03)) / (0.39 * avatarHeight),
        0.15,
        0.95,
      ),
    );
    this.body.position.y =
      T.MathUtils.lerp(
        -0.04 * avatarHeight,
        seatHeight - 0.96 * avatarHeight,
        this.seated,
      ) +
      (poolRig ? -0.053 : 0) +
      this.floorBlend * (0.22 * avatarHeight - seatHeight) +
      (!seated && moving
        ? Math.abs(Math.sin(t * 9)) * 0.025
        : Math.sin(t * 2) * 0.008);
    const sway = this.appearance.idle === "lively" ? 0.035 : 0.012;
    this.body.rotation.z =
      emote === "dance" ? Math.sin(t * 5) * 0.13 : Math.sin(t * 1.4) * sway;
    this.head.rotation.y = emote === "greet" ? Math.sin(t * 4) * 0.12 : 0;
    this.head.rotation.z = emote === "laugh" ? Math.sin(t * 12) * 0.05 : 0;
    this.arms.forEach((arm, i) => {
      const wave = (emote === "wave" || emote === "greet") && i === 1;
      const celebrate = emote === "celebrate" || emote === "dance";
      const smoking = emote === "smoke" && showSmoke && i === 1;
      const target = smoking
        ? -1.3
        : celebrate
          ? -2.4
          : wave
            ? -2.2
            : moving
              ? Math.sin(t * 9 + i * Math.PI) * 0.55
              : floorSit
                ? -0.75
                : emote === "laugh"
                  ? -0.6 + Math.sin(t * 12) * 0.05
                  : this.appearance.idle === "confident"
                    ? -0.14
                    : -0.05;
      arm.rotation.x = T.MathUtils.lerp(arm.rotation.x, target, alpha);
      arm.rotation.z = T.MathUtils.lerp(
        arm.rotation.z,
        wave ? Math.sin(t * 8) * 0.25 : smoking ? -0.8 : i === 0 ? -0.16 : 0.16,
        alpha,
      );
      this.forearms[i].rotation.x = T.MathUtils.lerp(
        this.forearms[i].rotation.x,
        smoking ? -1.3 + Math.sin(t * 1.2) * 0.08 : -0.08,
        alpha,
      );
    });
    this.legs.forEach((leg, i) => {
      leg.rotation.x = T.MathUtils.lerp(
        leg.rotation.x,
        poolRig
          ? -0.35
          : floorSit
            ? -1.4
            : seated
              ? -seatedBend
              : moving
                ? Math.sin(t * 9 + i * Math.PI) * (this.skirt ? 0.35 : 0.6)
                : emote === "dance"
                  ? Math.sin(t * 5 + i * Math.PI) * 0.22
                  : 0,
        alpha,
      );
      const shin = this.shins[i];
      leg.rotation.z = T.MathUtils.lerp(
        leg.rotation.z,
        floorSit ? (i === 0 ? -0.22 : 0.22) : 0,
        alpha,
      );
      shin.rotation.x = T.MathUtils.lerp(
        shin.rotation.x,
        poolRig
          ? 0.7
          : floorSit
            ? 2.8
            : seated
              ? seatedBend
              : moving
                ? Math.max(0, Math.sin(t * 9 + i * Math.PI)) * 0.55
                : 0,
        alpha,
      );
      this.ankles[i].rotation.x = T.MathUtils.lerp(
        this.ankles[i].rotation.x,
        poolRig ? -0.35 : floorSit ? -1.4 : 0,
        alpha,
      );
    });
    this.cigarette.visible = emote === "smoke" && showSmoke;
    this.poolCue.visible = !!poolRig || carryCue;
    this.poolAligned = false;
    if (carryCue && !poolRig) {
      this.poolGrip.updateWorldMatrix(true, false);
      this.poolCue.matrixAutoUpdate = false;
      this.poolCue.matrix.copy(
        new T.Matrix4()
          .copy(this.poolGrip.matrixWorld)
          .invert()
          .multiply(
            new T.Matrix4().compose(
              this.poolGrip.getWorldPosition(new T.Vector3()),
              new T.Quaternion().setFromUnitVectors(
                new T.Vector3(0, 0, 1),
                new T.Vector3(0, 1, 0),
              ),
              new T.Vector3(1, 1, 1),
            ),
          ),
      );
    }
    if (poolRig) {
      this.cigarette.visible = false;
      this.body.rotation.z = 0;
      this.group.updateWorldMatrix(true, true);
      const bridge = new T.Vector3(
          poolRig.bridge.x,
          poolRig.bridge.y,
          poolRig.bridge.z,
        ),
        grip = new T.Vector3(poolRig.grip.x, poolRig.grip.y, poolRig.grip.z);
      const gripHand = poolRig.stance.gripHand,
        bridgeHand = 1 - gripHand;
      if (this.poolGrip.parent !== this.forearms[gripHand])
        this.forearms[gripHand].add(this.poolGrip);
      this.handErrors[bridgeHand] = armIK(
        this.arms[bridgeHand],
        this.forearms[bridgeHand],
        bridge,
        bridgeHand === 0 ? -1 : 1,
      );
      this.handErrors[gripHand] = armIK(
        this.arms[gripHand],
        this.forearms[gripHand],
        grip,
        gripHand === 0 ? -1 : 1,
      );
      this.poolAligned = this.handErrors.every((error) => error < 0.035);
      this.poolGrip.updateWorldMatrix(true, false);
      const held = this.poolGrip.getWorldPosition(new T.Vector3());
      const heldRotation = new T.Quaternion().setFromUnitVectors(
        new T.Vector3(0, 0, 1),
        new T.Vector3(poolRig.tip.x, poolRig.tip.y, poolRig.tip.z)
          .sub(held)
          .normalize(),
      );
      const cueOrigin = held
        .clone()
        .add(
          new T.Vector3(
            0,
            0,
            poolRig.stance.gripDistance - 0.8,
          ).applyQuaternion(heldRotation),
        );
      this.poolCue.matrixAutoUpdate = false;
      this.poolCue.matrix.copy(
        new T.Matrix4()
          .copy(this.poolGrip.matrixWorld)
          .invert()
          .multiply(
            new T.Matrix4().compose(
              cueOrigin,
              heldRotation,
              new T.Vector3(1, 1, 1),
            ),
          ),
      );
    }
    if (
      !cards &&
      !poolRig &&
      ["clap", "point", "pose", "surprise"].includes(emote ?? "")
    ) {
      this.group.updateWorldMatrix(true, true);
      const targets =
        emote === "clap"
          ? [
              [-(0.035 + Math.abs(Math.sin(t * 7)) * 0.13), 1.25, 0.43],
              [0.035 + Math.abs(Math.sin(t * 7)) * 0.13, 1.25, 0.43],
            ]
          : emote === "surprise"
            ? [
                [-0.22, 1.74, 0.3],
                [0.22, 1.74, 0.3],
              ]
            : emote === "point"
              ? [
                  [-0.28, 1.02, 0.1],
                  [0.1, 1.48, 0.57],
                ]
              : [
                  [-0.28, 1.07, 0.12],
                  [0.2, 1.9, 0.24],
                ];
      targets.forEach((target, i) => {
        const world = this.body.localToWorld(new T.Vector3(...target));
        armIK(this.arms[i], this.forearms[i], world, i === 0 ? -1 : 1);
      });
    }
    if (cards) {
      this.cigarette.visible = false;
      this.group.updateWorldMatrix(true, true);
      [cards.left, cards.right].forEach((target, i) => {
        this.handErrors[i] = armIK(
          this.arms[i],
          this.forearms[i],
          new T.Vector3(target.x, target.y, target.z),
          i === 0 ? -1 : 1,
        );
      });
    }
    // Small puffs travel from the animated cigarette tip, then dissipate.
    this.body.updateMatrixWorld(true);
    this.smoke.forEach((puff, i) => {
      puff.visible = this.cigarette.visible;
      const phase = (t * 0.38 + i / 5) % 1;
      const origin = this.cigarette.localToWorld(new T.Vector3(0, 0.1, 0));
      this.body.worldToLocal(origin);
      puff.position
        .copy(origin)
        .add(
          new T.Vector3(
            Math.sin(t + i) * phase * 0.08,
            phase * 0.55,
            phase * 0.04,
          ),
        );
      puff.scale.setScalar(0.05 + phase * 0.2);
      puff.material.opacity = 0.3 * Math.sin(phase * Math.PI);
    });
  }
  dispose() {
    for (const skeleton of this.skeletons) skeleton.dispose();
    this.r.dispose();
    this.group.removeFromParent();
  }
}
