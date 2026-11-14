import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { key } from "./support/keyboard";

async function main() {
  const root = resolve("test-results", "call-network-" + Date.now());
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    checks: string[] = [];
  await mkdir(root, { recursive: true });
  try {
    for (let i = 0; i < 2; i++) {
      const data = join(root, String(i));
      await mkdir(data, { recursive: true });
      await writeFile(
        join(data, "profile.json"),
        JSON.stringify({
          id: randomUUID(),
          name: `Network ${i}`,
          avatar: "A",
          input: i ? "missing-usb-device" : "",
          output: "",
          callSounds: false,
          pttEnabled: i === 1,
          pttKey: "F9",
        }),
      );
      const env = Object.fromEntries(
        Object.entries({ ...process.env, VOXY_DATA_DIR: data }).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({
        args: [
          ".",
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
        ],
        env,
      });
      apps.push(app);
      const p = await app.firstWindow();
      pages.push(p);
      await p
        .getByRole("button", { name: "Configurações", exact: true })
        .waitFor();
      const notes = p.getByRole("button", { name: "Entendi, vamos lá" });
      if (await notes.count()) await notes.click();
      await p.evaluate(() =>
        window.voxy.onEvent((e) => {
          if (e.type === "state") (window as any).state = e.state;
        }),
      );
    }
    const addresses = await pages[0].evaluate(() => window.voxy.addresses());
    const radmin = addresses.find((ip) => ip.startsWith("26."));
    assert(
      radmin,
      "This test requires the real Radmin adapter; do not silently substitute loopback",
    );
    const info = await pages[0].evaluate(
      (address) =>
        window.voxy.host({
          address,
          port: 43393,
          name: "Radmin local adapter test",
        }),
      radmin,
    );
    await pages[1].evaluate(
      (invite) => window.voxy.connect(invite),
      info.invite,
    );
    for (const p of pages)
      await p
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
    for (const p of pages)
      await p
        .getByText("Voz conectada", { exact: true })
        .waitFor({ timeout: 30000 });
    checks.push(
      "two real Electron clients use host signaling bound to the local Radmin interface; media peers connect",
    );
    await pages[1]
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await pages[1]
      .getByRole("button", { name: "Avançado", exact: true })
      .click();
    await pages[1]
      .getByRole("button", { name: "Abrir diagnóstico de conexão" })
      .click();
    await pages[1]
      .getByRole("button", { name: "Copiar diagnóstico seguro" })
      .click();
    const report = await apps[1].evaluate(async ({ clipboard }) =>
      JSON.parse(await clipboard.readText()),
    );
    assert(
      report.log.some((v: any) => v.stage === "microphone.default-fallback"),
    );
    const text = JSON.stringify(report);
    for (const secret of [
      info.invite,
      radmin,
      "missing-usb-device",
      "Network 0",
      "Network 1",
    ])
      assert(!text.includes(secret));
    checks.push(
      "saved missing USB input falls back to the default; copied report omits invitation, address, names and device IDs",
    );
    const lossBefore = report.peers[0]?.loss;
    await pages[1].getByRole("button", { name: "Fechar", exact: true }).click();
    await apps[1].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await pages[1].waitForTimeout(2000);
    await key(false, 120);
    await pages[1].waitForFunction(
      () => !!document.querySelector(".voice-status .ptt-open"),
    );
    await key(true, 120);
    await pages[1].waitForFunction(
      () => !document.querySelector(".voice-status .ptt-open"),
    );
    checks.push(
      "global F9 Push-to-Talk opens and closes the microphone while minimized",
    );
    await pages[1].waitForTimeout(60000);
    await apps[1].evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.restore();
      w.focus();
    });
    await pages[1]
      .getByText("Voz conectada", { exact: true })
      .waitFor({ timeout: 10000 });
    checks.push(
      `one minute minimized preserves voice connection (initial packet loss counter: ${lossBefore})`,
    );
    const result = {
      checks,
      syntheticDevices: true,
      limitation:
        "Two processes on one Windows host. Local Radmin binding does not validate routes, firewall or microphone hardware on a second computer.",
    };
    await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
    console.log(root, JSON.stringify(result, null, 2));
  } finally {
    await key(true, 120);
    for (const app of apps) await app.close().catch(() => {});
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
