import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { poolStroke } from "../src/shared/poolMotion";
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
  while (["preparing", "rolling"].includes(g.state.phase) && n++ < 2500)
    g.step();
  assert(["aiming", "placing"].includes(g.state.phase));
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
  assert.equal(a.state.phase, "finished");
  assert.equal(a.state.winner, "b");
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
  for (
    let i = 0;
    i < 2500 && ["preparing", "rolling"].includes(g.state.phase);
    i++
  )
    g.step();
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
    await new Promise((r) => setTimeout(r, 350));
    await command(0, {
      type: "room.pose",
      pose: { ...spawnPose(), ...poolStroke(initial).stance },
    });
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
        if (
          !["preparing", "rolling"].includes(
            host.state().poolGames![channel.id]?.phase,
          )
        ) {
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
    assert(["aiming", "placing"].includes(active.phase));
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
    assert.equal(host.state().poolGames![channel.id].phase, "finished");
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

// ── Eight-Ball (Bola 8) and modes ─────────────────────────────────────────
import { createHash } from "node:crypto";
import {
  newPool,
  eightRack,
  legalTargets,
  onEight,
  groupOf,
  HEAD_STRING,
  FOOT_SPOT,
  type PoolGroup,
} from "../src/shared/pool";
import { playEightMatch } from "./pool.eight.match";

function eight(seed = 1) {
  const g = new PoolGame(seed);
  g.state = newPool("eight", seed);
  g.join("a");
  g.join("b");
  return g;
}
/** Only the listed balls stay on the table; everything else is pocketed. */
function scenario(
  balls: Record<number, [number, number]>,
  options: {
    opening?: boolean;
    groups?: (PoolGroup | null)[];
    called?: number;
  } = {},
) {
  const g = eight();
  const s = g.state;
  for (const b of s.balls) {
    const p = balls[b.id];
    if (p) Object.assign(b, { x: p[0], z: p[1], sunk: false });
    else b.sunk = true;
  }
  s.phase = "aiming";
  s.ballInHand = undefined;
  s.opening = !!options.opening;
  if (options.groups) s.groups = options.groups;
  if (options.called !== undefined) s.called = options.called;
  return g;
}
function run(g: PoolGame, angle: number, power: number, spin = 0) {
  g.shoot(g.state.players[g.state.turn], angle, power, g.state.revision, spin);
  for (
    let n = 0;
    n < 3000 && ["preparing", "rolling"].includes(g.state.phase);
    n++
  )
    g.step();
  assert(!["preparing", "rolling"].includes(g.state.phase));
  return g.state;
}
const RIGHT = Math.PI / 2; // towards +x: the right side pocket is index 4
const SIDE = {
  cue: [0.5, 0] as [number, number],
  ball: [0.95, 0] as [number, number],
};

test("modes: rotation stays the default and its physics/rules are unchanged", () => {
  assert.equal(newPool().mode, "rotation");
  assert.equal(new PoolGame().state.mode, "rotation");
  assert.equal(newPool().balls.length, 8);
  // Fingerprint recorded with the 1.5.0 implementation for the same inputs.
  const f = game();
  for (const [angle, power] of [
    [0, 0.7],
    [0.4, 0.5],
    [-0.8, 0.35],
    [2.2, 0.6],
  ]) {
    const s = f.state;
    if (s.phase === "placing") f.place(s.players[s.turn], 0, 1.6, s.revision);
    if (f.state.phase !== "aiming") break;
    f.shoot(f.state.players[f.state.turn], angle, power, f.state.revision);
    while (["preparing", "rolling"].includes(f.state.phase)) f.step();
  }
  const hash = createHash("sha256")
    .update(
      JSON.stringify(
        f.state.balls.map((b) => [
          b.id,
          b.x.toFixed(6),
          b.z.toFixed(6),
          b.sunk,
        ]),
      ),
    )
    .digest("hex");
  assert.equal(
    hash,
    "8dce387ea8f94c346be50a4de33713c4b449b8f1daf673fea5486f1621d5b295",
  );
  assert.equal(f.state.phase, "placing");
  assert.deepEqual(legalTargets(f.state), [
    Math.min(...f.state.balls.filter((b) => b.id && !b.sunk).map((b) => b.id)),
  ]);
});

test("eight-ball rack: 15 official balls, 8 centred on the third row, apex on the foot spot, mixed back corners, deterministic shuffle", () => {
  const balls = eightRack(7);
  assert.equal(balls.length, 16);
  assert.deepEqual(
    balls.map((b) => b.id),
    Array.from({ length: 16 }, (_, i) => i),
  );
  const spacing = POOL.radius * 2 + 0.003,
    row = spacing * Math.sin(Math.PI / 3);
  assert(Math.abs(balls[8].x) < 1e-9);
  assert(Math.abs(balls[8].z - (FOOT_SPOT.z - 2 * row)) < 1e-9);
  const apex = balls.find(
    (b) => b.id && Math.abs(b.x) < 1e-9 && Math.abs(b.z - FOOT_SPOT.z) < 1e-9,
  );
  assert(apex && apex.id !== 8);
  const corners = balls.filter(
    (b) =>
      Math.abs(b.z - (FOOT_SPOT.z - 4 * row)) < 1e-9 &&
      Math.abs(Math.abs(b.x) - 2 * spacing) < 1e-9,
  );
  assert.equal(corners.length, 2);
  assert.deepEqual(corners.map((b) => groupOf(b.id)).sort(), [
    "solids",
    "stripes",
  ]);
  assert.deepEqual(eightRack(7), balls);
  assert(
    [1, 2, 3, 4, 5].some(
      (seed) => JSON.stringify(eightRack(seed)) !== JSON.stringify(balls),
    ),
  );
  for (const a of balls)
    for (const b of balls)
      if (a.id < b.id)
        assert(Math.hypot(a.x - b.x, a.z - b.z) > POOL.radius * 2);
  assert(balls[0].z > HEAD_STRING);
});

test("eight-ball break: ball in hand behind the head string; an illegal break is a foul and the opponent re-breaks a new rack", () => {
  const g = eight();
  assert.equal(g.state.phase, "placing");
  assert.equal(g.state.ballInHand, "kitchen");
  assert.equal(g.state.opening, true);
  assert.throws(() => g.shoot("a", 0, 1, g.state.revision));
  assert.throws(() => g.place("b", 0, 1.5, g.state.revision));
  assert.throws(() => g.place("a", 0, 0.5, g.state.revision), /cabeceira/);
  g.place("a", 0, 1.5, g.state.revision);
  assert.equal(g.state.phase, "aiming");
  const before = g.state.revision;
  const s = run(g, 0, 0.2);
  assert.match(s.message, /Abertura ilegal/);
  assert.deepEqual(s.fouls, [1, 0]);
  assert.equal(s.turn, 1);
  assert.equal(s.breaker, 1);
  assert.equal(s.phase, "placing");
  assert.equal(s.ballInHand, "kitchen");
  assert.equal(s.opening, true);
  assert(s.revision > before);
  assert(s.balls.every((b) => !b.sunk));
});

test("eight-ball break: four balls to the cushions is legal; a pot keeps the breaker shooting; the table stays open", () => {
  const rails = eight(2);
  rails.place("a", 0, 1.5, rails.state.revision);
  const r = run(rails, 0, 0.8);
  assert.match(r.message, /Abertura válida/);
  assert(!r.balls.some((b) => b.sunk));
  assert.equal(r.turn, 1);
  assert.equal(r.phase, "aiming");
  assert.deepEqual(r.groups, [null, null]);
  const potting = eight(1);
  potting.place("a", 0, 1.5, potting.state.revision);
  const p = run(potting, 0, 1);
  assert(p.balls.some((b) => b.id && b.sunk));
  assert.equal(p.turn, 0);
  assert.deepEqual(p.groups, [null, null]);
  assert.equal(p.opening, false);
});

test("eight-ball break: scratch gives ball in hand in the kitchen; the 8 potted on the break is respotted", () => {
  const scratch = scenario(
    {
      0: SIDE.cue,
      3: SIDE.ball,
      1: [0, -1],
      2: [0.3, -1.2],
      4: [-0.3, -1.6],
      8: [0, -1.4],
    },
    { opening: true },
  );
  const s = run(scratch, RIGHT, 0.3, 1);
  assert.equal(s.balls[3].sunk, true, "pocketed balls stay down");
  assert.equal(s.phase, "placing");
  assert.equal(s.ballInHand, "kitchen");
  assert.equal(s.turn, 1);
  assert.deepEqual(s.fouls, [1, 0]);
  assert.deepEqual(s.groups, [null, null]);
  assert.throws(() => scratch.place("b", 0.4, 0.2, s.revision), /cabeceira/);
  scratch.place("b", 0.4, HEAD_STRING + 0.2, s.revision);

  const spotted = run(
    scenario({ 0: SIDE.cue, 8: SIDE.ball, 1: [0.5, -1] }, { opening: true }),
    RIGHT,
    0.18,
  );
  assert.equal(spotted.balls[8].sunk, false);
  assert.deepEqual(
    [spotted.balls[8].x, spotted.balls[8].z],
    [0, FOOT_SPOT.z],
  );
  assert.equal(spotted.turn, 0, "breaker continues");
  assert.equal(spotted.phase, "aiming");
  const behind = run(
    scenario(
      { 0: SIDE.cue, 8: SIDE.ball, 1: [0, FOOT_SPOT.z] },
      { opening: true },
    ),
    RIGHT,
    0.18,
  );
  assert.equal(behind.balls[8].x, 0);
  assert(behind.balls[8].z < FOOT_SPOT.z - POOL.radius * 2);
  const both = run(
    scenario({ 0: SIDE.cue, 8: SIDE.ball, 1: [0, -1] }, { opening: true }),
    RIGHT,
    0.3,
    1,
  );
  assert.equal(both.balls[8].sunk, false);
  assert.equal(both.phase, "placing");
  assert.equal(both.ballInHand, "kitchen");
  assert.equal(both.turn, 1);
});

test("eight-ball groups: the first legal pot after the break assigns groups and only own pots keep the turn", () => {
  const g = scenario({
    0: SIDE.cue,
    11: SIDE.ball,
    12: [0.6, 1.4],
    2: [-0.5, -1],
    8: [0, -1.5],
  });
  const s = run(g, RIGHT, 0.18);
  assert.deepEqual(s.groups, ["stripes", "solids"]);
  assert.equal(s.turn, 0);
  assert.deepEqual(s.scores, [6, 6], "pocketed balls of each group (setup pockets the rest)");
  assert.deepEqual(legalTargets(s), [12]);
  assert.deepEqual(legalTargets(s, 1), [2]);
  const opponentOnly = run(
    scenario(
      { 0: [0.2, 0], 2: [0.6, 0], 11: SIDE.ball, 8: [0, -1.5], 3: [-0.5, 1] },
      { groups: ["solids", "stripes"] },
    ),
    RIGHT,
    0.3,
  );
  assert.equal(opponentOnly.balls[11].sunk, true);
  assert.equal(opponentOnly.turn, 1);
  assert.equal(opponentOnly.phase, "aiming");
  assert.deepEqual(opponentOnly.fouls, [0, 0]);
  const miss = run(
    scenario(
      { 0: [0, 0.5], 2: [0, -0.3], 8: [0.5, -1.5], 11: [-0.5, -1.5] },
      { groups: ["solids", "stripes"] },
    ),
    0,
    0.3,
  );
  assert.equal(miss.turn, 1);
  assert.match(miss.message, /Troca de turno/);
});

test("eight-ball fouls: wrong first ball, 8 first on an open table, no contact, no cushion and scratch give ball in hand anywhere", () => {
  const groups: (PoolGroup | null)[] = ["solids", "stripes"];
  const wrong = run(
    scenario(
      { 0: SIDE.cue, 11: SIDE.ball, 2: [-0.5, -1], 8: [0, -1.5] },
      { groups },
    ),
    RIGHT,
    0.18,
  );
  assert.match(wrong.message, /primeira bola tocada/);
  assert.equal(wrong.balls[11].sunk, true, "balls pocketed on a foul stay down");
  assert.equal(wrong.phase, "placing");
  assert.equal(wrong.ballInHand, "table");
  assert.equal(wrong.turn, 1);
  assert.deepEqual(wrong.fouls, [1, 0]);
  const eightFirst = run(
    scenario({ 0: [0.2, 0], 8: [0.6, 0], 2: [-0.5, -1], 11: [-0.5, 1] }),
    RIGHT,
    0.1,
  );
  assert.match(eightFirst.message, /bola 8 não pode/);
  assert.equal(eightFirst.phase, "placing");
  const none = run(
    scenario({ 0: [0, 1.5], 2: [0, -1], 8: [0, -1.5] }, { groups }),
    Math.PI,
    0.1,
  );
  assert.match(none.message, /não tocou nenhuma bola/);
  const cushion = run(
    scenario(
      { 0: [0, 0], 2: [0, -0.3], 8: [0, -1.5], 11: [0.5, -1.5] },
      { groups },
    ),
    0,
    0.08,
  );
  assert.match(cushion.message, /tabela/);
  assert.equal(cushion.ballInHand, "table");
  const scratch = scenario(
    { 0: [1, 0], 2: [-0.5, -1], 8: [0, -1.5] },
    { groups },
  );
  const s = run(scratch, RIGHT, 0.2);
  assert.match(s.message, /branca caiu/);
  assert.equal(s.balls[0].sunk, false);
  assert.equal(s.phase, "placing");
  // Ball in hand anywhere: past the head string too, never on a ball or pocket.
  assert.throws(() => scratch.place("b", -0.5, -1, s.revision));
  assert.throws(() => scratch.place("b", POOL.halfX - 0.1, 0, s.revision));
  assert.throws(() => scratch.place("a", 0.3, -0.5, s.revision));
  scratch.place("b", 0.3, -0.5, s.revision);
  assert.equal(scratch.state.phase, "aiming");
  assert.equal(scratch.state.turn, 1);
});

test("eight-ball end: early 8, 8 with scratch and 8 in another pocket lose; the called 8 after the group wins", () => {
  const early = run(
    scenario(
      { 0: SIDE.cue, 8: SIDE.ball, 2: [-0.5, -1] },
      { groups: ["solids", "stripes"] },
    ),
    RIGHT,
    0.18,
  );
  assert.equal(early.phase, "finished");
  assert.equal(early.winner, "b");
  assert.match(early.message, /antes de terminar/);
  const onTheEight = () =>
    scenario(
      { 0: SIDE.cue, 8: SIDE.ball, 11: [0.5, -1.5] },
      { groups: ["solids", "stripes"] },
    );
  const g = onTheEight();
  assert(onEight(g.state));
  assert.throws(() => g.shoot("a", RIGHT, 0.18, g.state.revision), /Anuncie/);
  assert.throws(() => g.call("b", 4, g.state.revision));
  assert.throws(() => g.call("a", 6, g.state.revision));
  assert.throws(() => g.call("a", 4, g.state.revision - 1));
  g.call("a", 4, g.state.revision);
  assert.equal(g.state.called, 4);
  const win = run(g, RIGHT, 0.18);
  assert.equal(win.phase, "finished");
  assert.equal(win.winner, "a");
  assert.match(win.message, /Vitória/);
  const wrongPocket = onTheEight();
  wrongPocket.call("a", 1, wrongPocket.state.revision);
  const w = run(wrongPocket, RIGHT, 0.18);
  assert.equal(w.winner, "b");
  assert.match(w.message, /diferente da anunciada/);
  const scratch = onTheEight();
  scratch.call("a", 4, scratch.state.revision);
  const sc = run(scratch, RIGHT, 0.3, 1);
  assert.equal(sc.winner, "b");
  assert.match(sc.message, /branca caiu/);
  const missFoul = scenario(
    { 0: [0, 1.5], 8: [0, -1], 11: [0.5, -1.5] },
    { groups: ["solids", "stripes"], called: 0 },
  );
  const mf = run(missFoul, Math.PI, 0.1);
  assert.equal(mf.phase, "placing", "a foul on the 8 without potting it is not a loss");
  assert.equal(mf.called, undefined);
  const notNeeded = scenario(
    { 0: SIDE.cue, 2: SIDE.ball, 8: [0, -1.5] },
    { groups: ["solids", "stripes"] },
  );
  assert.throws(
    () => notNeeded.call("a", 4, notNeeded.state.revision),
    /só é anunciada/,
  );
});

test("pool modes: chosen before/after a match, kept by rematch with the breaker alternating", () => {
  const g = new PoolGame();
  g.join("a", "eight");
  assert.equal(g.state.mode, "eight");
  assert.equal(g.state.phase, "waiting");
  assert.throws(() => g.setMode("x", "rotation"), /Entre na mesa/);
  g.setMode("a", "rotation");
  assert.equal(g.state.mode, "rotation");
  g.setMode("a", "eight");
  g.join("b");
  assert.equal(g.state.phase, "placing");
  assert.equal(g.state.turn, 0);
  assert.throws(() => g.setMode("a", "rotation"), /antes ou depois/);
  assert.throws(() => g.restart("a"));
  g.state.phase = "finished";
  g.state.winner = "a";
  g.restart("b");
  assert.equal(g.state.mode, "eight");
  assert.equal(g.state.breaker, 1);
  assert.equal(g.state.turn, 1);
  assert.equal(g.state.phase, "placing");
  assert.deepEqual(g.state.fouls, [0, 0]);
  assert.deepEqual(g.state.groups, [null, null]);
  g.state.phase = "finished";
  g.restart("a");
  assert.equal(g.state.breaker, 0);
  g.state.phase = "finished";
  g.setMode("a", "rotation");
  assert.equal(g.state.mode, "rotation");
  assert.equal(g.state.phase, "aiming");
  assert.equal(g.state.turn, 1, "a mode change at the end is a rematch");
  g.state.phase = "finished";
  g.restart("a");
  assert.equal(g.state.mode, "rotation");
  assert.equal(g.state.turn, 0);
  const left = eight();
  left.leave("a");
  assert.equal(left.state.winner, "b");
  left.join("c");
  assert.equal(left.state.mode, "eight", "a new opponent keeps the mode");
});

test("cue ball spin: bounded follow/draw is deterministic and validated", () => {
  const position = (spin: number) =>
    run(
      scenario(
        { 0: [0, 0.5], 2: [0, -0.3], 8: [0.5, -1.5], 11: [-0.5, -1.5] },
        { groups: ["solids", "stripes"] },
      ),
      0,
      0.3,
      spin,
    ).balls;
  const draw = position(-1),
    stun = position(0),
    follow = position(1);
  assert(draw[0].z > 0.9, "draw brings the cue ball back");
  assert(Math.abs(stun[0].z + 0.13) < 0.05, "no spin stops near contact");
  assert(follow[0].z < -0.6, "follow carries it forward");
  assert.deepEqual(position(0.6), position(0.6));
  const g = scenario({ 0: [0, 0.5], 2: [0, -0.3], 8: [0, -1.5] });
  assert.throws(() => g.shoot("a", 0, 0.5, g.state.revision, 1.5));
  for (const c of [
    { type: "pool.shoot", angle: 0, power: 0.5, revision: 0, spin: 2 },
    { type: "pool.call", pocket: 6, revision: 0 },
    { type: "pool.call", pocket: 1.5, revision: 0 },
    { type: "pool.mode", mode: "nine" },
    { type: "pool.join", mode: "snooker" },
  ])
    assert(!commandSchema.safeParse(c).success, JSON.stringify(c));
  for (const c of [
    { type: "pool.shoot", angle: 0, power: 0.5, revision: 0, spin: -0.4 },
    { type: "pool.call", pocket: 5, revision: 3 },
    { type: "pool.mode", mode: "eight" },
    { type: "pool.join", mode: "eight" },
    { type: "pool.join" },
  ])
    assert(commandSchema.safeParse(c).success, JSON.stringify(c));
});

test("complete simulated Eight-Ball matches end with a legal winner on the host model", () => {
  for (const seed of [1, 4, 9]) {
    const { state, shots } = playEightMatch(seed);
    assert.equal(state.phase, "finished");
    assert(state.winner && state.players.includes(state.winner));
    assert(shots.length >= 2);
    if (/Vitória!/.test(state.message)) {
      const winner = state.players.indexOf(state.winner!),
        group = state.groups![winner]!;
      assert(state.balls.every((b) => groupOf(b.id) !== group || b.sunk));
      assert(state.balls[8].sunk);
    }
  }
});

test("host accepts Eight-Ball mode, kitchen placement and rejects illegal calls from real socket clients", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-pool8-")),
    store = await Store.open(join(dir, "room.sqlite"));
  store.createServer("Bola 8", randomUUID());
  const channel = store.snapshot().channels.find((c) => c.kind === "voice")!;
  const host = new RoomHost(store, "f".repeat(64), "owner"),
    port = await host.listen("127.0.0.1", 0),
    sockets: Socket[] = [];
  const command = async (i: number, c: Command) =>
    (await sockets[i].timeout(3000).emitWithAck("command", c)) as Reply;
  try {
    for (let i = 0; i < 3; i++) {
      const socket = io(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        reconnection: false,
        auth: {
          protocol: 2,
          token: "f".repeat(64),
          ownerKey: i === 0 ? "owner" : undefined,
          profile: { id: randomUUID(), name: `Oito ${i}`, avatar: "8" },
        },
      });
      sockets.push(socket);
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
    for (let i = 0; i < 3; i++) {
      assert((await command(i, { type: "voice", channelId: channel.id })).ok);
      assert(
        (
          await command(i, {
            type: "room.pose",
            pose: { ...spawnPose(), x: 5 + i * 2, z: 6.7 },
          })
        ).ok,
      );
    }
    assert((await command(0, { type: "pool.join", mode: "eight" })).ok);
    assert.equal(host.state().poolGames![channel.id].mode, "eight");
    assert.equal((await command(2, { type: "pool.mode", mode: "rotation" })).ok, false);
    assert((await command(1, { type: "pool.join" })).ok);
    const s = host.state().poolGames![channel.id];
    assert.equal(s.phase, "placing");
    assert.equal(s.balls.length, 16);
    assert.equal((await command(0, { type: "pool.mode", mode: "rotation" })).ok, false);
    const breaker = sockets.findIndex(
      (socket) => socket.id === s.players[s.turn],
    );
    assert.equal(
      (await command(breaker, { type: "pool.place", x: 0, z: 0, revision: s.revision })).ok,
      false,
    );
    assert.equal(
      (await command(1 - breaker, { type: "pool.place", x: 0, z: 1.5, revision: s.revision })).ok,
      false,
    );
    assert(
      (await command(breaker, { type: "pool.place", x: 0, z: 1.5, revision: s.revision })).ok,
    );
    const placed = host.state().poolGames![channel.id];
    assert.equal(placed.phase, "aiming");
    const call = await command(breaker, {
      type: "pool.call",
      pocket: 2,
      revision: placed.revision,
    });
    assert.equal(call.ok, false);
    assert.equal(
      (
        await sockets[breaker]
          .timeout(3000)
          .emitWithAck("command", { type: "pool.call", pocket: 9, revision: 0 })
      ).ok,
      false,
    );
  } finally {
    for (const s of sockets) s.disconnect();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
