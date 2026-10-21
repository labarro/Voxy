import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  randomUUID,
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import { DirectInbox } from "../src/main/directInbox";
import { deviceCredential } from "../src/main/deviceIdentity";
import { profileSchema, commandSchema } from "../src/shared/validation";
import { unreadTotal } from "../src/renderer/directThreads";
import type { DirectSnapshot, RoomState, Reply } from "../src/shared/types";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPboAAAAASUVORK5CYII=";
async function until(fn: () => boolean) {
  const end = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > end) throw Error("Timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}
const scope = (id: string, token: string) =>
  createHash("sha256")
    .update(id + ":" + token)
    .digest("hex");

test("presença valida opções e perfis antigos recebem Online", () => {
  const profile = {
    id: randomUUID(),
    name: "Amigo",
    avatar: "👴",
    input: "",
    output: "",
  };
  assert.equal(profileSchema.parse(profile).presence, "online");
  for (const presence of ["online", "away", "busy"])
    assert.equal(
      profileSchema.parse({ ...profile, presence }).presence,
      presence,
    );
  assert(
    !profileSchema.safeParse({ ...profile, presence: "invisible" }).success,
  );
  assert(
    !commandSchema.safeParse({
      type: "profile",
      name: "Amigo",
      avatar: "👴",
      presence: "offline",
    }).success,
  );
});

test("DM: entrega privada, presença remota, imagens com ACL, autoria e identidade vinculada", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-direct-")),
    token = randomBytes(32).toString("hex"),
    profiles = [0, 1, 2].map((i) => ({
      id: randomUUID(),
      name: "Pessoa " + i,
      avatar: "👴",
      presence: "online",
    })),
    keys = profiles.map(() => randomBytes(32).toString("hex"));
  let store = await Store.open(join(dir, "room.sqlite")),
    host = new RoomHost(store, token, "owner");
  let port = await host.listen("127.0.0.1", 0);
  const clients: Socket[] = [],
    states: RoomState[] = [],
    direct: DirectSnapshot[] = [],
    thirdPackets: string[] = [];
  async function connect(i: number, key: string | null = keys[i]) {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      autoConnect: false,
      reconnection: false,
      auth: {
        protocol: 2,
        token,
        profile: profiles[i],
        identityKey: key ?? undefined,
      },
    });
    clients.push(socket);
    socket.on("state", (s) => {
      states[i] = s;
      if (i === 2) thirdPackets.push(JSON.stringify(s));
    });
    socket.on("direct", (s) => {
      direct[i] = s;
      if (i === 2) thirdPackets.push(JSON.stringify(s));
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
      socket.connect();
    });
    return socket;
  }
  try {
    store.createServer("Amigos", profiles[0].id);
    const a = await connect(0),
      b = await connect(1),
      c = await connect(2);
    await until(
      () => direct.every((x) => x.contacts.length === 2) && direct.length === 3,
    );
    assert(
      (
        (await a.emitWithAck("command", {
          type: "profile",
          name: profiles[0].name,
          avatar: "👴",
          presence: "busy",
        })) as Reply
      ).ok,
    );
    await until(
      () =>
        states[1].participants.find((p) => p.profile.id === profiles[0].id)
          ?.profile.presence === "busy",
    );
    assert(
      (
        (await a.emitWithAck("command", {
          type: "direct.message",
          scope: scope(profiles[0].id, token),
          recipient: profiles[1].id,
          text: "segredo-que-nao-pode-ir-ao-terceiro",
          image: png,
        })) as Reply
      ).ok,
    );
    await until(() => direct[1].messages.length === 1);
    const message = direct[1].messages[0];
    assert.equal(direct[0].messages.length, 1);
    assert.equal(direct[2].messages.length, 0);
    assert(
      thirdPackets.every(
        (packet) => !packet.includes("segredo-que-nao-pode-ir-ao-terceiro"),
      ),
    );
    assert(
      ((await b.emitWithAck("direct-image", message.imageId)) as Reply).ok,
    );
    assert(
      !((await c.emitWithAck("direct-image", message.imageId)) as Reply).ok,
    );
    assert(!((await c.emitWithAck("image", message.imageId)) as Reply).ok);
    assert(
      !(
        (await c.emitWithAck("command", {
          type: "direct.edit",
          scope: scope(profiles[2].id, token),
          id: message.id,
          text: "roubada",
        })) as Reply
      ).ok,
    );
    assert(
      !(
        (await a.emitWithAck("command", {
          type: "direct.message",
          scope: "0".repeat(64),
          recipient: profiles[1].id,
          text: "sala errada",
        })) as Reply
      ).ok,
    );
    b.disconnect();
    await until(
      () =>
        !states[0].participants.some((p) => p.profile.id === profiles[1].id),
    );
    await assert.rejects(connect(1, "a".repeat(64)), /outro dispositivo/);
    await assert.rejects(connect(1, null), /outro dispositivo/);
    const restored = await connect(1);
    await until(() => direct[1].messages.length === 1);
    assert(restored.connected);
    assert(
      (
        (await a.emitWithAck("command", {
          type: "direct.edit",
          scope: scope(profiles[0].id, token),
          id: message.id,
          text: "Mensagem corrigida",
        })) as Reply
      ).ok,
    );
    await until(() => direct[1].messages[0]?.text === "Mensagem corrigida");
    assert.equal(direct[2].messages.length, 0);
    for (const socket of clients) socket.disconnect();
    await host.close();
    store.close();
    store = await Store.open(join(dir, "room.sqlite"));
    host = new RoomHost(store, token, "owner");
    port = await host.listen("127.0.0.1", 0);
    assert.throws(
      () =>
        store.direct.authorize(
          profiles[1].id,
          createHash("sha256").update(token).digest("hex"),
        ),
      /outro dispositivo/,
    );
    const again = await connect(0);
    await until(() => direct[0].messages[0]?.text === "Mensagem corrigida");
    assert(
      (
        (await again.emitWithAck("command", {
          type: "direct.delete",
          scope: scope(profiles[0].id, token),
          id: message.id,
        })) as Reply
      ).ok,
    );
    await until(() => direct[0].messages.length === 0);
    assert.throws(() => store.direct.image(message.imageId!, profiles[0].id));
    const bytes = await readFile(join(dir, "room.sqlite"));
    assert(!bytes.includes(Buffer.from(keys[1])));
  } finally {
    for (const socket of clients) socket.disconnect();
    await host.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("inbox preserva histórico offline, leitura por sala e perfil e rejeita dados de terceiros", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-inbox-")),
    path = join(dir, "direct-inbox.json"),
    owner = randomUUID(),
    peer = randomUUID(),
    other = randomUUID(),
    scope1 = "a".repeat(64),
    scope2 = "b".repeat(64);
  try {
    let inbox = new DirectInbox(path, owner);
    const first = {
      id: randomUUID(),
      sequence: 1,
      author: peer,
      recipient: owner,
      name: "Amigo",
      avatar: "👴",
      text: "Oi",
      time: Date.now(),
    };
    const snap: DirectSnapshot = {
      contacts: [
        { id: peer, name: "Amigo", avatar: "👴", directEnabled: true },
      ],
      messages: [first],
      avatars: {},
    };
    inbox.receive(scope1, "Sala A", snap);
    inbox.receive(scope2, "Sala B", snap);
    assert.equal(unreadTotal(inbox.view(), owner), 2);
    inbox.markRead(scope1, peer, 1);
    assert.equal(unreadTotal(inbox.view(), owner), 1);
    assert.throws(() => inbox.markRead(scope1, peer, 2));
    inbox = new DirectInbox(path, owner);
    assert.equal(inbox.view().rooms.length, 2);
    assert.equal(inbox.activeScope, undefined);
    assert.equal(unreadTotal(inbox.view(), owner), 1);
    inbox.receive(scope1, "Sala A", { ...snap, messages: [] });
    assert.equal(
      inbox.view().rooms.find((r) => r.scope === scope1)?.messages.length,
      0,
    );
    assert.throws(() =>
      inbox.receive(scope1, "Sala A", {
        ...snap,
        messages: [{ ...first, author: other, recipient: peer }],
      }),
    );
    assert.equal(new DirectInbox(path, other).view().rooms.length, 0);
    await writeFile(path, "{broken");
    assert.equal(new DirectInbox(path, owner).view().rooms.length, 0);
    assert((await readdir(dir)).some((p) => p.includes(".corrupt-")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("identidade local é protegida, estável após reinício e diferente por sala", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-identity-")),
    path = join(dir, "identity.bin"),
    owner = randomUUID(),
    key = randomBytes(32);
  const vault = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, c.update(text), c.final(), c.getAuthTag()]);
    },
    decryptString: (value: Buffer) => {
      const d = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      d.setAuthTag(value.subarray(-16));
      return Buffer.concat([
        d.update(value.subarray(12, -16)),
        d.final(),
      ]).toString();
    },
  };
  try {
    const first = deviceCredential(path, vault, owner, "a".repeat(64));
    assert.equal(first, deviceCredential(path, vault, owner, "a".repeat(64)));
    assert.notEqual(
      first,
      deviceCredential(path, vault, owner, "b".repeat(64)),
    );
    assert(!(await readFile(path)).includes(Buffer.from(first)));
    assert.throws(() =>
      deviceCredential(
        path,
        { ...vault, isEncryptionAvailable: () => false },
        owner,
        "a",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
