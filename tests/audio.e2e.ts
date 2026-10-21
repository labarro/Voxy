import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createServer, connect as tcpConnect, type Socket } from "node:net";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

async function main() {
  const root = resolve("test-results", "audio-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const results: string[] = [];
  let online = true;
  let targetPort = 0;
  const connections = new Set<Socket>();
  const proxy = createServer((front) => {
    if (!online) {
      front.destroy();
      return;
    }
    const back = tcpConnect(targetPort, "127.0.0.1");
    connections.add(front);
    connections.add(back);
    front.pipe(back).pipe(front);
    front.on("error", () => back.destroy());
    back.on("error", () => front.destroy());
    front.on("close", () => {
      connections.delete(front);
      back.destroy();
    });
    back.on("close", () => {
      connections.delete(back);
      front.destroy();
    });
  });
  const drop = () => {
    online = false;
    for (const socket of connections) socket.destroy();
  };
  async function settings(page: Page) {
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
  }
  try {
    for (let i = 0; i < 2; i++) {
      const env: Record<string, string> = Object.fromEntries(
        Object.entries({
          ...process.env,
          VOXY_DATA_DIR: join(root, String(i)),
        }).filter((p): p is [string, string] => p[1] !== undefined),
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
      const page = await app.firstWindow();
      pages.push(page);
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .getByRole("heading", { name: "Sua frequência.", exact: false })
        .waitFor({ timeout: 20000 });
      const notes = page.getByRole("button", {
        name: "Entendi, vamos lá",
        exact: true,
      });
      if (await notes.count()) await notes.click();
      await page.evaluate(async (i) => {
        const p = await window.voxy.profile();
        await window.voxy.saveProfile({ ...p, name: i ? "Bruno" : "Ana" });
      }, i);
    }
    const [a, b] = pages;
    // Instrument real capture; no capture, audio, signaling or WebRTC implementation is replaced.
    await b.evaluate(() => {
      const w = window as any;
      w.captures = [];
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        w.captures.push({ stream, constraints });
        return stream;
      };
    });
    await settings(b);
    await b.getByLabel("Nome de exibição").fill("Bruno");
    await b
      .getByRole("button", { name: "Testar meu microfone", exact: true })
      .click();
    await b.getByText("Teste local ativo", { exact: false }).waitFor();
    await b.waitForFunction(() => (window as any).captures.length === 1);
    await b.screenshot({ path: "test-results/audio-microphone.png" });
    await b.getByLabel("Supressão de ruído", { exact: true }).uncheck();
    await b.getByLabel("Cancelamento de eco", { exact: true }).uncheck();
    await b.waitForFunction(() => {
      const c = (window as any).captures;
      return (
        c.length >= 2 &&
        c.at(-1).constraints.audio.noiseSuppression === false &&
        c.at(-1).constraints.audio.echoCancellation === false
      );
    });
    await b.getByLabel("Volume de entrada", { exact: true }).fill("0.8");
    await b
      .getByRole("button", { name: "Parar teste do microfone", exact: true })
      .click();
    await b.waitForFunction(() =>
      (window as any).captures.every((c: any) =>
        c.stream
          .getTracks()
          .every((t: MediaStreamTrack) => t.readyState === "ended"),
      ),
    );
    await b
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    const saved = await b.evaluate(() => window.voxy.profile());
    assert.equal(saved.noiseSuppression, false);
    assert.equal(saved.echoCancellation, false);
    assert.equal(saved.inputVolume, 0.8);
    results.push(
      "Teste privado antes da chamada, troca de processamento, preferências salvas e liberação de todas as capturas.",
    );
    const info = await a.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43158,
        name: "Áudio e reconexão",
      }),
    );
    targetPort = info.port;
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const port = (proxy.address() as { port: number }).port;
    const invite = info.invite.replace(":" + info.port + "/", ":" + port + "/");
    await b.evaluate((invite) => window.voxy.connect(invite), invite);
    await apps[1].evaluate(({ shell }) => {
      (globalThis as any).__opened = [];
      shell.openExternal = async (url) => {
        (globalThis as any).__opened.push(url);
      };
    });
    await b
      .getByLabel("Mensagem", { exact: true })
      .fill("Veja https://devbarros.com/ e javascript:alert(1)");
    await b
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await b
      .locator(".message")
      .getByRole("link", { name: "https://devbarros.com/", exact: true })
      .click();
    await b.locator(".creator-credit").click();
    assert.deepEqual(
      await apps[1].evaluate(() => (globalThis as any).__opened),
      ["https://devbarros.com/", "https://devbarros.com/"],
    );
    assert(
      await b.evaluate(async () => {
        try {
          await window.voxy.openExternal("file:///C:/Windows");
          return false;
        } catch {
          return true;
        }
      }),
    );
    results.push(
      "Link de mensagem e crédito encaminhados ao navegador via IPC; URL file bloqueada. A chamada do shell foi interceptada somente no teste.",
    );
    for (const page of pages) {
      await page
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
      await page.locator(".voice-status").waitFor();
    }
    await b.waitForFunction(() => {
      const c = (window as any).captures.at(-1);
      return (
        c.constraints.audio.noiseSuppression === false &&
        c.constraints.audio.echoCancellation === false
      );
    });
    await settings(b);
    await b
      .getByRole("button", { name: "Testar meu microfone", exact: true })
      .click();
    await a
      .locator(".participant-card")
      .filter({ hasText: "Bruno" })
      .getByRole("img", { name: "Microfone mutado", exact: true })
      .waitFor();
    await b.getByRole("button", { name: "Fechar", exact: true }).click();
    await a
      .locator(".participant-card")
      .filter({ hasText: "Bruno" })
      .getByRole("img", { name: "Microfone mutado", exact: true })
      .waitFor({ state: "hidden" });
    results.push(
      "Teste durante chamada pausa o envio e fechar configurações restaura o estado anterior.",
    );
    const card = b.locator(".participant-card").filter({ hasText: "Ana" });
    assert.equal(await card.getByRole("slider").count(), 0);
    await card.click({ button: "right" });
    const menu = b.locator(".participant-menu");
    await menu.waitFor();
    await b.screenshot({ path: "test-results/audio-menu.png" });
    assert((await menu.boundingBox())!.width < 300);
    await menu
      .getByRole("slider", { name: "Volume de Ana", exact: true })
      .fill("2");
    const hostProfile = await a.evaluate(() => window.voxy.profile());
    await b.waitForFunction(
      async (id) => (await window.voxy.profile()).volumes?.[id] === 2,
      hostProfile.id,
    );
    await menu
      .getByRole("button", { name: "Mutar voz para mim", exact: true })
      .click();
    await b.locator("h1").first().click();
    await menu.waitFor({ state: "hidden" });
    await card.click({ button: "right" });
    assert.equal(await menu.getByRole("slider").inputValue(), "2");
    await menu
      .getByRole("button", { name: "Ouvir voz novamente", exact: true })
      .click();
    await b.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    results.push(
      "Menu contextual compacto, volume 200% persistido, mute individual e fechamento fora/Escape.",
    );
    const before = await readFile(join(root, "1", "profile.json"), "utf8");
    drop();
    await b.locator(".reconnect-banner").waitFor();
    online = true;
    await b.locator(".voice-status").waitFor({ timeout: 20000 });
    await a.waitForFunction(
      () => document.querySelectorAll(".channel-person").length === 2,
    );
    assert.equal(
      (await b.evaluate(() => window.voxy.profile())).volumes?.[hostProfile.id],
      2,
    );
    assert.equal(
      JSON.parse(before).id,
      (await b.evaluate(() => window.voxy.profile())).id,
    );
    results.push(
      "Queda TCP real restaura servidor e canal de voz automaticamente, sem duplicação e mantendo perfil/volume.",
    );
    // A second drop is explicitly cancelled by the user and must not resurrect a call.
    drop();
    await b.locator(".reconnect-banner").waitFor();
    await b.evaluate(() => window.voxy.disconnect());
    online = true;
    await b.waitForTimeout(2200);
    assert.equal(await b.locator(".voice-status").count(), 0);
    assert.equal(await b.locator(".reconnect-banner").count(), 0);
    await b.evaluate((invite) => window.voxy.connect(invite), invite);
    await b
      .getByRole("button", { name: "Sala dos amigos", exact: true })
      .click();
    await b.locator(".voice-status").waitFor();
    drop();
    await b.locator(".reconnect-banner").waitFor();
    await b
      .getByText("Reconexão encerrada após 5 tentativas.", { exact: false })
      .waitFor({ timeout: 70000 });
    assert.equal(await b.locator(".reconnect-banner").count(), 0);
    online = true;
    await b.waitForTimeout(6500);
    assert.equal(await b.locator(".voice-status").count(), 0);
    results.push(
      "Saída voluntária cancela reconexão; indisponibilidade prolongada encerra em cinco tentativas e não volta sozinha.",
    );
    assert.deepEqual(errors, []);
    await b.screenshot({ path: "test-results/audio-offline.png" });
    await writeFile(
      "test-results/audio.json",
      JSON.stringify(
        { date: new Date().toISOString(), results, errors },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ results, errors }));
  } finally {
    for (const s of connections) s.destroy();
    await new Promise<void>((r) => proxy.close(() => r()));
    for (const app of apps) await app.close().catch(() => {});
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
