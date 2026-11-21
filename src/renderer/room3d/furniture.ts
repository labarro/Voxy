import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Resources } from "./resources";

// Voxy 1.6 furniture and material kit. Everything is authored here (no
// external assets): soft rounded upholstery, turned legs, bevelled tops and
// small procedural textures shared per room. Pieces use +Z as their front and
// sit on y=0; environment.ts places them on the shared layout.

export type Palette = {
  wood: string;
  woodDark: string;
  fabricA: string;
  fabricB: string;
  fabricC: string;
  accent: string;
  metal: string;
  wall: string;
  plaster: string;
  floor: string;
  rug: [string, string, string];
};

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class Kit {
  readonly r: Resources;
  private cache = new Map<string, T.Material>();
  private textures = new Map<string, T.Texture>();
  constructor(
    r: Resources,
    readonly palette: Palette,
  ) {
    this.r = r;
  }

  // ---------------------------------------------------------- textures
  canvas(
    key: string,
    size: number,
    draw: (ctx: CanvasRenderingContext2D, s: number) => void,
    repeat = 1,
    color = true,
  ) {
    const hit = this.textures.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    draw(ctx, size);
    const t = this.r.keep(new T.CanvasTexture(c));
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    if (color) t.colorSpace = T.SRGBColorSpace;
    this.textures.set(key, t);
    return t;
  }
  grain(key = "grain") {
    return this.canvas(key, 512, (ctx, s) => {
      const random = rng(31);
      ctx.fillStyle = "#c9a27e";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        const y = random() * s,
          w = 0.6 + random() * 2.4;
        ctx.strokeStyle = `rgba(${random() > 0.5 ? "70,40,20" : "255,235,210"},${0.05 + random() * 0.1})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= s; x += 32)
          ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 4 + (random() - 0.5) * 2);
        ctx.stroke();
      }
      // a few knots
      for (let i = 0; i < 5; i++) {
        const x = random() * s,
          y = random() * s;
        const g = ctx.createRadialGradient(x, y, 1, x, y, 18);
        g.addColorStop(0, "rgba(70,40,20,.35)");
        g.addColorStop(1, "rgba(70,40,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, 26, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  weave() {
    return this.canvas(
      "weave",
      128,
      (ctx, s) => {
        const random = rng(7);
        ctx.fillStyle = "#808080";
        ctx.fillRect(0, 0, s, s);
        for (let y = 0; y < s; y += 2)
          for (let x = 0; x < s; x += 2) {
            const v =
              128 + (((x + y) / 2) % 2 ? 18 : -18) + (random() - 0.5) * 24;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 2, 2);
          }
      },
      6,
      false,
    );
  }
  noise(key = "noise", strength = 18) {
    return this.canvas(
      key,
      256,
      (ctx, s) => {
        const random = rng(key.length * 17 + 3);
        const img = ctx.createImageData(s, s);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = 128 + (random() - 0.5) * strength * 2;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      },
      4,
      false,
    );
  }
  // Long planks laid in a staggered (brick) pattern with tone variation.
  herringbone(base: string, dark: string) {
    return this.canvas(
      `planks:${base}`,
      1024,
      (ctx, s) => {
        const random = rng(99);
        ctx.fillStyle = dark;
        ctx.fillRect(0, 0, s, s);
        const W = 64,
          L = 512;
        for (let row = 0; row < s / W; row++) {
          const offset = ((row * 197) % 5) * (L / 5);
          for (let x = -L; x < s + L; x += L) {
            const px = x + offset;
            const tone = new T.Color(base).offsetHSL(
              (random() - 0.5) * 0.01,
              (random() - 0.5) * 0.06,
              (random() - 0.5) * 0.09,
            );
            ctx.fillStyle = `#${tone.getHexString()}`;
            ctx.fillRect(px + 1, row * W + 1, L - 2, W - 2);
            for (let k = 0; k < 9; k++) {
              ctx.globalAlpha = 0.05 + random() * 0.07;
              ctx.fillStyle = random() > 0.5 ? "#3a2414" : "#f3dcc0";
              const y = row * W + 3 + random() * (W - 6);
              ctx.fillRect(px + 2, y, L - 4, 1 + random() * 1.5);
            }
            ctx.globalAlpha = 1;
          }
        }
      },
      1,
    );
  }
  marble() {
    return this.canvas("marble", 512, (ctx, s) => {
      const random = rng(4);
      ctx.fillStyle = "#e9e4dc";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 26; i++) {
        ctx.strokeStyle = `rgba(110,100,95,${0.08 + random() * 0.18})`;
        ctx.lineWidth = 0.5 + random() * 2;
        ctx.beginPath();
        let x = random() * s,
          y = 0;
        ctx.moveTo(x, y);
        while (y < s) {
          x += (random() - 0.5) * 40;
          y += 20 + random() * 30;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });
  }

  // ---------------------------------------------------------- materials
  mat(key: string, make: () => T.Material) {
    let m = this.cache.get(key);
    if (!m) {
      m = this.r.keep(make());
      this.cache.set(key, m);
    }
    return m as T.MeshStandardMaterial;
  }
  wood(color = this.palette.wood, rough = 0.55) {
    return this.mat(`wood:${color}:${rough}`, () => {
      const map = this.grain();
      return new T.MeshStandardMaterial({
        color,
        map,
        roughness: rough,
        metalness: 0,
      });
    });
  }
  fabric(color: string, rough = 0.95) {
    return this.mat(`fabric:${color}`, () => {
      const m = new T.MeshStandardMaterial({ color, roughness: rough });
      m.bumpMap = this.weave();
      m.bumpScale = 0.9;
      return m;
    });
  }
  leather(color: string) {
    return this.mat(`leather:${color}`, () => {
      const m = new T.MeshStandardMaterial({ color, roughness: 0.48 });
      m.bumpMap = this.noise("leather", 22);
      m.bumpScale = 0.4;
      return m;
    });
  }
  metal(color = this.palette.metal, rough = 0.32) {
    return this.mat(
      `metal:${color}:${rough}`,
      () =>
        new T.MeshStandardMaterial({ color, roughness: rough, metalness: 1 }),
    );
  }
  paint(color: string, rough = 0.9) {
    return this.mat(`paint:${color}:${rough}`, () => {
      const m = new T.MeshStandardMaterial({ color, roughness: rough });
      m.bumpMap = this.noise("plaster", 10);
      m.bumpScale = 0.25;
      return m;
    });
  }
  plain(color: string, rough = 0.7, metal = 0) {
    return this.mat(
      `plain:${color}:${rough}:${metal}`,
      () =>
        new T.MeshStandardMaterial({
          color,
          roughness: rough,
          metalness: metal,
        }),
    );
  }
  glow(color: string, intensity = 1.6) {
    return this.mat(
      `glow:${color}:${intensity}`,
      () =>
        new T.MeshStandardMaterial({
          color: "#111",
          emissive: color,
          emissiveIntensity: intensity,
          roughness: 1,
        }),
    );
  }
  glass(tint = "#cfe3e8", opacity = 0.28) {
    return this.mat(
      `glass:${tint}:${opacity}`,
      () =>
        new T.MeshStandardMaterial({
          color: tint,
          roughness: 0.05,
          metalness: 0.1,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
    );
  }
  stone() {
    return this.mat(
      "marble",
      () =>
        new T.MeshStandardMaterial({
          color: "#ffffff",
          map: this.marble(),
          roughness: 0.18,
        }),
    );
  }
  leaf(color: string) {
    return this.mat(
      `leaf:${color}`,
      () =>
        new T.MeshStandardMaterial({
          color,
          roughness: 0.75,
          side: T.DoubleSide,
        }),
    );
  }

  // ---------------------------------------------------------- geometry
  rbox(w: number, h: number, d: number, radius = 0.04, seg = 3) {
    const r = Math.min(radius, w / 2.05, h / 2.05, d / 2.05);
    return this.r.keep(new RoundedBoxGeometry(w, h, d, seg, r));
  }
  // Upholstery: rounded box whose faces bulge slightly, like a filled cushion.
  cushion(w: number, h: number, d: number, bulge = 0.025) {
    const g = new RoundedBoxGeometry(w, h, d, 4, Math.min(h * 0.45, 0.07));
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (w / 2),
        y = pos.getY(i) / (h / 2),
        z = pos.getZ(i) / (d / 2);
      const k = (1 - x * x) * (1 - z * z);
      pos.setY(i, pos.getY(i) + Math.sign(y) * bulge * k * Math.abs(y));
      const kz = (1 - x * x) * (1 - y * y);
      pos.setZ(i, pos.getZ(i) + Math.sign(z) * bulge * 0.6 * kz * Math.abs(z));
    }
    g.computeVertexNormals();
    return this.r.keep(g);
  }
  lathe(points: [number, number][], seg = 24) {
    return this.r.keep(
      new T.LatheGeometry(
        points.map(([x, y]) => new T.Vector2(x, y)),
        seg,
      ),
    );
  }
  cyl(rt: number, rb: number, h: number, seg = 20) {
    return this.r.keep(new T.CylinderGeometry(rt, rb, h, seg));
  }
  mesh(
    parent: T.Object3D,
    g: T.BufferGeometry,
    m: T.Material,
    x = 0,
    y = 0,
    z = 0,
    shadow = true,
  ) {
    const mesh = new T.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------- furniture
  leg(
    parent: T.Object3D,
    x: number,
    z: number,
    h: number,
    mat: T.Material,
    style: "taper" | "pin" | "block" = "taper",
  ) {
    if (style === "block")
      return this.mesh(
        parent,
        this.rbox(0.07, h, 0.07, 0.015),
        mat,
        x,
        h / 2,
        z,
      );
    if (style === "pin")
      return this.mesh(parent, this.cyl(0.014, 0.01, h, 10), mat, x, h / 2, z);
    return this.mesh(parent, this.cyl(0.024, 0.014, h, 12), mat, x, h / 2, z);
  }
  sofa(
    width: number,
    color: string,
    seats = 3,
    opts: { arms?: boolean; legs?: T.Material; depth?: number } = {},
  ) {
    const g = new T.Group();
    const depth = opts.depth ?? 0.95,
      seatH = 0.46;
    const fab = this.fabric(color),
      base = this.fabric(new T.Color(color).multiplyScalar(0.82).getStyle()),
      legs = opts.legs ?? this.wood(this.palette.woodDark, 0.5);
    const arm = opts.arms === false ? 0 : 0.2;
    // plinth
    this.mesh(g, this.rbox(width, 0.22, depth, 0.05), base, 0, 0.24, 0);
    const inner = width - arm * 2,
      cw = inner / seats;
    for (let i = 0; i < seats; i++) {
      const x = -inner / 2 + cw * (i + 0.5);
      this.mesh(
        g,
        this.cushion(cw - 0.02, 0.15, depth - 0.24, 0.022),
        fab,
        x,
        seatH - 0.07,
        0.08,
      );
      const back = this.mesh(
        g,
        this.cushion(cw - 0.03, 0.46, 0.2, 0.03),
        fab,
        x,
        seatH + 0.2,
        -depth / 2 + 0.17,
      );
      back.rotation.x = -0.14;
    }
    // back frame
    this.mesh(
      g,
      this.rbox(width, 0.5, 0.16, 0.06),
      base,
      0,
      0.55,
      -depth / 2 + 0.08,
    );
    if (arm)
      for (const s of [-1, 1])
        this.mesh(
          g,
          this.cushion(arm, 0.36, depth, 0.02),
          base,
          s * (width / 2 - arm / 2),
          0.5,
          0,
        );
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        this.leg(
          g,
          sx * (width / 2 - 0.08),
          sz * (depth / 2 - 0.08),
          0.13,
          legs,
        );
    // throw pillows
    if (seats >= 2)
      for (const s of [-1, 1]) {
        const p = this.mesh(
          g,
          this.cushion(0.36, 0.34, 0.12, 0.04),
          this.fabric(this.palette.fabricC),
          s * (inner / 2 - 0.25),
          seatH + 0.16,
          -depth / 2 + 0.33,
        );
        p.rotation.set(-0.25, s * 0.25, s * 0.08);
      }
    return g;
  }
  armchair(color: string, legs?: T.Material) {
    const g = new T.Group();
    const fab = this.fabric(color),
      wood = legs ?? this.wood(this.palette.woodDark, 0.5);
    this.mesh(g, this.rbox(0.82, 0.2, 0.82, 0.05), fab, 0, 0.26, 0);
    this.mesh(g, this.cushion(0.6, 0.14, 0.66, 0.025), fab, 0, 0.42, 0.06);
    const back = this.mesh(
      g,
      this.cushion(0.76, 0.56, 0.18, 0.03),
      fab,
      0,
      0.66,
      -0.33,
    );
    back.rotation.x = -0.18;
    for (const s of [-1, 1])
      this.mesh(g, this.cushion(0.14, 0.3, 0.78, 0.02), fab, s * 0.34, 0.5, 0);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) this.leg(g, sx * 0.33, sz * 0.33, 0.16, wood);
    return g;
  }
  ottoman(color: string, round = true) {
    const g = new T.Group();
    const fab = this.fabric(color);
    if (round) {
      const body = this.lathe(
        [
          [0, 0.04],
          [0.34, 0.04],
          [0.37, 0.1],
          [0.38, 0.3],
          [0.36, 0.4],
          [0.3, 0.44],
          [0, 0.45],
        ],
        28,
      );
      this.mesh(g, body, fab, 0, 0, 0);
      // tufting button
      this.mesh(
        g,
        this.cyl(0.03, 0.03, 0.02, 10),
        this.fabric(new T.Color(color).multiplyScalar(0.7).getStyle()),
        0,
        0.452,
        0,
        false,
      );
    } else this.mesh(g, this.cushion(0.6, 0.38, 0.6, 0.03), fab, 0, 0.23, 0);
    return g;
  }
  coffeeTable(w: number, d: number) {
    const g = new T.Group();
    const top = new T.Shape();
    const r = Math.min(w, d) * 0.48;
    top.moveTo(-w / 2 + r, -d / 2);
    top.lineTo(w / 2 - r, -d / 2);
    top.absarc(w / 2 - r, 0, d / 2, -Math.PI / 2, Math.PI / 2, false);
    top.lineTo(-w / 2 + r, d / 2);
    top.absarc(-w / 2 + r, 0, d / 2, Math.PI / 2, Math.PI * 1.5, false);
    const geo = new T.ExtrudeGeometry(top, {
      depth: 0.05,
      bevelEnabled: true,
      bevelSize: 0.015,
      bevelThickness: 0.015,
      bevelSegments: 3,
      curveSegments: 24,
    });
    geo.rotateX(Math.PI / 2);
    this.mesh(
      g,
      this.r.keep(geo),
      this.wood(this.palette.woodDark, 0.38),
      0,
      0.42,
      0,
    );
    const shelf = new T.ExtrudeGeometry(top, {
      depth: 0.025,
      bevelEnabled: false,
      curveSegments: 20,
    });
    shelf.rotateX(Math.PI / 2);
    shelf.scale(0.86, 1, 0.8);
    this.mesh(g, this.r.keep(shelf), this.wood(this.palette.wood), 0, 0.14, 0);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        this.leg(
          g,
          sx * (w / 2 - 0.22),
          sz * (d / 2 - 0.12),
          0.4,
          this.metal(),
          "pin",
        );
    // styling: books, bowl, candle
    const books = [this.palette.accent, "#e8dfcf", this.palette.fabricB];
    books.forEach((c, i) =>
      this.mesh(
        g,
        this.rbox(0.26 - i * 0.02, 0.035, 0.2, 0.006, 1),
        this.plain(c, 0.8),
        -w * 0.22,
        0.465 + i * 0.036,
        0.02,
      ),
    );
    this.mesh(
      g,
      this.lathe(
        [
          [0, 0],
          [0.09, 0.005],
          [0.14, 0.05],
          [0.15, 0.07],
        ],
        28,
      ),
      this.plain("#d9cfc0", 0.4),
      w * 0.2,
      0.44,
      0,
    );
    for (let i = 0; i < 3; i++)
      this.mesh(
        g,
        this.r.keep(new T.SphereGeometry(0.035, 12, 8)),
        this.plain(["#d8823e", "#c94f3c", "#e3b74b"][i], 0.6),
        w * 0.2 + (i - 1) * 0.045,
        0.5,
        (i % 2) * 0.03,
        false,
      );
    return g;
  }
  sideTable(round = true) {
    const g = new T.Group();
    if (round) {
      this.mesh(g, this.cyl(0.26, 0.26, 0.04, 28), this.stone(), 0, 0.56, 0);
      this.mesh(
        g,
        this.lathe(
          [
            [0.16, 0],
            [0.05, 0.08],
            [0.035, 0.3],
            [0.05, 0.54],
          ],
          20,
        ),
        this.metal(),
        0,
        0,
        0,
      );
    } else {
      this.mesh(
        g,
        this.rbox(0.5, 0.04, 0.5, 0.012),
        this.wood(this.palette.woodDark, 0.4),
        0,
        0.56,
        0,
      );
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          this.leg(
            g,
            sx * 0.21,
            sz * 0.21,
            0.54,
            this.wood(this.palette.woodDark, 0.4),
            "block",
          );
    }
    return g;
  }
  roundTable(radius: number, height = 0.74) {
    const g = new T.Group();
    this.mesh(
      g,
      this.cyl(radius, radius, 0.05, 40),
      this.wood(this.palette.woodDark, 0.4),
      0,
      height,
      0,
    );
    this.mesh(
      g,
      this.r.keep(new T.TorusGeometry(radius, 0.012, 6, 48)),
      this.metal(),
      0,
      height - 0.01,
      0,
      false,
    ).rotation.x = Math.PI / 2;
    this.mesh(
      g,
      this.lathe(
        [
          [0.32, 0],
          [0.3, 0.03],
          [0.07, 0.08],
          [0.055, height - 0.2],
          [0.09, height - 0.05],
        ],
        24,
      ),
      this.metal(this.palette.metal, 0.4),
      0,
      0,
      0,
    );
    return g;
  }
  floorLamp(warm = "#ffd29a") {
    const g = new T.Group();
    this.mesh(
      g,
      this.cyl(0.17, 0.19, 0.03, 24),
      this.metal("#2a2522", 0.4),
      0,
      0.015,
      0,
    );
    this.mesh(g, this.cyl(0.012, 0.012, 1.6, 8), this.metal(), 0, 0.82, 0);
    const shade = this.lathe(
      [
        [0.16, 0],
        [0.2, 0.0],
        [0.15, 0.3],
        [0.12, 0.3],
      ],
      28,
    );
    const sm = this.mat(
      `shade:${warm}`,
      () =>
        new T.MeshStandardMaterial({
          color: "#f2e6d2",
          emissive: warm,
          emissiveIntensity: 0.55,
          roughness: 0.9,
          side: T.DoubleSide,
        }),
    );
    this.mesh(g, shade, sm, 0, 1.52, 0, false);
    return g;
  }
  pendant(
    radius = 0.22,
    warm = "#ffcf8a",
    drop = 0.9,
    style: "dome" | "globe" | "cone" = "dome",
  ) {
    const g = new T.Group();
    this.mesh(
      g,
      this.cyl(0.004, 0.004, drop, 6),
      this.plain("#1a1a1a"),
      0,
      -drop / 2,
      0,
      false,
    );
    const bulb = this.glow(warm, 2.2);
    if (style === "globe") {
      this.mesh(
        g,
        this.r.keep(new T.SphereGeometry(radius, 20, 14)),
        this.mat(
          `globe:${warm}`,
          () =>
            new T.MeshStandardMaterial({
              color: "#fff7ea",
              emissive: warm,
              emissiveIntensity: 1.1,
              roughness: 0.6,
              transparent: true,
              opacity: 0.95,
            }),
        ),
        0,
        -drop - radius,
        0,
        false,
      );
    } else {
      const points: [number, number][] =
        style === "cone"
          ? [
              [0.02, 0],
              [radius * 0.3, -0.02],
              [radius, -radius * 1.1],
              [radius * 0.98, -radius * 1.12],
            ]
          : [
              [0.02, 0],
              [radius * 0.5, -0.03],
              [radius * 0.9, -radius * 0.55],
              [radius, -radius * 0.82],
            ];
      this.mesh(
        g,
        this.lathe(points, 28),
        this.mat(
          "pendant-shell",
          () =>
            new T.MeshStandardMaterial({
              color: this.palette.metal,
              metalness: 1,
              roughness: 0.3,
              side: T.DoubleSide,
            }),
        ),
        0,
        -drop,
        0,
        false,
      );
      this.mesh(
        g,
        this.r.keep(new T.SphereGeometry(radius * 0.32, 12, 8)),
        bulb,
        0,
        -drop - radius * 0.62,
        0,
        false,
      );
    }
    return g;
  }
  bookshelf(w: number, h: number, seed = 1) {
    const g = new T.Group();
    const wood = this.wood(this.palette.woodDark, 0.5);
    const shelves = Math.max(3, Math.round(h / 0.42));
    for (const s of [-1, 1])
      this.mesh(
        g,
        this.rbox(0.04, h, 0.36, 0.01, 1),
        wood,
        s * (w / 2 - 0.02),
        h / 2,
        0,
      );
    this.mesh(g, this.rbox(w, h, 0.02, 0.005, 1), wood, 0, h / 2, -0.17);
    for (let i = 0; i <= shelves; i++)
      this.mesh(
        g,
        this.rbox(w - 0.04, 0.035, 0.34, 0.006, 1),
        wood,
        0,
        0.03 + (i * (h - 0.06)) / shelves,
        0,
      );
    // books: one instanced draw call
    const random = rng(seed * 13);
    const colors = [
      this.palette.accent,
      this.palette.fabricA,
      this.palette.fabricB,
      "#e7dcc7",
      "#2f3b48",
      "#8a5a3c",
      "#6e7f6a",
      "#b9893f",
    ];
    const count = shelves * 14;
    const geom = this.r.keep(new T.BoxGeometry(1, 1, 1));
    const books = new T.InstancedMesh(geom, this.plain("#ffffff", 0.75), count);
    const m = new T.Object3D(),
      c = new T.Color();
    let n = 0;
    for (let s = 0; s < shelves; s++) {
      let x = -w / 2 + 0.06;
      const y0 = 0.05 + (s * (h - 0.06)) / shelves;
      while (x < w / 2 - 0.12 && n < count) {
        if (random() < 0.12) {
          x += 0.08 + random() * 0.1;
          continue;
        }
        const bw = 0.025 + random() * 0.03,
          bh = 0.22 + random() * 0.12;
        m.position.set(x + bw / 2, y0 + bh / 2, 0.01);
        m.rotation.set(0, 0, random() < 0.08 ? 0.25 : 0);
        m.scale.set(bw, bh, 0.24 + random() * 0.05);
        m.updateMatrix();
        books.setMatrixAt(n, m.matrix);
        books.setColorAt(
          n,
          c
            .set(colors[Math.floor(random() * colors.length)])
            .offsetHSL(0, 0, (random() - 0.5) * 0.1),
        );
        n++;
        x += bw + 0.004;
      }
    }
    books.count = n;
    books.castShadow = books.receiveShadow = true;
    g.add(books);
    // a couple of objects
    this.mesh(
      g,
      this.lathe(
        [
          [0, 0],
          [0.07, 0.01],
          [0.09, 0.12],
          [0.05, 0.22],
          [0.06, 0.26],
        ],
        18,
      ),
      this.plain("#d7c8b1", 0.35),
      w / 2 - 0.16,
      0.05 + ((shelves - 1) * (h - 0.06)) / shelves,
      0,
    );
    return g;
  }
  plant(
    kind: "tall" | "bush" | "palm" = "tall",
    seed = 1,
    potColor = "#d8cbb8",
  ) {
    const g = new T.Group();
    const random = rng(seed * 7 + 1);
    const potH = kind === "tall" ? 0.5 : 0.36;
    this.mesh(
      g,
      this.lathe(
        [
          [0, 0],
          [0.16, 0],
          [0.2, potH * 0.6],
          [0.22, potH],
          [0.2, potH],
          [0, potH - 0.03],
        ],
        24,
      ),
      this.plain(potColor, 0.85),
      0,
      0,
      0,
    );
    this.mesh(
      g,
      this.cyl(0.19, 0.19, 0.02, 20),
      this.plain("#3c2a1f", 1),
      0,
      potH - 0.03,
      0,
      false,
    );
    // leaves: curved blades merged into one geometry
    const blades: T.BufferGeometry[] = [];
    const count = kind === "tall" ? 18 : kind === "palm" ? 12 : 28;
    for (let i = 0; i < count; i++) {
      const len =
        kind === "tall"
          ? 0.7 + random() * 0.7
          : kind === "palm"
            ? 0.9 + random() * 0.4
            : 0.35 + random() * 0.25;
      const width = kind === "palm" ? 0.28 : kind === "tall" ? 0.12 : 0.1;
      const blade = new T.PlaneGeometry(width, len, 1, 6);
      const pos = blade.getAttribute("position");
      for (let k = 0; k < pos.count; k++) {
        const t = (pos.getY(k) + len / 2) / len;
        pos.setX(
          k,
          pos.getX(k) *
            Math.sin(Math.min(1, t * 1.15) * Math.PI) *
            (kind === "palm" ? 1 : 0.9),
        );
        pos.setZ(k, t * t * len * (kind === "palm" ? 0.55 : 0.32));
        pos.setY(k, t * len);
      }
      blade.computeVertexNormals();
      const tilt =
        kind === "tall" ? 0.15 + random() * 0.35 : 0.5 + random() * 0.6;
      blade.rotateX(-tilt);
      blade.rotateY(random() * Math.PI * 2);
      blade.translate(
        (random() - 0.5) * 0.08,
        potH - 0.02 + (kind === "tall" ? random() * 0.5 : 0),
        (random() - 0.5) * 0.08,
      );
      blades.push(blade);
    }
    const merged = mergeGeometries(blades)!;
    blades.forEach((b) => b.dispose());
    this.mesh(
      g,
      this.r.keep(merged),
      this.leaf(
        kind === "palm" ? "#4d7b4a" : kind === "tall" ? "#3f6e48" : "#5b8a4f",
      ),
      0,
      0,
      0,
    );
    if (kind === "tall")
      this.mesh(
        g,
        this.cyl(0.015, 0.02, 0.9, 6),
        this.plain("#5a4632"),
        0,
        potH + 0.4,
        0,
      );
    return g;
  }
  art(w: number, h: number, seed: number, frame = this.palette.woodDark) {
    const g = new T.Group();
    const tex = this.canvas(`art:${seed}`, 512, (ctx, s) => {
      const random = rng(seed * 101);
      const palettes = [
        ["#efe6d6", "#d0764a", "#2f4b58", "#e3b64e", "#7d9b8e"],
        ["#1e2633", "#c6a15b", "#7c72df", "#e8ddd0", "#c46a5a"],
        ["#e8ddcc", "#40573f", "#b55f3b", "#283240", "#e0b66a"],
      ];
      const pal = palettes[seed % palettes.length];
      ctx.fillStyle = pal[0];
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = pal[1 + Math.floor(random() * (pal.length - 1))];
        ctx.globalAlpha = 0.85;
        const x = random() * s,
          y = random() * s,
          r = s * (0.1 + random() * 0.3);
        ctx.beginPath();
        if (random() < 0.5) ctx.arc(x, y, r, 0, Math.PI * 2);
        else ctx.rect(x - r, y - r * 0.4, r * 2, r * 0.8);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal[3];
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(s * 0.1, s * (0.3 + random() * 0.4));
      ctx.bezierCurveTo(
        s * 0.4,
        s * random(),
        s * 0.6,
        s * random(),
        s * 0.9,
        s * (0.3 + random() * 0.4),
      );
      ctx.stroke();
    });
    this.mesh(
      g,
      this.rbox(w + 0.08, h + 0.08, 0.05, 0.01, 1),
      this.wood(frame, 0.45),
      0,
      0,
      0,
    );
    const canvas = new T.Mesh(
      this.r.keep(new T.PlaneGeometry(w, h)),
      this.mat(
        `artmat:${seed}`,
        () => new T.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
      ),
    );
    canvas.position.z = 0.027;
    g.add(canvas);
    return g;
  }
  rug(
    w: number,
    d: number,
    colors: [string, string, string],
    seed = 1,
    round = false,
  ) {
    const tex = this.canvas(
      `rug:${colors.join()}:${seed}:${round}`,
      512,
      (ctx, s) => {
        const random = rng(seed);
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = colors[1];
        ctx.lineWidth = 10;
        ctx.strokeRect(22, 22, s - 44, s - 44);
        ctx.lineWidth = 3;
        ctx.strokeRect(42, 42, s - 84, s - 84);
        ctx.fillStyle = colors[2];
        for (let i = 0; i < 8; i++) {
          ctx.globalAlpha = 0.5;
          const x = 80 + random() * (s - 160),
            y = 80 + random() * (s - 160);
          ctx.beginPath();
          ctx.ellipse(
            x,
            y,
            30 + random() * 70,
            8 + random() * 16,
            random() * 3,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        const img = ctx.getImageData(0, 0, s, s);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = (random() - 0.5) * 16;
          img.data[i] += n;
          img.data[i + 1] += n;
          img.data[i + 2] += n;
        }
        ctx.putImageData(img, 0, 0);
      },
    );
    tex.repeat.set(1, 1);
    const m = this.mat(`rugmat:${colors.join()}:${seed}:${round}`, () => {
      const mm = new T.MeshStandardMaterial({ map: tex, roughness: 1 });
      mm.bumpMap = this.weave();
      mm.bumpScale = 1.2;
      return mm;
    });
    const geo = round
      ? this.r.keep(new T.CylinderGeometry(w / 2, w / 2, 0.02, 48))
      : this.rbox(w, 0.02, d, 0.008, 1);
    const mesh = new T.Mesh(geo, m);
    mesh.position.y = 0.012;
    mesh.receiveShadow = true;
    return mesh;
  }
  stool(color: string) {
    const g = new T.Group();
    const metal = this.metal("#2b2724", 0.35);
    this.mesh(
      g,
      this.cushion(0.42, 0.08, 0.42, 0.015),
      this.leather(color),
      0,
      0.74,
      0,
    );
    this.mesh(g, this.cyl(0.03, 0.03, 0.66, 10), metal, 0, 0.37, 0);
    this.mesh(g, this.cyl(0.2, 0.22, 0.03, 24), metal, 0, 0.015, 0);
    this.mesh(
      g,
      this.r.keep(new T.TorusGeometry(0.16, 0.011, 6, 24)),
      this.metal(),
      0,
      0.3,
      0,
    ).rotation.x = Math.PI / 2;
    const back = this.mesh(
      g,
      this.cushion(0.38, 0.2, 0.06, 0.012),
      this.leather(color),
      0,
      0.95,
      -0.2,
    );
    back.rotation.x = -0.12;
    for (const s of [-1, 1])
      this.mesh(
        g,
        this.cyl(0.008, 0.008, 0.24, 6),
        metal,
        s * 0.15,
        0.85,
        -0.2,
      );
    return g;
  }
  // Generic (unbranded) bottle shape.
  bottle(kind: number) {
    const profiles: [number, number][][] = [
      [
        [0, 0],
        [0.04, 0],
        [0.042, 0.005],
        [0.042, 0.19],
        [0.03, 0.23],
        [0.014, 0.27],
        [0.014, 0.32],
        [0, 0.32],
      ],
      [
        [0, 0],
        [0.05, 0],
        [0.052, 0.005],
        [0.052, 0.17],
        [0.045, 0.2],
        [0.016, 0.24],
        [0.016, 0.3],
        [0, 0.3],
      ],
      [
        [0, 0],
        [0.036, 0],
        [0.038, 0.005],
        [0.038, 0.14],
        [0.02, 0.2],
        [0.013, 0.27],
        [0, 0.27],
      ],
    ];
    return this.lathe(profiles[kind % profiles.length], 14);
  }
}

export function mergeStatic(r: Resources, root: T.Object3D) {
  r.batch(root);
}
