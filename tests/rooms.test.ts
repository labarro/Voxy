import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import initSqlJs from "sql.js";
import { RecentRooms, probeRoom } from "../src/main/recentRooms";
import { Store } from "../src/database/store";
import { RoomHost } from "../src/services/signaling/host";
import releases from "../src/shared/releases.json";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPboAAAAASUVORK5CYII=";
function vault() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), data]);
    },
    decryptString: (value: Buffer) => {
      const d = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      d.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([d.update(value.subarray(28)), d.final()]).toString(
        "utf8",
      );
    },
  };
}
test("migração preserva servidor antigo e só o criador gerencia sua imagem", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-server-icon-"));
  let store: Store | undefined;
  try {
    const SQL = await initSqlJs({
        locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
      }),
      db = new SQL.Database();
    db.run(
      "CREATE TABLE servers(id TEXT PRIMARY KEY,name TEXT NOT NULL);INSERT INTO servers VALUES('legacy','Servidor antigo')",
    );
    await writeFile(join(dir, "room.sqlite"), db.export());
    db.close();
    store = await Store.open(join(dir, "room.sqlite"));
    const owner = randomUUID();
    store.claimLegacyServers(owner);
    assert.equal(store.snapshot().servers[0].name, "Servidor antigo");
    assert.equal(store.snapshot().servers[0].ownerId, owner);
    assert.throws(() => store!.setServerIcon("legacy", randomUUID(), png));
    store.setServerIcon("legacy", owner, png);
    const icon = store.snapshot().servers[0].icon!;
    assert.equal(store.snapshot().avatars[icon], png);
    store.close();
    store = await Store.open(join(dir, "room.sqlite"));
    assert.equal(store.snapshot().servers[0].icon, icon);
    store.claimLegacyServers(randomUUID());
    assert.equal(store.snapshot().servers[0].ownerId, owner);
    store.setServerIcon("legacy", owner, null);
    assert.equal(store.snapshot().servers[0].icon, null);
    const other = store.createServer("Novo", owner);
    assert.equal(
      store.snapshot().servers.find((s) => s.id === other)?.ownerId,
      owner,
    );
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("recentes persistem offline, protegem convite, atualizam metadados e respeitam remoção", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-recents-"));
  const path = join(dir, "recent-rooms.json"),
    crypto = vault();
  try {
    const invite = "voxy://26.1.2.3:43120/" + "b".repeat(64),
      server = { id: randomUUID(), name: "Amigos", icon: null };
    let recent = new RecentRooms(path, crypto);
    recent.remember(invite, [server], {}, false, true);
    const entry = recent.list()[0];
    assert(!("secret" in entry));
    assert(!("invite" in entry));
    const raw = await readFile(path, "utf8");
    assert(!raw.includes(invite));
    assert(!raw.includes("b".repeat(64)));
    recent = new RecentRooms(path, crypto);
    assert.equal(recent.get(entry.id).invite, invite);
    assert.deepEqual(await recent.availability(() => false), [
      { id: entry.id, status: "unavailable" },
    ]);
    recent.remember(
      invite,
      [{ ...server, name: "Renomeado", icon: "avatar:photo" }],
      { "avatar:photo": png },
      false,
      false,
    );
    assert.equal(recent.list()[0].name, "Renomeado");
    assert.equal(recent.list()[0].icon, png);
    recent.remove(entry.id);
    recent.remember(invite, [server], {}, false, false);
    assert.equal(new RecentRooms(path, crypto).list().length, 0);
    recent.remember(invite, [server], {}, false, true);
    assert.equal(recent.list().length, 1);
    await writeFile(path, "{broken");
    assert.equal(new RecentRooms(path, crypto).list().length, 0);
    assert((await readdir(dir)).some((name) => name.includes(".corrupt-")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("disponibilidade exige segredo, não ocupa vaga e detecta servidor removido ou host offline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-probe-"));
  const store = await Store.open(join(dir, "room.sqlite"));
  const token = "a".repeat(64);
  const id = store.createServer("Probe"),
    host = new RoomHost(store, token, "owner");
  const port = await host.listen("127.0.0.1", 0);
  try {
    assert.equal(await probeRoom("127.0.0.1", port, token, id), "available");
    assert.equal(host.state().participants.length, 0);
    assert.equal(
      await probeRoom("127.0.0.1", port, "b".repeat(64), id),
      "invalid",
    );
    assert.equal(
      await probeRoom("127.0.0.1", port, token, "missing"),
      "missing",
    );
    await host.close();
    assert.equal(await probeRoom("127.0.0.1", port, token, id), "unavailable");
  } finally {
    await host.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("canal de novidades conserva versões anteriores com datas e categorias", () => {
  for (const version of ["0.2.0", "0.3.0", "0.4.0"] as const) {
    const post = releases[version];
    assert(/^\d{4}-\d{2}-\d{2}$/.test(post.date));
    assert(post.items.length);
    assert(
      Array.isArray(post.features) &&
        Array.isArray(post.improvements) &&
        Array.isArray(post.fixes),
    );
  }
});
