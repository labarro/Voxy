import * as T from "three";
import type { Avatar3D, RoomPose } from "../../shared/types";
import { RoomAssets } from "./assets";
import { Resources } from "./resources";

// Models use a single +Z front and articulated local joints. Facial details are
// placed on the ellipsoid surface instead of fixed offsets outside a GLB head.
export class SocialAvatar {
  readonly group = new T.Group();
  private r = new Resources();
  private body = new T.Group();
  private head = new T.Group();
  private arms: T.Group[] = [];
  private legs: T.Group[] = [];
  private shins: T.Group[] = [];
  private skirt?: T.Group;
  private skirtStanding?: T.Mesh;
  private skirtSeated?: T.Mesh;
  private forearms: T.Group[] = [];
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
    r.cylinder(this.body, 0, 1.02, 0, 0.22, 0.24, 0.2, cloth);
    const width = a.body === "athletic" ? 0.64 : 0.56;
    r.box(this.body, 0, 1.22, 0, width, 0.59, 0.34, cloth, 0.15);
    if (["coat", "suit"].includes(outfit)) {
      r.box(this.body, 0, 0.98, 0, 0.6, 0.44, 0.37, cloth, 0.08);
      for (const x of [-0.12, 0.12]) {
        const lapel = r.box(
          this.body,
          x,
          1.35,
          0.19,
          0.11,
          0.3,
          0.025,
          "#d8d5ca",
          0,
        );
        lapel.rotation.z = x < 0 ? 0.25 : -0.25;
      }
    }
    if (["jacket", "varsity", "shirt", "suit", "coat"].includes(outfit)) {
      r.box(
        this.body,
        0,
        1.23,
        0.186,
        0.025,
        0.46,
        0.025,
        outfit === "shirt" ? "#e4d7be" : "#d2ba87",
        0,
      );
      for (const x of [-0.16, 0.16])
        r.box(this.body, x, 1.12, 0.188, 0.12, 0.11, 0.03, cloth, 0.01);
      for (const y of [1.13, 1.26, 1.39])
        r.sphere(this.body, 0.025, y, 0.206, 0.017, "#e3d6ba");
    }
    if (outfit === "tee")
      r.box(this.body, 0, 1.28, 0.18, 0.24, 0.15, 0.025, "#e8dccd", 0.02);
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
    if (a.headShape === "square")
      r.box(this.head, 0, 0, 0, rx * 2, ry * 2, rz * 2, a.skin, 0.16);
    else {
      const skull = r.sphere(this.head, 0, 0, 0, 1, a.skin);
      skull.scale.set(rx, ry, rz);
    }
    const surface = (x: number, y: number) =>
      a.headShape === "square"
        ? rz
        : rz * Math.sqrt(Math.max(0.01, 1 - (x / rx) ** 2 - (y / ry) ** 2));
    for (const x of [-rx, rx]) {
      const ear = r.sphere(this.head, x, -0.025, 0, 0.075, a.skin);
      ear.scale.set(0.7, 1, 0.6);
    }
    const eyeY = 0.035;
    for (const x of [-0.115, 0.115]) {
      const eye = r.sphere(
        this.head,
        x,
        eyeY,
        surface(x, eyeY),
        0.044,
        "#292b35",
      );
      eye.scale.set(
        a.eyes === "almond" ? 1.25 : 1,
        a.eyes === "sleepy" || a.face === "calm"
          ? 0.35
          : a.face === "bright"
            ? 1.2
            : 0.85,
        0.13,
      );
      const glint = r.sphere(
        this.head,
        x - 0.009,
        eyeY + 0.01,
        surface(x, eyeY) + 0.007,
        0.01,
        "#f7eee1",
      );
      glint.scale.z = 0.2;
      const brow = r.box(
        this.head,
        x,
        0.115,
        surface(x, 0.115) + 0.004,
        0.089,
        a.brows === "bold" ? 0.027 : 0.017,
        0.012,
        a.hairColor,
        0,
      );
      brow.rotation.z = (a.brows === "arched" ? 0.24 : 0.07) * Math.sign(-x);
    }
    const nose = r.sphere(
      this.head,
      0,
      -0.045,
      rz - 0.008,
      a.nose === "round" ? 0.065 : 0.047,
      a.skin,
    );
    nose.scale.set(a.nose === "wide" ? 1.4 : 0.8, 0.8, 0.45);
    const points = Array.from({ length: 17 }, (_, i) => {
      const x = (i / 16 - 0.5) * 0.16,
        y =
          -0.112 -
          (a.face === "calm" ? 0.003 : Math.sin((i / 16) * Math.PI) * 0.035);
      return new T.Vector3(x, y, surface(x, y) + 0.004);
    });
    const mouth = new T.Mesh(
      r.keep(
        new T.TubeGeometry(new T.CatmullRomCurve3(points), 16, 0.008, 5, false),
      ),
      r.material("#754547"),
    );
    this.head.add(mouth);
    if (a.facialHair && a.facialHair !== "none") {
      const beard = a.facialHair !== "mustache";
      const fur = r.sphere(
        this.head,
        0,
        beard ? -0.19 : -0.085,
        beard ? 0.16 : 0.275,
        1,
        a.hairColor,
      );
      fur.scale.set(
        beard ? 0.235 : 0.11,
        beard ? (a.facialHair === "stubble" ? 0.09 : 0.16) : 0.025,
        beard ? 0.105 : 0.016,
      );
    }
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
    if (hair !== "bald" && hair !== "buzz") {
      // Upper hemisphere is an authored cap, leaving the forehead and face clear.
      const shell = new T.Mesh(
        r.keep(
          new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.36),
        ),
        r.material(a.hairColor),
      );
      shell.scale.set(rx + 0.025, ry + 0.025, rz + 0.025);
      this.head.add(shell);
    }
    if (hair === "buzz") {
      const shell = new T.Mesh(
        r.keep(
          new T.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.39),
        ),
        r.material(a.hairColor),
      );
      shell.scale.set(rx + 0.004, ry + 0.004, rz + 0.004);
      this.head.add(shell);
    }
    if (!hat) {
      if (hair === "crest") {
        const m = cap(0.33, 0.18, 0.17, 0.23);
        m.rotation.z = -0.25;
      }
      if (hair === "afro") {
        for (let i = 0; i < 14; i++) {
          const t = (i / 14) * Math.PI * 2;
          const m = r.sphere(
            this.head,
            Math.cos(t) * 0.28,
            0.2 + Math.sin(t) * 0.1,
            Math.sin(t) * 0.2,
            0.16,
            a.hairColor,
          );
          m.scale.y = 1.2;
        }
      }
      if (hair === "curly" || hair === "bun")
        for (const x of [-0.25, 0.25])
          r.sphere(
            this.head,
            x,
            0.3,
            -0.09,
            hair === "bun" ? 0.14 : 0.2,
            a.hairColor,
          );
      if (hair === "ponytail") {
        const tail = r.sphere(this.head, 0, -0.02, -0.33, 0.16, a.hairColor);
        tail.scale.set(0.8, 2, 0.8);
      }
      if (hair === "short") {
        const fringe = r.box(
          this.head,
          -0.08,
          0.24,
          0.19,
          0.36,
          0.13,
          0.15,
          a.hairColor,
          0.05,
        );
        fringe.rotation.z = 0.15;
      }
      if (a.hairSecondary && !["bald", "afro", "curly", "bun"].includes(hair)) {
        const streak = new T.Mesh(
          r.keep(
            new T.SphereGeometry(1, 6, 8, Math.PI * 0.4, 0.18, 0.12, 0.96),
          ),
          r.material(a.hairSecondary),
        );
        const lift = hair === "buzz" ? 0.006 : 0.028;
        streak.scale.set(rx + lift, ry + lift, rz + lift);
        this.head.add(streak);
      }
    }
    if (["long", "bob", "wavy", "braids"].includes(hair)) {
      const length = hair === "bob" ? 0.32 : 0.61;
      for (const x of [-1, 1]) {
        if (hair === "braids" || hair === "wavy")
          for (let i = 0; i < 5; i++) {
            const part = r.sphere(
              this.head,
              x *
                (rx +
                  0.005 +
                  (hair === "wavy" ? Math.sin(i * 1.8) * 0.025 : 0)),
              0.15 - i * 0.105,
              -0.05,
              0.105,
              i % 2 && a.hairSecondary ? a.hairSecondary : a.hairColor,
            );
            part.scale.set(0.8, 1, 0.85);
          }
        else
          r.box(
            this.head,
            x * (rx - 0.025),
            0.1 - length / 2,
            -0.08,
            0.14,
            length,
            0.28,
            a.hairColor,
            0.06,
          );
      }
      if (hair === "long")
        r.box(this.head, 0, -0.12, -0.25, 0.5, 0.57, 0.13, a.hairColor, 0.06);
    }
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
        r.box(
          this.head,
          Math.sign(x) * 0.25,
          0.04,
          0.16,
          0.02,
          0.02,
          0.28,
          "#bd9864",
          0,
        );
      }
      r.box(this.head, 0, 0.05, 0.305, 0.075, 0.015, 0.015, "#bd9864", 0);
    }
    if (accessories.has("headphones") || accessories.has("headset")) {
      for (const x of [-rx - 0.025, rx + 0.025]) {
        const cup = r.sphere(this.head, x, 0, 0, 0.105, "#a294ca");
        cup.scale.set(0.5, 1, 1);
      }
      const band = new T.Mesh(
        r.keep(new T.TorusGeometry(rx + 0.035, 0.022, 6, 24, Math.PI)),
        r.material("#a294ca"),
      );
      this.head.add(band);
      if (accessories.has("headset"))
        r.box(this.head, 0.21, -0.11, 0.27, 0.22, 0.025, 0.025, "#423e55", 0);
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
      r.box(this.body, 0, 1.22, -0.28, 0.46, 0.57, 0.24, "#856a52", 0.09);
      for (const x of [-0.2, 0.2])
        r.box(this.body, x, 1.29, 0.18, 0.045, 0.42, 0.035, "#856a52", 0.01);
    }
    for (const side of [-1, 1]) {
      const arm = new T.Group();
      arm.position.set(side * 0.36, 1.43, 0);
      this.body.add(arm);
      this.arms.push(arm);
      const short = outfit === "tee";
      r.box(
        arm,
        0,
        -0.13,
        0,
        0.19,
        short ? 0.22 : 0.31,
        0.21,
        outfit === "varsity" ? "#e6d9c4" : cloth,
        0.07,
      );
      const forearm = new T.Group();
      forearm.position.y = -0.27;
      arm.add(forearm);
      this.forearms.push(forearm);
      r.box(
        forearm,
        0,
        -0.12,
        0,
        0.16,
        0.27,
        0.17,
        short ? a.skin : cloth,
        0.07,
      );
      r.sphere(forearm, 0, -0.29, 0, 0.095, a.skin);
      if (accessories.has("bracelet") && side === 1)
        r.cylinder(forearm, 0, -0.24, 0, 0.095, 0.095, 0.035, "#d9b76c");
      const leg = new T.Group();
      leg.position.set(side * 0.155, 0.96, 0);
      this.body.add(leg);
      this.legs.push(leg);
      r.box(
        leg,
        0,
        -0.2,
        0,
        0.245,
        0.4,
        0.28,
        a.bottom === "skirt" ? a.skin : pants,
        0.08,
      );
      const shin = new T.Group();
      shin.position.y = -0.39;
      leg.add(shin);
      this.shins.push(shin);
      r.box(
        shin,
        0,
        -0.21,
        0,
        0.21,
        0.42,
        0.23,
        a.bottom === "shorts" || a.bottom === "skirt" ? a.skin : pants,
        0.07,
      );
      const boot = a.shoes === "boots";
      r.box(
        shin,
        0,
        boot ? -0.33 : -0.43,
        0.07,
        0.25,
        boot ? 0.26 : 0.14,
        0.4,
        shoe,
        0.05,
      );
      if (a.shoes !== "formal")
        r.box(shin, 0, -0.485, 0.07, 0.26, 0.035, 0.41, "#d5d0c6", 0);
      if (a.shoes === "sneakers" || !a.shoes)
        for (const z of [0.09, 0.14])
          r.box(shin, 0, -0.355, z, 0.13, 0.014, 0.018, "#f3eee6", 0);
    }
    if (a.bottom === "skirt") {
      this.skirt = new T.Group();
      this.skirt.position.y = 0.985;
      this.body.add(this.skirt);
      const cloth = new T.Mesh(
        r.keep(new T.CylinderGeometry(0.25, 0.38, 0.45, 20, 4, true)),
        r.keep(r.material(pants).clone()),
      );
      cloth.material.side = T.DoubleSide;
      cloth.position.y = -0.21;
      cloth.castShadow = cloth.receiveShadow = true;
      this.skirt.add(cloth);
      this.skirtStanding = cloth;
      // A separate drape covers the lap and knees without rotating a rigid hem
      // into a forward-facing hoop. The lower edge remains open like fabric.
      const drape = r.keep(new T.BufferGeometry());
      drape.setAttribute(
        "position",
        new T.Float32BufferAttribute(
          [
            -0.26, 0.13, -0.14, 0.26, 0.13, -0.14, -0.38, 0.17, 0.55, 0.38,
            0.17, 0.55, -0.29, -0.28, -0.15, 0.29, -0.28, -0.15, -0.38, -0.16,
            0.55, 0.38, -0.16, 0.55,
          ],
          3,
        ),
      );
      drape.setIndex([
        0, 2, 1, 1, 2, 3, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5,
        0, 1, 4, 1, 5, 4,
      ]);
      drape.computeVertexNormals();
      this.skirtSeated = new T.Mesh(drape, cloth.material);
      this.skirtSeated.castShadow = this.skirtSeated.receiveShadow = true;
      this.skirtSeated.visible = false;
      this.skirt.add(this.skirtSeated);
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
    if (this.skirtSeated) this.skirtSeated.userData.dynamic = true;
    r.batch(this.body);
  }
  play(name: string) {
    this.animation = name;
  }
  update(
    dt: number,
    moving: boolean,
    seated: boolean,
    seatHeight = 0.68,
    pose?: RoomPose,
    showSmoke = true,
  ) {
    this.time += dt;
    const t = this.time,
      alpha = 1 - Math.exp(-dt * 12),
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
    this.seated = T.MathUtils.lerp(this.seated, seated ? 1 : 0, alpha);
    if (this.skirt) {
      this.skirtStanding!.visible = this.seated < 0.5;
      this.skirtSeated!.visible = this.seated >= 0.5;
    }
    this.body.position.y =
      this.seated * (seatHeight - 0.96) +
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
              : emote === "laugh"
                ? -0.6 + Math.sin(t * 12) * 0.05
                : this.appearance.idle === "confident"
                  ? -0.14
                  : -0.05;
      arm.rotation.x = T.MathUtils.lerp(arm.rotation.x, target, alpha);
      arm.rotation.z = T.MathUtils.lerp(
        arm.rotation.z,
        wave ? Math.sin(t * 8) * 0.25 : smoking ? -0.8 : i === 0 ? 0.08 : -0.08,
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
        seated
          ? -Math.PI / 2
          : moving
            ? Math.sin(t * 9 + i * Math.PI) * (this.skirt ? 0.35 : 0.6)
            : 0,
        alpha,
      );
      const shin = this.shins[i];
      shin.rotation.x = T.MathUtils.lerp(
        shin.rotation.x,
        seated
          ? Math.PI / 2
          : moving
            ? Math.max(0, Math.sin(t * 9 + i * Math.PI)) * 0.55
            : 0,
        alpha,
      );
    });
    this.cigarette.visible = emote === "smoke" && showSmoke;
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
    this.r.dispose();
    this.group.removeFromParent();
  }
}
