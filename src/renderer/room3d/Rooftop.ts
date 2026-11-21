import * as T from "three";
import { Resources } from "./resources";
import type { RoomEnvironment } from "./environment";
import { buildBar, makeScreen, placeSeats } from "./environment";
import { Kit, type Palette } from "./furniture";

const ROOF: Palette = {
  wood: "#9a6a45",
  woodDark: "#5a3b26",
  fabricA: "#e3d7c3",
  fabricB: "#2f5a63",
  fabricC: "#d4a24c",
  accent: "#7c72df",
  metal: "#c9a062",
  wall: "#2a3438",
  plaster: "#3a464a",
  floor: "#8a6a4e",
  rug: ["#e3d7c3", "#2f5a63", "#b8673d"],
};

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Dusk rooftop terrace: deck, glass balustrade, two pergolas, fire lounge,
// bar, outdoor screen on the service core and a layered city skyline.
export function buildRooftop(scene: T.Scene): RoomEnvironment {
  const r = new Resources();
  const kit = new Kit(r, ROOF);
  const p = ROOF;
  const colliders: T.Object3D[] = [],
    walls: T.Mesh[] = [],
    seatMarkers = new Map<string, T.Mesh>();
  // ---------------------------------------------------------- sky
  const sky = kit.canvas(
    "sky",
    512,
    (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, "#0b1230");
      g.addColorStop(0.45, "#26305e");
      g.addColorStop(0.7, "#7a4a6e");
      g.addColorStop(0.85, "#e08a5c");
      g.addColorStop(1, "#f2b977");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      const random = rng(3);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(255,255,255,${random() * 0.7})`;
        ctx.fillRect(random() * s, random() * s * 0.45, 1.2, 1.2);
      }
    },
    1,
  );
  sky.repeat.set(1, 1);
  sky.wrapS = T.RepeatWrapping;
  const dome = new T.Mesh(
    r.keep(
      new T.SphereGeometry(90, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.15),
    ),
    r.keep(
      new T.MeshBasicMaterial({
        map: sky,
        side: T.BackSide,
        fog: false,
        toneMapped: false,
      }),
    ),
  );
  dome.position.y = -6;
  scene.add(dome);
  scene.background = new T.Color("#141a36");
  scene.fog = new T.Fog("#3a3458", 40, 95);
  // moon
  const moon = new T.Mesh(
    r.keep(new T.SphereGeometry(2.2, 20, 14)),
    r.keep(new T.MeshBasicMaterial({ color: "#fff1d6", fog: false })),
  );
  moon.position.set(-38, 34, -55);
  scene.add(moon);
  // ---------------------------------------------------------- light
  scene.add(new T.HemisphereLight("#9fb3ff", "#4a3428", 0.55));
  const key = new T.SpotLight("#ffd3a0", 150, 42, 1.1, 0.8, 1.6);
  key.position.set(0, 9, 2);
  key.target.position.set(0, 0, 2);
  key.castShadow = true;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 35;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  const sunset = new T.DirectionalLight("#ff9a66", 0.9);
  sunset.position.set(20, 6, -30);
  scene.add(sunset);
  const moonLight = new T.DirectionalLight("#8fa8ff", 0.35);
  moonLight.position.set(-12, 15, -8);
  scene.add(moonLight);
  const site = new T.Group();
  scene.add(site);
  // ---------------------------------------------------------- deck
  kit.mesh(
    site,
    kit.rbox(26.4, 0.6, 24.8, 0.05, 1),
    kit.plain("#2d3236", 0.9),
    0,
    -0.3,
    1,
    false,
  );
  const deckTex = kit.canvas("deck", 512, (ctx, s) => {
    const random = rng(12);
    for (let y = 0; y < s; y += 32) {
      for (let x = (y / 32) % 2 ? -128 : 0; x < s; x += 256) {
        const tone = new T.Color(p.wood).offsetHSL(
          0,
          (random() - 0.5) * 0.05,
          (random() - 0.5) * 0.1,
        );
        ctx.fillStyle = `#${tone.getHexString()}`;
        ctx.fillRect(x, y, 254, 30);
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = "#2a160a";
        for (let k = 0; k < 5; k++) ctx.fillRect(x, y + random() * 30, 254, 1);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#1c120b";
      ctx.fillRect(0, y + 30, s, 2);
    }
  });
  deckTex.repeat.set(7, 7);
  const deck = new T.Mesh(
    r.keep(new T.PlaneGeometry(26.2, 24.6)),
    kit.mat(
      "deck",
      () => new T.MeshStandardMaterial({ map: deckTex, roughness: 0.65 }),
    ),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, 0.002, 1);
  deck.receiveShadow = true;
  site.add(deck);
  // stone border
  for (const [x, z, w, d] of [
    [0, -10.9, 26.2, 0.5],
    [0, 12.9, 26.2, 0.5],
    [-12.85, 1, 0.5, 24.4],
    [12.85, 1, 0.5, 24.4],
  ])
    kit.mesh(
      site,
      kit.rbox(w, 0.04, d, 0.01, 1),
      kit.plain("#4b5257", 0.85),
      x,
      0.02,
      z,
      false,
    );
  // ---------------------------------------------------------- balustrade
  const glass = kit.glass("#9fc2c8", 0.22);
  const metal = kit.plain("#262b2f", 0.4, 0.6);
  for (const side of [-1, 1]) {
    walls.push(
      kit.mesh(
        site,
        kit.rbox(0.22, 0.32, 24.6, 0.03, 1),
        metal,
        side * 13.02,
        0.16,
        1,
        false,
      ),
    );
    kit.mesh(
      site,
      kit.rbox(0.03, 1.0, 24.4, 0.005, 1),
      glass,
      side * 13.02,
      0.82,
      1,
      false,
    );
    kit.mesh(
      site,
      kit.rbox(0.14, 0.06, 24.6, 0.02, 1),
      kit.wood(p.wood, 0.45),
      side * 13.02,
      1.33,
      1,
      false,
    );
  }
  for (const z of [-11.15, 13.15]) {
    walls.push(
      kit.mesh(
        site,
        kit.rbox(26.2, 0.32, 0.22, 0.03, 1),
        metal,
        0,
        0.16,
        z,
        false,
      ),
    );
    kit.mesh(site, kit.rbox(26, 1.0, 0.03, 0.005, 1), glass, 0, 0.82, z, false);
    kit.mesh(
      site,
      kit.rbox(26.2, 0.06, 0.14, 0.02, 1),
      kit.wood(p.wood, 0.45),
      0,
      1.33,
      z,
      false,
    );
  }
  const post = kit.rbox(0.06, 1.0, 0.06, 0.01, 1);
  const posts = new T.InstancedMesh(post, metal, 48);
  const m = new T.Object3D();
  let n = 0;
  for (let z = -10; z <= 12; z += 2)
    for (const s of [-1, 1]) {
      m.position.set(s * 13.02, 0.82, z);
      m.updateMatrix();
      posts.setMatrixAt(n++, m.matrix);
    }
  for (let x = -12; x <= 12; x += 2) {
    m.position.set(x, 0.82, 13.15);
    m.updateMatrix();
    posts.setMatrixAt(n++, m.matrix);
  }
  posts.count = n;
  posts.userData.dynamic = true;
  site.add(posts);
  // ---------------------------------------------------------- service core + screen
  const core = kit.mesh(
    site,
    kit.rbox(9.4, 5.6, 0.7, 0.05),
    kit.paint("#2c3a40", 0.85),
    0,
    2.8,
    -11.1,
    false,
  );
  walls.push(core);
  kit.mesh(
    site,
    kit.rbox(9.6, 0.2, 0.9, 0.03),
    kit.wood(p.woodDark, 0.45),
    0,
    5.7,
    -11.05,
    false,
  );
  const { screen, poster } = makeScreen(r, kit, "rooftop");
  screen.position.set(0, 3.15, -10.59);
  site.add(screen);
  kit.mesh(
    site,
    kit.rbox(8.05, 4.62, 0.1, 0.03),
    kit.plain("#0d0d10", 0.35, 0.3),
    0,
    3.15,
    -10.7,
    false,
  );
  kit.mesh(
    site,
    kit.rbox(8.4, 0.05, 0.05, 0.01, 1),
    kit.glow("#b8a8ff", 1.4),
    0,
    0.82,
    -10.72,
    false,
  );
  // door into the building
  kit.mesh(
    site,
    kit.rbox(2.2, 3.0, 0.2, 0.04),
    kit.wood(p.woodDark),
    -6.1,
    1.5,
    -10.95,
    false,
  );
  kit.mesh(
    site,
    kit.rbox(0.25, 0.1, 0.04, 0.01, 1),
    kit.glow("#4fdc8f", 1.2),
    -6.1,
    3.15,
    -10.82,
    false,
  );
  // ---------------------------------------------------------- pergolas
  const teak = kit.wood(p.woodDark, 0.55);
  for (const c of [
    { x: 0, z: 1, w: 11, d: 8 },
    { x: 6.9, z: 3.6, w: 5, d: 5.2 },
  ]) {
    for (const dx of [-c.w / 2, c.w / 2])
      for (const dz of [-c.d / 2, c.d / 2]) {
        const pole = kit.mesh(
          site,
          kit.rbox(0.16, 4.4, 0.16, 0.02, 1),
          kit.plain("#22272b", 0.45, 0.5),
          c.x + dx,
          2.2,
          c.z + dz,
        );
        colliders.push(pole);
        kit.mesh(
          site,
          kit.rbox(0.32, 0.12, 0.32, 0.02, 1),
          kit.plain("#22272b", 0.45, 0.5),
          c.x + dx,
          0.06,
          c.z + dz,
          false,
        );
      }
    for (const dx of [-c.w / 2, c.w / 2])
      kit.mesh(
        site,
        kit.rbox(0.2, 0.24, c.d + 0.3, 0.02, 1),
        teak,
        c.x + dx,
        4.35,
        c.z,
      );
    for (const dz of [-c.d / 2, c.d / 2])
      kit.mesh(
        site,
        kit.rbox(c.w + 0.3, 0.24, 0.2, 0.02, 1),
        teak,
        c.x,
        4.35,
        c.z + dz,
      );
    const slats = new T.InstancedMesh(
      kit.rbox(0.09, 0.12, c.d + 0.4, 0.01, 1),
      teak,
      Math.floor(c.w / 0.45) + 1,
    );
    for (let i = 0; i < slats.count; i++) {
      m.position.set(c.x - c.w / 2 + i * 0.45, 4.52, c.z);
      m.updateMatrix();
      slats.setMatrixAt(i, m.matrix);
    }
    slats.castShadow = true;
    slats.userData.dynamic = true;
    site.add(slats);
  }
  // ---------------------------------------------------------- string lights
  const bulbs: number[] = [];
  const lines: [T.Vector3, T.Vector3][] = [
    [new T.Vector3(-12.6, 4.6, -9.8), new T.Vector3(-5.5, 4.4, -3)],
    [new T.Vector3(-5.5, 4.4, -3), new T.Vector3(5.5, 4.4, -3)],
    [new T.Vector3(5.5, 4.4, -3), new T.Vector3(12.6, 4.6, -9.8)],
    [new T.Vector3(-5.5, 4.4, 5), new T.Vector3(-12.6, 4.6, 12.6)],
    [new T.Vector3(5.5, 4.4, 5), new T.Vector3(12.6, 4.6, 12.6)],
    [new T.Vector3(-5.5, 4.4, 5), new T.Vector3(5.5, 4.4, 5)],
    [new T.Vector3(-12.6, 4.6, 12.6), new T.Vector3(12.6, 4.6, 12.6)],
  ];
  const wire: number[] = [];
  for (const [a, b] of lines) {
    const steps = Math.ceil(a.distanceTo(b) / 0.7);
    let prev = a.clone();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = a.clone().lerp(b, t);
      pt.y -= Math.sin(t * Math.PI) * 0.7;
      if (i) wire.push(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z);
      prev = pt;
      bulbs.push(pt.x, pt.y - 0.08, pt.z);
    }
  }
  const wireGeo = r.keep(new T.BufferGeometry());
  wireGeo.setAttribute("position", new T.Float32BufferAttribute(wire, 3));
  site.add(
    new T.LineSegments(
      wireGeo,
      r.keep(new T.LineBasicMaterial({ color: "#1a1a1a" })),
    ),
  );
  const bulbGeo = r.keep(new T.SphereGeometry(0.06, 10, 8));
  const bulbMesh = new T.InstancedMesh(
    bulbGeo,
    kit.glow("#ffd18a", 3.2),
    bulbs.length / 3,
  );
  for (let i = 0; i < bulbs.length / 3; i++) {
    m.position.set(bulbs[i * 3], bulbs[i * 3 + 1], bulbs[i * 3 + 2]);
    m.updateMatrix();
    bulbMesh.setMatrixAt(i, m.matrix);
  }
  bulbMesh.userData.dynamic = true;
  site.add(bulbMesh);
  for (const [x, z] of [
    [0, -2.6],
    [0, 4.6],
    [-9, 4],
    [9, -6],
  ]) {
    const glow = new T.PointLight("#ffc27a", 9, 9, 2);
    glow.position.set(x, 3.6, z);
    site.add(glow);
  }
  // ---------------------------------------------------------- lounge furniture
  const rug = kit.rug(9, 6.2, p.rug, 4);
  rug.position.set(0, 0.012, 1.4);
  site.add(rug);
  const table = kit.coffeeTable(2.5, 1.15);
  table.position.set(0, 0, -0.2);
  site.add(table);
  r.batch(table);
  colliders.push(table);
  // fire pit lounge (existing footprint 7.2,-4.5)
  const pit = new T.Group();
  kit.mesh(
    pit,
    kit.lathe(
      [
        [0, 0],
        [0.95, 0],
        [1.05, 0.08],
        [1.05, 0.38],
        [0.9, 0.42],
        [0.8, 0.36],
        [0, 0.36],
      ],
      32,
    ),
    kit.plain("#3b3f44", 0.8),
    0,
    0,
    0,
  );
  const stones = new T.InstancedMesh(
    r.keep(new T.DodecahedronGeometry(0.11, 0)),
    kit.plain("#2b2724", 0.9),
    14,
  );
  for (let i = 0; i < 14; i++) {
    m.position.set(Math.cos(i * 0.45) * 0.45, 0.42, Math.sin(i * 0.45) * 0.45);
    m.rotation.set(i, i * 2, 0);
    m.updateMatrix();
    stones.setMatrixAt(i, m.matrix);
  }
  stones.userData.dynamic = true;
  pit.add(stones);
  const flame = new T.Mesh(
    r.keep(new T.ConeGeometry(0.35, 0.8, 12, 1, true)),
    r.keep(
      new T.MeshBasicMaterial({
        color: "#ff9a3c",
        transparent: true,
        opacity: 0.75,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    ),
  );
  flame.position.y = 0.8;
  flame.userData.dynamic = true;
  pit.add(flame);
  const fire = new T.PointLight("#ff8c3a", 22, 8, 2);
  fire.position.y = 1.2;
  pit.add(fire);
  pit.position.set(7.2, 0, -4.5);
  site.add(pit);
  colliders.push(pit);
  // planters along the rail, plants by the pergolas
  for (const [x, z, w, d] of [
    [-12.62, 4.5, 0.6, 5.5],
    [12.62, 1.5, 0.6, 5],
    [-3, 12.72, 5, 0.6],
    [6, 12.72, 4, 0.6],
  ]) {
    const box = kit.mesh(
      site,
      kit.rbox(w, 0.7, d, 0.05),
      kit.wood(p.woodDark, 0.6),
      x,
      0.35,
      z,
    );
    void box;
    const count = Math.floor(Math.max(w, d) / 0.9);
    for (let i = 0; i < count; i++) {
      const plant = kit.plant(
        i % 2 ? "bush" : "tall",
        i + Math.round(Math.abs(x)),
        "#2a2a2a",
      );
      const t = (i + 0.5) / count - 0.5;
      plant.position.set(
        x + (w > d ? t * w : 0),
        0.34,
        z + (d > w ? t * d : 0),
      );
      plant.scale.setScalar(0.85);
      plant.children[0].visible = false;
      site.add(plant);
    }
  }
  for (const [x, z, seed] of [
    [-11, -8.1, 2],
    [11, -8.1, 3],
    [-11, 8.8, 4],
    [11, 8.8, 5],
  ]) {
    const plant = kit.plant("palm", seed, "#d9cdb9");
    plant.position.set(x, 0, z);
    site.add(plant);
    colliders.push(plant);
  }
  // south console (existing footprint)
  const side = new T.Group();
  kit.mesh(
    side,
    kit.rbox(5.4, 0.9, 0.7, 0.04),
    kit.wood(p.woodDark, 0.5),
    -8,
    0.45,
    11.85,
  );
  for (let i = 0; i < 6; i++)
    kit.mesh(
      side,
      kit.lathe(
        [
          [0, 0],
          [0.05, 0],
          [0.07, 0.1],
          [0.05, 0.22],
        ],
        12,
      ),
      kit.plain("#d9cdb9", 0.6),
      -10 + i * 0.8,
      0.9,
      11.85,
    );
  site.add(side);
  colliders.push(side);
  // NE footprint: DJ/bar cart
  const cart = new T.Group();
  kit.mesh(
    cart,
    kit.rbox(2.9, 0.95, 0.6, 0.05),
    kit.wood(p.woodDark, 0.45),
    7.2,
    0.48,
    -10.1,
  );
  kit.mesh(
    cart,
    kit.rbox(2.6, 0.04, 0.04, 0.01, 1),
    kit.glow("#b8a8ff", 1.3),
    7.2,
    0.9,
    -9.79,
    false,
  );
  site.add(cart);
  colliders.push(cart);
  // ---------------------------------------------------------- skyline
  const winTex = kit.canvas("windows", 256, (ctx, s) => {
    ctx.fillStyle = "#151a2e";
    ctx.fillRect(0, 0, s, s);
    const random = rng(21);
    for (let y = 4; y < s; y += 10)
      for (let x = 4; x < s; x += 8)
        if (random() < 0.38) {
          ctx.fillStyle =
            random() < 0.75
              ? `rgba(255,${190 + random() * 40},120,${0.5 + random() * 0.5})`
              : "rgba(170,200,255,.8)";
          ctx.fillRect(x, y, 4, 5);
        }
  });
  winTex.repeat.set(1, 1);
  const buildingMat = kit.mat(
    "building",
    () =>
      new T.MeshStandardMaterial({
        color: "#3a4060",
        emissiveMap: winTex,
        emissive: "#ffffff",
        emissiveIntensity: 0.9,
        map: winTex,
        roughness: 0.9,
      }),
  );
  const random = rng(77);
  const box = r.keep(new T.BoxGeometry(1, 1, 1));
  const city = new T.InstancedMesh(box, buildingMat, 150);
  let k = 0;
  for (let ring = 0; ring < 3; ring++)
    for (let i = 0; i < 50; i++) {
      const a = (i / 50) * Math.PI * 2 + ring * 0.07;
      const dist = 32 + ring * 14 + random() * 8;
      const h = 8 + random() * (18 + ring * 10);
      const w = 4 + random() * 6;
      m.position.set(Math.cos(a) * dist, h / 2 - 12, Math.sin(a) * dist);
      m.rotation.set(0, -a, 0);
      m.scale.set(w, h, w * (0.7 + random() * 0.6));
      m.updateMatrix();
      city.setMatrixAt(k++, m.matrix);
    }
  city.count = k;
  city.userData.dynamic = true;
  scene.add(city);
  // ---------------------------------------------------------- bar and seats
  buildBar(kit, scene, colliders, true);
  // Canopy carrying the bar pendants.
  for (const z of [-9.1, -2.9])
    kit.mesh(
      site,
      kit.rbox(0.14, 3.4, 0.14, 0.02, 1),
      kit.plain("#22272b", 0.45, 0.5),
      -12.3,
      1.7,
      z,
    );
  kit.mesh(site, kit.rbox(0.2, 0.2, 6.6, 0.02, 1), teak, -12.3, 3.35, -6);
  for (let i = 0; i < 9; i++)
    kit.mesh(
      site,
      kit.rbox(2.6, 0.08, 0.12, 0.01, 1),
      teak,
      -11.1,
      3.42,
      -9 + i * 0.75,
    );
  kit.mesh(site, kit.rbox(0.18, 0.18, 6.6, 0.02, 1), teak, -9.9, 3.32, -6);
  placeSeats(kit, scene, "rooftop", colliders, seatMarkers);
  r.batch(site);
  colliders.push(...walls);
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
