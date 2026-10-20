import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import type { NsisUpdater } from "electron-updater";
import { RemoteUpdates } from "../src/main/remoteUpdates";
import {
  verifyReleaseEnvelope,
  type TrustConfig,
} from "../src/main/updateTrust";
import { fetchUpdateText } from "../src/main/updateTransport";
function fixture(version = "0.4.1") {
  const keys = generateKeyPairSync("ed25519"),
    publicKey = keys.publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
  const trust: TrustConfig = {
    schema: 1,
    repository: "labarro/Voxy",
    endpoint: "https://devbarros.com/voxy/updates/",
    publicKeys: [publicKey],
    authenticodePublisher: null,
  };
  const bytes = Buffer.from("MZ fixture executable - never executed"),
    hash = (data: Buffer | string) =>
      createHash("sha512").update(data).digest("base64"),
    name = `Voxy-Setup-${version}-x64.exe`,
    manifest = "fixture immutable latest.yml";
  const payload = {
    schema: 1,
    channel: "stable",
    version,
    date: "2026-10-20",
    repository: trust.repository,
    files: [
      { name, sha512: hash(bytes), size: bytes.length },
      { name: name + ".blockmap", sha512: hash("blockmap"), size: 8 },
    ],
    manifestSha512: hash(manifest),
    releases: [
      {
        version,
        date: "2026-10-20",
        title: "Teste",
        items: ["Nova versão"],
        features: ["Teste"],
        improvements: [],
        fixes: [],
      },
    ],
  };
  const envelope = (value: unknown = payload) => {
    const data = Buffer.from(JSON.stringify(value));
    return JSON.stringify({
      payload: data.toString("base64"),
      signature: sign(null, data, keys.privateKey).toString("base64"),
    });
  };
  return { trust, payload, envelope, bytes, manifest, name };
}
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  disableDifferentialDownload = true;
  previousBlockmapBaseUrlOverride: string | null = null;
  logger: unknown;
  installed = 0;
  downloads = 0;
  verifyUpdateCodeSignature = async (
    _names: string[],
    _path: string,
  ): Promise<string | null> => null;
  constructor(
    private f: ReturnType<typeof fixture>,
    private path: string,
  ) {
    super();
  }
  async checkForUpdates() {
    const file = this.f.payload.files[0];
    return {
      updateInfo: {
        version: this.f.payload.version,
        files: [{ url: file.name, sha512: file.sha512, size: file.size }],
      },
    };
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", { percent: 50, bytesPerSecond: 1024 });
    const error = await this.verifyUpdateCodeSignature(["Voxy"], this.path);
    if (error) throw Error(error);
    return [this.path];
  }
  quitAndInstall() {
    this.installed++;
  }
}
test("publicação assinada rejeita payload alterado, outra chave, outro repositório e caminhos inesperados", () => {
  const f = fixture();
  assert.equal(verifyReleaseEnvelope(f.envelope(), f.trust).version, "0.4.1");
  const corrupted = JSON.parse(f.envelope());
  corrupted.payload = Buffer.from(
    JSON.stringify({ ...f.payload, version: "9.9.9" }),
  ).toString("base64");
  assert.throws(() =>
    verifyReleaseEnvelope(JSON.stringify(corrupted), f.trust),
  );
  assert.throws(() => verifyReleaseEnvelope(f.envelope(), fixture().trust));
  assert.throws(() =>
    verifyReleaseEnvelope(
      f.envelope({ ...f.payload, repository: "attacker/repo" }),
      f.trust,
    ),
  );
  assert.throws(() =>
    verifyReleaseEnvelope(
      f.envelope({
        ...f.payload,
        files: [
          { ...f.payload.files[0], name: "../evil.exe" },
          f.payload.files[1],
        ],
      }),
      f.trust,
    ),
  );
  assert.throws(() =>
    verifyReleaseEnvelope("x".repeat(1024 * 1024 + 1), f.trust),
  );
});
test("updater baixa, verifica, mantém instalação explícita e faz backup antes de reiniciar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-remote-"));
  const f = fixture(),
    path = join(dir, f.name);
  await writeFile(path, f.bytes);
  let prepared = 0;
  const fake = new FakeUpdater(f, path),
    states: string[] = [];
  const update = new RemoteUpdates({
    version: "0.4.0",
    packaged: true,
    trust: f.trust,
    cachePath: join(dir, "history.json"),
    factory: () => fake as unknown as NsisUpdater,
    fetchText: async (url) =>
      url.endsWith("latest.yml") ? f.manifest : f.envelope(),
    changed: (state) => states.push(state.phase),
    beforeInstall: async () => {
      prepared++;
    },
  });
  try {
    await update.check();
    assert.equal(update.status().phase, "ready");
    assert.equal(fake.installed, 0);
    assert.equal(fake.autoInstallOnAppQuit, false);
    assert.equal(fake.autoDownload, false);
    assert.equal(fake.allowDowngrade, false);
    assert(fake.previousBlockmapBaseUrlOverride?.includes("/v0.4.0/"));
    assert(states.includes("available") && states.includes("downloading"));
    assert.equal(update.history()[0].version, "0.4.1");
    await update.install();
    assert.equal(prepared, 1);
    assert.equal(fake.installed, 1);
    await update.install();
    assert.equal(fake.installed, 1);
    assert(
      (await readFile(join(dir, "history.json"), "utf8")).includes("signature"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("arquivo alterado após download impede instalação sem fechar a chamada; metadados de download falsos impedem baixar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-tamper-"));
  const f = fixture(),
    path = join(dir, f.name);
  await writeFile(path, f.bytes);
  let prepared = 0;
  const fake = new FakeUpdater(f, path);
  const make = (adapter: FakeUpdater) =>
    new RemoteUpdates({
      version: "0.4.0",
      packaged: true,
      trust: f.trust,
      cachePath: join(dir, "history.json"),
      factory: () => adapter as unknown as NsisUpdater,
      fetchText: async (url) =>
        url.endsWith("latest.yml") ? f.manifest : f.envelope(),
      changed: () => {},
      beforeInstall: async () => {
        prepared++;
      },
    });
  try {
    const update = make(fake);
    await update.check();
    await writeFile(path, "tampered");
    await assert.rejects(update.install());
    assert.equal(prepared, 0);
    assert.equal(fake.installed, 0);
    const bad = new FakeUpdater(f, path);
    bad.checkForUpdates = async () =>
      ({
        updateInfo: {
          version: "0.4.1",
          files: [
            { ...f.payload.files[0], url: "https://evil.example/evil.exe" },
          ],
        },
      }) as any;
    const blocked = make(bad);
    await blocked.check();
    assert.equal(blocked.status().phase, "error");
    await assert.rejects(blocked.download());
    assert.equal(bad.downloads, 0);
    const corrupt = new FakeUpdater(f, path),
      corruptUpdate = make(corrupt);
    await corruptUpdate.check();
    assert.equal(corruptUpdate.status().phase, "error");
    assert.equal(corrupt.installed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("fallback de rede, cache verificado offline e bloqueio de replay de versão antiga", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-fallback-")),
    f = fixture(),
    path = join(dir, f.name);
  await writeFile(path, f.bytes);
  const fake = new FakeUpdater(f, path),
    cache = join(dir, "history.json");
  try {
    const options = {
      version: "0.4.0",
      packaged: true,
      trust: f.trust,
      cachePath: cache,
      factory: () => fake as unknown as NsisUpdater,
      changed: () => {},
      beforeInstall: async () => {},
    };
    const update = new RemoteUpdates({
      ...options,
      fetchText: async (url) => {
        if (url.includes("devbarros.com")) throw Error("offline domain");
        return url.endsWith("latest.yml") ? f.manifest : f.envelope();
      },
    });
    await update.check(false);
    assert.equal(update.status().phase, "available");
    assert.equal(new RemoteUpdates(options).history()[0].version, "0.4.1");
    const old = {
      ...f.payload,
      version: "0.4.0",
      files: f.payload.files.map((file) => ({
        ...file,
        name: file.name.replace("0.4.1", "0.4.0"),
      })),
      releases: f.payload.releases.map((post) => ({
        ...post,
        version: "0.4.0",
      })),
    };
    const replay = new RemoteUpdates({
      ...options,
      fetchText: async () => f.envelope(old),
    });
    await replay.check();
    assert.equal(replay.status().phase, "error");
    assert.equal(fake.downloads, 0);
    const disabled = new RemoteUpdates({ ...options, packaged: false });
    await disabled.check();
    assert.equal(disabled.status().phase, "disabled");
    await assert.rejects(
      fetchUpdateText("http://devbarros.com/update", f.trust),
    );
    await assert.rejects(
      fetchUpdateText("https://evil.example/update", f.trust),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
