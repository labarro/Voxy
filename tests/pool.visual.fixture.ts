import * as T from "three";
import { SocialAvatar } from "../src/renderer/room3d/avatar";
import { PoolTable } from "../src/renderer/room3d/PoolTable";
import { RoomAssets } from "../src/renderer/room3d/assets";
import { defaultAvatar } from "../src/shared/room3d";
import { POOL, newPool } from "../src/shared/pool";
import { poolStroke } from "../src/shared/poolMotion";
const scene = new T.Scene();
scene.background = new T.Color("#28353c");
scene.add(new T.HemisphereLight("#f8ead8", "#5c747b", 2));
const light = new T.DirectionalLight("#fff0d6", 3);
light.position.set(POOL.x - 3, 5, POOL.z + 3);
scene.add(light);
const camera = new T.PerspectiveCamera(42, 1200 / 800, 0.1, 60),
  renderer = new T.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
renderer.setSize(1200, 800);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
const floor = new T.Mesh(
  new T.PlaneGeometry(24, 24),
  new T.MeshStandardMaterial({ color: "#38474a", roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const table = new PoolTable(scene, []);
let avatar: SocialAvatar | undefined;
(window as any).posePool = (angle = 0, age = 0.65, height = 1) => {
  avatar?.dispose();
  const state = newPool();
  state.players = ["a", "b"];
  state.phase = "preparing";
  state.clock = age;
  state.shot = {
    actor: "a",
    angle,
    power: 0.6,
    started: 0,
    sequence: 1,
    x: state.balls[0].x,
    z: state.balls[0].z,
  };
  const stroke = poolStroke(state, { ...defaultAvatar, height });
  avatar = new SocialAvatar(new RoomAssets(), { ...defaultAvatar, height });
  scene.add(avatar.group);
  avatar.group.position.set(stroke.stance.x, 0, stroke.stance.z);
  avatar.group.rotation.y = stroke.stance.yaw;
  for (let i = 0; i < 90; i++)
    avatar.update(1 / 60, false, false, 0.74, undefined, false, stroke, true);
  table.update(state, 0, ["Ana", "Bruno"], angle);
  scene.updateMatrixWorld(true);
  camera.position.set(POOL.x + 3.6, 2.8, POOL.z + 3.6);
  camera.lookAt(POOL.x, 0.9, POOL.z);
  renderer.render(scene, camera);
  const cue = avatar.group.getObjectByName("held-pool-cue")!,
    tip = cue.localToWorld(new T.Vector3(0, 0, 0.8 - POOL.radius * POOL.scale));
  return {
    errors: avatar.handErrors,
    tip: tip.toArray(),
    target: [stroke.tip.x, stroke.tip.y, stroke.tip.z],
    stance: stroke.stance,
  };
};
(window as any).ready = true;
(window as any).auditPool = () => {
  avatar?.dispose();
  avatar = undefined;
  const cases = [];
  for (const height of [0.9, 1, 1.1])
    for (const body of ["slim", "soft"] as const) {
      const a = new SocialAvatar(new RoomAssets(), {
        ...defaultAvatar,
        height,
        body,
      });
      scene.add(a.group);
      for (const x of [-0.95, 0, 0.95])
        for (const z of [-1.95, 0, 1.95])
          for (let i = 0; i < 16; i++) {
            const angle = (i * Math.PI) / 8,
              s = newPool();
            Object.assign(s.balls[0], { x, z });
            s.phase = "preparing";
            s.clock = 0.65;
            s.shot = {
              actor: "a",
              angle,
              power: 0.65,
              started: 0,
              sequence: 1,
              x,
              z,
            };
            const st = poolStroke(s, { ...defaultAvatar, height, body });
            a.group.position.set(st.stance.x, 0, st.stance.z);
            a.group.rotation.y = st.stance.yaw;
            for (let frame = 0; frame < 40; frame++)
              a.update(1 / 40, false, false, 0.74, undefined, false, st, true);
            const error = Math.max(...a.handErrors),
              cue = a.group.getObjectByName("held-pool-cue")!,
              tip = cue.localToWorld(
                new T.Vector3(0, 0, 0.8 - POOL.radius * POOL.scale),
              ),
              tipError = tip.distanceTo(
                new T.Vector3(st.tip.x, st.tip.y, st.tip.z),
              );
            if (error > 0.04 || tipError > 0.008)
              cases.push({
                height,
                body,
                x,
                z,
                angle,
                error,
                tipError,
                cost: st.stance.cost,
              });
          }
      a.dispose();
    }
  return cases.sort((a, b) => b.error - a.error);
};
