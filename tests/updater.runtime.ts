// Runs only under Electron, against real NSIS files and a local Range server.
import { app } from "electron";
import { NsisUpdater } from "electron-updater";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor";
import { createServer } from "node:http";
import {
  createReadStream,
  readFileSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { RemoteUpdates } from "../src/main/remoteUpdates";
import assert from "node:assert/strict";
async function main() {
  await app.whenReady();
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const root = resolve("test-results", "updater-native-" + Date.now());
  mkdirSync(root, { recursive: true });
  const base = resolve("release", version),
    oldBase = resolve("release", "0.3.0"),
    name = `Voxy-Setup-${version}-x64.exe`;
  const data = readFileSync(join(base, name)),
    blockmap = readFileSync(join(base, name + ".blockmap")),
    manifest = readFileSync(join(base, "latest.yml"), "utf8");
  const cache = join(root, "updater-test");
  mkdirSync(cache, { recursive: true });
  copyFileSync(
    join(oldBase, "Voxy-Setup-0.3.0-x64.exe"),
    join(cache, "installer.exe"),
  );
  copyFileSync(
    join(oldBase, "Voxy-Setup-0.3.0-x64.exe.blockmap"),
    join(cache, "current.blockmap"),
  );
  const config = join(root, "app-update.yml");
  writeFileSync(
    config,
    "publisherName:\n  - Voxy\nupdaterCacheDirName: updater-test\n",
  );
  let rangeRequests = 0,
    bytesServed = 0,
    fullInstallerRequests = 0;
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    const body =
      path === "/latest.yml"
        ? Buffer.from(manifest)
        : path === "/" + name
          ? data
          : path === "/" + name + ".blockmap"
            ? blockmap
            : undefined;
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      rangeRequests++;
      const start = Number(range[1]),
        end = range[2] ? Number(range[2]) : body.length - 1;
      if (start > end || end >= body.length) {
        res.writeHead(416);
        res.end();
        return;
      }
      bytesServed += end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${body.length}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
      });
      res.end(body.subarray(start, end + 1));
    } else {
      if (path === "/" + name) fullInstallerRequests++;
      bytesServed += body.length;
      res.writeHead(200, {
        "Content-Length": body.length,
        "Accept-Ranges": "bytes",
      });
      res.end(body);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const keys = generateKeyPairSync("ed25519"),
    hash = (bytes: Buffer | string) =>
      createHash("sha512").update(bytes).digest("base64");
  const payload = Buffer.from(
    JSON.stringify({
      schema: 1,
      channel: "stable",
      version,
      date: "2026-10-20",
      repository: "labarro/Voxy",
      files: [
        { name, sha512: hash(data), size: data.length },
        {
          name: name + ".blockmap",
          sha512: hash(blockmap),
          size: blockmap.length,
        },
      ],
      manifestSha512: hash(manifest),
      releases: [
        {
          version,
          date: "2026-10-20",
          title: "Teste real do updater",
          items: ["Teste"],
          features: [],
          improvements: [],
          fixes: [],
        },
      ],
    }),
  );
  const envelope = JSON.stringify({
    payload: payload.toString("base64"),
    signature: sign(null, payload, keys.privateKey).toString("base64"),
  });
  const phases: string[] = [];
  let installerInvoked = false;
  const makeController = (cacheRoot: string, notify: (state: any) => void) =>
    new RemoteUpdates({
      version: "0.3.0",
      packaged: true,
      cachePath: join(cacheRoot, "history.json"),
      trust: {
        schema: 1,
        repository: "labarro/Voxy",
        endpoint: "https://devbarros.com/voxy/updates/",
        publicKeys: [
          keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
        ],
        authenticodePublisher: null,
      },
      factory: () => {
        const native = new NsisUpdater(null, {
          version: "0.3.0",
          name: "Voxy test",
          isPackaged: true,
          appUpdateConfigPath: config,
          userDataPath: cacheRoot,
          baseCachePath: cacheRoot,
          whenReady: () => Promise.resolve(),
          relaunch: () => {
            installerInvoked = true;
          },
          quit: () => {
            installerInvoked = true;
          },
          onQuit: () => {},
        });
        (native as any).httpExecutor = new ElectronHttpExecutor();
        native.setFeedURL({
          provider: "generic",
          url,
          useMultipleRangeRequest: false,
        });
        return native;
      },
      fetchText: async (address) =>
        address.endsWith("latest.yml") ? manifest : envelope,
      changed: notify,
      beforeInstall: async () => {
        throw Error("Instalação deliberadamente não executada neste teste");
      },
    });
  const controller = makeController(root, (state) => phases.push(state.phase));
  try {
    await controller.check();
    assert.equal(
      controller.status().phase,
      "ready",
      JSON.stringify(controller.status()),
    );
    assert(phases.includes("downloading"));
    assert(!installerInvoked);
    assert(rangeRequests > 0, "Download diferencial não fez requisições Range");
    assert.equal(
      fullInstallerRequests,
      0,
      "Houve fallback inesperado para pacote completo",
    );
    assert(
      bytesServed < data.length,
      "O download diferencial não economizou bytes",
    );
    const result = {
      version,
      rangeRequests,
      bytesServed,
      fullInstallerBytes: data.length,
      savedPercent: Math.round((1 - bytesServed / data.length) * 100),
      installerInvoked,
      phases: [...new Set(phases)],
    };
    rangeRequests = 0;
    bytesServed = 0;
    fullInstallerRequests = 0;
    const fallbackRoot = join(root, "fallback");
    mkdirSync(join(fallbackRoot, "updater-test"), { recursive: true });
    copyFileSync(
      join(oldBase, "Voxy-Setup-0.3.0-x64.exe.blockmap"),
      join(fallbackRoot, "updater-test", "current.blockmap"),
    );
    const fallback = makeController(fallbackRoot, () => {});
    await fallback.check();
    assert.equal(
      fallback.status().phase,
      "ready",
      JSON.stringify(fallback.status()),
    );
    assert.equal(fullInstallerRequests, 1);
    assert(!installerInvoked);
    Object.assign(result, {
      fallback: {
        fullInstallerRequests,
        bytesServed,
        verified: true,
        installerInvoked,
      },
    });
    writeFileSync(
      "test-results/updater-native.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
void main()
  .then(() => app.exit(0))
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
