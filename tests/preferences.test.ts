import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  profileSchema,
  commandSchema,
  avatarSchema,
} from "../src/shared/validation";
import { microphoneMuted, PTT_KEYS } from "../src/shared/preferences";
import { VoiceGate } from "../src/services/webrtc/microphone";
import { validateImage } from "../src/shared/image";
import initSqlJs from "sql.js";
import { Store } from "../src/database/store";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPboAAAAASUVORK5CYII=";
test("perfil antigo recebe padrões; UUID, volumes e tecla são validados", () => {
  const id = randomUUID();
  const p = profileSchema.parse({
    id,
    name: "Amigo",
    avatar: "x",
    input: "",
    output: "",
  });
  assert.equal(p.pttEnabled, false);
  assert.equal(p.callSounds, true);
  assert.equal(p.inputVolume, 1);
  assert.equal(p.noiseSuppression, true);
  assert.equal(p.echoCancellation, true);
  assert.equal(p.voiceDetection, false);
  assert.equal(p.voiceThreshold, -45);
  assert.deepEqual(p.mutedParticipants, {});
  assert(
    !profileSchema.safeParse({ ...p, mutedParticipants: { [id]: "true" } })
      .success,
  );
  for (const code of [
    "Mouse4",
    "Mouse5",
    "KeyQ",
    "Digit7",
    "F24",
    "ShiftRight",
    "Numpad5",
    "ArrowUp",
    "Quote",
  ])
    assert(profileSchema.safeParse({ ...p, pttKey: code }).success);
  for (const code of ["__proto__", "constructor", "Unknown"])
    assert(!profileSchema.safeParse({ ...p, pttKey: code }).success);
  for (const value of Object.values(PTT_KEYS))
    assert(Number.isInteger(value.vk) && value.vk > 0 && value.vk < 256);
  for (const patch of [
    { inputVolume: 2.1 },
    { voiceThreshold: -100 },
    { voiceThreshold: NaN },
  ])
    assert(!profileSchema.safeParse({ ...p, ...patch }).success);

  assert.deepEqual(p.volumes, {});
  assert(!profileSchema.safeParse({ ...p, pttKey: "ExecuteCommand" }).success);
  assert(!profileSchema.safeParse({ ...p, volumes: { [id]: 2.1 } }).success);
  assert.equal(
    profileSchema.parse({
      ...p,
      volumes: { [id]: 0.35 },
      streamVolumes: { [id]: 0 },
    }).volumes[id],
    0.35,
  );
});
test("detecção tem limiar, histerese, retenção e reinicia ao ativar", () => {
  const gate = new VoiceGate();
  assert.equal(gate.update(-60, -40, 100, true), false);
  assert.equal(gate.update(-30, -40, 200, true), true);
  assert.equal(gate.update(-44, -40, 400, true), true);
  assert.equal(gate.update(-65, -40, 600, true), true);
  assert.equal(gate.update(-65, -40, 700, true), false);
  assert.equal(gate.update(-80, -40, 800, false), true);
  assert.equal(gate.update(-44, -40, 900, true), false);
});
test("Push to Talk só abre enquanto pressionado e nunca supera mute manual", () => {
  for (const manual of [false, true])
    for (const ptt of [false, true])
      for (const held of [false, true])
        assert.equal(
          microphoneMuted(manual, ptt, held),
          manual || (ptt && !held),
        );
});
test("imagem: formato real, limites e mensagem sem texto", () => {
  assert(avatarSchema.safeParse(PNG).success);
  assert(!avatarSchema.safeParse("data:image/svg+xml;base64,PHN2Zz4=").success);
  assert(
    !avatarSchema.safeParse("data:image/png;base64," + "A".repeat(44000))
      .success,
  );
  const bigAvatar = Buffer.from(PNG.split(",")[1], "base64");
  bigAvatar.writeUInt32BE(256, 16);
  assert(
    !avatarSchema.safeParse(
      "data:image/png;base64," + bigAvatar.toString("base64"),
    ).success,
  );
  assert.deepEqual(validateImage(PNG), {
    width: 1,
    height: 1,
    bytes: Buffer.from(PNG.split(",")[1], "base64").length,
  });
  assert(
    commandSchema.safeParse({
      type: "message",
      channelId: "canal",
      text: "",
      image: PNG,
    }).success,
  );
  assert.throws(() => validateImage(PNG.replace("image/png", "image/jpeg")));
  assert.throws(() => validateImage("data:image/svg+xml;base64,PHN2Zz4="));
  const huge = Buffer.from(PNG.split(",")[1], "base64");
  huge.writeUInt32BE(10000, 16);
  assert.throws(() =>
    validateImage("data:image/png;base64," + huge.toString("base64")),
  );
  assert(
    !commandSchema.safeParse({ type: "message", channelId: "canal", text: "" })
      .success,
  );
});
test("migração do SQLite antigo preserva texto e aceita imagens no novo esquema", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-migration-"));
  const path = join(dir, "room.sqlite");
  let store: Store | undefined;
  try {
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const db = new SQL.Database();
    db.run(
      "CREATE TABLE messages(id TEXT PRIMARY KEY,channelId TEXT,author TEXT,name TEXT,avatar TEXT,text TEXT,time INTEGER);INSERT INTO messages VALUES('old','canal','autor','Amigo','x','Histórico antigo',1)",
    );
    await writeFile(path, db.export());
    db.close();
    store = await Store.open(path);
    assert.equal(store.snapshot().messages[0].text, "Histórico antigo");
    store.message(
      {
        id: "new",
        channelId: "canal",
        author: "autor",
        name: "Amigo",
        avatar: "x",
        text: "",
        time: 2,
      },
      PNG,
    );
    assert.equal(store.image("new"), PNG);
    assert.equal(store.snapshot().messages[1].imageId, "new");
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
