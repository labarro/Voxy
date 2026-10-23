import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UpdateManager, newerVersion, fileHash } from "../src/main/updates";
import { ReleaseNotesStore } from "../src/main/releaseNotes";
import pkg from "../package.json";
import releases from "../src/shared/releases.json";

test("versão do pacote, lock, saída e README correspondem às notas exibidas após atualizar", async () => {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(pkg.build.directories.output, "release/" + pkg.version);
  assert(
    (await readFile("README.md", "utf8")).includes(
      "## Novidades na versão " + pkg.version,
    ),
  );
  const entry = (
    releases as Record<
      string,
      {
        date: string;
        title: string;
        items: string[];
        features: string[];
        improvements: string[];
        fixes: string[];
      }
    >
  )[pkg.version];
  assert(entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
  assert(entry.title && entry.items.length > 0);
  for (const category of [entry.features, entry.improvements, entry.fixes])
    assert(Array.isArray(category));
  const dir = await mkdtemp(join(tmpdir(), "voxy-current-release-"));
  try {
    const path = join(dir, "release-notes.json");
    const previous = Object.keys(releases).filter((v) =>
      newerVersion(pkg.version, v),
    );
    await writeFile(path, JSON.stringify(previous));
    const store = new ReleaseNotesStore(path, pkg.version);
    assert.equal(store.notes()?.version, pkg.version);
    assert.deepEqual(store.notes()?.items, entry.items);
    store.mark(pkg.version);
    assert.equal(new ReleaseNotesStore(path, pkg.version).notes(), null);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), [
      ...previous,
      pkg.version,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("versões de atualização não permitem downgrade ou reinstalar a mesma versão", () => {
  assert(newerVersion("0.3.0", "0.2.0"));
  assert(newerVersion("0.2.10", "0.2.9"));
  assert(!newerVersion("0.2.0", "0.2.0"));
  assert(!newerVersion("0.1.9", "0.2.0"));
  assert.throws(() => newerVersion("x;command", "0.2.0"));
});
test("atualizador confere pacote, hash, alteração posterior e backup sem modificar os dados", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-update-"));
  try {
    const data = join(dir, "data");
    await mkdir(data);
    await writeFile(join(data, "profile.json"), "perfil preservado");
    await writeFile(join(data, "room.sqlite"), "histórico preservado");
    await writeFile(join(data, "release-notes.json"), '["0.2.0"]');
    await writeFile(join(data, "recent-rooms.json"), "[]");
    const source = join(dir, "Voxy-Setup-0.3.0-x64.exe");
    const pe = Buffer.alloc(128);
    pe.write("MZ");
    pe.writeUInt32LE(64, 60);
    pe.write("PE\0\0", 64);
    await writeFile(source, pe);
    const hash = await fileHash(source);
    await writeFile(
      join(dir, "SHA256SUMS.txt"),
      hash + "  Voxy-Setup-0.3.0-x64.exe\n",
    );
    const manager = new UpdateManager(data, "0.2.0");
    await writeFile(join(data, "direct-inbox.json"), '{"rooms":[]}');
    await writeFile(
      join(data, "profile-identity.bin"),
      Buffer.from([1, 2, 3, 4]),
    );
    const info = await manager.prepare(source);
    assert(info.verified);
    assert.equal(info.version, "0.3.0");
    const staged = await manager.installer(info.id);
    assert.notEqual(staged, source);
    const backup = manager.backup();
    assert.equal(
      await readFile(join(backup, "direct-inbox.json"), "utf8"),
      '{"rooms":[]}',
    );
    assert.deepEqual(
      await readFile(join(backup, "profile-identity.bin")),
      Buffer.from([1, 2, 3, 4]),
    );
    assert.equal(
      await readFile(join(backup, "recent-rooms.json"), "utf8"),
      "[]",
    );
    assert.equal(
      await readFile(join(backup, "profile.json"), "utf8"),
      "perfil preservado",
    );
    assert.equal(
      await readFile(join(data, "room.sqlite"), "utf8"),
      "histórico preservado",
    );
    assert.equal(
      await readFile(join(backup, "release-notes.json"), "utf8"),
      '["0.2.0"]',
    );
    await writeFile(staged, "tampered");
    await assert.rejects(manager.installer(info.id));
    await writeFile(
      join(dir, "SHA256SUMS.txt"),
      "0".repeat(64) + "  Voxy-Setup-0.3.0-x64.exe",
    );
    await assert.rejects(manager.prepare(source));
    await assert.rejects(manager.prepare(join(dir, "qualquer.exe")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("novidades aparecem uma vez por versão e sobrevivem a reinício", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-release-"));
  try {
    const path = join(dir, "release-notes.json");
    const first = new ReleaseNotesStore(path, "0.2.0");
    assert.equal(first.notes()?.version, "0.2.0");
    first.mark("0.2.0");
    assert.equal(new ReleaseNotesStore(path, "0.2.0").notes(), null);
    assert.throws(() => first.mark("9.9.9"));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), ["0.2.0"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
