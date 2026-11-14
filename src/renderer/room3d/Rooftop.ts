import * as T from "three";
import { Resources } from "./resources";
import { seats } from "../../shared/room3d";
import type { RoomEnvironment } from "./environment";

/** A furnished rooftop, with a real perimeter, service core and distant city. */
export function buildRooftop(scene: T.Scene): RoomEnvironment {
  const r = new Resources(),
    colliders: T.Object3D[] = [],
    walls: T.Mesh[] = [],
    seatMarkers = new Map<string, T.Mesh>();
  scene.background = new T.Color("#111e36");
  scene.fog = new T.Fog("#17263d", 34, 78);
  scene.add(
    new T.HemisphereLight("#b8d2f7", "#5b4c42", 1.1),
    new T.AmbientLight("#b9b1aa", 0.32),
  );
  const key = new T.SpotLight("#ffe1b6", 175, 42, 1.1, 0.8, 2);
  key.position.set(0, 8, 2);
  key.target.position.set(0, 0, 2);
  key.castShadow = true;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 35;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.035;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  const moon = new T.DirectionalLight("#b4ceff", 0.8);
  moon.position.set(-10, 15, -6);
  scene.add(moon);
  const architecture = new T.Group();
  scene.add(architecture);
  const teak = r.material("#795e46", 0.75),
    metal = r.material("#293e45", 0.5, 0.25),
    stone = r.material("#647478", 0.94),
    cushion = r.material("#557b7c", 0.97),
    gold = r.material("#d9b889", 0.4, 0.3);
  const glow = r.material("#ffe1a0");
  glow.emissive.set("#ffca76");
  glow.emissiveIntensity = 1.3;
  r.box(architecture, 0, -0.28, 1, 26.3, 0.56, 24.6, "#2e424c", 0.06);
  r.box(architecture, 0, -0.025, 1, 26.2, 0.09, 24.5, stone, 0.01);
  for (let x = -12; x <= 12; x += 2)
    r.box(architecture, x, 0.025, 1, 0.017, 0.005, 24, "#53656c", 0);
  for (let z = -10; z <= 12; z += 2)
    r.box(architecture, 0, 0.025, z, 26, 0.005, 0.017, "#53656c", 0);
  // Load-bearing parapet and capped glass rails; camera collides with real geometry.
  const glass = r.keep(
    new T.MeshPhysicalMaterial({
      color: "#76989d",
      transparent: true,
      opacity: 0.25,
      roughness: 0.3,
      metalness: 0.1,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  for (const side of [-1, 1]) {
    walls.push(
      r.box(architecture, side * 13, 0.38, 1, 0.24, 0.78, 24.4, metal, 0.025),
    );
    r.box(architecture, side * 13, 1.32, 1, 0.16, 0.09, 24.4, teak, 0.025);
    r.box(architecture, side * 13, 0.98, 1, 0.035, 0.62, 24.2, glass, 0);
    for (let z = -10; z <= 12; z += 2)
      r.box(architecture, side * 13, 1.0, z, 0.065, 0.64, 0.065, metal, 0.01);
  }
  for (const z of [-11.1, 13.1]) {
    walls.push(r.box(architecture, 0, 0.38, z, 26, 0.78, 0.24, metal, 0.025));
    r.box(architecture, 0, 1.32, z, 26, 0.09, 0.16, teak, 0.025);
    r.box(architecture, 0, 0.98, z, 25.8, 0.62, 0.035, glass, 0);
    for (let x = -12; x <= 12; x += 2)
      r.box(architecture, x, 1, z, 0.065, 0.64, 0.065, metal, 0.01);
  }
  // Service core supports the outdoor screen; the door belongs to the building.
  const core = r.box(
    architecture,
    0,
    2.8,
    -11.1,
    9.4,
    5.6,
    0.65,
    "#344b51",
    0.06,
  );
  walls.push(core);
  for (const x of [-4.25, 4.25])
    r.box(architecture, x, 2.7, -10.73, 0.12, 5.2, 0.08, teak, 0.015);
  r.box(architecture, -6.1, 1.6, -10.91, 2.3, 3.2, 0.25, teak, 0.05);
  r.box(architecture, -6.1, 1.6, -10.75, 1.95, 2.95, 0.05, "#263c44", 0.015);
  r.box(architecture, -5.35, 1.6, -10.67, 0.04, 0.4, 0.04, gold, 0.01);
  // Two pergolas define the viewing lounge and sheltered games terrace.
  for (const canopy of [
    { x: 0, z: 1, w: 11, d: 8 },
    { x: 6.9, z: 3.6, w: 5, d: 5.2 },
  ]) {
    for (const dx of [-canopy.w / 2, canopy.w / 2])
      for (const dz of [-canopy.d / 2, canopy.d / 2]) {
        const pole = r.box(
          architecture,
          canopy.x + dx,
          2.2,
          canopy.z + dz,
          0.14,
          4.4,
          0.14,
          metal,
          0.02,
        );
        colliders.push(pole);
      }
    for (const dx of [-canopy.w / 2, canopy.w / 2])
      r.box(
        architecture,
        canopy.x + dx,
        4.35,
        canopy.z,
        0.22,
        0.22,
        canopy.d + 0.25,
        teak,
        0.025,
      );
    for (let dx = -canopy.w / 2; dx <= canopy.w / 2; dx += 0.5)
      r.box(
        architecture,
        canopy.x + dx,
        4.43,
        canopy.z,
        0.14,
        0.12,
        canopy.d + 0.3,
        teak,
        0.015,
      );
    for (const dz of [-canopy.d / 2, canopy.d / 2])
      r.box(
        architecture,
        canopy.x,
        4.2,
        canopy.z + dz,
        canopy.w,
        0.035,
        0.045,
        glow,
        0,
      );
  }
  // Teak deck and inset outdoor rug organize the television conversation area.
  r.box(architecture, 0, 0.037, 1, 10, 0.04, 9, teak, 0.02);
  for (let x = -4.8; x < 5; x += 0.27)
    r.box(architecture, x, 0.06, 1, 0.012, 0.004, 8.9, "#5b493b", 0);
  r.box(architecture, 0, 0.066, 1, 7.6, 0.012, 6.2, "#b0a58b", 0.025);
  r.box(architecture, 0, 0.075, 1, 7.3, 0.008, 5.9, "#7b8580", 0.025);
  const sofa = new T.Group();
  sofa.position.set(0, 0, 2);
  sofa.rotation.y = Math.PI;
  architecture.add(sofa);
  colliders.push(sofa);
  r.box(sofa, 0, 0.38, 0, 5.8, 0.2, 1.4, teak, 0.08);
  r.box(sofa, 0, 1.02, -0.58, 5.8, 0.88, 0.16, teak, 0.06);
  for (const x of [-2.8, 2.8])
    r.box(sofa, x, 0.81, 0, 0.24, 0.46, 1.4, teak, 0.045);
  for (const x of [-1.85, 0, 1.85]) {
    r.box(sofa, x, 0.55, 0.04, 1.77, 0.25, 1.03, cushion, 0.1);
    r.box(sofa, x, 1.04, -0.43, 1.77, 0.78, 0.22, cushion, 0.09);
  }
  for (const x of [-2.4, 2.4])
    for (const z of [-0.48, 0.48])
      r.box(sofa, x, 0.15, z, 0.11, 0.3, 0.11, metal, 0.015);
  const table = r.box(architecture, 0, 0.56, -0.2, 3.5, 0.14, 1.5, teak, 0.08);
  colliders.push(table);
  for (const x of [-1.4, 1.4])
    r.box(architecture, x, 0.27, -0.2, 0.08, 0.54, 1.2, metal, 0.02);
  r.cylinder(
    architecture,
    -8,
    0.62,
    2.5,
    0.8,
    0.72,
    0.12,
    teak.color.getStyle(),
  );
  r.cylinder(
    architecture,
    -8,
    0.3,
    2.5,
    0.16,
    0.28,
    0.6,
    metal.color.getStyle(),
  );
  for (const seat of seats("rooftop")) {
    if (seat.kind !== "sofa") {
      const chair = new T.Group();
      chair.name = "seat-" + seat.id;
      chair.position.set(seat.x, 0, seat.z);
      chair.rotation.y = seat.yaw;
      architecture.add(chair);
      colliders.push(chair);
      if (seat.kind === "puff")
        r.box(chair, 0, 0.33, 0, 1.15, 0.64, 1.15, "#bf9973", 0.18);
      else if (seat.game) {
        r.box(chair, 0, 0.52, 0, 0.65, 0.14, 0.64, teak, 0.04);
        r.box(chair, 0, 0.62, 0.025, 0.56, 0.1, 0.55, cushion, 0.04);
        r.box(chair, 0, 0.99, -0.29, 0.63, 0.6, 0.12, cushion, 0.045);
        for (const x of [-0.23, 0.23])
          for (const z of [-0.22, 0.22])
            r.box(chair, x, 0.26, z, 0.055, 0.5, 0.055, metal, 0.008);
      } else {
        r.box(chair, 0, 0.4, 0, 1.28, 0.18, 1.24, teak, 0.05);
        r.box(chair, 0, 0.58, 0.07, 1.04, 0.24, 0.98, cushion, 0.1);
        r.box(chair, 0, 1.12, -0.52, 1.2, 1.02, 0.24, cushion, 0.11);
        for (const x of [-0.64, 0.64]) {
          r.box(chair, x, 0.84, 0, 0.16, 0.32, 1.3, teak, 0.04);
          for (const z of [-0.45, 0.45])
            r.box(chair, x, 0.2, z, 0.09, 0.4, 0.09, metal, 0.01);
        }
      }
      r.batch(chair);
    }
    const marker = new T.Mesh(
      r.keep(new T.RingGeometry(0.64, 0.69, 24)),
      r.keep(
        new T.MeshBasicMaterial({
          color: "#f1cf93",
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          side: T.DoubleSide,
        }),
      ),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(seat.x, 0.105, seat.z);
    marker.visible = false;
    scene.add(marker);
    seatMarkers.set(seat.id, marker);
  }
  // A planted windbreak and low bar make the exposed edges feel inhabited.
  for (const [x, z] of [
    [-11, -8.1],
    [11, -8.1],
    [-11, 8.8],
    [11, 8.8],
    [-8, 11.8],
  ]) {
    const planter = new T.Group();
    planter.position.set(x, 0, z);
    architecture.add(planter);
    colliders.push(planter);
    const wide = z === 11.8;
    r.box(
      planter,
      0,
      0.4,
      0,
      wide ? 5.6 : 1.25,
      0.8,
      wide ? 0.6 : 1.0,
      metal,
      0.06,
    );
    const plants = wide ? 7 : 3;
    for (let i = 0; i < plants; i++) {
      const px = wide ? (i - 3) * 0.7 : (i - 1) * 0.27;
      r.cylinder(planter, px, 1, 0, 0.022, 0.035, 0.5, "#596f52");
      const leaf = r.sphere(planter, px, 1.3, 0, 0.35, "#557a61");
      leaf.scale.set(0.7, 1.3, 0.75);
    }
  }
  r.box(architecture, 7.2, 0.63, -9.8, 2.4, 1.26, 0.6, teak, 0.05);
  r.box(architecture, 7.2, 1.29, -9.8, 2.5, 0.07, 0.72, stone, 0.03);
  r.box(architecture, -11, 0.7, -5, 2.4, 1.4, 0.6, teak, 0.05);
  const pit = r.cylinder(
    architecture,
    7.2,
    0.32,
    -4.5,
    0.75,
    0.68,
    0.56,
    "#47585d",
  );
  colliders.push(pit);
  r.cylinder(architecture, 7.2, 0.62, -4.5, 0.61, 0.61, 0.03, "#202d32");
  const fire = r.material("#ffcc8c");
  fire.emissive.set("#ffad62");
  fire.emissiveIntensity = 1.0;
  for (let i = 0; i < 5; i++) {
    const flame = r.sphere(
      architecture,
      7.2 + (i - 2) * 0.16,
      0.76,
      -4.5 + (i % 2) * 0.13,
      0.13,
      "#ffca8a",
    );
    flame.material = fire;
    flame.scale.set(0.7, 1.5 + (i % 2), 0.7);
  }
  const warmth = new T.PointLight("#ffbc7c", 12, 7, 2);
  warmth.position.set(7.2, 1.3, -4.5);
  scene.add(warmth);
  // City blocks share two original window atlases and batch into a few draws.
  const city = new T.Group();
  scene.add(city);
  let seed = 1826;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const atlas = document.createElement("canvas");
  atlas.width = 128;
  atlas.height = 256;
  const ac = atlas.getContext("2d")!;
  ac.fillStyle = "#182c40";
  ac.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 20; row++)
    for (let col = 0; col < 8; col++) {
      ac.fillStyle =
        random() > 0.52
          ? ["#bca775", "#749eb3", "#d2b88a"][col % 3]
          : "#263c4b";
      ac.fillRect(col * 16 + 5, row * 12 + 4, 5, 6);
    }
  const windows = r.keep(new T.CanvasTexture(atlas));
  windows.colorSpace = T.SRGBColorSpace;
  const cityMat = r.keep(
    new T.MeshStandardMaterial({
      map: windows,
      emissiveMap: windows,
      emissive: "#a8bfd0",
      emissiveIntensity: 0.42,
      roughness: 1,
    }),
  );
  for (let side = 0; side < 4; side++)
    for (let i = 0; i < 16; i++) {
      const angle = (side * Math.PI) / 2,
        along = (i - 7.5) * 5,
        away = 23 + random() * 26,
        x = Math.cos(angle) * along + Math.sin(angle) * away,
        z = -Math.sin(angle) * along + Math.cos(angle) * away,
        h = 12 + random() * 23,
        w = 2.8 + random() * 3.5;
      const building = r.box(
        city,
        x,
        -19 + h / 2,
        z,
        w,
        h,
        3 + random() * 4,
        cityMat,
        0,
      );
      if (i % 5 === 0) {
        r.box(city, x, -19 + h + 0.6, z, w * 0.64, 1.2, 2.2, cityMat, 0);
        r.cylinder(city, x, -19 + h + 2, z, 0.035, 0.035, 2, "#8198a8");
      }
      building.castShadow = false;
    }
  r.batch(city);
  const moonDisc = new T.Mesh(
    r.keep(new T.SphereGeometry(1.1, 16, 12)),
    r.keep(new T.MeshBasicMaterial({ color: "#e1e4dd" })),
  );
  moonDisc.position.set(-28, 30, -44);
  scene.add(moonDisc);
  const sign = r.label("Voxy · Rooftop", "#f5d49b", 512, 96);
  sign.position.set(-6.1, 3.7, -10.71);
  sign.scale.set(2.2, 0.4125, 1);
  architecture.add(sign);
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#17343e";
  c.fillRect(0, 0, 1280, 720);
  c.fillStyle = "#ead8b5";
  c.font = "600 40px system-ui";
  c.fillText("Voxy · No alto, juntos.", 80, 140);
  c.font = "600 68px system-ui";
  c.fillText("A cidade lá fora.", 80, 330);
  c.fillText("Os amigos aqui.", 80, 425);
  c.fillStyle = "#a8c8c6";
  c.font = "28px system-ui";
  c.fillText("Compartilhe sua tela para assistir juntos.", 80, 560);
  const poster = r.keep(new T.CanvasTexture(canvas));
  poster.colorSpace = T.SRGBColorSpace;
  const screen = new T.Mesh(
    r.keep(new T.PlaneGeometry(7.8, 4.3875)),
    r.keep(new T.MeshBasicMaterial({ map: poster, toneMapped: false })),
  );
  screen.position.set(0, 3.15, -10.59);
  scene.add(screen);
  colliders.push(...walls);
  for (const collider of colliders)
    if (collider instanceof T.Mesh) collider.userData.dynamic = true;
  r.batch(architecture);
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
