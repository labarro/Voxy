import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { profileSchema, commandSchema } from "../src/shared/validation";
import { microphoneMuted } from "../src/shared/preferences";
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

  assert.deepEqual(p.volumes, {});
  assert(!profileSchema.safeParse({ ...p, pttKey: "ExecuteCommand" }).success);
  assert(!profileSchema.safeParse({ ...p, volumes: { [id]: 1.1 } }).success);
  assert.equal(
    profileSchema.parse({
      ...p,
      volumes: { [id]: 0.35 },
      streamVolumes: { [id]: 0 },
    }).volumes[id],
    0.35,
  );
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
