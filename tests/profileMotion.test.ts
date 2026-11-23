import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import { inspectGif, validateImage, GIF_LIMITS } from "../src/shared/image";
import {
  avatarMotionSchema,
  bannerSchema,
  avatarSchema,
  publicProfileSchema,
  commandSchema,
} from "../src/shared/validation";
import { friendEntries } from "../src/renderer/friends";
import type { Inbox, RoomState, Participant } from "../src/shared/types";

function gif(w: number, h: number, frames: number) {
  const enc = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = (i + f * 7) % 255;
      rgba[i * 4 + 1] = (i * 3) % 255;
      rgba[i * 4 + 2] = f * 20;
      rgba[i * 4 + 3] = 255;
    }
    const palette = quantize(rgba, 64);
    enc.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay: 50 });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}
const url = (b: Buffer) => "data:image/gif;base64," + b.toString("base64");

test("GIF: estrutura real, quadros, duração e limites de decodificação", () => {
  const animated = gif(64, 48, 5);
  const info = inspectGif(animated);
  assert.deepEqual(
    { w: info.width, h: info.height, frames: info.frames },
    { w: 64, h: 48, frames: 5 },
  );
  assert.equal(info.duration, 250);
  assert.equal(inspectGif(gif(8, 8, 1)).frames, 1);
  // Truncated, wrong magic, garbage after the header.
  assert.throws(() => inspectGif(animated.subarray(0, animated.length - 40)));
  assert.throws(() => inspectGif(Buffer.from("GIF87b" + "x".repeat(40))));
  assert.throws(() =>
    inspectGif(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64, 7)])),
  );
  // A frame that does not fit the logical screen is malformed.
  const bad = Buffer.from(animated);
  const at = bad.indexOf(0x2c, 13);
  bad.writeUInt16LE(60, at + 1); // left 60 + width 64 > 64
  assert.throws(() => inspectGif(bad));
  // Too many frames / decoded pixels: rejected before any decoder runs.
  assert.throws(() => inspectGif(gif(2, 2, GIF_LIMITS.maxFrames + 1)), /quadros/);
  assert.throws(() => inspectGif(gif(1200, 1200, 60)), /grande demais/);
});

test("GIF: esquemas de avatar animado e capa, sem abrir GIF em mensagens", () => {
  const small = url(gif(128, 128, 4));
  assert.equal(validateImage(small).format, "gif");
  assert(avatarMotionSchema.safeParse(small).success);
  assert(avatarMotionSchema.safeParse("").success);
  // Animated avatar must really be animated and within 256 px.
  assert(!avatarMotionSchema.safeParse(url(gif(64, 64, 1))).success);
  assert(!avatarMotionSchema.safeParse(url(gif(300, 300, 2))).success);
  assert(!avatarMotionSchema.safeParse("data:image/png;base64,AAAA").success);
  // Covers: GIF up to 960 × 360 and 1 MB.
  assert(bannerSchema.safeParse(url(gif(900, 340, 3))).success);
  assert(!bannerSchema.safeParse(url(gif(1000, 300, 2))).success);
  // Static avatar slot keeps its tight limit even for GIFs.
  assert(!avatarSchema.safeParse(url(gif(200, 200, 2))).success);
  // Chat images still accept only PNG, JPEG and WebP.
  assert(
    !commandSchema.safeParse({ type: "message", channelId: "c", text: "", image: small })
      .success,
  );
  const profile = publicProfileSchema.parse({
    id: randomUUID(),
    name: "Ana",
    avatar: "A",
    avatarMotion: small,
    animatedBanner: url(gif(600, 225, 3)),
    banner: "",
  });
  assert(profile.avatarMotion?.startsWith("data:image/gif"));
  assert(profile.animatedBanner?.startsWith("data:image/gif"));
});

test("GIF: host registra avatar animado e capa como referências e entrega sob demanda", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-gif-"));
  const store = await Store.open(join(dir, "room.sqlite"));
  store.createServer("Amigos", randomUUID());
  const host = new RoomHost(store, "a".repeat(64), "owner-key");
  const port = await host.listen("127.0.0.1", 0);
  const sockets: Socket[] = [];
  const motion = url(gif(128, 128, 6));
  const cover = url(gif(600, 225, 4));
  async function connect(name: string, profile: Record<string, unknown>) {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      auth: {
        protocol: 2,
        token: "a".repeat(64),
        identityKey: (name === "Ana" ? "b" : "c").repeat(64),
        profile: { id: randomUUID(), name, avatar: "A", ...profile },
      },
    });
    sockets.push(socket);
    let state: any;
    socket.on("state", (s) => (state = s));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return { socket, state: () => state };
  }
  try {
    await connect("Ana", { avatarMotion: motion, animatedBanner: cover, banner: "" });
    const b = await connect("Bruno", {});
    await new Promise((r) => setTimeout(r, 300));
    const ana = b
      .state()
      .participants.find((p: Participant) => p.profile.name === "Ana").profile;
    assert.match(ana.avatarMotion, /^avatar:[a-f0-9]{64}$/);
    assert.match(ana.banner, /^avatar:[a-f0-9]{64}$/);
    // The snapshot never carries the GIF bytes; only references.
    assert(!JSON.stringify(b.state()).includes(motion.slice(30, 90)));
    const fetched = (await b.socket
      .timeout(3000)
      .emitWithAck("profile-image", ana.avatarMotion)) as { ok: boolean; value: string };
    assert.equal(fetched.value, motion);
    const banner = (await b.socket
      .timeout(3000)
      .emitWithAck("profile-image", ana.banner)) as { ok: boolean; value: string };
    assert.equal(banner.value, cover);
    // Removing the animation via a profile command clears the reference.
    const anaSocket = sockets[0];
    const reply = (await anaSocket.timeout(3000).emitWithAck("command", {
      type: "profile",
      name: "Ana",
      avatar: "A",
      avatarMotion: "",
    })) as { ok: boolean };
    assert(reply.ok);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(
      b.state().participants.find((p: Participant) => p.profile.name === "Ana")
        .profile.avatarMotion,
      "",
    );
  } finally {
    for (const s of sockets) s.disconnect();
    await host.close?.();
    store.close?.();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("Amigos: uma entrada por pessoa entre servidores e presença só confirmada pelo host", () => {
  const self = "me",
    bruno = "bruno",
    carla = "carla",
    davi = "davi";
  const inbox: Inbox = {
    activeScope: "s1",
    rooms: [
      {
        scope: "s1",
        name: "Estúdio",
        friendships: [],
        contacts: [{ id: bruno, name: "Bruno", avatar: "B", directEnabled: true }],
        messages: [],
        read: {},
      },
      {
        scope: "s2",
        name: "Casa",
        friendships: [
          { requester: self, recipient: bruno, status: "accepted" },
          { requester: davi, recipient: self, status: "accepted" },
        ],
        contacts: [
          { id: bruno, name: "Bruno", avatar: "B", directEnabled: true },
          { id: davi, name: "Davi", avatar: "D", directEnabled: true },
        ],
        messages: [],
        read: {},
      },
    ],
  };
  const room = {
    servers: [],
    channels: [{ id: "v", serverId: "x", name: "Sala", kind: "voice" }],
    messages: [],
    participants: [
      {
        id: "sock",
        profile: { id: bruno, name: "Bruno", avatar: "B", presence: "away" },
        channelId: "v",
        muted: false,
        deafened: false,
        sharing: false,
        host: false,
      },
    ],
    friendships: [
      { requester: self, recipient: bruno, status: "accepted" },
      { requester: carla, recipient: self, status: "pending" },
    ],
    profiles: { [carla]: { id: carla, name: "Carla", avatar: "C" } },
  } as unknown as RoomState;
  const list = friendEntries(room, inbox, self, true);
  assert.deepEqual(
    list.map((f) => [f.name, f.status, !!f.person]),
    [
      ["Bruno", "accepted", true],
      ["Carla", "incoming", false],
      ["Davi", "accepted", false],
    ],
  );
  const b = list[0];
  assert.equal(b.links.length, 2, "same person in two servers, one entry");
  assert.equal(b.links[0].live, true, "live host first for actions");
  assert.equal(b.activity, "Em voz · Sala");
  // Offline: nobody gets a presence or activity.
  const offline = friendEntries(room, inbox, self, false);
  assert(offline.every((f) => !f.person && !f.activity));
});
