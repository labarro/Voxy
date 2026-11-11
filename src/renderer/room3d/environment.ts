import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { RoomPreset } from "../../shared/types";
import { seats } from "../../shared/room3d";
import { Resources } from "./resources";
import { RoomAssets } from "./assets";

export type RoomEnvironment = {
  screen: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  poster: T.Texture;
  colliders: T.Object3D[];
  walls: T.Mesh[];
  seatMarkers: Map<string, T.Mesh>;
  key: T.DirectionalLight;
  dispose: () => void;
};
export function buildEnvironment(
  scene: T.Scene,
  preset: RoomPreset,
  assets: RoomAssets,
): RoomEnvironment {
  const r = new Resources(),
    colliders: T.Object3D[] = [],
    walls: T.Mesh[] = [],
    seatMarkers = new Map<string, T.Mesh>();
  const cinema = preset === "cinema";
  const palette = {
    wall: cinema ? "#242734" : "#52615e",
    plaster: cinema ? "#393449" : "#b4aaa0",
    wood: "#75503e",
    cloth: cinema ? "#76536c" : "#8c718d",
    trim: "#bda17a",
    floor: "#8d6c51",
  };
  scene.background = new T.Color(cinema ? "#171925" : "#222c35");
  scene.fog = new T.Fog(scene.background, 28, 65);
  scene.add(new T.HemisphereLight("#dae5fa", "#8a6b56", 1.15));
  scene.add(new T.AmbientLight("#e3c9ab", 0.36));
  const key = new T.DirectionalLight("#ffe1b7", 3.2);
  key.position.set(-4, 9, 5);
  key.castShadow = true;
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.035;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 3;
  scene.add(key);
  const fill = new T.DirectionalLight("#b6c6ff", 0.7);
  fill.position.set(5, 5, -1);
  scene.add(fill);
  const grain = r.texture("wood"),
    weave = r.texture("fabric");
  const wood = r.keep(
    new T.MeshStandardMaterial({
      color: palette.floor,
      map: grain,
      roughness: 0.7,
    }),
  );
  const fabric = (color: string) => {
    const mat = r.material(color, 0.97);
    mat.bumpMap = weave;
    mat.bumpScale = 0.018;
    return mat;
  };
  r.box(scene, 0, -0.22, 0.4, 22, 0.4, 23, "#262b30", 0.12);
  // Continue the floor beneath the cutaway camera, avoiding a visible platform edge.
  r.box(scene, 0, -0.06, 0.4, 22, 0.16, 23, wood, 0.04);
  const rug = r.box(
    scene,
    0,
    0.035,
    1,
    10,
    0.06,
    9,
    fabric(cinema ? "#3d354c" : "#b5a093"),
    0.05,
  );
  r.box(
    scene,
    0,
    0.07,
    1,
    9.65,
    0.015,
    8.65,
    fabric(cinema ? "#454052" : "#a7948b"),
    0.03,
  );
  // Architectural shell: wainscot, plaster, inset window and ceiling coves.
  walls.push(
    r.box(scene, 0, 3.05, -6.13, 14, 6.2, 0.25, palette.plaster, 0.04),
  );
  walls.push(
    r.box(scene, -7.05, 2.45, 0.4, 0.22, 4.9, 13.4, palette.wall, 0.04),
  );
  walls.push(
    r.box(scene, 7.05, 2.45, 0.4, 0.22, 4.9, 13.4, palette.wall, 0.04),
  );
  colliders.push(...walls);
  r.box(scene, 0, 0.6, -5.96, 14, 1.2, 0.08, palette.wood, 0.02);
  for (const x of [-6.9, 6.9]) {
    r.box(scene, x, 0.6, 0.4, 0.12, 1.2, 13.4, palette.wood, 0.02);
    r.box(scene, x, 1.23, 0.4, 0.15, 0.08, 13.4, palette.trim, 0.01);
    r.box(scene, x, 4.65, 0.4, 0.28, 0.14, 13.4, palette.wood, 0.03);
    const strip = r.material("#ffe0a8");
    strip.emissive.set("#f2af5d");
    strip.emissiveIntensity = 1.1;
    r.box(scene, x, 4.54, 0.4, 0.06, 0.045, 13.1, strip, 0);
    const ambient = new T.PointLight("#ffc784", cinema ? 8 : 12, 13, 2);
    ambient.position.set(x * 0.7, 3.8, 1);
    scene.add(ambient);
  }
  r.box(scene, 0, 5.9, -5.94, 13.7, 0.14, 0.2, palette.wood, 0.03);
  // A single instanced set provides the rhythm of acoustic / timber panels.
  const slatGeometry = r.keep(new T.BoxGeometry(0.12, 4.6, 0.12)),
    slatMaterial = r.material(cinema ? "#46394c" : "#886b53");
  const slats = new T.InstancedMesh(slatGeometry, slatMaterial, 32);
  const transform = new T.Object3D();
  for (let i = 0; i < 32; i++) {
    const side = i < 16 ? -1 : 1;
    transform.position.set(side * (4.6 + (i % 16) * 0.14), 3.5, -5.83);
    transform.updateMatrix();
    slats.setMatrixAt(i, transform.matrix);
  }
  slats.castShadow = true;
  slats.receiveShadow = true;
  scene.add(slats);
  if (!cinema) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const sky = ctx.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#35496b");
    sky.addColorStop(0.7, "#a27f8c");
    sky.addColorStop(1, "#e2b69a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#cbd9e7";
    ctx.beginPath();
    ctx.arc(380, 60, 22, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 18; i++) {
      const height = 35 + ((i * 37) % 100);
      ctx.fillStyle = i % 2 ? "#4e536a" : "#65657a";
      ctx.fillRect(i * 32, 256 - height, 28, height);
      ctx.fillStyle = "#e8c391";
      for (let j = 0; j < 3; j++)
        ctx.fillRect(i * 32 + 6, 270 - height + j * 22, 3, 6);
    }
    const map = r.keep(new T.CanvasTexture(canvas));
    map.colorSpace = T.SRGBColorSpace;
    const windowMat = r.keep(new T.MeshBasicMaterial({ map }));
    const windowPlane = new T.Mesh(
      r.keep(new T.PlaneGeometry(6.5, 2.5)),
      windowMat,
    );
    windowPlane.rotation.y = Math.PI / 2;
    windowPlane.position.set(-6.9, 3, 0);
    scene.add(windowPlane);
    for (const z of [-3.3, 0, 3.3])
      r.box(scene, -6.78, 3, z, 0.16, 2.7, 0.09, palette.wood, 0.02);
    for (const y of [1.65, 4.35])
      r.box(scene, -6.78, y, 0, 0.25, 0.1, 6.8, palette.wood, 0.02);
    const art = document.createElement("canvas");
    art.width = 512;
    art.height = 384;
    const ac = art.getContext("2d")!;
    ac.fillStyle = "#d8c7ac";
    ac.fillRect(0, 0, 512, 384);
    ac.fillStyle = "#819486";
    ac.beginPath();
    ac.arc(160, 160, 108, 0, Math.PI * 2);
    ac.fill();
    ac.fillStyle = "#a47d83";
    ac.fillRect(274, 83, 100, 230);
    ac.strokeStyle = "#394c51";
    ac.lineWidth = 19;
    ac.lineCap = "round";
    ac.beginPath();
    ac.moveTo(80, 280);
    ac.bezierCurveTo(190, 160, 230, 350, 425, 145);
    ac.stroke();
    const artMap = r.keep(new T.CanvasTexture(art));
    artMap.colorSpace = T.SRGBColorSpace;
    const artwork = new T.Mesh(
      r.keep(new T.PlaneGeometry(3.3, 2.45)),
      r.keep(new T.MeshStandardMaterial({ map: artMap, roughness: 1 })),
    );
    artwork.rotation.y = -Math.PI / 2;
    artwork.position.set(6.88, 3, 0);
    scene.add(artwork);
    for (const y of [1.72, 4.28])
      r.box(scene, 6.84, y, 0, 0.13, 0.09, 3.55, palette.wood, 0.02);
    for (const z of [-1.77, 1.77])
      r.box(scene, 6.84, 3, z, 0.13, 2.65, 0.09, palette.wood, 0.02);
  } else {
    const panelGeometry = r.keep(new RoundedPanelGeometry()),
      panels = new T.InstancedMesh(panelGeometry, fabric("#40384c"), 12);
    for (let i = 0; i < 12; i++) {
      transform.position.set(i < 6 ? -6.88 : 6.88, 2.9, (i % 6) * 1.8 - 4.5);
      transform.rotation.y = i < 6 ? Math.PI / 2 : -Math.PI / 2;
      transform.updateMatrix();
      panels.setMatrixAt(i, transform.matrix);
    }
    scene.add(panels);
  }
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 64;
  const shadowCtx = shadowCanvas.getContext("2d")!;
  const gradient = shadowCtx.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, "rgba(17,14,25,.4)");
  gradient.addColorStop(1, "rgba(17,14,25,0)");
  shadowCtx.fillStyle = gradient;
  shadowCtx.fillRect(0, 0, 64, 64);
  const contactMaterial = r.keep(
    new T.MeshBasicMaterial({
      map: r.keep(new T.CanvasTexture(shadowCanvas)),
      transparent: true,
      depthWrite: false,
    }),
  );
  const contact = (x: number, z: number, w: number, d: number) => {
    const mesh = new T.Mesh(r.keep(new T.PlaneGeometry(w, d)), contactMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.09, z);
    scene.add(mesh);
  };
  const prop = (
    name: string,
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    yaw = 0,
    color?: string,
    y = 0,
  ) => {
    const root = assets.prop(name),
      bounds = new T.Box3().setFromObject(root),
      size = bounds.getSize(new T.Vector3()),
      center = bounds.getCenter(new T.Vector3());
    root.position.sub(new T.Vector3(center.x, bounds.min.y, center.z));
    const group = new T.Group();
    group.add(root);
    group.scale.set(w / size.x, h / size.y, d / size.z);
    group.position.set(x, y, z);
    group.rotation.y = yaw + Math.PI;
    root.traverse((obj) => {
      if (!(obj instanceof T.Mesh)) return;
      const originals = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      const mats = originals.map((mat) => {
        const n = mat.name.toLowerCase();
        if (/carpet/.test(n)) return fabric(color ?? palette.cloth);
        if (/plant/.test(n)) return r.material("#587d64", 0.9);
        if (/lamp/.test(n)) {
          const lamp = r.material("#e7cf9e", 0.9);
          lamp.emissive.set("#d39a53");
          lamp.emissiveIntensity = 0.25;
          return lamp;
        }
        if (/metal/.test(n)) return r.material("#a68a62", 0.35, 0.6);
        if (/wooddark/.test(n)) return r.material("#4c3934");
        return r.material(palette.wood, 0.72);
      });
      obj.material = mats.length === 1 ? mats[0] : mats;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    scene.add(group);
    colliders.push(group);
    return group;
  };
  if (!cinema) {
    prop("loungeSofa", 0, 2, 5.8, 1.45, 1.5, Math.PI, palette.cloth);
    contact(0, 2, 6.7, 2.1);
    for (const x of [-1.85, 0, 1.85]) {
      r.box(scene, x, 0.64, 1.84, 1.76, 0.25, 1.05, fabric("#9b809a"), 0.12);
      const back = r.box(
        scene,
        x,
        1.08,
        2.44,
        1.76,
        0.64,
        0.24,
        fabric("#91748d"),
        0.11,
      );
      back.rotation.x = -0.06;
    }
    // Separate throw cushions add silhouette and fabric detail to the authored sofa.
    for (const x of [-2.2, 2.2]) {
      const cushion = r.box(
        scene,
        x,
        0.99,
        2.25,
        0.65,
        0.63,
        0.2,
        fabric(x < 0 ? "#bd9b78" : "#a8b2a0"),
        0.13,
      );
      cushion.rotation.z = x < 0 ? 0.16 : -0.16;
    }
    const table = prop("tableCoffee", 0, -0.2, 3.5, 0.6, 1.5, 0);
    colliders.push(table);
    contact(0, -0.2, 4.2, 2.1);
    prop("bookcaseOpenLow", 5.8, -3, 1.3, 1.4, 0.55, Math.PI / 2);
    prop("books", 5.72, -3, 0.7, 0.38, 0.35, Math.PI / 2, undefined, 1.4);
    const tray = r.cylinder(scene, 0.65, 0.65, -0.2, 0.4, 0.4, 0.04, "#d2b598");
    tray.scale.z = 0.7;
    for (const x of [0.45, 0.9])
      r.cylinder(scene, x, 0.78, -0.2, 0.1, 0.08, 0.23, "#d9cbc0");
  }
  for (const seat of seats(preset)) {
    if (seat.kind !== "sofa") {
      if (seat.kind === "puff")
        prop(
          "loungeSofaOttoman",
          seat.x,
          seat.z,
          1.2,
          0.56,
          1.2,
          seat.yaw,
          "#ab7963",
        );
      else
        prop(
          cinema ? "loungeDesignChair" : "loungeChair",
          seat.x,
          seat.z,
          cinema ? 1.35 : 1.55,
          cinema ? 1.45 : 1.4,
          1.35,
          seat.yaw,
          cinema ? palette.cloth : "#839384",
        );
      contact(seat.x, seat.z, 1.8, 1.8);
    }
    const marker = new T.Mesh(
      r.keep(new T.RingGeometry(0.64, 0.69, 32)),
      r.keep(
        new T.MeshBasicMaterial({
          color: "#e0c393",
          transparent: true,
          opacity: 0.8,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(seat.x, 0.105, seat.z);
    marker.visible = false;
    scene.add(marker);
    seatMarkers.set(seat.id, marker);
  }
  // Shared rounded inserts soften the silhouette of every seat in one draw per part.
  const chairs = seats(preset).filter((s) => s.kind === "chair");
  for (const part of [
    { size: [1.04, 0.24, 0.95], y: 0.61, z: 0.04 },
    { size: [1.04, 0.78, 0.26], y: 1.1, z: -0.44 },
  ]) {
    const geometry = r.keep(
      new RoundedBoxGeometry(part.size[0], part.size[1], part.size[2], 3, 0.11),
    );
    const cushions = new T.InstancedMesh(
      geometry,
      fabric(cinema ? "#92708b" : "#9aa999"),
      chairs.length,
    );
    chairs.forEach((seat, i) => {
      const pivot = new T.Object3D();
      pivot.position.set(seat.x, part.y, seat.z);
      pivot.rotation.y = seat.yaw;
      pivot.translateZ(part.z);
      pivot.updateMatrix();
      cushions.setMatrixAt(i, pivot.matrix);
    });
    cushions.castShadow = true;
    cushions.receiveShadow = true;
    scene.add(cushions);
  }
  for (const x of [-5.6, 5.6]) {
    prop("pottedPlant", x, -4.1, 1.15, 2.3, 1.15);
    contact(x, -4.1, 1.6, 1.6);
    prop("lampRoundFloor", x, 3.8, 0.8, 2.9, 0.8);
    const bulb = new T.PointLight("#ffbc75", 9, 7, 2);
    bulb.position.set(x, 2.5, 3.8);
    scene.add(bulb);
  }
  // Screen architecture and a deliberately composed idle slate.
  const panel = r.box(
    scene,
    0,
    3.15,
    -5.76,
    8.5,
    4.7,
    0.28,
    cinema ? "#171821" : "#41494b",
    0.18,
  );
  colliders.push(panel);
  const warm = r.material("#e4c59a");
  warm.emissive.set("#dba46b");
  warm.emissiveIntensity = 0.7;
  r.box(scene, 0, 5.54, -5.75, 8.4, 0.035, 0.1, warm, 0);
  r.box(scene, 0, 0.55, -5.5, 8, 1, 0.8, palette.wood, 0.08);
  const posterCanvas = document.createElement("canvas");
  posterCanvas.width = 1280;
  posterCanvas.height = 720;
  const pc = posterCanvas.getContext("2d")!;
  pc.fillStyle = cinema ? "#211e31" : "#2c3b3a";
  pc.fillRect(0, 0, 1280, 720);
  pc.strokeStyle = cinema ? "#8c708b" : "#8b9d8b";
  pc.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    pc.beginPath();
    pc.arc(1080, 700, 180 + i * 90, Math.PI, Math.PI * 1.8);
    pc.stroke();
  }
  pc.fillStyle = "#dbc7a9";
  pc.font = "600 32px system-ui";
  pc.fillText("Voxy", 90, 105);
  pc.font = "600 66px system-ui";
  pc.fillText(cinema ? "A próxima sessão" : "Boa companhia.", 90, 320);
  pc.fillText(cinema ? "começa com vocês." : "Uma tela em comum.", 90, 405);
  pc.fillStyle = "#b9c1b9";
  pc.font = "26px system-ui";
  pc.fillText("Compartilhe uma tela para assistir juntos.", 90, 540);
  const poster = r.keep(new T.CanvasTexture(posterCanvas));
  poster.colorSpace = T.SRGBColorSpace;
  const screen = new T.Mesh(
    r.keep(new T.PlaneGeometry(7.8, 4.3875)),
    r.keep(new T.MeshBasicMaterial({ map: poster, toneMapped: false })),
  );
  screen.position.set(0, 3.15, -5.59);
  scene.add(screen);
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

// Flat acoustic panels use one geometry and one draw call for both side walls.
class RoundedPanelGeometry extends T.BoxGeometry {
  constructor() {
    super(1.4, 2.6, 0.12);
  }
}
