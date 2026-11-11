import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import {
  defaultAvatar,
  defaultRoomSettings,
  seats,
  spawnPose,
  spatialVoice,
  walkable,
} from "../src/shared/room3d";
import { commandSchema, profileSchema } from "../src/shared/validation";
import { ReleaseNotesStore } from "../src/main/releaseNotes";
import type { Command, Reply } from "../src/shared/types";

test("spatial attenuation, stereo direction and preset collision agree", () => {
  const listener = { ...spawnPose(), x: 0, z: 0 };
  assert.equal(spatialVoice(listener, { ...listener, x: 1 }, 10, 0).gain, 1);
  assert.equal(spatialVoice(listener, { ...listener, x: 10 }, 10, 0).gain, 0);
  assert(spatialVoice(listener, { ...listener, x: 5 }, 10, 0).gain < 1);
  assert.equal(spatialVoice(listener, { ...listener, x: 5 }, 10, 0).pan, 1);
  assert.equal(
    spatialVoice(listener, { ...listener, x: 5 }, 10, Math.PI).pan,
    -1,
  );
  for (const preset of ["lounge", "cinema"] as const) {
    assert(walkable(preset, 0, 6));
    assert(!walkable(preset, 8, 6));
    assert(!walkable(preset, NaN, 0));
    for (const seat of seats(preset)) assert(!walkable(preset, seat.x, seat.z));
    assert.equal(
      new Set(seats(preset).map((s) => s.id)).size,
      seats(preset).length,
    );
  }
});
test("avatar and room preferences validate, migrate and retain customized values", () => {
  const old = {
    id: randomUUID(),
    name: "Pessoa",
    avatar: "A",
    input: "",
    output: "",
  };
  assert.equal(profileSchema.parse(old).room3d, undefined);
  const value = profileSchema.parse({
    ...old,
    avatar3d: defaultAvatar,
    room3d: defaultRoomSettings,
  });
  assert.deepEqual(value.avatar3d, defaultAvatar);
  assert.deepEqual(value.room3d, defaultRoomSettings);
  assert(
    !profileSchema.safeParse({
      ...value,
      avatar3d: { ...defaultAvatar, color: "url(x)" },
    }).success,
  );
  assert(
    !commandSchema.safeParse({
      type: "room.pose",
      pose: { ...spawnPose(), x: Infinity },
    }).success,
  );
});
test("real host validates rooms, reserves seats atomically, isolates pose packets and persists presets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-3d-"));
  const path = join(dir, "room.sqlite"),
    store = await Store.open(path);
  store.createServer("Amigos", randomUUID());
  const server = store.snapshot().servers[0],
    channel = store.snapshot().channels.find((c) => c.kind === "voice")!;
  const text = store.snapshot().channels.find((c) => c.kind === "text")!;
  const host = new RoomHost(store, "d".repeat(64), "owner");
  const port = await host.listen("127.0.0.1", 0);
  const sockets: Socket[] = [];
  let poses = 0,
    states = 0;
  const command = async (i: number, c: Command) =>
    (await sockets[i].timeout(3000).emitWithAck("command", c)) as Reply;
  const wait = () => new Promise((r) => setTimeout(r, 115));
  try {
    for (let i = 0; i < 3; i++) {
      const socket = io(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        reconnection: false,
        auth: {
          protocol: 2,
          token: "d".repeat(64),
          ownerKey: i === 0 ? "owner" : undefined,
          identityKey: String(i + 1).repeat(64),
          profile: {
            id: randomUUID(),
            name: "Pessoa " + i,
            avatar: "A",
            avatar3d: defaultAvatar,
          },
        },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
    }
    assert.equal(
      (
        await command(1, {
          type: "channel.room",
          id: channel.id,
          preset: "lounge",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await command(0, {
          type: "channel.room",
          id: text.id,
          preset: "lounge",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await command(0, {
          type: "channel.room",
          id: channel.id,
          preset: "lounge",
        })
      ).ok,
      true,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await command(i, { type: "voice", channelId: channel.id })).ok,
        true,
      );
    assert.equal(
      (await command(2, { type: "room.pose", pose: spawnPose() })).ok,
      false,
    );
    sockets[2].on("room-pose", () => poses++);
    sockets[1].on("state", () => states++);
    assert.equal(
      (await command(0, { type: "room.pose", pose: spawnPose() })).ok,
      true,
    );
    await wait();
    assert.equal(
      (await command(1, { type: "room.pose", pose: spawnPose() })).ok,
      true,
    );
    const entries = host
      .state()
      .participants.filter((p) => p.roomPose)
      .map((p) => p.roomPose!);
    assert(
      Math.hypot(entries[0].x - entries[1].x, entries[0].z - entries[1].z) >=
        0.9,
      "simultaneous entries must not overlap",
    );
    const initial = states;
    assert.equal(
      (
        await command(0, {
          type: "room.pose",
          pose: { ...spawnPose(), x: 0.3 },
        })
      ).ok,
      true,
    );
    await wait();
    assert.equal(states, initial);
    assert.equal(poses, 0);
    assert.equal(
      (await command(2, { type: "room.tv", participantId: sockets[0].id! })).ok,
      false,
    );
    assert.equal(
      (await command(1, { type: "room.tv", participantId: sockets[0].id! })).ok,
      false,
    );
    for (const i of [0, 1])
      await command(i, {
        type: "status",
        muted: false,
        deafened: false,
        sharing: true,
      });
    assert.equal(
      (await command(1, { type: "room.tv", participantId: sockets[0].id! })).ok,
      true,
    );
    assert.equal(host.state().televisions?.[channel.id], sockets[0].id);
    await command(0, {
      type: "status",
      muted: false,
      deafened: false,
      sharing: false,
    });
    assert.equal(host.state().televisions?.[channel.id], sockets[1].id);
    assert(
      host.state().participants.find((p) => p.id === sockets[0].id)?.profile
        .avatar3d,
    );
    assert.equal(
      (
        await command(0, {
          type: "room.pose",
          pose: { ...spawnPose(), x: 6, z: -5 },
        })
      ).ok,
      false,
    );
    await wait();
    assert.equal(
      (
        await command(0, {
          type: "room.pose",
          pose: { ...spawnPose(), x: 0, z: 0 },
        })
      ).ok,
      false,
    );
    // Approach the puff using valid walking steps, as the renderer does.
    for (const i of [0, 1]) {
      assert.equal(
        (await command(i, { type: "room.pose", pose: null })).ok,
        true,
      );
      await wait();
      assert.equal(
        (
          await command(i, {
            type: "room.pose",
            pose: { ...spawnPose(), x: i === 0 ? -3.7 : -2.5, z: 6 },
          })
        ).ok,
        true,
      );
    }
    await wait();
    const seat = seats("lounge").find((s) => s.kind === "puff")!;
    const sitting = {
      ...spawnPose(),
      x: seat.x,
      z: seat.z,
      yaw: 0,
      seat: seat.id,
    };
    const results = await Promise.all([
      command(0, { type: "room.pose", pose: sitting }),
      command(1, { type: "room.pose", pose: sitting }),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    const winner = results[0].ok ? 0 : 1,
      loser = 1 - winner;
    assert.equal(
      (await command(winner, { type: "room.pose", pose: null })).ok,
      true,
    );
    await wait();
    assert.equal(
      (await command(loser, { type: "room.pose", pose: sitting })).ok,
      true,
    );
    assert.equal(
      (await command(loser, { type: "voice", channelId: null })).ok,
      true,
    );
    assert.equal(
      host.state().participants.find((p) => p.id === sockets[loser].id)
        ?.roomPose,
      undefined,
    );
    const reopened = await Store.open(path);
    assert.equal(
      reopened.snapshot().channels.find((c) => c.id === channel.id)?.roomPreset,
      "lounge",
    );
    reopened.createChannel(server.id, "Outra sala", "voice");
    assert(reopened.snapshot().channels.some((c) => c.name === "Outra sala"));
    const notes = new ReleaseNotesStore(join(dir, "notes.json"), "1.0.0");
    assert.equal(notes.notes()?.version, "1.0.0");
    notes.mark("1.0.0");
    assert.equal(notes.notes(), null);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
