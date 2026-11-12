import * as T from "three";
import { SocialAvatar } from "../src/renderer/room3d/avatar";
import { RoomAssets } from "../src/renderer/room3d/assets";
import { SocialScene } from "../src/renderer/room3d/scene";
import { defaultAvatar } from "../src/shared/room3d";
import type { Avatar3D } from "../src/shared/types";

const w = window as any;
w.SocialScene = SocialScene;
const assets = new RoomAssets(),
  scene = new T.Scene(),
  camera = new T.PerspectiveCamera(34, 1200 / 720, 0.1, 40);
const renderer = new T.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1200, 720);
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
scene.background = new T.Color("#273337");
scene.add(new T.HemisphereLight("#eee4d4", "#738491", 2));
const key = new T.DirectionalLight("#ffe1b7", 2.5);
key.position.set(-3, 5, 5);
scene.add(key);
const fill = new T.DirectionalLight("#bdc6f4", 1.3);
fill.position.set(3, 3, -2);
scene.add(fill);
camera.position.set(0, 2.4, 11.8);
camera.lookAt(0, 1.1, 0);
const entries: Avatar3D[] = [
  {
    ...defaultAvatar,
    hairStyle: "short",
    outfitStyle: "tee",
    skin: "#f4d1b5",
    headShape: "round",
    eyes: "round",
    bottom: "shorts",
    color: "#7b9a8c",
  },
  {
    ...defaultAvatar,
    hairStyle: "braids",
    hairSecondary: "#b88754",
    skin: "#644232",
    headShape: "oval",
    eyes: "almond",
    outfitStyle: "coat",
    bottom: "skirt",
    bottomColor: "#775464",
    shoes: "boots",
    accessories: ["glasses", "earrings", "backpack"],
    body: "slim",
    color: "#b67665",
  },
  {
    ...defaultAvatar,
    hairStyle: "afro",
    skin: "#8c5b43",
    headShape: "square",
    facialHair: "beard",
    outfitStyle: "varsity",
    body: "athletic",
    accessories: ["headset", "bracelet"],
    color: "#d0ae79",
  },
  {
    ...defaultAvatar,
    hairStyle: "ponytail",
    hairColor: "#517168",
    hairSecondary: "#d8bb83",
    headShape: "oval",
    eyes: "sleepy",
    outfitStyle: "hoodie",
    body: "soft",
    accessories: ["cap", "necklace"],
    color: "#67859b",
  },
];
let avatars: SocialAvatar[] = [];
w.appearances = entries;
w.show = (angle = 0, smoke = false) => {
  for (const a of avatars) a.dispose();
  avatars = [];
  entries.forEach((appearance, i) => {
    const a = new SocialAvatar(assets, appearance);
    a.group.position.x = (i - 1.5) * 1.65;
    a.group.rotation.y = angle;
    scene.add(a.group);
    avatars.push(a);
    for (let j = 0; j < 100; j++)
      a.update(
        1 / 60,
        false,
        false,
        0.88,
        smoke
          ? {
              x: 0,
              z: 0,
              yaw: 0,
              seat: null,
              moving: false,
              emote: "smoke",
              emoteAt: Date.now(),
            }
          : undefined,
      );
  });
  renderer.render(scene, camera);
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
};
w.characterCase = (
  appearance: Avatar3D,
  angle: number,
  seated = false,
  smoke = false,
) => {
  for (const a of avatars) a.dispose();
  avatars = [];
  const a = new SocialAvatar(assets, appearance);
  avatars.push(a);
  scene.add(a.group);
  a.group.rotation.y = angle;
  camera.position.set(0, 1.85, 4.3);
  camera.lookAt(0, 1.25, 0);
  for (let j = 0; j < 120; j++)
    a.update(
      1 / 60,
      false,
      seated,
      0.88,
      smoke
        ? {
            x: 0,
            z: 0,
            yaw: 0,
            seat: null,
            moving: false,
            emote: "smoke",
            emoteAt: Date.now(),
          }
        : undefined,
    );
  renderer.render(scene, camera);
};
w.verifySmokePreference = () => {
  const a = avatars[0] as any;
  a.update(
    1 / 60,
    false,
    false,
    0.88,
    { emote: "smoke", emoteAt: Date.now() },
    true,
  );
  const visible = a.cigarette.visible;
  a.update(
    1 / 60,
    false,
    false,
    0.88,
    { emote: "smoke", emoteAt: Date.now() },
    false,
  );
  return (
    visible &&
    !a.cigarette.visible &&
    a.smoke.every((p: T.Sprite) => !p.visible)
  );
};
document.body.appendChild(renderer.domElement);
w.catalog = () => {
  for (const a of avatars) a.dispose();
  avatars = [];
  const hairs: NonNullable<Avatar3D["hairStyle"]>[] = [
    "short",
    "long",
    "crest",
    "bob",
    "curly",
    "buzz",
    "afro",
    "ponytail",
    "braids",
    "wavy",
    "bun",
    "bald",
  ];
  const tops: NonNullable<Avatar3D["outfitStyle"]>[] = [
    "sweater",
    "jacket",
    "hoodie",
    "tee",
    "shirt",
    "coat",
    "suit",
    "varsity",
  ];
  camera.position.set(0, 2.9, 11.5);
  camera.lookAt(0, 2.3, 0);
  hairs.forEach((hairStyle, i) => {
    const a = new SocialAvatar(assets, {
      ...entries[i % 4],
      hairStyle,
      outfitStyle: tops[i % tops.length],
      accessories: [],
      bottom: i % 3 === 0 ? "shorts" : i % 3 === 1 ? "skirt" : "trousers",
    });
    a.group.position.set(((i % 6) - 2.5) * 1.4, i < 6 ? 2.5 : 0, 0);
    a.update(0, false, false);
    scene.add(a.group);
    avatars.push(a);
  });
  renderer.render(scene, camera);
};
w.show();
w.ready = true;
