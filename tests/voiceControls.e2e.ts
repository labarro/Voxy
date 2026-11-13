import { _electron as electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { key } from "./support/keyboard";

async function main() {
  const root = resolve("test-results", "voice-controls-" + Date.now());
  await mkdir(root, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (p): p is [string, string] => p[1] !== undefined,
      ),
    ),
    VOXY_DATA_DIR: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [
      ".",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    env,
  });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("heading", { name: "Sua frequência.", exact: false })
      .waitFor();
    const notes = page.getByRole("button", {
      name: "Entendi, vamos lá",
      exact: true,
    });
    if (await notes.count()) await notes.click();
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page.getByRole("button", { name: "Atalhos", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Configurar Mutar/desmutar microfone",
        exact: true,
      })
      .click();
    await page.keyboard.press("Control+Shift+M");
    await page
      .getByRole("button", { name: "Configurar Deafen", exact: true })
      .click();
    // Dispatch the browser side-button event to exercise the picker.
    const deafenPicker = page.getByRole("button", {
      name: "Configurar Deafen",
      exact: true,
    });
    await deafenPicker.dispatchEvent("pointerdown", { button: 3 });
    await page
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    const prefs = await page.evaluate(() => window.voxy.profile());
    assert.deepEqual(prefs.muteShortcut, {
      key: "KeyM",
      ctrl: true,
      shift: true,
      alt: false,
    });
    assert.equal(prefs.deafenShortcut?.key, "Mouse4");
    await page.evaluate(() =>
      window.voxy.host({ address: "127.0.0.1", port: 43168, name: "Atalhos" }),
    );
    await page
      .getByRole("button", { name: "Sala dos amigos", exact: true })
      .click();
    await page.locator(".voice-status").waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    // Allow the reader's first heartbeat to arrive before testing key edges.
    await page.waitForTimeout(1800);
    const mute = async () => {
      await key(false, 17);
      await key(false, 16);
      await key(false, 77);
      await key(true, 77);
      await key(true, 16);
      await key(true, 17);
    };
    await mute();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.profile-bar button[aria-label="Ativar microfone"]')
          ?.getAttribute("aria-pressed") === "true",
    );
    await key(false, 5);
    await page.waitForFunction(
      () =>
        document.querySelector(".titlebar-call-state")?.textContent ===
        "Deafen ativo",
    );
    await page.waitForTimeout(800);
    assert.equal(
      await page.locator(".titlebar-call-state").count(),
      1,
      "Segurar não repete toggle",
    );
    await key(true, 5);
    await key(false, 5);
    await key(true, 5);
    await page.locator(".titlebar-call-state").waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator('.profile-bar button[aria-label="Ativar microfone"]')
        .getAttribute("aria-pressed"),
      "true",
      "Mute anterior deve voltar",
    );
    await mute();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.profile-bar button[aria-label="Mutar microfone"]')
          ?.getAttribute("aria-pressed") === "false",
    );
    await key(false, 5);
    await key(true, 5);
    await page.locator(".titlebar-call-state").waitFor();
    await mute(); // Must not change saved mute during Deafen.
    await key(false, 5);
    await key(true, 5);
    await page.locator(".titlebar-call-state").waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator('.profile-bar button[aria-label="Mutar microfone"]')
        .getAttribute("aria-pressed"),
      "false",
    );
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.restore();
      win.focus();
    });
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await page.getByRole("button", { name: "Kuromi", exact: true }).click();
    await page
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".window-titlebar")!)
          .backgroundColor === "rgb(24, 21, 31)",
    );
    await page.screenshot({ path: join(root, "kuromi-titlebar.png") });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].maximize(),
    );
    await page.waitForTimeout(250);
    assert(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].unmaximize(),
    );
    assert(
      !(await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      )),
    );
    assert.deepEqual(errors, []);
    await writeFile(
      join(root, "result.json"),
      JSON.stringify(
        {
          saved: prefs,
          errors,
          checks:
            "Combinação, Mouse4, segundo plano, segurar sem repetir, restauração do mute, Deafen, Kuromi, maximizar/restaurar.",
        },
        null,
        2,
      ),
    );
    console.log(
      "Atalhos globais, Deafen, persistência e barra Kuromi verificados.",
      root,
    );
  } finally {
    for (const code of [17, 16, 77, 5]) await key(true, code);
    await app.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
