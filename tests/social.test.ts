import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import type { Command, Reply, RoomState } from "../src/shared/types";
test("amizades autenticadas, chamadas privadas com consentimento e histórico com ACL, respostas e reações", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-social-"));
  const store = await Store.open(join(dir, "room.sqlite"));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const server = store.createServer("Amigos", ids[0]);
  const token = "d".repeat(64),
    scope = (id: string) =>
      createHash("sha256")
        .update(id + ":" + token)
        .digest("hex");
  const host = new RoomHost(store, token, "owner");
  const port = await host.listen("127.0.0.1", 0);
  const sockets: Socket[] = [];
  const command = async (i: number, c: Command) =>
    (await sockets[i].timeout(3000).emitWithAck("command", c)) as Reply;
  try {
    for (let i = 0; i < 3; i++) {
      const socket = io(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        reconnection: false,
        auth: {
          protocol: 2,
          token,
          identityKey: String(i).repeat(64),
          profile: {
            id: ids[i],
            name: "Pessoa " + i,
            avatar: "A",
            mediaSubscriptions: true,
          },
        },
      });
      sockets.push(socket);
      await new Promise<void>((r, j) => {
        socket.once("connect", r);
        socket.once("connect_error", j);
      });
    }
    assert.equal(
      (await command(0, { type: "friend.request", memberId: ids[0] })).ok,
      false,
    );
    assert.equal(
      (await command(0, { type: "friend.request", memberId: randomUUID() })).ok,
      false,
    );
    assert.equal(
      (await command(0, { type: "friend.request", memberId: ids[1] })).ok,
      true,
    );
    assert.equal(
      (
        await command(0, {
          type: "friend.respond",
          memberId: ids[1],
          accept: true,
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await command(2, {
          type: "friend.respond",
          memberId: ids[0],
          accept: true,
        })
      ).ok,
      false,
    );
    assert.equal(host.state(ids[2]).friendships!.length, 0);
    assert.equal(
      (
        await command(1, {
          type: "friend.respond",
          memberId: ids[0],
          accept: false,
        })
      ).ok,
      true,
    );
    assert.equal(host.state(ids[0]).friendships!.length, 0);
    await command(0, { type: "friend.request", memberId: ids[1] });
    await command(1, {
      type: "friend.respond",
      memberId: ids[0],
      accept: true,
    });
    assert.equal(
      (await command(2, { type: "call.invite", memberId: ids[0] })).ok,
      false,
    );
    assert.equal(
      (await command(0, { type: "call.invite", memberId: ids[1] })).ok,
      true,
    );
    const call = host.state(ids[0]).calls![0];
    assert.equal(host.state(ids[2]).calls!.length, 0);
    assert.equal(
      (await command(0, { type: "voice", channelId: call.id })).ok,
      false,
    );
    assert.equal(
      (await command(2, { type: "call.respond", id: call.id, accept: true }))
        .ok,
      false,
    );
    await command(1, { type: "call.respond", id: call.id, accept: true });
    assert.equal(
      (await command(2, { type: "voice", channelId: call.id })).ok,
      false,
    );
    for (const i of [0, 1])
      assert.equal(
        (await command(i, { type: "voice", channelId: call.id })).ok,
        true,
      );
    assert(!host.state(ids[2]).channels.some((c) => c.id === call.id));
    await command(1, { type: "voice", channelId: null });
    assert.equal(host.state(ids[0]).calls!.length, 0);
    assert.equal(
      host.state(ids[0]).participants.find((p) => p.profile.id === ids[0])!
        .channelId,
      null,
    );
    const channel = store
      .snapshot()
      .channels.find((c) => c.serverId === server && c.kind === "text")!;
    // Identical timestamps exercise the stable cursor across a full page.
    for (let i = 0; i < 220; i++)
      store.message({
        id: randomUUID(),
        channelId: channel.id,
        author: ids[0],
        name: "Pessoa",
        avatar: "A",
        text: "Histórico " + i,
        time: 1000,
      });
    const recent = store.snapshot().messages;
    assert.equal(recent.length, 100);
    const previous = store.history({
      channelId: channel.id,
      before: recent[0].time,
      beforeId: recent[0].id,
    });
    assert.equal(previous.length, 100);
    assert(!previous.some((m) => recent.some((r) => r.id === m.id)));
    const oldest = store.history({
      channelId: channel.id,
      before: previous[0].time,
      beforeId: previous[0].id,
    });
    assert.equal(oldest.length, 20);
    const original = oldest[0];
    assert.equal(
      (
        await command(1, {
          type: "message",
          channelId: channel.id,
          text: "Resposta @{" + ids[0] + "}",
          replyTo: original.id,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await command(1, {
          type: "message.react",
          id: original.id,
          emoji: "👍",
        })
      ).ok,
      true,
    );
    assert.deepEqual(
      store.history({ channelId: channel.id, messageId: original.id })[0]
        .reactions,
      { "👍": [ids[1]] },
    );
    await command(1, { type: "message.react", id: original.id, emoji: "👍" });
    assert.deepEqual(
      store.history({ channelId: channel.id, messageId: original.id })[0]
        .reactions,
      {},
    );
    assert.equal(
      (
        await command(0, {
          type: "direct.message",
          scope: scope(ids[0]),
          recipient: ids[1],
          text: "Privada",
        })
      ).ok,
      true,
    );
    const dm = store.direct.snapshot(
      ids[0],
      createHash("sha256").update(token).digest("hex"),
    ).messages[0];
    assert.equal(
      (
        await command(2, {
          type: "direct.react",
          scope: scope(ids[2]),
          id: dm.id,
          emoji: "👍",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await command(2, {
          type: "direct.message",
          scope: scope(ids[2]),
          recipient: ids[1],
          text: "Intruso",
          replyTo: dm.id,
        })
      ).ok,
      false,
    );
    await command(1, {
      type: "direct.message",
      scope: scope(ids[1]),
      recipient: ids[0],
      text: "Resposta privada",
      replyTo: dm.id,
    });
    await command(1, {
      type: "direct.react",
      scope: scope(ids[1]),
      id: dm.id,
      emoji: "❤️",
    });
    const privateHistory = (await sockets[1]
      .timeout(3000)
      .emitWithAck("history", { scope: scope(ids[1]), peer: ids[0] })) as Reply<
      RoomState["messages"]
    >;
    assert(privateHistory.ok);
    assert.equal(privateHistory.value.length, 2);
    const forbidden = (await sockets[2]
      .timeout(3000)
      .emitWithAck("history", {
        scope: scope(ids[2]),
        peer: ids[0],
        messageId: dm.id,
      })) as Reply<RoomState["messages"]>;
    assert(forbidden.ok);
    assert.equal(forbidden.value.length, 0);
    await command(1, { type: "friend.remove", memberId: ids[0] });
    assert(!store.social.friends(ids[0], ids[1]));
  } finally {
    sockets.forEach((s) => s.disconnect());
    await host.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
