import { _electron as electron } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { randomUUID, randomBytes, createHash } from "node:crypto";
async function main() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VOXY_DATA_DIR = resolve(`test-results/packaged-${Date.now()}`);
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const { directory } = JSON.parse(
    readFileSync(`release/${version}/latest-build.json`, "utf8"),
  );
  const executablePath = resolve(directory, "win-unpacked/Voxy.exe");
  const peer = { id: randomUUID(), name: "Amigo privado", avatar: "👴" },
    identityKey = randomBytes(32).toString("hex");
  let readSequence = 0;
  for (let cycle = 0; cycle < 2; cycle++) {
    const app = await electron.launch({ executablePath, args: [], env });
    let fixture: Socket | undefined;
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("heading", { name: "Sua frequência.", exact: false })
        .waitFor({ timeout: 20000 });
      if (cycle === 0)
        await page
          .getByRole("button", { name: "Entendi, vamos l\u00e1", exact: true })
          .click();
      else if (
        await page
          .getByRole("button", { name: "Entendi, vamos l\u00e1", exact: true })
          .count()
      )
        throw Error("Release popup repeated");
      if (cycle === 1) {
        const privateCache = await page.evaluate(() => window.voxy.inbox());
        assert.equal(privateCache.activeScope, undefined);
        assert.equal(privateCache.rooms[0].messages.length, 2);
        assert.equal(privateCache.rooms[0].read[peer.id], readSequence);
        const saved = await page.evaluate(() => window.voxy.savedRooms());
        assert.equal(saved.length, 1);
        assert(saved[0].icon?.startsWith("data:image/png;base64,"));
        assert.equal(
          (await page.evaluate(() => window.voxy.roomAvailability()))[0].status,
          "unavailable",
        );
        await page
          .getByRole("button", { name: "Novidades do Voxy", exact: true })
          .click();
        await page.getByText("Voxy 0.4.0", { exact: true }).waitFor();
        await page.getByText("Voxy 0.2.0", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Home", exact: true }).click();
      }
      const info = await page.evaluate(async (cycle) => {
        const p = await window.voxy.profile();
        if (cycle === 0) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 64;
          canvas.getContext("2d")!.fillRect(0, 0, 64, 64);
          await window.voxy.saveProfile({
            ...p,
            name: "Perfil persistido",
            avatar: canvas.toDataURL("image/png"),
            pttEnabled: true,
            pttKey: "Mouse5",
            inputVolume: 0.65,
            noiseSuppression: false,
            echoCancellation: false,
            voiceDetection: true,
            voiceThreshold: -38,
            callSounds: false,
            cameraDevice: "camera-persisted",
            presence: "away",
          });
          await window.voxy.setVolume(p.id, 2, false);
          await window.voxy.setVolume(p.id, 0.15, true);
          await window.voxy.setParticipantMuted(p.id, true);
        }
        const info =
          cycle === 1
            ? (
                await window.voxy.reconnectRoom(
                  (await window.voxy.savedRooms())[0].id,
                )
              ).hostInfo!
            : await window.voxy.host({
                address: "127.0.0.1",
                port: 43138,
                name: "Pacote validado",
              });
        return { p, info };
      }, cycle);
      if (cycle === 1) {
        assert.equal(info.p.name, "Perfil persistido");
        assert.equal(info.p.presence, "away");
        assert(info.p.avatar.startsWith("data:image/png;base64,"));
        assert.equal(info.p.pttEnabled, true);
        assert.equal(info.p.pttKey, "Mouse5");
        assert.equal(info.p.inputVolume, 0.65);
        assert.equal(info.p.noiseSuppression, false);
        assert.equal(info.p.echoCancellation, false);
        assert.equal(info.p.voiceDetection, true);
        assert.equal(info.p.voiceThreshold, -38);
        assert.equal(info.p.mutedParticipants?.[info.p.id], true);
        assert.equal(info.p.callSounds, false);
        assert.equal(info.p.cameraDevice, "camera-persisted");
        assert.equal(info.p.volumes?.[info.p.id], 2);
        assert.equal(info.p.streamVolumes?.[info.p.id], 0.15);
      }
      await page.getByRole("heading", { name: "Pacote validado" }).waitFor();
      if (cycle === 0) {
        const invite = new URL(info.info.invite),
          token = invite.pathname.slice(1),
          scope = createHash("sha256")
            .update(peer.id + ":" + token)
            .digest("hex");
        fixture = io(`http://${invite.hostname}:${invite.port}`, {
          transports: ["websocket"],
          auth: { protocol: 2, token, identityKey, profile: peer },
          reconnection: false,
        });
        await new Promise<void>((resolve, reject) => {
          fixture!.once("connect", resolve);
          fixture!.once("connect_error", reject);
        });
        for (const text of ["Mensagem lida", "Mensagem pendente"]) {
          const result = await fixture.emitWithAck("command", {
            type: "direct.message",
            scope,
            recipient: info.p.id,
            text,
          });
          assert(result.ok);
        }
        await page.waitForFunction(async () => {
          const inbox = await window.voxy.inbox();
          return inbox.rooms[0]?.messages.length === 2;
        });
        const inbox = await page.evaluate(() => window.voxy.inbox());
        readSequence = inbox.rooms[0].messages[0].sequence;
        await page.evaluate(
          ({ scope, peer, sequence }) =>
            window.voxy.markDirectRead(scope, peer, sequence),
          {
            scope: inbox.rooms[0].scope,
            peer: peer.id,
            sequence: readSequence,
          },
        );
      } else {
        const inbox = await page.evaluate(() => window.voxy.inbox());
        assert.equal(inbox.rooms[0].read[peer.id], readSequence);
        assert.equal(
          inbox.rooms[0].messages.filter(
            (m) =>
              m.author === peer.id &&
              m.sequence > (inbox.rooms[0].read[peer.id] ?? 0),
          ).length,
          1,
        );
      }
      if (cycle === 0) {
        await page.evaluate(async () => {
          const entry = (await window.voxy.savedRooms())[0];
          await window.voxy.command({
            type: "server.icon",
            id: entry.serverId,
            image: (await window.voxy.profile()).avatar,
          });
        });
      }
      await page.waitForFunction(
        () =>
          !!document.querySelector<HTMLImageElement>(".server-photo img")
            ?.naturalWidth,
      );
      const runtime = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        version: app.getVersion(),
      }));
      assert(runtime.packaged);
      await page.screenshot({ path: `test-results/packaged-${cycle}.png` });
      await page.evaluate(() => window.voxy.disconnect());
    } finally {
      fixture?.disconnect();
      await app.close();
    }
  }
  const result = {
    date: new Date().toISOString(),
    results: [
      "Executável ASAR abre em produção.",
      "SQLite WASM e dependências incluídas: host criado.",
      "Reinício preserva servidor e perfil; segredo DPAPI reutilizado.",
      "Histórico protegido e imagem do servidor persistem offline; reabrir sala pelo recente funciona; canal global preserva versões.",
      "Presença Ausente, identidade privada, histórico de DMs e marcador de não lidas sobrevivem à reabertura do pacote.",
    ],
  };
  console.log(result.results.join("\n"));
  await writeFile(
    "test-results/packaged.json",
    JSON.stringify(result, null, 2),
  );
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
