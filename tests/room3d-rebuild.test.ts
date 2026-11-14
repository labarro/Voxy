import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { RoomCamera } from "../src/renderer/room3d/camera";
import { Resources } from "../src/renderer/room3d/resources";
import {
  profileGeometry,
  skinnedLimb,
  buildHair,
} from "../src/renderer/room3d/characterGeometry";
import { defaultAvatar, seats, spawnPose } from "../src/shared/room3d";
import { playingCue } from "../src/renderer/room3d/PlayingCue";
import { POOL } from "../src/shared/pool";

test("cue butt, shaft, ferrule and tip share one centerline and meet without gaps under the rack transform", () => {
  const resources = new Resources(),
    rack = new T.Group();
  const cues = [playingCue(resources, rack), playingCue(resources, rack)];
  for (const cue of cues) {
    let end = -0.65;
    for (const piece of cue.children as T.Mesh[]) {
      piece.updateMatrix();
      piece.geometry.computeBoundingBox();
      const bounds = piece.geometry
        .boundingBox!.clone()
        .applyMatrix4(piece.matrix);
      assert(Math.abs(bounds.min.z - end) < 1e-6);
      assert(
        Math.abs(piece.position.x) < 1e-8 && Math.abs(piece.position.y) < 1e-8,
      );
      end = bounds.max.z;
    }
    assert(Math.abs(end - (0.8 - POOL.radius * POOL.scale)) < 1e-6);
  }
  resources.dispose();
});

test("continuous section surfaces have outward normals in either profile direction", () => {
  for (const rings of [
    [
      [0, 0.1, 0.1],
      [-0.3, 0.12, 0.1],
      [-0.6, 0.07, 0.08],
    ],
    [
      [0, 0.1, 0.1],
      [0.3, 0.12, 0.1],
      [0.6, 0.07, 0.08],
    ],
  ] as const) {
    const g = profileGeometry(rings.map((r) => [...r]));
    const p = g.getAttribute("position"),
      n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++)
      assert(p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i) > 0);
    g.dispose();
  }
});
test("continuous limbs skin across the bend with normalized weights and no detached forearm mesh", () => {
  const r = new Resources(),
    group = new T.Group(),
    limb = skinnedLimb(
      r,
      group,
      0.6,
      0.27,
      [
        [0.03, 0.01, 0.01],
        [0, 0.1, 0.1],
        [-0.18, 0.09, 0.09],
        [-0.24, 0.085, 0.085],
        [-0.3, 0.08, 0.08],
        [-0.36, 0.075, 0.075],
        [-0.6, 0.03, 0.03],
      ],
      () => "#cda17b",
    );
  const g = limb.mesh.geometry,
    w = g.getAttribute("skinWeight"),
    p = g.getAttribute("position");
  for (let i = 0; i < w.count; i++)
    assert(Math.abs(w.getX(i) + w.getY(i) - 1) < 1e-6);
  limb.lower.rotation.x = -1.2;
  group.updateMatrixWorld(true);
  limb.skeleton.update();
  const before = new T.Vector3().fromBufferAttribute(p, p.count - 1),
    after = limb.mesh.applyBoneTransform(p.count - 1, before.clone());
  assert(after.distanceTo(before) > 0.2);
  assert(Number.isFinite(after.x + after.y + after.z));
  assert.equal(
    group.children.filter((c) => c instanceof T.SkinnedMesh).length,
    1,
  );
  limb.skeleton.dispose();
  r.dispose();
});
test("all hair silhouettes are continuous surfaces, finite and not piles of primitive spheres", () => {
  for (const hairStyle of [
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
  ] as const) {
    const r = new Resources(),
      head = new T.Group();
    buildHair(
      r,
      head,
      { ...defaultAvatar, hairStyle },
      0.32,
      0.34,
      0.295,
      false,
    );
    assert(head.children.length <= 3, hairStyle);
    head.traverse((obj) => {
      if (obj instanceof T.Mesh) {
        assert(!(obj.geometry instanceof T.SphereGeometry), hairStyle);
        const p = obj.geometry.getAttribute("position");
        for (let i = 0; i < p.count; i++)
          assert(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
      }
    });
    r.dispose();
  }
});

test("scalp roots follow round, oval and square head surfaces without exposed-skin intersections", () => {
  for (const headShape of ["round", "oval", "square"] as const)
    for (const hairStyle of [
      "short",
      "long",
      "crest",
      "buzz",
      "afro",
      "curly",
      "bun",
    ] as const) {
      const r = new Resources(),
        head = new T.Group(),
        power = headShape === "square" ? 2.6 : 2;
      buildHair(
        r,
        head,
        { ...defaultAvatar, headShape, hairStyle },
        0.32,
        0.34,
        0.295,
        false,
      );
      const scalp = head.getObjectByName(
          "continuous-hair-" + hairStyle,
        ) as T.Mesh,
        p = scalp.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const implicit =
          Math.abs(p.getX(i) / 0.32) ** power +
          Math.abs(p.getY(i) / 0.34) ** power +
          Math.abs(p.getZ(i) / 0.295) ** power;
        assert(implicit > 1.02, `${headShape}/${hairStyle}/${i}`);
      }
      r.dispose();
    }
});

test("scalp sweep closes its angular seam and shares smooth normals at the join", () => {
  for (const hairStyle of ["short", "crest", "curly"] as const) {
    const r = new Resources(),
      head = new T.Group();
    buildHair(
      r,
      head,
      { ...defaultAvatar, hairStyle },
      0.32,
      0.34,
      0.295,
      false,
    );
    const g = (head.getObjectByName("continuous-hair-" + hairStyle) as T.Mesh)
        .geometry,
      p = g.getAttribute("position"),
      n = g.getAttribute("normal");
    for (let first = 0; first < p.count; first += 49) {
      const last = first + 48;
      assert(
        new T.Vector3()
          .fromBufferAttribute(p, first)
          .distanceTo(new T.Vector3().fromBufferAttribute(p, last)) < 1e-6,
      );
      assert(
        new T.Vector3()
          .fromBufferAttribute(n, first)
          .distanceTo(new T.Vector3().fromBufferAttribute(n, last)) < 1e-6,
      );
    }
    r.dispose();
  }
});
test("sitting camera clears real seat backs instead of collapsing into the avatar; closed shell bounds hold on every orbit", () => {
  const material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
    geometry = new T.BoxGeometry(1.3, 1.03, 0.28);
  for (const preset of ["lounge", "cinema"] as const)
    for (const seat of seats(preset)) {
      const back = new T.Mesh(geometry, material);
      back.position.set(
        seat.x - Math.sin(seat.yaw) * 0.52,
        1.12,
        seat.z - Math.cos(seat.yaw) * 0.52,
      );
      back.rotation.y = seat.yaw;
      back.updateMatrixWorld(true);
      const camera = new T.PerspectiveCamera(55, 1.7, 0.12, 80),
        rig = new RoomCamera(camera);
      const pose = {
        ...spawnPose(),
        x: seat.x,
        z: seat.z,
        yaw: seat.yaw,
        seat: seat.id,
      };
      for (let step = 0; step < 16; step++) {
        rig.rotate((2 * Math.PI) / 16 / 0.004, 0, 1);
        for (let i = 0; i < 50; i++) rig.update(1 / 60, pose, [back]);
        const nearest = new T.Vector3(
          pose.x,
          T.MathUtils.clamp(camera.position.y, 0.35, 2.15),
          pose.z,
        );
        assert(
          camera.position.distanceTo(nearest) >= 0.94,
          `${preset}/${seat.id}/${step}`,
        );
        assert(
          Math.abs(camera.position.x) <= 12.64 &&
            camera.position.z >= -10.63 &&
            camera.position.z <= 12.71 &&
            camera.position.y <= 5.79,
        );
      }
      for (let i = 0; i < 60; i++)
        rig.update(1 / 60, { ...pose, seat: null, z: pose.z + 1.4 }, [back]);
      assert(Number.isFinite(camera.position.length()));
    }
  geometry.dispose();
  material.dispose();
});
