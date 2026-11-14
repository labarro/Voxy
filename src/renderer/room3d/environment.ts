import * as T from "three";
import type { RoomPreset } from "../../shared/types";
import { seats } from "../../shared/room3d";
import { Resources } from "./resources";
import { RoomAssets } from "./assets";
import { buildRooftop } from "./Rooftop";

export type RoomEnvironment = {
  screen: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  poster: T.Texture;
  colliders: T.Object3D[];
  walls: T.Mesh[];
  seatMarkers: Map<string, T.Mesh>;
  key: T.SpotLight;
  dispose: () => void;
};
export function buildEnvironment(
  scene: T.Scene,
  preset: RoomPreset,
  assets: RoomAssets,
): RoomEnvironment {
  if (preset === "rooftop") return buildRooftop(scene);
  const r = new Resources(),
    colliders: T.Object3D[] = [],
    walls: T.Mesh[] = [],
    seatMarkers = new Map<string, T.Mesh>();
  const cinema = preset === "cinema";
  const palette = {
    wall: cinema ? "#343541" : "#52615e",
    plaster: cinema ? "#454151" : "#b4aaa0",
    wood: "#75503e",
    cloth: cinema ? "#76536c" : "#8c718d",
    trim: "#bda17a",
    floor: "#8d6c51",
  };
  scene.background = new T.Color(cinema ? "#171925" : "#222c35");
  scene.fog = new T.Fog(scene.background, 28, 65);
  scene.add(new T.HemisphereLight("#dae5fa", "#8a6b56", cinema ? 0.95 : 0.95));
  scene.add(new T.AmbientLight("#e3c9ab", cinema ? 0.3 : 0.3));
  const key = new T.SpotLight("#ffe1b7", cinema ? 105 : 165, 35, 1.14, 0.7, 2);
  key.position.set(0, 5.8, 1);
  key.target.position.set(0, 0, 1);
  key.castShadow = true;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.035;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 3;
  scene.add(key, key.target);
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
  r.box(scene, 0, -0.22, 0.4, 26.3, 0.4, 24.6, "#262b30", 0.12);
  // Continue the floor beneath the cutaway camera, avoiding a visible platform edge.
  r.box(scene, 0, -0.06, 0.4, 26.3, 0.16, 24.6, wood, 0.04);
  const rug = r.box(
    scene,
    0,
    0.035,
    1,
    cinema ? 16.8 : 10,
    0.06,
    cinema ? 16 : 9,
    fabric(cinema ? "#3d354c" : "#b5a093"),
    0.05,
  );
  r.box(
    scene,
    0,
    0.07,
    1,
    cinema ? 16.45 : 9.65,
    0.015,
    cinema ? 15.65 : 8.65,
    fabric(cinema ? "#454052" : "#a7948b"),
    0.03,
  );
  // Architectural shell: wainscot, plaster, inset window and ceiling coves.
  walls.push(
    r.box(scene, 0, 3.05, -11.13, 26, 6.2, 0.25, palette.plaster, 0.04),
  );
  walls.push(r.box(scene, -13.05, 3.1, 1, 0.22, 6.2, 24, palette.wall, 0.04));
  walls.push(r.box(scene, 13.05, 3.1, 1, 0.22, 6.2, 24, palette.wall, 0.04));
  walls.push(r.box(scene, 0, 3.1, 13.15, 26.2, 6.2, 0.22, palette.wall, 0.04));
  const ceiling = r.box(
    scene,
    0,
    6.15,
    1,
    26.3,
    0.24,
    24.6,
    cinema ? "#33323f" : "#d0c8b8",
    0.02,
  );
  ceiling.name = "solid-ceiling";
  walls.push(ceiling);
  walls.forEach((w, i) => {
    w.name = w.name || "interior-shell-" + i;
    (w.material as T.MeshStandardMaterial).side = T.DoubleSide;
  });
  colliders.push(...walls);
  r.box(scene, 0, 0.6, -10.96, 26, 1.2, 0.08, palette.wood, 0.02);
  for (const x of [-12.9, 12.9]) {
    r.box(scene, x, 0.6, 0.4, 0.12, 1.2, 24, palette.wood, 0.02);
    r.box(scene, x, 1.23, 0.4, 0.15, 0.08, 24, palette.trim, 0.01);
    r.box(scene, x, 4.65, 0.4, 0.28, 0.14, 24, palette.wood, 0.03);
    const strip = r.material("#ffe0a8");
    strip.emissive.set("#f2af5d");
    strip.emissiveIntensity = 1.1;
    r.box(scene, x, 4.54, 0.4, 0.06, 0.045, 23.7, strip, 0);
    const ambient = new T.PointLight("#ffc784", cinema ? 8 : 12, 13, 2);
    ambient.position.set(x * 0.7, 3.8, 1);
    scene.add(ambient);
  }
  r.box(scene, 0, 5.9, -10.94, 25.7, 0.14, 0.2, palette.wood, 0.03);
  // Ceiling coffers, perimeter cornice and actual ceiling-mounted luminaires.
  for (const z of [-10.8, 12.85]) {
    r.box(scene, 0, 5.87, z, 25.8, 0.25, 0.28, palette.wood, 0.025);
    r.box(scene, 0, 0.6, z, 25.8, 1.2, 0.07, palette.wood, 0.015);
  }
  for (const x of [-12.84, 12.84])
    r.box(scene, x, 5.87, 1, 0.28, 0.25, 23.8, palette.wood, 0.025);
  const diffuser = r.material("#e9d3ad");
  diffuser.emissive.set("#d9b98a");
  diffuser.emissiveIntensity = 0.5;
  for (const x of [-7, 0, 7])
    for (const z of [-5, 4, 10]) {
      r.box(scene, x, 6.0, z, cinema ? 2.8 : 3.6, 0.12, 1.0, "#4b4443", 0.03);
      r.box(scene, x, 5.92, z, cinema ? 2.5 : 3.3, 0.035, 0.7, diffuser, 0.01);
    }
  // Doors and rear-wall composition give every orbit a real interior elevation.
  for (const x of cinema ? [-9, 9] : [0]) {
    r.box(scene, x, 1.65, 12.98, 2.65, 3.3, 0.13, palette.wood, 0.04);
    r.box(
      scene,
      x,
      1.67,
      12.88,
      2.32,
      3.05,
      0.08,
      cinema ? "#353442" : "#71817a",
      0.03,
    );
    r.box(scene, x + 0.85, 1.45, 12.8, 0.045, 0.32, 0.055, palette.trim, 0.01);
    r.box(scene, x, 3.4, 12.89, 2.8, 0.12, 0.2, palette.trim, 0.015);
  }
  if (cinema) {
    r.box(scene, 0, 3.7, 12.95, 5, 1.45, 0.15, "#635b66", 0.04);
    r.box(scene, 0, 3.7, 12.84, 4.7, 1.18, 0.06, "#202735", 0.02);
    r.box(scene, 0, 3.55, 12.72, 0.7, 0.28, 0.28, "#41444d", 0.04);
  } else {
    const console = r.box(
      scene,
      -8,
      0.65,
      11.8,
      5.4,
      1.3,
      0.85,
      palette.wood,
      0.06,
    );
    colliders.push(console);
    r.box(scene, -8, 1.34, 11.8, 5.65, 0.1, 1.0, "#b9ad96", 0.035);
    for (const x of [-9.7, -8, -6.3]) {
      r.box(scene, x, 0.65, 11.33, 1.55, 1.05, 0.045, "#665849", 0.015);
      r.box(scene, x, 1.0, 11.28, 0.4, 0.025, 0.04, palette.trim, 0);
    }
    // Hospitality station: a tray and a carafe, grouped on the counter surface.
    r.cylinder(scene, -8.7, 1.43, 11.7, 0.55, 0.55, 0.07, "#b69d77");
    for (const x of [-8.9, -8.5])
      r.cylinder(scene, x, 1.58, 11.7, 0.11, 0.09, 0.22, "#ddd4c5");
    r.cylinder(scene, -7.3, 1.63, 11.8, 0.15, 0.21, 0.48, "#565753");
    r.cylinder(scene, -7.3, 1.9, 11.8, 0.13, 0.15, 0.06, palette.trim);
  }
  // A single instanced set provides the rhythm of acoustic / timber panels.
  const slatGeometry = r.keep(new T.BoxGeometry(0.12, 4.6, 0.12)),
    slatMaterial = r.material(cinema ? "#46394c" : "#886b53");
  const slats = new T.InstancedMesh(slatGeometry, slatMaterial, 32);
  const transform = new T.Object3D();
  for (let i = 0; i < 32; i++) {
    const side = i < 16 ? -1 : 1;
    transform.position.set(side * (4.6 + (i % 16) * 0.14), 3.5, -10.83);
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
    windowPlane.position.set(-12.9, 3, 0);
    scene.add(windowPlane);
    for (const z of [-3.3, 0, 3.3])
      r.box(scene, -12.78, 3, z, 0.16, 2.7, 0.09, palette.wood, 0.02);
    for (const y of [1.65, 4.35])
      r.box(scene, -12.78, y, 0, 0.25, 0.1, 6.8, palette.wood, 0.02);
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
    artwork.position.set(12.88, 3, 0);
    scene.add(artwork);
    for (const y of [1.72, 4.28])
      r.box(scene, 12.84, y, 0, 0.13, 0.09, 3.55, palette.wood, 0.02);
    for (const z of [-1.77, 1.77])
      r.box(scene, 12.84, 3, z, 0.13, 2.65, 0.09, palette.wood, 0.02);
  } else {
    const panelGeometry = r.keep(new RoundedPanelGeometry()),
      panels = new T.InstancedMesh(panelGeometry, fabric("#40384c"), 12);
    for (let i = 0; i < 12; i++) {
      transform.position.set(i < 6 ? -12.88 : 12.88, 2.9, (i % 6) * 1.8 - 4.5);
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
    group.rotation.y = yaw;
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
    const sofa = new T.Group();
    sofa.position.set(0, 0, 2);
    sofa.rotation.y = Math.PI;
    scene.add(sofa);
    colliders.push(sofa);
    r.box(sofa, 0, 0.4, 0, 5.8, 0.35, 1.4, palette.wood, 0.12);
    r.box(sofa, 0, 1.05, -0.58, 5.8, 0.95, 0.26, fabric(palette.cloth), 0.12);
    for (const x of [-2.8, 2.8])
      r.box(sofa, x, 0.85, 0, 0.28, 0.6, 1.4, fabric(palette.cloth), 0.12);
    for (const x of [-1.85, 0, 1.85])
      r.box(sofa, x, 0.5, 0.06, 1.76, 0.22, 1.03, fabric("#9b809a"), 0.1);
    for (const x of [-2.4, 2.4])
      for (const z of [-0.48, 0.48])
        r.box(sofa, x, 0.15, z, 0.16, 0.3, 0.16, palette.wood, 0.02);
    r.batch(sofa);
    contact(0, 2, 6.7, 2.1);
    const table = prop("tableCoffee", 0, -0.2, 3.5, 0.6, 1.5, 0);
    colliders.push(table);
    contact(0, -0.2, 4.2, 2.1);
    prop("bookcaseOpenLow", 7.2, -9.8, 2.4, 1.4, 0.6, 0);
    prop("books", 7.2, -9.8, 1.6, 0.35, 0.35, 0, undefined, 1.4);
    const tray = r.cylinder(scene, 0.65, 0.65, -0.2, 0.4, 0.4, 0.04, "#d2b598");
    tray.scale.z = 0.7;
    for (const x of [0.45, 0.9])
      r.cylinder(scene, x, 0.78, -0.2, 0.1, 0.08, 0.23, "#d9cbc0");
  }
  for (const seat of seats(preset)) {
    if (seat.kind !== "sofa") {
      const chair = new T.Group();
      chair.name = "seat-" + seat.id;
      chair.position.set(seat.x, 0, seat.z);
      chair.rotation.y = seat.yaw;
      scene.add(chair);
      colliders.push(chair);
      if (seat.game) {
        r.box(chair, 0, 0.52, 0, 0.65, 0.14, 0.64, palette.wood, 0.04);
        r.box(chair, 0, 0.62, 0.025, 0.56, 0.1, 0.55, fabric("#688a84"), 0.04);
        r.box(chair, 0, 0.99, -0.29, 0.63, 0.6, 0.12, fabric("#688a84"), 0.045);
        for (const x of [-0.23, 0.23])
          for (const z of [-0.22, 0.22])
            r.box(chair, x, 0.26, z, 0.055, 0.5, 0.055, palette.wood, 0.008);
      } else if (seat.kind === "puff") {
        r.box(chair, 0, 0.29, 0, 1.15, 0.56, 1.15, fabric("#ab7963"), 0.18);
      } else {
        r.box(
          chair,
          0,
          0.29,
          0,
          1.28,
          0.26,
          1.24,
          cinema ? "#373944" : palette.wood,
          0.06,
        );
        r.box(
          chair,
          0,
          0.5,
          0.07,
          1.04,
          0.22,
          0.98,
          fabric(cinema ? "#92708b" : "#9aa999"),
          0.1,
        );
        r.box(
          chair,
          0,
          1.12,
          -0.52,
          1.2,
          1.02,
          0.24,
          fabric(palette.cloth),
          0.11,
        );
        for (const x of [-0.64, 0.64])
          r.box(
            chair,
            x,
            0.84,
            0,
            0.22,
            0.38,
            1.3,
            fabric(palette.cloth),
            0.08,
          );
        if (cinema) {
          r.box(chair, 0, 0.18, 0, 0.6, 0.36, 0.7, "#373944", 0.1);
          r.box(
            chair,
            0,
            1.45,
            -0.48,
            0.94,
            0.29,
            0.23,
            fabric("#80667a"),
            0.09,
          );
          for (const x of [-0.64, 0.64])
            r.cylinder(chair, x, 1.045, 0.32, 0.075, 0.075, 0.018, "#292a32");
        } else
          for (const x of [-0.46, 0.46])
            for (const z of [-0.45, 0.45])
              r.box(chair, x, 0.17, z, 0.12, 0.34, 0.12, palette.wood, 0.02);
      }
      r.batch(chair);
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
  for (const x of [-11, 11]) {
    const plant = new T.Group();
    plant.position.set(x, 0, -8.1);
    scene.add(plant);
    colliders.push(plant);
    r.cylinder(plant, 0, 0.3, 0, 0.34, 0.25, 0.6, "#978d77");
    r.cylinder(plant, 0, 0.61, 0, 0.32, 0.32, 0.045, "#343d32");
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2,
        leaf = new T.Shape();
      leaf.moveTo(0, 0);
      leaf.bezierCurveTo(-0.22, 0.28, -0.24, 0.75, 0, 1.25);
      leaf.bezierCurveTo(0.24, 0.75, 0.22, 0.28, 0, 0);
      const geo = r.keep(new T.ShapeGeometry(leaf, 12)),
        pos = geo.getAttribute("position");
      for (let j = 0; j < pos.count; j++) {
        const y = pos.getY(j);
        pos.setZ(j, 0.2 * Math.sin((y / 1.25) * Math.PI) - y * y * 0.2);
      }
      geo.computeVertexNormals();
      const mat = r.keep(
        new T.MeshStandardMaterial({
          color: i % 2 ? "#55765b" : "#6a8666",
          roughness: 0.9,
          side: T.DoubleSide,
        }),
      );
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(Math.sin(angle) * 0.09, 0.58, Math.cos(angle) * 0.09);
      mesh.rotation.set(-0.3 + (i % 3) * 0.15, angle, 0);
      mesh.scale.setScalar(0.9 + (i % 3) * 0.15);
      mesh.castShadow = true;
      plant.add(mesh);
    }
    contact(x, -8.1, 1.6, 1.6);
    const lamp = new T.Group();
    lamp.position.set(x, 0, 8.8);
    scene.add(lamp);
    colliders.push(lamp);
    r.cylinder(lamp, 0, 0.065, 0, 0.25, 0.29, 0.13, "#645e50");
    r.cylinder(lamp, 0, 1.15, 0, 0.025, 0.035, 2.2, "#a58e65");
    const shade = new T.Mesh(
      r.keep(new T.CylinderGeometry(0.22, 0.4, 0.5, 32, 1, true)),
      r.keep(
        new T.MeshStandardMaterial({
          color: "#d7c9aa",
          roughness: 0.92,
          side: T.DoubleSide,
        }),
      ),
    );
    shade.position.y = 2.4;
    shade.castShadow = true;
    lamp.add(shade);
    r.cylinder(lamp, 0, 2.16, 0, 0.36, 0.36, 0.025, "#ddc9a3");
    const bulb = new T.PointLight("#ffbc75", 9, 7, 2);
    bulb.position.set(x, 2.5, 8.8);
    scene.add(bulb);
  }
  if (!cinema) {
    // Conversation nook and separate games zone, with wide circulation between them.
    r.box(scene, -8, 0.035, 3, 6, 0.06, 7, fabric("#758c82"), 0.04);
    const chatTable = r.cylinder(
      scene,
      -8,
      0.37,
      2.5,
      0.85,
      0.65,
      0.7,
      palette.wood,
    );
    colliders.push(chatTable);
    prop("bookcaseOpenLow", -11, -5, 2.4, 1.4, 0.5, 0);
    prop("books", -11, -5, 1.6, 0.35, 0.35, 0, undefined, 1.4);
  } else {
    const aisle = r.material("#d8ac72");
    aisle.emissive.set("#d8ac72");
    aisle.emissiveIntensity = 0.6;
    for (const x of [-1.3, 1.3, -8, 8])
      r.box(scene, x, 0.045, 2, 0.045, 0.03, 17, aisle, 0);
  }
  // Screen architecture and a deliberately composed idle slate.
  const panel = r.box(
    scene,
    0,
    3.15,
    -10.76,
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
  r.box(scene, 0, 5.54, -10.75, 8.4, 0.035, 0.1, warm, 0);
  r.box(scene, 0, 0.55, -10.5, 8, 1, 0.8, palette.wood, 0.08);
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
  screen.position.set(0, 3.15, -10.59);
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
