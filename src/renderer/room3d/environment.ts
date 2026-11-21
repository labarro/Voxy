import * as T from "three";
import type { RoomPreset } from "../../shared/types";
import { BAR, barStools, seats, type Seat } from "../../shared/room3d";
import { Resources } from "./resources";
import { RoomAssets } from "./assets";
import { buildRooftop } from "./Rooftop";
import { Kit, type Palette } from "./furniture";

export type RoomEnvironment = {
  screen: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  poster: T.Texture;
  colliders: T.Object3D[];
  walls: T.Mesh[];
  seatMarkers: Map<string, T.Mesh>;
  key: T.SpotLight;
  bar?: T.Object3D;
  dispose: () => void;
};

export const LOUNGE: Palette = {
  wood: "#8a5c3c",
  woodDark: "#4b2f1f",
  fabricA: "#2f5a63",
  fabricB: "#b8673d",
  fabricC: "#7c72df",
  accent: "#d4a24c",
  metal: "#c9a062",
  wall: "#2a4747",
  plaster: "#cfc2ae",
  floor: "#9a6a44",
  rug: ["#e6dccb", "#2f5a63", "#b8673d"],
};
const CINEMA: Palette = {
  wood: "#5a3a2a",
  woodDark: "#2e1f18",
  fabricA: "#7a2734",
  fabricB: "#3b2b44",
  fabricC: "#c9a062",
  accent: "#c9a062",
  metal: "#c9a062",
  wall: "#1b1726",
  plaster: "#2a2436",
  floor: "#2a2230",
  rug: ["#2a2230", "#7a2734", "#c9a062"],
};

// Screen/poster in the Voxy Nocturne style; shared by all rooms.
export function makeScreen(
  r: Resources,
  kit: Kit,
  preset: RoomPreset,
  width = 7.8,
) {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 720;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 1280, 720);
  g.addColorStop(0, "#14121f");
  g.addColorStop(1, preset === "cinema" ? "#2a1424" : "#13283a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);
  const glow = ctx.createRadialGradient(1040, 600, 10, 1040, 600, 520);
  glow.addColorStop(0, "rgba(124,114,223,.55)");
  glow.addColorStop(1, "rgba(124,114,223,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.strokeStyle = "rgba(201,160,98,.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(1040, 640, 140 + i * 70, Math.PI, Math.PI * 1.85);
    ctx.stroke();
  }
  ctx.fillStyle = "#c9a062";
  ctx.font = "700 30px system-ui";
  ctx.fillText("VOXY", 96, 110);
  ctx.fillStyle = "#f3ece2";
  ctx.font = "700 72px system-ui";
  const lines =
    preset === "cinema"
      ? ["A próxima sessão", "começa com vocês."]
      : preset === "rooftop"
        ? ["A cidade acordada.", "Os amigos aqui."]
        : ["Boa companhia.", "Uma tela em comum."];
  ctx.fillText(lines[0], 96, 330);
  ctx.fillText(lines[1], 96, 418);
  ctx.fillStyle = "#b9b4c9";
  ctx.font = "28px system-ui";
  ctx.fillText("Compartilhe uma tela para assistir juntos.", 96, 540);
  const poster = r.keep(new T.CanvasTexture(c));
  poster.colorSpace = T.SRGBColorSpace;
  const screen = new T.Mesh(
    r.keep(new T.PlaneGeometry(width, (width * 9) / 16)),
    r.keep(new T.MeshBasicMaterial({ map: poster, toneMapped: false })),
  );
  void kit;
  return { screen, poster };
}

export function seatMarker(r: Resources, scene: T.Scene, seat: Seat) {
  const marker = new T.Mesh(
    r.keep(
      new T.RingGeometry(
        seat.kind === "stool" ? 0.32 : 0.5,
        seat.kind === "stool" ? 0.36 : 0.55,
        40,
      ),
    ),
    r.keep(
      new T.MeshBasicMaterial({
        color: "#c9b8ff",
        transparent: true,
        opacity: 0.85,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(seat.x, 0.03, seat.z);
  marker.visible = false;
  scene.add(marker);
  return marker;
}

// Seats: one consistent construction per kind, front +Z rotated by seat yaw.
export function placeSeats(
  kit: Kit,
  scene: T.Scene,
  preset: RoomPreset,
  colliders: T.Object3D[],
  markers: Map<string, T.Mesh>,
) {
  const all = seats(preset);
  const list = all.filter((s) => !s.game);
  // Game tables get dining chairs (the tables themselves are built by their modules).
  for (const seat of all.filter((s) => s.game)) {
    const chair = diningChair(kit);
    chair.position.set(
      seat.x - Math.sin(seat.yaw) * 0.12,
      0,
      seat.z - Math.cos(seat.yaw) * 0.12,
    );
    chair.rotation.y = seat.yaw;
    scene.add(chair);
    kit.r.batch(chair);
  }
  const p = kit.palette;
  const sofaSeats = list.filter((s) => s.kind === "sofa");
  if (sofaSeats.length) {
    const cx = sofaSeats.reduce((a, s) => a + s.x, 0) / sofaSeats.length,
      cz = sofaSeats[0].z;
    const sofa = kit.sofa(6.3, p.fabricA, 6, { depth: 1.0, legs: kit.metal() });
    sofa.position.set(cx, 0, cz + 0.12);
    sofa.rotation.y = sofaSeats[0].yaw;
    scene.add(sofa);
    kit.r.batch(sofa);
    colliders.push(sofa);
  }
  for (const seat of list) {
    markers.set(seat.id, seatMarker(kit.r, scene, seat));
    if (seat.kind === "sofa") continue;
    let piece: T.Object3D;
    if (seat.kind === "puff") piece = kit.ottoman(p.fabricB);
    else if (seat.kind === "stool") piece = kit.stool(p.fabricB);
    else if (preset === "cinema") piece = cinemaSeat(kit);
    else
      piece = kit.armchair(seat.id.startsWith("roof") ? p.fabricA : p.fabricB);
    // Seat geometry is built around the hips: move the frame slightly back.
    const back = seat.kind === "stool" ? 0 : -0.1;
    piece.position.set(
      seat.x + Math.sin(seat.yaw) * back,
      0,
      seat.z + Math.cos(seat.yaw) * back,
    );
    piece.rotation.y = seat.yaw;
    scene.add(piece);
    kit.r.batch(piece);
    colliders.push(piece);
  }
}

function diningChair(kit: Kit) {
  const g = new T.Group();
  const wood = kit.wood(kit.palette.woodDark, 0.45);
  kit.mesh(
    g,
    kit.cushion(0.5, 0.07, 0.48, 0.015),
    kit.fabric(kit.palette.fabricB),
    0,
    0.5,
    0.02,
  );
  kit.mesh(g, kit.rbox(0.52, 0.05, 0.5, 0.015, 2), wood, 0, 0.45, 0.02);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      kit.leg(g, sx * 0.21, 0.02 + sz * 0.2, 0.44, wood, "taper");
  const back = kit.mesh(
    g,
    kit.rbox(0.48, 0.42, 0.05, 0.02, 2),
    wood,
    0,
    0.8,
    -0.23,
  );
  back.rotation.x = -0.12;
  for (const sx of [-1, 1])
    kit.mesh(
      g,
      kit.rbox(0.04, 0.5, 0.04, 0.01, 1),
      wood,
      sx * 0.21,
      0.72,
      -0.21,
    );
  return g;
}
function cinemaSeat(kit: Kit) {
  const g = new T.Group();
  const fab = kit.fabric(kit.palette.fabricA, 0.85),
    dark = kit.fabric("#2a1a22");
  kit.mesh(g, kit.rbox(0.9, 0.24, 0.86, 0.05), dark, 0, 0.18, 0);
  kit.mesh(g, kit.cushion(0.66, 0.16, 0.7, 0.03), fab, 0, 0.4, 0.05);
  const back = kit.mesh(
    g,
    kit.cushion(0.7, 0.78, 0.2, 0.04),
    fab,
    0,
    0.82,
    -0.36,
  );
  back.rotation.x = -0.2;
  kit.mesh(
    g,
    kit.cushion(0.5, 0.18, 0.14, 0.03),
    fab,
    0,
    1.18,
    -0.42,
  ).rotation.x = -0.25;
  for (const s of [-1, 1]) {
    kit.mesh(g, kit.cushion(0.14, 0.3, 0.84, 0.02), dark, s * 0.4, 0.46, 0);
    // cup holder
    kit.mesh(
      g,
      kit.cyl(0.045, 0.045, 0.03, 16),
      kit.metal(),
      s * 0.4,
      0.62,
      0.3,
      false,
    );
  }
  return g;
}

// Bar counter, back bar, fridge, taps and decoration (west wall).
export function buildBar(
  kit: Kit,
  scene: T.Scene,
  colliders: T.Object3D[],
  outdoor = false,
) {
  const g = new T.Group();
  g.name = "voxy-bar";
  const p = kit.palette;
  const len = BAR.halfZ * 2,
    x = BAR.x;
  const front = x + BAR.halfX;
  // counter body with fluted wood front and stone top
  kit.mesh(
    g,
    kit.rbox(0.78, 1.02, len, 0.03),
    kit.wood(p.woodDark, 0.45),
    x,
    0.51,
    BAR.z,
  );
  const flute = kit.cyl(0.025, 0.025, 0.86, 10);
  const flutes = new T.InstancedMesh(
    flute,
    kit.wood(p.wood, 0.45),
    Math.floor(len / 0.07),
  );
  const m = new T.Object3D();
  for (let i = 0; i < flutes.count; i++) {
    m.position.set(front + 0.01, 0.5, BAR.z - len / 2 + 0.06 + i * 0.07);
    m.updateMatrix();
    flutes.setMatrixAt(i, m.matrix);
  }
  flutes.castShadow = flutes.receiveShadow = true;
  flutes.userData.dynamic = true;
  g.add(flutes);
  kit.mesh(
    g,
    kit.rbox(0.98, 0.06, len + 0.12, 0.02),
    kit.stone(),
    x + 0.06,
    1.05,
    BAR.z,
  );
  // brass foot rail and under-counter glow
  const rail = kit.mesh(
    g,
    kit.cyl(0.02, 0.02, len, 12),
    kit.metal(),
    front + 0.14,
    0.2,
    BAR.z,
    false,
  );
  rail.rotation.x = Math.PI / 2;
  kit.mesh(
    g,
    kit.rbox(0.04, 0.02, len - 0.1, 0.005, 1),
    kit.glow("#ffb867", 1.4),
    front + 0.07,
    0.98,
    BAR.z,
    false,
  );
  // taps
  for (let i = 0; i < 3; i++) {
    const z = BAR.z - 0.5 + i * 0.5;
    kit.mesh(g, kit.cyl(0.02, 0.025, 0.36, 12), kit.metal(), x - 0.05, 1.26, z);
    kit.mesh(
      g,
      kit.cyl(0.012, 0.012, 0.14, 8),
      kit.metal(),
      x + 0.02,
      1.4,
      z,
    ).rotation.z = Math.PI / 2;
    kit.mesh(
      g,
      kit.lathe(
        [
          [0.012, 0],
          [0.016, 0.05],
          [0.014, 0.11],
          [0, 0.12],
        ],
        10,
      ),
      kit.plain(["#7c72df", "#d4a24c", "#2f5a63"][i], 0.5),
      x + 0.08,
      1.42,
      z,
    );
  }
  // glasses and a tray on the counter
  for (let i = 0; i < 4; i++)
    kit.mesh(
      g,
      kit.lathe(
        [
          [0, 0],
          [0.03, 0],
          [0.034, 0.13],
          [0.03, 0.13],
          [0.026, 0.005],
        ],
        14,
      ),
      kit.glass(),
      x + 0.16,
      1.08,
      BAR.z + 1.2 + i * 0.1,
      false,
    );
  kit.mesh(
    g,
    kit.cyl(0.18, 0.18, 0.015, 24),
    kit.wood(p.wood, 0.4),
    x + 0.12,
    1.085,
    BAR.z - 1.4,
  );
  // Back bar: shelves with backlight and unbranded bottles (instanced).
  const wallX = outdoor ? x - 1.9 : -12.86;
  kit.mesh(
    g,
    kit.rbox(0.36, 0.9, len + 0.6, 0.03),
    kit.wood(p.woodDark, 0.5),
    wallX + 0.2,
    0.45,
    BAR.z,
  );
  kit.mesh(
    g,
    kit.rbox(0.4, 0.04, len + 0.6, 0.01),
    kit.stone(),
    wallX + 0.2,
    0.92,
    BAR.z,
  );
  kit.mesh(
    g,
    kit.rbox(0.03, 1.6, len + 0.4, 0.005, 1),
    kit.glow("#c9733a", 0.22),
    wallX + 0.02,
    1.95,
    BAR.z,
    false,
  );
  const shelfMat = kit.wood(p.wood, 0.45);
  const glassColors = [
    "#3e6b3a",
    "#6b3a1f",
    "#c8d6d8",
    "#8a2f2f",
    "#d9a441",
    "#2f4a6b",
  ];
  const bottleGeoms = [0, 1, 2].map((k) => kit.bottle(k));
  const perShelf = Math.floor((len + 0.2) / 0.16);
  for (let s = 0; s < 3; s++) {
    const y = 1.25 + s * 0.42;
    kit.mesh(
      g,
      kit.rbox(0.28, 0.035, len + 0.4, 0.008, 1),
      shelfMat,
      wallX + 0.16,
      y,
      BAR.z,
    );
    for (let k = 0; k < 3; k++) {
      const inst = new T.InstancedMesh(
        bottleGeoms[k],
        kit.glass("#ffffff", 0.85),
        perShelf,
      );
      let n = 0;
      for (let i = 0; i < perShelf; i++) {
        if ((i + s * 2) % 3 !== k) continue;
        m.position.set(
          wallX + 0.16,
          y + 0.02,
          BAR.z - len / 2 + 0.1 + i * 0.16,
        );
        m.rotation.set(0, i, 0);
        m.scale.setScalar(1);
        m.updateMatrix();
        inst.setMatrixAt(n, m.matrix);
        inst.setColorAt(
          n,
          new T.Color(glassColors[(i * 7 + s * 3 + k) % glassColors.length]),
        );
        n++;
      }
      inst.count = n;
      inst.userData.dynamic = true;
      (inst.material as T.MeshStandardMaterial).depthWrite = true;
      g.add(inst);
    }
  }
  // Glass-door fridge with lit interior and cans.
  const fz = BAR.z + BAR.halfZ + 0.05 - 0.45;
  const fx = wallX + 0.9;
  const fridge = new T.Group();
  fridge.position.set(fx, 0, fz + 0.1);
  kit.mesh(
    fridge,
    kit.rbox(0.66, 1.6, 0.62, 0.04),
    kit.plain("#1f2a2e", 0.4, 0.4),
    0,
    0.8,
    0,
  );
  kit.mesh(
    fridge,
    kit.rbox(0.56, 1.36, 0.02, 0.01, 1),
    kit.glow("#d6f2ff", 1.3),
    0,
    0.84,
    0.29,
    false,
  );
  kit.mesh(
    fridge,
    kit.rbox(0.58, 1.4, 0.015, 0.01, 1),
    kit.glass("#cfefff", 0.18),
    0,
    0.84,
    0.32,
    false,
  );
  const can = kit.cyl(0.03, 0.03, 0.11, 12);
  const cans = new T.InstancedMesh(can, kit.metal("#ffffff", 0.3), 24);
  for (let i = 0; i < 24; i++) {
    m.position.set(-0.2 + (i % 6) * 0.08, 0.32 + Math.floor(i / 6) * 0.3, 0.18);
    m.rotation.set(0, 0, 0);
    m.updateMatrix();
    cans.setMatrixAt(i, m.matrix);
    cans.setColorAt(i, new T.Color(["#7c72df", "#c9d2d6", "#d4a24c"][i % 3]));
  }
  cans.userData.dynamic = true;
  fridge.add(cans);
  kit.mesh(
    fridge,
    kit.cyl(0.012, 0.012, 0.5, 8),
    kit.metal(),
    0.27,
    0.95,
    0.34,
  );
  fridge.rotation.y = Math.PI / 2;
  g.add(fridge);
  // Neon sign (own brand only).
  if (!outdoor) {
    const sign = kit.canvas("bar-neon", 512, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.font = "italic 700 120px Georgia, serif";
      ctx.textAlign = "center";
      ctx.shadowColor = "#b9b0ff";
      ctx.shadowBlur = 30;
      ctx.fillStyle = "#e7e3ff";
      ctx.fillText("Voxy", s / 2, s * 0.48);
      ctx.font = "600 52px system-ui";
      ctx.shadowColor = "#ffb867";
      ctx.fillStyle = "#ffe2bf";
      ctx.fillText("BAR", s / 2, s * 0.68);
    });
    const neon = new T.Mesh(
      kit.r.keep(new T.PlaneGeometry(1.8, 1.8)),
      kit.mat(
        "neon",
        () =>
          new T.MeshBasicMaterial({
            map: sign,
            transparent: true,
            toneMapped: false,
            depthWrite: false,
          }),
      ),
    );
    neon.position.set(-12.84, 3.25, BAR.z);
    neon.rotation.y = Math.PI / 2;
    g.add(neon);
    const light = new T.PointLight("#b8a8ff", 6, 6, 2);
    light.position.set(-12, 3, BAR.z);
    g.add(light);
  }
  // Pendants over the counter.
  for (const dz of [-1.6, 0, 1.6]) {
    const pend = kit.pendant(0.13, "#ffcf8a", outdoor ? 1.2 : 2.6, "globe");
    pend.position.set(x + 0.1, outdoor ? 3.2 : 6.0, BAR.z + dz);
    g.add(pend);
  }
  const counterLight = new T.PointLight("#ffc986", 9, 7, 2);
  counterLight.position.set(x + 0.6, 2.6, BAR.z);
  g.add(counterLight);
  scene.add(g);
  kit.r.batch(g);
  colliders.push(g);
  // stools are seats; built by placeSeats
  void barStools;
  return g;
}

function windowView(kit: Kit, w: number, h: number, seed: number) {
  const tex = kit.canvas(`city:${seed}`, 512, (ctx, s) => {
    const sky = ctx.createLinearGradient(0, 0, 0, s);
    sky.addColorStop(0, "#0d1530");
    sky.addColorStop(0.6, "#28305a");
    sky.addColorStop(1, "#5a4064");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, s, s);
    let seedN = seed * 9;
    const random = () =>
      (seedN = (seedN * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let layer = 0; layer < 3; layer++) {
      let x = 0;
      while (x < s) {
        const bw = 20 + random() * 50,
          bh = s * (0.2 + random() * 0.45) * (1 - layer * 0.2);
        const y = s - bh;
        ctx.fillStyle = ["#1a1d33", "#141729", "#0e1020"][layer];
        ctx.fillRect(x, y, bw, bh);
        for (let wy = y + 6; wy < s - 4; wy += 9)
          for (let wx = x + 4; wx < x + bw - 4; wx += 7)
            if (random() < 0.32) {
              ctx.fillStyle =
                random() < 0.7
                  ? "rgba(255,206,140,.85)"
                  : "rgba(190,210,255,.8)";
              ctx.fillRect(wx, wy, 3, 4);
            }
        x += bw + random() * 6;
      }
    }
  });
  tex.repeat.set(1, 1);
  const view = new T.Mesh(
    kit.r.keep(new T.PlaneGeometry(w, h)),
    kit.mat(
      `citymat:${seed}`,
      () =>
        new T.MeshBasicMaterial({
          map: tex,
          toneMapped: false,
          color: "#c8c3d8",
        }),
    ),
  );
  return view;
}

export function buildEnvironment(
  scene: T.Scene,
  preset: RoomPreset,
  assets: RoomAssets,
): RoomEnvironment {
  void assets;
  if (preset === "rooftop") return buildRooftop(scene);
  const cinema = preset === "cinema";
  const r = new Resources();
  const kit = new Kit(r, cinema ? CINEMA : LOUNGE);
  const p = kit.palette;
  const colliders: T.Object3D[] = [],
    walls: T.Mesh[] = [],
    seatMarkers = new Map<string, T.Mesh>();
  scene.background = new T.Color(cinema ? "#0c0a12" : "#121618");
  scene.fog = null;
  // ---------------------------------------------------------------- light
  scene.add(
    new T.HemisphereLight(
      cinema ? "#7d76a8" : "#ffe6c8",
      cinema ? "#1a1018" : "#3a2a20",
      cinema ? 0.32 : 0.55,
    ),
  );
  const key = new T.SpotLight(
    cinema ? "#c9c2ff" : "#ffd9a8",
    cinema ? 70 : 150,
    30,
    1.05,
    0.75,
    1.6,
  );
  key.position.set(0, 5.9, cinema ? 3 : 1.5);
  key.target.position.set(0, 0, cinema ? 1 : 1.5);
  key.castShadow = true;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const fill = new T.DirectionalLight(
    cinema ? "#6d6ab8" : "#9db7ff",
    cinema ? 0.25 : 0.35,
  );
  fill.position.set(-6, 5, 8);
  scene.add(fill);
  // ---------------------------------------------------------------- shell
  const floorMat = cinema
    ? kit.mat("carpet", () => {
        const tex = kit.canvas(
          "carpet",
          512,
          (ctx, s) => {
            ctx.fillStyle = "#231c2a";
            ctx.fillRect(0, 0, s, s);
            ctx.strokeStyle = "#5a2a36";
            ctx.lineWidth = 3;
            for (let y = 0; y < s; y += 64)
              for (let x = 0; x < s; x += 64) {
                ctx.beginPath();
                ctx.moveTo(x + 32, y + 8);
                ctx.lineTo(x + 56, y + 32);
                ctx.lineTo(x + 32, y + 56);
                ctx.lineTo(x + 8, y + 32);
                ctx.closePath();
                ctx.stroke();
                ctx.fillStyle = "#c9a06233";
                ctx.fillRect(x + 30, y + 30, 4, 4);
              }
          },
          10,
        );
        const m = new T.MeshStandardMaterial({ map: tex, roughness: 1 });
        m.bumpMap = kit.weave();
        m.bumpScale = 1.4;
        return m;
      })
    : kit.mat("floor", () => {
        const map = kit.herringbone(p.floor, "#3a2416");
        map.repeat.set(5, 5);
        return new T.MeshStandardMaterial({
          map,
          roughness: 0.42,
          metalness: 0,
        });
      });
  const floor = new T.Mesh(r.keep(new T.PlaneGeometry(26.3, 24.6)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 1);
  floor.receiveShadow = true;
  scene.add(floor);
  const wallMat = cinema ? kit.fabric(p.wall, 0.95) : kit.paint(p.wall, 0.88);
  const shell = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    m: T.Material = wallMat,
  ) => {
    const mesh = kit.mesh(scene, kit.rbox(w, h, d, 0.01, 1), m, x, y, z, false);
    walls.push(mesh);
    return mesh;
  };
  shell(0, 3.05, -11.13, 26.2, 6.3, 0.25);
  shell(-13.05, 3.1, 1, 0.22, 6.3, 24.6);
  shell(13.05, 3.1, 1, 0.22, 6.3, 24.6);
  shell(0, 3.1, 13.15, 26.2, 6.3, 0.22);
  const ceilingMat = kit.paint(cinema ? "#14111c" : "#3a322b", 0.95);
  const ceiling = shell(0, 6.17, 1, 26.3, 0.24, 24.8, ceilingMat);
  ceiling.name = "solid-ceiling";
  for (const w of walls) (w.material as T.Material).side = T.DoubleSide;
  colliders.push(...walls);
  const decor = new T.Group();
  scene.add(decor);
  // Wainscot + cornice + baseboards (lounge) / acoustic panels (cinema)
  if (!cinema) {
    const wood = kit.wood(p.woodDark, 0.5);
    for (const [x, z, w, d, ry] of [
      [0, -10.98, 26, 0.06, 0],
      [-12.92, 1, 24.4, 0.06, Math.PI / 2],
      [12.92, 1, 24.4, 0.06, Math.PI / 2],
      [0, 13.02, 26, 0.06, 0],
    ] as [number, number, number, number, number][]) {
      const lower = kit.mesh(
        decor,
        kit.rbox(w, 1.15, d, 0.01, 1),
        wood,
        x,
        0.575,
        z,
        false,
      );
      lower.rotation.y = ry;
      const cap = kit.mesh(
        decor,
        kit.rbox(w, 0.05, 0.1, 0.01, 1),
        kit.wood(p.wood, 0.4),
        x,
        1.17,
        z,
        false,
      );
      cap.rotation.y = ry;
      const cove = kit.mesh(
        decor,
        kit.rbox(w, 0.06, 0.06, 0.01, 1),
        kit.glow("#ffbf7a", 1.1),
        x,
        5.62,
        z,
        false,
      );
      cove.rotation.y = ry;
      const cornice = kit.mesh(
        decor,
        kit.rbox(w, 0.22, 0.2, 0.02, 1),
        wood,
        x,
        5.95,
        z,
        false,
      );
      cornice.rotation.y = ry;
    }
    // ceiling beams
    for (const x of [-9, -4.5, 0, 4.5, 9])
      kit.mesh(
        decor,
        kit.rbox(0.34, 0.32, 24.4, 0.02, 1),
        wood,
        x,
        5.9,
        1,
        false,
      );
  } else {
    const panelGeo = kit.rbox(1.6, 3.2, 0.12, 0.04, 2);
    const panels = new T.InstancedMesh(
      panelGeo,
      kit.fabric("#2a2238", 0.95),
      16,
    );
    const m = new T.Object3D();
    let n = 0;
    for (const side of [-1, 1])
      for (let i = 0; i < 8; i++) {
        m.position.set(side * 12.86, 2.4, -8 + i * 2.6);
        m.rotation.set(0, (side * Math.PI) / 2, 0);
        m.updateMatrix();
        panels.setMatrixAt(n++, m.matrix);
      }
    panels.userData.dynamic = true;
    panels.receiveShadow = true;
    decor.add(panels);
    // sconces between panels
    for (const side of [-1, 1])
      for (let i = 0; i < 7; i++) {
        const z = -6.7 + i * 2.6;
        kit.mesh(
          decor,
          kit.lathe(
            [
              [0, 0],
              [0.12, 0.02],
              [0.16, 0.22],
              [0.1, 0.24],
            ],
            18,
          ),
          kit.glow("#ffb46a", 0.9),
          side * 12.85,
          4.3,
          z,
          false,
        ).rotation.z = (side * Math.PI) / 2;
      }
    // star ceiling: one points cloud
    const stars = new Float32Array(900 * 3);
    let s = 7;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 900; i++)
      stars.set([(rand() - 0.5) * 25, 6.03, -10.5 + rand() * 23], i * 3);
    const sg = r.keep(new T.BufferGeometry());
    sg.setAttribute("position", new T.BufferAttribute(stars, 3));
    decor.add(
      new T.Points(
        sg,
        r.keep(
          new T.PointsMaterial({
            color: "#fff2d8",
            size: 0.045,
            sizeAttenuation: true,
          }),
        ),
      ),
    );
    // aisle step lights
    for (const x of [-1.6, 1.6])
      for (let i = 0; i < 6; i++)
        kit.mesh(
          decor,
          kit.rbox(0.18, 0.03, 0.06, 0.01, 1),
          kit.glow("#ffb867", 1.2),
          x,
          0.03,
          -3.5 + i * 2,
          false,
        );
  }
  // ---------------------------------------------------------------- screen wall
  const { screen, poster } = makeScreen(r, kit, preset);
  screen.position.set(0, 3.15, -10.59);
  scene.add(screen);
  const frame = kit.mesh(
    decor,
    kit.rbox(8.05, 4.62, 0.12, 0.03),
    kit.plain("#0d0d10", 0.35, 0.3),
    0,
    3.15,
    -10.7,
    false,
  );
  void frame;
  if (cinema) {
    // stage, curtains, proscenium
    kit.mesh(
      decor,
      kit.rbox(11, 0.42, 1.6, 0.04),
      kit.wood(p.woodDark, 0.5),
      0,
      0.21,
      -10.1,
    );
    colliders.push(decor.children[decor.children.length - 1]);
    const curtain = r.keep(new T.PlaneGeometry(2.2, 5.6, 40, 1));
    const cp = curtain.getAttribute("position");
    for (let i = 0; i < cp.count; i++)
      cp.setZ(i, Math.sin(cp.getX(i) * 14) * 0.08);
    curtain.computeVertexNormals();
    const velvet = kit.mat(
      "velvet",
      () =>
        new T.MeshStandardMaterial({
          color: "#6a1f2b",
          roughness: 0.75,
          side: T.DoubleSide,
        }),
    );
    for (const s of [-1, 1]) {
      const c = new T.Mesh(curtain, velvet);
      c.position.set(s * 5.1, 3.05, -10.75);
      c.castShadow = c.receiveShadow = true;
      decor.add(c);
    }
    kit.mesh(
      decor,
      kit.rbox(12.5, 0.7, 0.4, 0.05),
      velvet,
      0,
      5.75,
      -10.8,
      false,
    );
    for (const s of [-1, 1]) {
      const wash = new T.SpotLight("#ff8a5c", 18, 9, 0.5, 0.8, 1.5);
      wash.position.set(s * 5, 0.4, -9.4);
      wash.target.position.set(s * 5.1, 4, -10.8);
      decor.add(wash, wash.target);
    }
    // projection booth window with a soft beam
    kit.mesh(
      decor,
      kit.rbox(2.4, 1.1, 0.1, 0.03),
      kit.glow("#8ea6ff", 0.6),
      0,
      4.6,
      13.0,
      false,
    );
    const beam = new T.Mesh(
      r.keep(new T.ConeGeometry(2.8, 23.5, 24, 1, true)),
      r.keep(
        new T.MeshBasicMaterial({
          color: "#a9b6ff",
          transparent: true,
          opacity: 0.035,
          depthWrite: false,
          side: T.DoubleSide,
        }),
      ),
    );
    beam.position.set(0, 3.9, 1.2);
    beam.rotation.x = -Math.PI / 2 + 0.03;
    decor.add(beam);
    // rear doors
    for (const x of [-9, 9]) {
      kit.mesh(
        decor,
        kit.rbox(2.2, 3.1, 0.14, 0.04),
        kit.wood(p.woodDark),
        x,
        1.55,
        12.98,
        false,
      );
      kit.mesh(
        decor,
        kit.rbox(0.3, 0.12, 0.04, 0.01, 1),
        kit.glow("#4fdc8f", 1.2),
        x,
        3.35,
        12.9,
        false,
      );
    }
    // seating carpet runner
    decor.add(kit.rug(15.5, 10.5, ["#2b1f30", "#7a2734", "#c9a062"], 3));
  } else {
    // TV wall: slatted walnut with backlight; low media console; speakers.
    const slat = kit.rbox(0.09, 5.2, 0.08, 0.01, 1);
    const slats = new T.InstancedMesh(slat, kit.wood(p.wood, 0.5), 56);
    const m = new T.Object3D();
    for (let i = 0; i < 56; i++) {
      m.position.set(-5.5 + i * 0.2, 2.75, -10.92);
      m.updateMatrix();
      slats.setMatrixAt(i, m.matrix);
    }
    slats.userData.dynamic = true;
    slats.receiveShadow = true;
    decor.add(slats);
    kit.mesh(
      decor,
      kit.rbox(8.4, 0.05, 0.05, 0.01, 1),
      kit.glow("#b8a8ff", 1.4),
      0,
      0.82,
      -10.75,
      false,
    );
    const console = new T.Group();
    kit.mesh(
      console,
      kit.rbox(8, 0.55, 0.6, 0.04),
      kit.wood(p.woodDark, 0.45),
      0,
      0.38,
      -10.45,
    );
    for (let i = 0; i < 4; i++)
      kit.mesh(
        console,
        kit.rbox(1.9, 0.42, 0.02, 0.01, 1),
        kit.wood(p.wood, 0.42),
        -3 + i * 2,
        0.38,
        -10.14,
      );
    for (const x of [-3.6, 3.6]) {
      kit.mesh(
        console,
        kit.rbox(0.5, 1.2, 0.4, 0.05),
        kit.plain("#1b1b1f", 0.6),
        x,
        1.25,
        -10.45,
      );
      kit.mesh(
        console,
        kit.cyl(0.13, 0.13, 0.02, 24),
        kit.plain("#2b2b30", 0.4),
        x,
        1.4,
        -10.24,
        false,
      ).rotation.x = Math.PI / 2;
      kit.mesh(
        console,
        kit.cyl(0.08, 0.08, 0.02, 20),
        kit.plain("#2b2b30", 0.4),
        x,
        1.0,
        -10.24,
        false,
      ).rotation.x = Math.PI / 2;
    }
    const vinyl = kit.mesh(
      console,
      kit.cyl(0.16, 0.16, 0.02, 32),
      kit.plain("#111", 0.3),
      2.2,
      0.67,
      -10.45,
      false,
    );
    void vinyl;
    for (let i = 0; i < 3; i++)
      kit.mesh(
        console,
        kit.rbox(0.32, 0.04, 0.24, 0.006, 1),
        kit.plain([p.accent, "#e8dfcf", p.fabricA][i], 0.8),
        -2.2,
        0.68 + i * 0.04,
        -10.45,
      );
    const plantA = kit.plant("bush", 3, "#2a2a2e");
    plantA.position.set(-1.2, 0.66, -10.45);
    plantA.scale.setScalar(0.6);
    console.add(plantA);
    decor.add(console);
    colliders.push(console);
    for (const x of [-7.3, 7.3]) {
      const shelf = kit.bookshelf(2.4, 3.4, x > 0 ? 3 : 1);
      shelf.position.set(x, 0, -10.8);
      decor.add(shelf);
      kit.r.batch(shelf);
    }
    // conversation zone
    const rug = kit.rug(8.6, 6.4, p.rug, 2);
    rug.position.set(0, 0.012, 1.2);
    decor.add(rug);
    const table = kit.coffeeTable(2.5, 1.15);
    table.position.set(0, 0, -0.2);
    decor.add(table);
    kit.r.batch(table);
    colliders.push(table);
    for (const s of [-1, 1]) {
      const lamp = kit.floorLamp();
      lamp.position.set(s * 3.6, 0, 3.2);
      decor.add(lamp);
      const bulb = new T.PointLight("#ffc98a", 6, 6, 2);
      bulb.position.set(s * 3.6, 1.6, 3.2);
      decor.add(bulb);
    }
    // reading nook (west)
    const nookRug = kit.rug(
      4.4,
      4.4,
      ["#2f5a63", "#d4a24c", "#e6dccb"],
      5,
      true,
    );
    nookRug.position.set(-8, 0.012, 2.5);
    decor.add(nookRug);
    const round = kit.roundTable(0.62, 0.62);
    round.position.set(-8, 0, 2.5);
    decor.add(round);
    kit.r.batch(round);
    colliders.push(round);
    const candle = kit.mesh(
      decor,
      kit.cyl(0.04, 0.04, 0.1, 16),
      kit.plain("#efe6d6", 0.6),
      -8,
      0.7,
      2.5,
      false,
    );
    void candle;
    const nookLight = kit.pendant(0.3, "#ffcf8a", 2.4, "dome");
    nookLight.position.set(-8, 6.0, 2.5);
    decor.add(nookLight);
    const nookPoint = new T.PointLight("#ffc78a", 10, 7, 2);
    nookPoint.position.set(-8, 3.0, 2.5);
    decor.add(nookPoint);
    // games corner rug + pendants over truco/chess
    const games = kit.rug(10.5, 4.6, ["#3a2a22", "#d4a24c", "#2f5a63"], 9);
    games.position.set(-2.5, 0.012, 8.5);
    decor.add(games);
    for (const [gx, gz] of [
      [-6.6, 8.1],
      [1.5, 8.8],
    ]) {
      const pend = kit.pendant(0.38, "#ffd59a", 3.2, "cone");
      pend.position.set(gx, 6.0, gz);
      decor.add(pend);
      const light = new T.PointLight("#ffd29c", 9, 6, 2);
      light.position.set(gx, 2.4, gz);
      decor.add(light);
    }
    // south sideboard (existing footprint) with art above
    const side = new T.Group();
    kit.mesh(
      side,
      kit.rbox(5.4, 0.9, 0.7, 0.04),
      kit.wood(p.woodDark, 0.45),
      -8,
      0.45,
      11.85,
    );
    for (let i = 0; i < 3; i++)
      kit.mesh(
        side,
        kit.rbox(1.7, 0.74, 0.02, 0.01, 1),
        kit.wood(p.wood, 0.42),
        -9.8 + i * 1.8,
        0.45,
        11.49,
      );
    for (let i = 0; i < 4; i++)
      kit.mesh(
        side,
        kit.rbox(0.42, 0.08, 0.32, 0.01, 1),
        kit.plain([p.fabricB, p.fabricA, p.accent, "#e8dfcf"][i], 0.75),
        -6.8,
        0.94 + i * 0.08,
        11.85,
      );
    decor.add(side);
    colliders.push(side);
    const art1 = kit.art(2.6, 1.6, 1);
    art1.position.set(-8, 2.6, 12.98);
    art1.rotation.y = Math.PI;
    decor.add(art1);
    // NE: record cabinet / jukebox footprint
    const juke = new T.Group();
    kit.mesh(
      juke,
      kit.rbox(2.9, 1.05, 0.6, 0.05),
      kit.wood(p.woodDark, 0.4),
      7.2,
      0.53,
      -10.1,
    );
    kit.mesh(
      juke,
      kit.rbox(2.6, 0.05, 0.04, 0.01, 1),
      kit.glow("#ffb867", 1.2),
      7.2,
      1.0,
      -9.79,
      false,
    );
    for (let i = 0; i < 24; i++)
      kit.mesh(
        juke,
        kit.rbox(0.012, 0.3, 0.3, 0.002, 1),
        kit.plain(["#2b2b2b", p.accent, p.fabricA, "#e8dfcf"][i % 4], 0.6),
        6.0 + i * 0.05,
        0.75,
        -10.1,
        false,
      );
    const record = kit.lathe(
      [
        [0.18, 0],
        [0.12, 0.06],
        [0.12, 0.22],
        [0.2, 0.26],
      ],
      20,
    );
    kit.mesh(juke, record, kit.metal(), 8.2, 1.05, -10.1);
    decor.add(juke);
    colliders.push(juke);
    // windows (east) with night city
    for (const z of [-7.5, -3.2]) {
      kit.mesh(
        decor,
        kit.rbox(0.18, 3.0, 3.2, 0.03),
        kit.wood(p.woodDark, 0.4),
        12.92,
        3.1,
        z,
        false,
      );
      const view = windowView(kit, 2.9, 2.7, z < -5 ? 2 : 3);
      view.position.set(12.82, 3.1, z);
      view.rotation.y = -Math.PI / 2;
      decor.add(view);
      kit.mesh(
        decor,
        kit.rbox(0.06, 0.06, 2.9, 0.01, 1),
        kit.wood(p.woodDark, 0.4),
        12.8,
        3.1,
        z,
        false,
      );
      kit.mesh(
        decor,
        kit.rbox(0.06, 2.7, 0.06, 0.01, 1),
        kit.wood(p.woodDark, 0.4),
        12.8,
        3.1,
        z,
        false,
      );
      kit.mesh(
        decor,
        kit.rbox(0.3, 0.06, 3.0, 0.01, 1),
        kit.wood(p.wood, 0.4),
        12.75,
        1.62,
        z,
        false,
      );
    }
    // wall art
    for (const [x, y, z, ry, w, h, seed] of [
      [-12.85, 3.1, 7.5, Math.PI / 2, 2.2, 1.5, 2],
      [12.85, 3.0, 8.3, -Math.PI / 2, 1.6, 2.2, 3],
      [12.85, 3.0, 4.6, -Math.PI / 2, 1.2, 1.2, 4],
      [-12.85, 3.0, 2.5, Math.PI / 2, 1.8, 1.2, 5],
    ] as number[][]) {
      const art = kit.art(w, h, seed);
      art.position.set(x, y, z);
      art.rotation.y = ry;
      decor.add(art);
    }
    // plants (corner footprints)
    for (const [x, z, kind, seed] of [
      [11, -8.1, "palm", 1],
      [11, 8.8, "tall", 2],
      [-11, 8.8, "tall", 3],
    ] as [number, number, "palm" | "tall", number][]) {
      const plant = kit.plant(kind, seed);
      plant.position.set(x, 0, z);
      decor.add(plant);
      colliders.push(plant);
    }
    // pool zone: cue rack (existing footprint) and pendant over the table
    const rack = new T.Group();
    kit.mesh(
      rack,
      kit.rbox(1.1, 0.06, 0.5, 0.02, 1),
      kit.wood(p.woodDark, 0.45),
      9.65,
      0.03,
      1.85,
    );
    kit.mesh(
      rack,
      kit.rbox(1.1, 1.5, 0.08, 0.02, 1),
      kit.wood(p.woodDark, 0.45),
      9.65,
      0.75,
      1.65,
    );
    for (let i = 0; i < 5; i++) {
      const cue = kit.mesh(
        rack,
        kit.cyl(0.012, 0.02, 1.45, 10),
        kit.wood(i % 2 ? "#d8bf8d" : p.wood, 0.4),
        9.25 + i * 0.2,
        0.78,
        1.75,
        false,
      );
      cue.rotation.x = 0.05;
    }
    decor.add(rack);
    colliders.push(rack);

    // west wall rhythm: sconces
    for (const z of [0, 5])
      kit.mesh(
        decor,
        kit.lathe(
          [
            [0, 0],
            [0.1, 0.02],
            [0.13, 0.18],
            [0.08, 0.2],
          ],
          16,
        ),
        kit.glow("#ffbd78", 1.0),
        -12.85,
        2.6,
        z,
        false,
      ).rotation.z = -Math.PI / 2;
    // door (south)
    kit.mesh(
      decor,
      kit.rbox(2.6, 3.3, 0.14, 0.04),
      kit.wood(p.woodDark),
      0,
      1.65,
      12.98,
      false,
    );
    kit.mesh(
      decor,
      kit.rbox(2.3, 3.0, 0.06, 0.03),
      kit.wood(p.wood, 0.45),
      0,
      1.65,
      12.9,
      false,
    );
    kit.mesh(
      decor,
      kit.cyl(0.02, 0.02, 0.3, 8),
      kit.metal(),
      0.85,
      1.5,
      12.82,
      false,
    );
    buildBar(kit, scene, colliders);
  }
  placeSeats(kit, scene, preset, colliders, seatMarkers);
  r.batch(decor);
  for (const wall of walls)
    wall.material = r.keep((wall.material as T.MeshStandardMaterial).clone());
  return {
    screen,
    poster,
    colliders,
    walls,
    seatMarkers,
    key,
    dispose: () => {
      key.shadow.dispose();
      r.dispose();
    },
  };
}
