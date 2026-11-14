import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import { commandSchema } from "../src/shared/validation";
import { tableSeat } from "../src/shared/gameTables";
import { spawnPose } from "../src/shared/room3d";
import { cardId } from "../src/shared/truco";
import { walkPath, clearWalk } from "../src/shared/navigation";
import type { Command, Reply, SocialGamesView } from "../src/shared/types";
const until = async (fn: () => boolean) => {
  const end = Date.now() + 7000;
  while (!fn()) {
    if (Date.now() > end) throw Error("Game synchronization timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};
test("pool approach paths escape cells rounded into the rail clearance without crossing the table", () => {
  for (const preset of ["lounge", "rooftop"] as const) {
    let previous = { x: 8.56, z: 3.6479685 };
    const route = walkPath(preset, previous, { x: 6.215625, z: 3.670302 });
    assert(route.length > 0);
    for (const point of route) {
      assert(clearWalk(preset, previous, point));
      previous = point;
    }
  }
});
test("game command discriminators preserve unrelated commands and reject cross-game payloads", () => {
  for (const c of [
    { type: "status", muted: false, deafened: false, sharing: false },
    {
      type: "game.act",
      game: "truco",
      revision: 1,
      action: { type: "play", index: 0 },
    },
    {
      type: "game.act",
      game: "chess",
      revision: 1,
      action: { type: "move", from: "a2", to: "a4" },
    },
  ])
    assert(commandSchema.safeParse(c).success);
  assert(
    !commandSchema.safeParse({
      type: "game.act",
      game: "truco",
      revision: 1,
      action: { type: "move", from: "a2", to: "a4" },
    }).success,
  );
});
test("four authenticated sockets receive private hands; spectators/channels cannot act, partner races serialize, reconnection preserves secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-games-")),
    store = await Store.open(join(dir, "room.sqlite"));
  store.createServer("Games", randomUUID());
  const channel = store.snapshot().channels.find((c) => c.kind === "voice")!,
    token = "a".repeat(64),
    host = new RoomHost(store, token, "owner"),
    port = await host.listen("127.0.0.1", 0),
    sockets: Socket[] = [],
    packets: SocialGamesView[][] = Array.from({ length: 6 }, () => []),
    ids = Array.from({ length: 6 }, () => randomUUID()),
    keys = ids.map(() => randomBytes(32).toString("hex"));
  const connect = async (i: number, key: string | undefined = keys[i]) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      auth: {
        protocol: 2,
        token,
        ownerKey: i === 0 ? "owner" : undefined,
        identityKey: key,
        profile: { id: ids[i], name: `Player ${i}`, avatar: "P" },
      },
    });
    socket.on("room-games", (e) => packets[i].push(e.games));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    sockets[i] = socket;
  };
  const command = async (i: number, c: Command) =>
    (await sockets[i].timeout(3000).emitWithAck("command", c)) as Reply;
  try {
    for (let i = 0; i < 6; i++) await connect(i);
    assert(
      (
        await command(0, {
          type: "channel.room",
          id: channel.id,
          preset: "lounge",
        })
      ).ok,
    );
    for (let i = 0; i < 5; i++) {
      assert((await command(i, { type: "voice", channelId: channel.id })).ok);
      const seat = tableSeat("truco", i % 4);
      assert(
        (
          await command(i, {
            type: "room.pose",
            pose: {
              ...spawnPose(),
              x: i < 4 ? seat.x + Math.cos(seat.yaw) * 0.78 : 10,
              z: i < 4 ? seat.z - Math.sin(seat.yaw) * 0.78 : 10,
            },
          })
        ).ok,
      );
      if (i < 4)
        assert(
          (await command(i, { type: "game.join", game: "truco", seat: i })).ok,
        );
    }
    await until(() => packets[0].at(-1)?.truco?.phase === "playing");
    const views = [0, 1, 2, 3].map((i) => packets[i].at(-1)!.truco!);
    assert.equal(
      new Set([
        ...views.flatMap((v) => v.hand.map((c) => cardId(c!))),
        cardId(views[0].vira!),
      ]).size,
      13,
    );
    for (const v of views) {
      assert.equal(v.hand.length, 3);
      assert.equal(v.partnerHand, undefined);
      assert(!JSON.stringify(v).includes('"hands"'));
    }
    assert.deepEqual(
      host.state(ids[4]).socialGames![channel.id].truco!.hand,
      [],
    );
    assert.equal(host.state(ids[5]).socialGames?.[channel.id], undefined);
    assert.equal(packets[5].length, 0);
    assert.equal(
      (
        await command(4, {
          type: "game.act",
          game: "truco",
          revision: views[0].revision,
          action: { type: "play", index: 0 },
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await command(1, {
          type: "game.act",
          game: "truco",
          revision: views[0].revision,
          action: { type: "play", index: 0 },
        })
      ).ok,
      false,
    );
    assert(
      (
        await command(0, {
          type: "game.act",
          game: "truco",
          revision: views[0].revision,
          action: { type: "raise" },
        })
      ).ok,
    );
    const revision = host.state(ids[1]).socialGames![channel.id].truco!
      .revision;
    const responses = await Promise.all(
      [1, 3].map((i) =>
        command(i, {
          type: "game.act",
          game: "truco",
          revision,
          action: { type: "accept" },
        }),
      ),
    );
    assert.equal(responses.filter((r) => r.ok).length, 1);
    const before = host.state(ids[0]).socialGames![channel.id].truco!;
    sockets[0].disconnect();
    await until(
      () => host.state(ids[1]).socialGames![channel.id].truco!.paused,
    );
    await assert.rejects(connect(0, "b".repeat(64)));
    await connect(0);
    assert((await command(0, { type: "voice", channelId: channel.id })).ok);
    assert((await command(0, { type: "room.pose", pose: spawnPose() })).ok);
    await until(
      () => !host.state(ids[0]).socialGames![channel.id].truco!.paused,
    );
    const after = host.state(ids[0]).socialGames![channel.id].truco!;
    assert.deepEqual(after.hand, before.hand);
    assert.equal(after.turn, before.turn);
    assert.equal(after.phase, "playing");
    assert.equal(
      host.state().participants.find((p) => p.profile.id === ids[0])?.roomPose
        ?.seat,
      "truco-0",
    );
    assert((await command(2, { type: "voice", channelId: null })).ok);
    assert.equal(host.state(ids[1]).socialGames![channel.id].truco!.winner, 1);
  } finally {
    for (const socket of sockets) socket?.disconnect();
    await host.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
