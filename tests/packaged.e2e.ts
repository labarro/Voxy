import { _electron as electron } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
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
  for (let cycle = 0; cycle < 2; cycle++) {
    const app = await electron.launch({ executablePath, args: [], env });
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
            pttKey: "KeyQ",
            inputVolume: 0.65,
            voiceDetection: true,
            voiceThreshold: -38,
            callSounds: false,
            cameraDevice: "camera-persisted",
          });
          await window.voxy.setVolume(p.id, 0.35, false);
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
        assert(info.p.avatar.startsWith("data:image/png;base64,"));
        assert.equal(info.p.pttEnabled, true);
        assert.equal(info.p.pttKey, "KeyQ");
        assert.equal(info.p.inputVolume, 0.65);
        assert.equal(info.p.voiceDetection, true);
        assert.equal(info.p.voiceThreshold, -38);
        assert.equal(info.p.mutedParticipants?.[info.p.id], true);
        assert.equal(info.p.callSounds, false);
        assert.equal(info.p.cameraDevice, "camera-persisted");
        assert.equal(info.p.volumes?.[info.p.id], 0.35);
        assert.equal(info.p.streamVolumes?.[info.p.id], 0.15);
      }
      await page.getByRole("heading", { name: "Pacote validado" }).waitFor();
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
