import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import {
  parseInvite,
  privateIPv4,
  commandSchema,
  roomIPv4,
} from "../src/shared/validation";
import { roomAddresses } from "../src/main/addresses";
import type { NetworkInterfaceInfo } from "node:os";
import type { RoomState, Reply, Command } from "../src/shared/types";
const token = "a".repeat(64),
  ownerKey = "host-key";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("convites aceitam somente IPv4 privado e segredo forte", () => {
  for (const ip of [
    "127.0.0.1",
    "100.64.1.2",
    "100.127.255.254",
    "192.168.2.4",
    "10.0.0.4",
    "172.16.0.2",
  ])
    assert(privateIPv4(ip));
  for (const ip of [
    "0.0.0.0",
    "8.8.8.8",
    "100.128.0.1",
    "192.169.1.1",
    "localhost",
    "::1",
    "127.00.0.1",
    "999.1.1.1",
  ])
    assert(!privateIPv4(ip));
  assert.equal(parseInvite(`voxy://100.64.1.2:43120/${token}`).port, 43120);
  assert.equal(
    parseInvite(`voxy://26.12.34.56:43120/${token}`).address,
    "26.12.34.56",
  );
  assert(!privateIPv4("26.12.34.56"));
  for (const ip of ["26.0.0.1", "26.255.255.254"]) assert(roomIPv4(ip));
  for (const ip of ["26.256.1.2", "26.01.2.3", "26.1.2", "27.1.2.3"])
    assert(!roomIPv4(ip));
  const iface = (address: string) =>
    ({
      address,
      family: "IPv4",
      internal: false,
      netmask: "255.0.0.0",
      mac: "00:00:00:00:00:00",
      cidr: address + "/8",
    }) as NetworkInterfaceInfo;
  assert.deepEqual(
    roomAddresses({
      Ethernet: [iface("26.9.8.7")],
      "Radmin VPN": [iface("26.1.2.3")],
      LAN: [iface("192.168.1.2")],
    }),
    ["26.1.2.3", "127.0.0.1", "192.168.1.2"],
  );
  for (const invite of [
    `http://127.0.0.1:43120/${token}`,
    `voxy://8.8.8.8:43120/${token}`,
    `voxy://127.0.0.1:43120/short`,
    `voxy://x:y@127.0.0.1:43120/${token}`,
  ])
    assert.throws(() => parseInvite(invite));
  assert(
    !commandSchema.safeParse({
      type: "message",
      channelId: "x",
      text: " ".repeat(4),
    }).success,
  );
});
test("dez sessões, décima primeira rejeitada; imagens, canais e persistência", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-test-"));
  let store = await Store.open(join(dir, "room.sqlite"));
  const serverId = store.createServer("Amigos");
  const host = new RoomHost(store, token, ownerKey);
  const port = await host.listen("127.0.0.1", 0);
  const clients: Socket[] = [];
  const states = new Map<Socket, RoomState>();
  async function connect(secret = token, owner = false) {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      auth: {
        token: secret,
        ownerKey: owner ? ownerKey : undefined,
        profile: {
          id: randomUUID(),
          name: "Pessoa " + clients.length,
          avatar: "🪐",
          input: "",
          output: "",
        },
      },
    });
    clients.push(socket);
    socket.on("state", (s) => states.set(socket, s));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  async function command(s: Socket, c: Command) {
    return (await s.timeout(3000).emitWithAck("command", c)) as Reply;
  }
  async function state(s: Socket, predicate: (s: RoomState) => boolean) {
    for (let n = 0; n < 100; n++) {
      const value = states.get(s);
      if (value && predicate(value)) return value;
      await delay(20);
    }
    throw Error("Estado não recebido");
  }
  try {
    await assert.rejects(connect("wrong"));
    const a = await connect(token, true),
      b = await connect(),
      c = await connect();
    const d = await connect(),
      e = await connect();
    const extras: Socket[] = [];
    for (let i = 0; i < 5; i++) extras.push(await connect());
    await state(extras[4], (s) => s.participants.length === 10);
    await assert.rejects(connect());
    d.disconnect();
    e.disconnect();
    extras.forEach((s) => s.disconnect());
    const initial = await state(c, (s) => s.participants.length === 3),
      voice = initial.channels.find((c) => c.kind === "voice")!,
      text = initial.channels.find((c) => c.kind === "text")!;
    assert.equal(
      (await command(b, { type: "server.create", name: "Não permitido" })).ok,
      false,
    );
    assert.equal(
      (
        await command(a, {
          type: "channel.create",
          serverId,
          name: "Outra voz",
          kind: "voice",
        })
      ).ok,
      true,
    );
    const s = await state(c, (s) => s.channels.length === 3),
      other = s.channels.find((c) => c.name === "Outra voz")!;
    for (const client of [a, b])
      assert(
        (await command(client, { type: "voice", channelId: voice.id })).ok,
      );
    await command(c, { type: "voice", channelId: other.id });
    let received = 0;
    b.on("signal", () => received++);
    assert(
      (
        await a.timeout(3000).emitWithAck("signal", {
          to: b.id,
          description: { type: "offer", sdp: "test" },
        })
      ).ok,
    );
    await delay(50);
    assert.equal(received, 1);
    assert.equal(
      (
        await a.timeout(3000).emitWithAck("signal", {
          to: c.id,
          description: { type: "offer", sdp: "test" },
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await a.timeout(3000).emitWithAck("signal", {
          to: b.id,
          from: c.id,
          candidate: { candidate: "x".repeat(5000) },
        })
      ).ok,
      false,
    );
    await command(c, { type: "voice", channelId: voice.id });
    await command(a, {
      type: "status",
      muted: true,
      deafened: false,
      sharing: true,
    });
    await state(
      b,
      (s) =>
        s.participants.filter((p) => p.channelId === voice.id).length === 3 &&
        s.participants.some((p) => p.id === a.id && p.sharing && p.muted),
    );
    await command(b, {
      type: "message",
      channelId: text.id,
      text: "Olá <script> texto literal",
    });
    await state(c, (s) => s.messages.length === 1);
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPboAAAAASUVORK5CYII=";
    assert(
      (
        await command(b, {
          type: "profile",
          name: "Velho",
          avatar: "x",
        })
      ).ok,
    );
    assert(
      (
        await command(b, {
          type: "message",
          channelId: text.id,
          text: "",
          image,
        })
      ).ok,
    );
    const imageState = await state(c, (s) => s.messages.length === 2);
    const picture = imageState.messages[1];
    assert(picture.imageId);
    assert(!JSON.stringify(imageState).includes("base64"));
    const fetched = await c.timeout(3000).emitWithAck("image", picture.imageId);
    assert.equal(fetched.value, image);
    assert.equal(
      (
        await command(b, {
          type: "message",
          channelId: text.id,
          text: "",
          image,
        })
      ).ok,
      false,
    );
    await command(a, {
      type: "channel.rename",
      id: voice.id,
      name: "Voz nova",
    });
    await state(b, (s) => s.channels.some((c) => c.name === "Voz nova"));
    for (let n = 0; n < 8; n++) {
      await command(c, { type: "voice", channelId: null });
      await command(c, { type: "voice", channelId: voice.id });
    }
    await command(a, { type: "channel.delete", id: voice.id });
    await state(b, (s) => s.participants.every((p) => p.channelId === null));
    c.disconnect();
    await state(b, (s) => s.participants.length === 2);
    await host.close();
    store.close();
    store = await Store.open(join(dir, "room.sqlite"));
    assert.equal(
      store.snapshot().messages[0].text,
      "Olá <script> texto literal",
    );
    assert.equal(store.snapshot().channels.length, 2);
    assert.equal(store.image(picture.imageId!), image);
    assert.throws(() =>
      store.createChannel("inexistente", "Inválido", "voice"),
    );
    store.delete("servers", serverId);
    assert.equal(store.snapshot().channels.length, 0);
    assert.equal(store.snapshot().messages.length, 0);
    assert.throws(() => store.image(picture.imageId!));
  } finally {
    clients.forEach((c) => c.disconnect());
    await host.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
