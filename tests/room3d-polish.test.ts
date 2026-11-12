import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as T from "three";
import { z } from "zod";
import { RoomCamera } from "../src/renderer/room3d/camera";
import { profileSchema, publicProfileSchema } from "../src/shared/validation";
import {
  defaultAvatar,
  defaultRoomSettings,
  spawnPose,
} from "../src/shared/room3d";

const pose = { ...spawnPose(), x: 0, z: 0 };
test("camera follows with damping, clamps zoom/pitch and resets without a discontinuous jump", () => {
  const camera = new T.PerspectiveCamera(55, 1.6, 0.1, 80),
    rig = new RoomCamera(camera);
  rig.update(1 / 60, pose, []);
  const initial = camera.position.clone();
  rig.rotate(250, -10000, 1);
  rig.zoom(-100000);
  rig.update(1 / 60, pose, []);
  assert(camera.position.distanceTo(initial) < 2);
  for (let i = 0; i < 180; i++) rig.update(1 / 60, pose, []);
  assert(camera.position.y > 1.2);
  assert(camera.position.distanceTo(new T.Vector3(0, 1.25, -0.35)) >= 3.1);
  rig.zoom(100000);
  for (let i = 0; i < 180; i++) rig.update(1 / 60, pose, []);
  assert(camera.position.distanceTo(new T.Vector3(0, 1.25, -0.35)) <= 13.01);
  const before = camera.position.clone();
  rig.reset();
  rig.update(1 / 60, pose, []);
  assert(camera.position.distanceTo(before) < 2);
});
test("camera collision stops in front of walls and recovers smoothly after an obstruction is removed", () => {
  const camera = new T.PerspectiveCamera(55, 1.6, 0.1, 80),
    rig = new RoomCamera(camera);
  const geometry = new T.BoxGeometry(10, 6, 0.2),
    material = new T.MeshBasicMaterial(),
    wall = new T.Mesh(geometry, material);
  wall.position.set(0, 3, 3);
  wall.updateMatrixWorld(true);
  rig.update(1 / 60, pose, [wall]);
  assert(camera.position.z < 2.9);
  const obstructed = camera.position.clone();
  rig.update(1 / 60, pose, []);
  assert(camera.position.distanceTo(obstructed) < 1);
  for (let i = 0; i < 120; i++) rig.update(1 / 60, pose, []);
  assert(camera.position.z > 5);
  geometry.dispose();
  material.dispose();
});
test("watch camera fits the entire television in portrait and wide viewports, then restores exploration", () => {
  for (const aspect of [0.75, 16 / 9, 2.5]) {
    const camera = new T.PerspectiveCamera(55, aspect, 0.1, 80),
      rig = new RoomCamera(camera);
    rig.setMode("free");
    rig.update(1 / 60, pose, []);
    rig.setMode("watch");
    for (let i = 0; i < 180; i++) rig.update(1 / 60, pose, []);
    camera.updateMatrixWorld();
    for (const [x, y] of [
      [-3.9, 0.95625],
      [3.9, 5.34375],
    ]) {
      const ndc = new T.Vector3(x, y, -10.59).project(camera);
      assert(Math.abs(ndc.x) < 0.94);
      assert(Math.abs(ndc.y) < 0.94);
    }
    rig.leaveWatch();
    assert.equal(rig.mode, "free");
  }
});
test("leaving television restores the previous orbit, zoom and free-camera focus", () => {
  const camera = new T.PerspectiveCamera(55, 1.7, 0.1, 80),
    rig = new RoomCamera(camera);
  rig.setMode("free");
  rig.rotate(130, 40, 1);
  rig.zoom(-220);
  rig.pan(45, 20);
  for (let i = 0; i < 180; i++) rig.update(1 / 60, pose, []);
  const original = camera.position.clone();
  rig.setMode("watch");
  for (let i = 0; i < 180; i++) rig.update(1 / 60, pose, []);
  rig.leaveWatch();
  for (let i = 0; i < 180; i++) rig.update(1 / 60, pose, []);
  assert(camera.position.distanceTo(original) < 0.01);
  assert.equal(rig.mode, "free");
});
test("new customization persists while the base avatar remains accepted by the 1.0 public contract", () => {
  const appearance = {
    ...defaultAvatar,
    hairStyle: "curly",
    outfitStyle: "hoodie",
    accessoryStyle: "beanie",
    body: "soft",
    face: "bright",
  };
  const profile = profileSchema.parse({
    id: randomUUID(),
    name: "Pessoa",
    avatar: "A",
    input: "",
    output: "",
    avatar3d: appearance,
    room3d: { ...defaultRoomSettings, cameraMode: "free" },
  });
  const publicProfile = publicProfileSchema.parse(profile);
  assert.deepEqual(publicProfile.avatar3d, appearance);
  const legacy = z.object({
    hair: z.enum(["short", "long", "crest"]),
    hairColor: z.string(),
    skin: z.string(),
    outfit: z.enum(["sweater", "jacket"]),
    color: z.string(),
    accessory: z.enum(["none", "glasses", "headphones"]),
  });
  assert.deepEqual(legacy.parse(publicProfile.avatar3d), defaultAvatar);
  assert.equal(profile.room3d?.cameraMode, "free");
  assert(
    !profileSchema.safeParse({
      ...profile,
      avatar3d: { ...appearance, hairStyle: "unknown" },
    }).success,
  );
});
test("bundled models match their license manifest and include real idle, walking and sitting clips", async () => {
  const base = "src/renderer/public/assets/room3d",
    manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
  assert.equal(manifest.license, "CC0-1.0");
  let total = 0;
  for (const file of manifest.files) {
    const bytes = await readFile(join(base, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    total += bytes.length;
    if (file.path.startsWith("characters/") && file.path.endsWith(".glb")) {
      const json = JSON.parse(
        bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
      );
      const animations = json.animations.map((a: any) => a.name);
      for (const name of ["idle", "walk", "sit"])
        assert(animations.includes(name));
      assert(json.skins?.length);
      for (const image of json.images ?? [])
        assert(!image.uri || image.uri === "Textures/colormap.png");
    }
  }
  assert(total < 2 * 1024 * 1024, "local asset payload stays under 2 MiB");
  for (const folder of ["characters", "furniture"])
    assert(
      (await readFile(join(base, folder, "LICENSE.txt"), "utf8")).includes(
        "CC0",
      ),
    );
  assert(
    (await readdir(join(base, "characters"))).some((name) =>
      name.endsWith(".glb"),
    ),
  );
});
