import * as T from "three";
import { SocialAvatar } from "../src/renderer/room3d/avatar";
import { RoomAssets } from "../src/renderer/room3d/assets";
import { Resources } from "../src/renderer/room3d/resources";
import { TrucoTable } from "../src/renderer/room3d/TrucoTable";
import { ChessTable } from "../src/renderer/room3d/ChessTable";
import { PoolTable } from "../src/renderer/room3d/PoolTable";
import { buildRooftop } from "../src/renderer/room3d/Rooftop";
import { TrucoGame } from "../src/shared/truco";
import { ChessGame } from "../src/shared/chess";
import { cardMotion } from "../src/shared/cardMotion";
import { chessMotion } from "../src/shared/chessMotion";
import { GAME_TABLES, tableSeat, tableCamera } from "../src/shared/gameTables";
import { defaultAvatar, spawnPose } from "../src/shared/room3d";
import { newPool } from "../src/shared/pool";
import type { RoomPose } from "../src/shared/types";
const renderer = new T.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1280, 900);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.body.append(renderer.domElement);
let disposables: { dispose: () => void }[] = [],
  scene: T.Scene,
  camera: T.PerspectiveCamera;
function reset() {
  for (const d of disposables) d.dispose();
  disposables = [];
  scene = new T.Scene();
  scene.background = new T.Color("#26363b");
  camera = new T.PerspectiveCamera(55, 1280 / 900, 0.12, 80);
  scene.add(new T.HemisphereLight("#eee5d5", "#7a9394", 2));
  const light = new T.DirectionalLight("#fff0d6", 2);
  light.position.set(-3, 5, 4);
  scene.add(light);
  const r = new Resources();
  disposables.push(r);
  r.box(scene, 0, -0.035, 0, 30, 0.05, 30, "#3b4d4d");
}
function avatar(index: number, height = 1) {
  const a = new SocialAvatar(new RoomAssets(), {
    ...defaultAvatar,
    height,
    hairStyle: ["short", "afro", "long", "braids"][index % 4] as any,
    color: ["#8d9d79", "#c08877", "#7696ae", "#b0a28b"][index % 4],
    outfitStyle: index === 3 ? "coat" : "sweater",
    bottom: index === 3 ? "skirt" : "trousers",
    body: index === 1 ? "soft" : "slim",
  });
  scene.add(a.group);
  disposables.push(a);
  return a;
}
function view(kind: "truco" | "chess", index: number) {
  const v = tableCamera(kind, index);
  camera.position.set(v.position.x, v.position.y, v.position.z);
  camera.lookAt(v.target.x, v.target.y, v.target.z);
}
function finish() {
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
}
(window as any).cards = (index = 0, height = 1, age = 0.3) => {
  reset();
  const g = new TrucoGame((n) => Math.floor(n * 0.37));
  for (let i = 0; i < 4; i++) g.join("p" + i, 0, i);
  g.advance(4000);
  for (let i = 0; i <= index; i++)
    g.act("p" + i, { type: "play", index: 0 }, g.revision, 5000 + i * 600);
  const s = g.view("p" + index),
    clock = s.animation!.at + age * 1000,
    table = new TrucoTable(scene);
  disposables.push(table);
  const avatars = Array.from({ length: 4 }, (_, i) => {
    const a = avatar(i, height),
      seat = tableSeat("truco", i);
    a.group.position.set(seat.x, 0, seat.z);
    a.group.rotation.y = seat.yaw;
    for (let frame = 0; frame < 90; frame++)
      a.update(
        1 / 60,
        false,
        true,
        0.62,
        undefined,
        false,
        undefined,
        false,
        cardMotion(s, i, clock),
      );
    return a;
  });
  table.update(s, "p" + index, clock, (i, hand) => avatars[i].handWorld(hand));
  view("truco", index);
  return { ...finish(), errors: avatars.flatMap((a) => a.handErrors) };
};
(window as any).chess = (index = 0, height = 1, age = 0.5) => {
  reset();
  const g = new ChessGame(
    index === 0
      ? "8/R7/6k1/8/8/8/8/4K3 w - - 0 1"
      : "4k3/8/8/8/8/6K1/r7/8 b - - 0 1",
  );
  g.join("p0", 0, 0);
  g.join("p1", 0, 1);
  g.act(
    "p" + index,
    { type: "move", from: index ? "a2" : "a7", to: index ? "h2" : "h7" },
    g.revision,
    1000,
  );
  const s = g.view("p" + index),
    clock = 1000 + age * 1000,
    table = new ChessTable(scene);
  disposables.push(table);
  const avatars = Array.from({ length: 2 }, (_, i) => {
    const a = avatar(i, height),
      seat = tableSeat("chess", i);
    a.group.position.set(seat.x, 0, seat.z);
    a.group.rotation.y = seat.yaw;
    for (let frame = 0; frame < 90; frame++)
      a.update(
        1 / 60,
        false,
        true,
        0.62,
        undefined,
        false,
        undefined,
        false,
        chessMotion(s, i, clock),
      );
    return a;
  });
  table.update(s, clock);
  view("chess", index);
  return { ...finish(), errors: avatars.flatMap((a) => a.handErrors) };
};
(window as any).emote = (emote: RoomPose["emote"], angle = 0, height = 1) => {
  reset();
  const a = avatar(3, height);
  a.group.rotation.y = angle;
  const pose = { ...spawnPose(), emote, emoteAt: Date.now() - 1200 };
  for (let frame = 0; frame < 90; frame++)
    a.update(1 / 60, false, false, 0.74, pose, true);
  camera.position.set(0, 1.4, 4);
  camera.lookAt(0, 1, 0);
  const soles: number[] = [];
  a.group.updateMatrixWorld(true);
  a.group.traverse((o) => {
    if (o.name === "shoe-sole")
      soles.push(new T.Box3().setFromObject(o, true).min.y);
  });
  return { ...finish(), soles };
};
(window as any).roof = (angle = 0) => {
  reset();
  scene.clear();
  const env = buildRooftop(scene);
  disposables.push(env);
  const pool = new PoolTable(scene, env.colliders),
    truco = new TrucoTable(scene),
    chess = new ChessTable(scene);
  disposables.push(pool, truco, chess);
  pool.update(newPool(), 0);
  const g = new TrucoGame((n) => n - 1);
  truco.update(g.view(), "", 0, () => undefined);
  chess.update(new ChessGame().view(), 0);
  for (let i = 0; i < 4; i++) {
    const a = avatar(i);
    a.group.position.set((i - 1.5) * 1.7, 0, 6);
    a.update(1 / 60, false, false);
  }
  camera.position.set(Math.sin(angle) * 10.6, 4.4, 1 + Math.cos(angle) * 10.5);
  camera.lookAt(0, 1, 1);
  return finish();
};
(window as any).ready = true;
