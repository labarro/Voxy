import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import { memberRoles, nicknameColor } from "../src/shared/identity";
import {
  profileSchema,
  publicProfileSchema,
  commandSchema,
} from "../src/shared/validation";
import { VoiceEngine } from "../src/services/webrtc/engine";
import type { Command, Reply } from "../src/shared/types";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPboAAAAASUVORK5CYII=";

test("preferências migram e perfil público compartilha somente identidade visual", () => {
  const p = profileSchema.parse({
    id: randomUUID(),
    name: "Ana",
    avatar: "A",
    input: "",
    output: "",
  });
  assert.equal(p.autoGainControl, true);
  assert.equal(p.pttSounds, true);
  assert.equal(p.theme, "voxy");
  assert.equal(p.banner, "");
  assert.equal(p.nicknameColor, "");
  const publicProfile = publicProfileSchema.parse({
    ...p,
    banner: image,
    nicknameColor: "#ff88cc",
  });
  assert.equal(publicProfile.banner, image);
  assert(!("input" in publicProfile));
  assert(!("volumes" in publicProfile));
  for (const patch of [
    { nicknameColor: "red" },
    { banner: "javascript:alert(1)" },
    { theme: "unknown" },
    { accentColor: "url(x)" },
  ])
    assert(!profileSchema.safeParse({ ...p, ...patch }).success);
  assert(
    !commandSchema.safeParse({
      type: "role.save",
      serverId: "a",
      name: "",
      color: "#ff0000",
    }).success,
  );
});

test("cargos: autorização no host, isolamento entre servidores, atribuição offline, prioridade, persistência e cascata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-roles-"));
  const path = join(dir, "room.sqlite");
  let store = await Store.open(path);
  const owner = randomUUID(),
    member = randomUUID();
  const serverId = store.createServer("Amigos", owner),
    otherId = store.createServer("Outro", member);
  const host = new RoomHost(store, "a".repeat(64), "owner-key");
  const port = await host.listen("127.0.0.1", 0);
  const sockets: Socket[] = [];
  async function connect(id: string) {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      auth: {
        protocol: 2,
        token: "a".repeat(64),
        identityKey: id === owner ? "b".repeat(64) : "c".repeat(64),
        profile: {
          id,
          name: id === owner ? "Ana" : "Bruno",
          avatar: "A",
          banner: image,
          nicknameColor: "#ff88cc",
        },
      },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  const command = async (s: Socket, c: Command) =>
    (await s.timeout(3000).emitWithAck("command", c)) as Reply;
  try {
    const a = await connect(owner),
      b = await connect(member);
    assert.equal(
      (
        await command(b, {
          type: "role.save",
          serverId,
          name: "Intruso",
          color: "#ff0000",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await command(a, {
          type: "role.save",
          serverId,
          name: "Equipe",
          color: "#aa88ff",
        })
      ).ok,
      true,
    );
    const role = host.state().roles![0];
    assert.deepEqual(role.permissions, []);
    assert.equal(
      (
        await command(a, {
          type: "role.assign",
          serverId,
          roleId: role.id,
          memberId: member,
          assigned: true,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await command(b, {
          type: "role.assign",
          serverId: otherId,
          roleId: role.id,
          memberId: member,
          assigned: true,
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await command(a, {
          type: "role.save",
          serverId,
          name: "Segundo",
          color: "#88ffcc",
        })
      ).ok,
      true,
    );
    const second = host.state().roles![1];
    await command(a, {
      type: "role.assign",
      serverId,
      roleId: second.id,
      memberId: member,
      assigned: true,
    });
    let state = host.state();
    assert.equal(memberRoles(state, serverId, member).length, 2);
    assert.equal(
      nicknameColor(state, serverId, state.profiles![member]),
      "#aa88ff",
    );
    assert.equal(
      nicknameColor(state, otherId, state.profiles![member]),
      "#ff88cc",
    );
    const bannerId = state.participants.find((p) => p.profile.id === member)!
      .profile.banner!;
    assert(bannerId.startsWith("avatar:"));
    assert.equal(store.avatarImages([bannerId])[bannerId], image);
    assert.equal(
      (
        await command(b, {
          type: "status",
          muted: true,
          deafened: false,
          sharing: false,
          microphoneState: "ptt-waiting",
        })
      ).ok,
      true,
    );
    assert.equal(
      host.state().participants.find((p) => p.profile.id === member)!
        .microphoneState,
      "ptt-waiting",
    );
    b.disconnect();
    await command(a, {
      type: "role.assign",
      serverId,
      roleId: role.id,
      memberId: member,
      assigned: false,
    });
    assert.equal(
      nicknameColor(host.state(), serverId, { id: member }),
      second.color,
    );
    await command(a, {
      type: "role.save",
      serverId,
      id: second.id,
      name: "Moderadores",
      color: "#88bbff",
    });
    await command(a, {
      type: "profile",
      name: "Ana",
      avatar: "A",
      banner: "",
      nicknameColor: "",
    });
    assert.equal(host.state().profiles![owner].banner, "");
    await host.close();
    store.close();
    store = await Store.open(path);
    state = { ...store.snapshot(), participants: [] };
    assert.equal(
      state.roles!.find((r) => r.id === second.id)!.name,
      "Moderadores",
    );
    assert.equal(state.memberRoles!.length, 1);
    store.manageRole(owner, { type: "role.delete", serverId, id: second.id });
    assert.equal(store.snapshot().memberRoles.length, 0);
    store.delete("servers", serverId);
    assert.equal(store.snapshot().roles.length, 0);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await host.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PTT: espera, transmissão, mute prioritário e sons independentes sem repetição", () => {
  const engine = new VoiceEngine(
    async () => {},
    () => {},
    () => {},
  );
  const internal = engine as any;
  const sounds: string[] = [];
  internal.chime = (kind: string) => sounds.push(kind);
  internal.active = true;
  const p = profileSchema.parse({
    id: randomUUID(),
    name: "Ana",
    avatar: "A",
    input: "",
    output: "",
    pttEnabled: true,
    callSounds: false,
  });
  engine.configurePreferences(p);
  assert.equal(engine.microphoneState(), "ptt-waiting");
  engine.setPttPressed(true);
  engine.setPttPressed(true);
  assert.equal(engine.microphoneState(), "active");
  assert.equal(engine.isMuted(), false);
  engine.setPttPressed(false);
  assert.deepEqual(sounds, ["ptt-on", "ptt-off"]);
  engine.setMuted(true);
  engine.setPttPressed(true);
  engine.setPttPressed(false);
  assert.equal(engine.microphoneState(), "muted");
  assert.equal(sounds.length, 2);
  engine.setMuted(false);
  engine.configurePreferences({ ...p, pttSounds: false });
  engine.setPttPressed(true);
  engine.setPttPressed(false);
  assert.equal(sounds.length, 2);
});
