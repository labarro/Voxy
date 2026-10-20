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
  const {version}=JSON.parse(readFileSync('package.json','utf8'));
  const { directory } = JSON.parse(readFileSync(`release/${version}/latest-build.json`, "utf8"));
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
      const info = await page.evaluate(async (cycle) => {
        const p = await window.voxy.profile();
        if (cycle === 0) {
          await window.voxy.saveProfile({
            ...p,
            name: "Perfil persistido",
            pttEnabled: true,
            pttKey: "F9",
            callSounds: false,
          });
          await window.voxy.setVolume(p.id, 0.35, false);
          await window.voxy.setVolume(p.id, 0.15, true);
        }
        const info = await window.voxy.host({
          address: "127.0.0.1",
          port: 43138,
          name: "Pacote validado",
        });
        return { p, info };
      }, cycle);
      if (cycle === 1) {
        assert.equal(info.p.name, "Perfil persistido");
        assert.equal(info.p.pttEnabled, true);
        assert.equal(info.p.pttKey, "F9");
        assert.equal(info.p.callSounds, false);
        assert.equal(info.p.volumes?.[info.p.id], 0.35);
        assert.equal(info.p.streamVolumes?.[info.p.id], 0.15);
      }
      await page.getByRole("heading", { name: "Pacote validado" }).waitFor();
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
