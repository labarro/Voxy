import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { PoolGame, POOL, type PoolState } from "../src/shared/pool";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import {
  defaultAvatar,
  spawnPose,
  walkable,
  seats,
} from "../src/shared/room3d";
import { commandSchema, profileSchema } from "../src/shared/validation";
import type { Command, Reply } from "../src/shared/types";
import { ReleaseNotesStore } from "../src/main/releaseNotes";

function game() {
  const g = new PoolGame();
  g.join("a");
  g.join("b");
  return g;
}
function settle(g: PoolGame) {
  let n = 0;
  while (g.state.phase === "rolling" && n++ < 2500) g.step();
  assert.equal(g.state.phase, "aiming");
}
test("pool validates turns/revisions, breaks reproducibly and stops with finite non-overlapping balls", () => {
  const a = game(),
    b = game();
  assert.throws(() => a.shoot("b", 0, 0.7, a.state.revision));
  assert.throws(() => a.shoot("a", 0, 0.7, 0));
  assert.throws(() => a.shoot("a", NaN, 0.7, a.state.revision));
  a.shoot("a", 0, 0.7, a.state.revision);
  b.shoot("a", 0, 0.7, b.state.revision);
  assert.throws(() => a.shoot("a", 0, 0.7, a.state.revision));
  settle(a);
  settle(b);
  assert.deepEqual(a.state, b.state);
  for (const ball of a.state.balls) {
    assert(Number.isFinite(ball.x + ball.z));
    assert(Math.abs(ball.x) <= POOL.halfX);
    assert(Math.abs(ball.z) <= POOL.halfZ);
    assert.equal(ball.vx, 0);
  }
  a.leave("a");
  assert.equal(a.state.phase, "waiting");
  assert.deepEqual(a.state.players, ["b"]);
  assert.deepEqual(a.state.scores, [0, 0]);
});
test("pool detects legal pots, retains the turn, finishes, and respots scratches and wrong-first-contact pots", () => {
  const g = game();
  // A controlled last-ball shot into the side pocket exercises collision and pocket detection.
  for (const b of g.state.balls.slice(2)) b.sunk = true;
  Object.assign(g.state.balls[0], { x: 0.5, z: 0 });
  Object.assign(g.state.balls[1], { x: 0.95, z: 0 });
  g.shoot("a", Math.PI / 2, 0.18, g.state.revision);
  for (let i = 0; i < 2500 && g.state.phase === "rolling"; i++) g.step();
  assert.equal(g.state.phase, "finished");
  assert.equal(g.state.scores[0], 1);
  assert.equal(g.state.winner, "a");
  const scratch = game();
  Object.assign(scratch.state.balls[0], { x: 1, z: 0 });
  scratch.shoot("a", Math.PI / 2, 0.2, scratch.state.revision);
  settle(scratch);
  assert.equal(scratch.state.balls[0].sunk, false);
  assert.equal(scratch.state.turn, 1);
  assert.match(scratch.state.message, /Falta/);
  const wrong = game();
  Object.assign(wrong.state.balls[0], { x: 0.5, z: 0 });
  Object.assign(wrong.state.balls[2], { x: 0.95, z: 0 });
  wrong.shoot("a", Math.PI / 2, 0.18, wrong.state.revision);
  settle(wrong);
  assert.equal(wrong.state.balls[2].sunk, false);
  assert.deepEqual(wrong.state.scores, [0, 0]);
  assert.equal(wrong.state.turn, 1);
});
test("expanded rooms have accessible seat exits and pool circulation, and extended appearances survive validation", () => {
  for (const preset of ["lounge", "cinema"] as const) {
    assert(walkable(preset, 10, 10));
    assert(!walkable(preset, 13, 0));
    for (const s of seats(preset))
      assert(
        [
          [0, 1.4],
          [0, -1.4],
          [1.4, 0],
          [-1.4, 0],
        ].some(([dx, dz]) => walkable(preset, s.x + dx, s.z + dz)),
        s.id,
      );
  }
  assert(!walkable("lounge", POOL.x, POOL.z));
  assert(walkable("lounge", POOL.x + 2.3, POOL.z));
  const avatar = {
    ...defaultAvatar,
    hairStyle: "braids",
    hairSecondary: "#deaa88",
    outfitStyle: "coat",
    bottom: "skirt",
    bottomColor: "#336655",
    shoes: "boots",
    shoeColor: "#664433",
    accessories: ["cap", "earrings", "backpack"],
    headShape: "square",
    eyes: "almond",
    brows: "bold",
    nose: "wide",
    facialHair: "beard",
    body: "athletic",
    height: 1.07,
    idle: "confident",
  };
  const profile = profileSchema.parse({
    id: randomUUID(),
    name: "Teste",
    avatar: "A",
    input: "",
    output: "",
    avatar3d: avatar,
  });
  assert.deepEqual(profile.avatar3d, avatar);
  assert(
    !commandSchema.safeParse({
      type: "pool.shoot",
      angle: 0,
      power: 2,
      revision: 0,
    }).success,
  );
});
test("two real socket clients share authoritative pool results; other channels, out-of-turn and distant inputs are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-pool-")),
    store = await Store.open(join(dir, "room.sqlite"));
  store.createServer("Sinuca", randomUUID());
  const channel = store.snapshot().channels.find((c) => c.kind === "voice")!;
  const host = new RoomHost(store, "f".repeat(64), "owner"),
    port = await host.listen("127.0.0.1", 0),
    sockets: Socket[] = [];
  const command = async (i: number, c: Command) =>
    (await sockets[i].timeout(3000).emitWithAck("command", c)) as Reply;
  const received: PoolState[][] = [[], [], []];
  try {
    for (let i = 0; i < 3; i++) {
      const socket = io(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        reconnection: false,
        auth: {
          protocol: 2,
          token: "f".repeat(64),
          ownerKey: i === 0 ? "owner" : undefined,
          profile: { id: randomUUID(), name: `Pool ${i}`, avatar: "P" },
        },
      });
      sockets.push(socket);
      socket.on("room-pool", (e) => received[i].push(e.game));
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
    }
    assert(
      (
        await command(0, {
          type: "channel.room",
          id: channel.id,
          preset: "lounge",
        })
      ).ok,
    );
    for (let i = 0; i < 2; i++) {
      assert((await command(i, { type: "voice", channelId: channel.id })).ok);
      assert(
        (
          await command(i, {
            type: "room.pose",
            pose: { ...spawnPose(), x: i === 0 ? 5 : 9.8, z: 6.7 },
          })
        ).ok,
      );
      assert((await command(i, { type: "pool.join" })).ok);
    }
    assert.equal((await command(2, { type: "pool.join" })).ok, false);
    const initial = host.state().poolGames![channel.id];
    assert.equal(initial.phase, "aiming");
    assert.equal(
      (
        await command(1, {
          type: "pool.shoot",
          angle: 0,
          power: 0.3,
          revision: initial.revision,
        })
      ).ok,
      false,
    );
    assert(
      (
        await command(0, {
          type: "pool.shoot",
          angle: 0,
          power: 0.3,
          revision: initial.revision,
        })
      ).ok,
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(Error("Simulation did not settle"));
      }, 15000);
      const poll = setInterval(() => {
        if (host.state().poolGames![channel.id]?.phase !== "rolling") {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 100);
    });
    await new Promise((r) => setTimeout(r, 50));
    assert(received[0].some((s) => s.phase === "rolling"));
    assert.deepEqual(received[0].at(-1), received[1].at(-1));
    assert.equal(received[2].length, 0);
    // A late observer receives the current match through the regular state snapshot.
    assert((await command(2, { type: "voice", channelId: channel.id })).ok);
    assert(
      (
        await command(2, {
          type: "room.pose",
          pose: { ...spawnPose(), x: -10, z: 10 },
        })
      ).ok,
    );
    const distant = await command(2, { type: "pool.join" });
    assert.equal(distant.ok, false);
    if (!distant.ok) assert.match(distant.error, /Aproxime/);
    const observer = host
      .state()
      .participants.find((p) => p.id === sockets[2].id)!;
    assert.deepEqual(
      host.state(observer.profile.id).poolGames![channel.id],
      host.state().poolGames![channel.id],
    );
    const active = host.state().poolGames![channel.id];
    assert.equal(
      (
        await command(0, {
          type: "pool.shoot",
          angle: 0,
          power: 0.3,
          revision: initial.revision,
        })
      ).ok,
      false,
    );
    assert.equal(active.phase, "aiming");
    await command(0, {
      type: "room.pose",
      pose: { ...spawnPose(), x: 5, z: 6.7, emote: "smoke" },
    });
    const pose = host
      .state()
      .participants.find((p) => p.id === sockets[0].id)!.roomPose!;
    assert.equal(pose.emote, "smoke");
    assert(pose.emoteAt! > 0);
    sockets[0].disconnect();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(host.state().poolGames![channel.id].phase, "waiting");
    const notes = new ReleaseNotesStore(join(dir, "notes.json"), "1.1.0");
    notes.mark("1.1.0");
    const updated = new ReleaseNotesStore(join(dir, "notes.json"), "1.2.0");
    assert.equal(updated.notes()?.version, "1.2.0");
    updated.mark("1.2.0");
    assert.equal(updated.notes(), null);
  } finally {
    for (const s of sockets) s.disconnect();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
