import { _electron as electron, type ElectronApplication } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
async function main() {
  const root = resolve("test-results", "system-features-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [];
  const errors: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const env: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (p): p is [string, string] => p[1] !== undefined,
          ),
        ),
        VOXY_DATA_DIR: join(root, String(i)),
      };
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
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .getByRole("heading", { name: "Sua frequência.", exact: false })
        .waitFor();
      const notes = page.getByRole("button", {
        name: "Entendi, vamos lá",
        exact: true,
      });
      if (await notes.count()) await notes.click();
      await page.evaluate(() => {
        window.voxy.onEvent((e) => {
          if (e.type === "state") (window as any).__room = e.state;
        });
      });
      await app.evaluate(({ Notification, Tray }) => {
        const globals = globalThis as any;
        globals.__nativeNotices = [];
        Notification.prototype.show = function () {
          globals.__nativeNotices.push(this.title);
          globals.__lastNotice = this;
        };
        const original = Tray.prototype.setContextMenu;
        Tray.prototype.setContextMenu = function (menu) {
          globals.__trayMenu = menu;
          return original.call(this, menu);
        };
      });
      await page.evaluate(async (i) => {
        const p = await window.voxy.profile();
        await window.voxy.saveProfile({ ...p, name: i ? "Bruno" : "Ana" });
      }, i);
    }
    const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
    const pa = await a.evaluate(() => window.voxy.profile()),
      pb = await b.evaluate(() => window.voxy.profile());
    const host = await a.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43169,
        name: "Sala do sistema",
      }),
    );
    await b.evaluate((invite) => window.voxy.connect(invite), host.invite);
    await a.waitForFunction(
      () => (window as any).__room?.participants.length === 2,
    );
    const channel = await b.evaluate(
      () =>
        (window as any).__room.channels.find((c: any) => c.kind === "text")
          .id as string,
    );
    await a.getByRole("button", { name: "Home", exact: true }).click();
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await b.evaluate(
      ({ channel, owner }) =>
        window.voxy.command({
          type: "message",
          channelId: channel,
          text: `Menção de teste @{${owner}}`,
        }),
      { channel, owner: pa.id },
    );
    await a.waitForFunction(async () =>
      (await window.voxy.notifications()).items.some(
        (n) => n.kind === "mention",
      ),
    );
    let state = await a.evaluate(() => window.voxy.notifications());
    const mention = state.items.find((n) => n.kind === "mention")!;
    assert.equal(Object.values(state.unreadChannels)[0], 1);
    assert.equal(
      await apps[0].evaluate(() => (globalThis as any).__nativeNotices.length),
      1,
    );
    await apps[0].evaluate(() =>
      (globalThis as any).__lastNotice.emit("click"),
    );
    await a.locator("#message-" + mention.messageId + ".located").waitFor();
    await a.waitForFunction(async () =>
      Object.values((await window.voxy.notifications()).unreadChannels).every(
        (n) => !n,
      ),
    );
    const total = (await a.evaluate(() => window.voxy.notifications())).items
      .length;
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].focus(),
    );
    await b.evaluate(
      ({ channel, owner }) =>
        window.voxy.command({
          type: "message",
          channelId: channel,
          text: `Visível @{${owner}}`,
        }),
      { channel, owner: pa.id },
    );
    await a.getByText("Visível", { exact: false }).waitFor();
    assert.equal(
      (await a.evaluate(() => window.voxy.notifications())).items.length,
      total,
    );
    await a.getByRole("button", { name: "Home", exact: true }).click();
    await a.evaluate(
      (channel) =>
        window.voxy.command({
          type: "message",
          channelId: channel,
          text: "Minha mensagem",
        }),
      channel,
    );
    await b.waitForFunction(() =>
      (window as any).__room.messages.some(
        (m: any) => m.text === "Minha mensagem",
      ),
    );
    const replyTo = await b.evaluate(
      () =>
        (window as any).__room.messages.find(
          (m: any) => m.text === "Minha mensagem",
        ).id as string,
    );
    await b.evaluate(
      ({ channel, replyTo }) =>
        window.voxy.command({
          type: "message",
          channelId: channel,
          text: "Respondendo",
          replyTo,
        }),
      { channel, replyTo },
    );
    await a.waitForFunction(async () =>
      (await window.voxy.notifications()).items.some((n) => n.kind === "reply"),
    );
    await b.evaluate(
      (owner) =>
        window.voxy.command({ type: "friend.request", memberId: owner }),
      pa.id,
    );
    await a.waitForFunction(async () =>
      (await window.voxy.notifications()).items.some(
        (n) => n.kind === "friend-request",
      ),
    );
    await a.evaluate(
      (peer) =>
        window.voxy.command({
          type: "friend.respond",
          memberId: peer,
          accept: true,
        }),
      pb.id,
    );
    await b.waitForFunction(async () =>
      (await window.voxy.notifications()).items.some(
        (n) => n.kind === "friend-accepted",
      ),
    );
    const scope = await b.evaluate(
      async () => (await window.voxy.inbox()).activeScope!,
    );
    await b.evaluate(
      ({ scope, owner }) =>
        window.voxy.command({
          type: "direct.message",
          scope,
          recipient: owner,
          text: "DM para a central",
        }),
      { scope, owner: pa.id },
    );
    await a.waitForFunction(async () =>
      (await window.voxy.notifications()).items.some(
        (n) => n.kind === "direct",
      ),
    );
    await a.getByRole("button", { name: "Notificações", exact: true }).click();
    await a
      .getByRole("heading", { name: "Notificações", exact: true })
      .waitFor();
    await a.screenshot({ path: join(root, "notification-center.png") });
    await a.getByRole("button", { name: "Marcar todas como lidas" }).click();
    assert(
      (await a.evaluate(() => window.voxy.notifications())).items.every(
        (n) => n.read,
      ),
    );
    const persisted = JSON.parse(
      await readFile(join(root, "0", "notifications.json"), "utf8"),
    );
    assert(persisted.items.every((n: any) => n.read));
    // Keep the new feature preferences in the profile without reloading a call.
    await a.getByRole("button", { name: "Configurações", exact: true }).click();
    await a.getByRole("button", { name: "Windows", exact: true }).click();
    await a.getByLabel("Botão fechar minimiza para a bandeja").check();
    await a
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await a
      .getByRole("button", { name: "Sala dos amigos", exact: true })
      .click();
    await a.locator(".voice-status").waitFor();
    await a.getByRole("button", { name: "Ativar câmera", exact: true }).click();
    await a
      .getByRole("button", { name: "Ligar câmera selecionada", exact: true })
      .click();
    await a.locator(".player video").waitFor();
    await a
      .getByRole("button", {
        name: "Picture-in-Picture (sempre no topo)",
        exact: true,
      })
      .click();
    await a.waitForFunction(() => !!document.pictureInPictureElement);
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    assert(
      !(await apps[0].evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      )),
    );
    await a.waitForTimeout(1200);
    assert(await a.evaluate(() => !!document.pictureInPictureElement));
    assert(await a.locator(".voice-status").count());
    assert(
      await a.locator(".player video").count(),
      "PiP mantém o mesmo player",
    );
    // Invoke the real menu callbacks without driving the user's taskbar.
    await apps[0].evaluate(() => {
      const menu = (globalThis as any).__trayMenu;
      menu.items.find((i: any) => i.label === "Deafen").click();
    });
    await a.locator(".titlebar-call-state").waitFor();
    await apps[0].evaluate(() => {
      const menu = (globalThis as any).__trayMenu;
      menu.items.find((i: any) => i.label === "Abrir Voxy").click();
    });
    assert(
      await apps[0].evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    );
    await a
      .getByRole("button", { name: "Retornar do PiP", exact: true })
      .click();
    await a.waitForFunction(() => !document.pictureInPictureElement);
    await a
      .getByRole("button", {
        name: "Picture-in-Picture (sempre no topo)",
        exact: true,
      })
      .click();
    await a
      .getByRole("button", { name: "Desligar câmera", exact: true })
      .click();
    await a.waitForFunction(() => !document.pictureInPictureElement);
    await b
      .getByRole("button", { name: "Sala dos amigos", exact: true })
      .click();
    await b.locator(".voice-status").waitFor();
    await b.getByRole("button", { name: "Ativar câmera", exact: true }).click();
    await b
      .getByRole("button", { name: "Ligar câmera selecionada", exact: true })
      .click();
    await a
      .getByRole("button", {
        name: "Picture-in-Picture (sempre no topo)",
        exact: true,
      })
      .click();
    await a.waitForFunction(() => !!document.pictureInPictureElement);
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
    const frames = await a.evaluate(
      () =>
        (
          document.pictureInPictureElement as HTMLVideoElement
        ).getVideoPlaybackQuality().totalVideoFrames,
    );
    await a.waitForFunction(
      (frames) =>
        (
          document.pictureInPictureElement as HTMLVideoElement
        )?.getVideoPlaybackQuality().totalVideoFrames > frames,
      frames,
    );
    await b
      .getByRole("button", { name: "Desligar câmera", exact: true })
      .click();
    await a.waitForFunction(() => !document.pictureInPictureElement);
    await apps[0].evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].show();
      BrowserWindow.getAllWindows()[0].focus();
    });
    await b
      .getByRole("button", { name: "Compartilhar tela", exact: true })
      .click();
    await b.locator(".source").first().click();
    await b
      .getByRole("button", { name: "Iniciar transmissão", exact: true })
      .click();
    await a
      .locator('.player[data-kind="screen"]')
      .getByRole("button", {
        name: "Picture-in-Picture (sempre no topo)",
        exact: true,
      })
      .click();
    await a.waitForFunction(() => !!document.pictureInPictureElement);
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
    const screenFrames = await a.evaluate(
      () =>
        (
          document.pictureInPictureElement as HTMLVideoElement
        ).getVideoPlaybackQuality().totalVideoFrames,
    );
    await a.waitForFunction(
      (frames) =>
        (
          document.pictureInPictureElement as HTMLVideoElement
        )?.getVideoPlaybackQuality().totalVideoFrames > frames,
      screenFrames,
    );
    await b
      .getByRole("button", { name: "Parar transmissão", exact: true })
      .click();
    await a.waitForFunction(() => !document.pictureInPictureElement);
    assert.deepEqual(errors, []);
    await writeFile(
      join(root, "result.json"),
      JSON.stringify(
        {
          checks:
            "Menção, reply, DM, amizades, notificação nativa instrumentada, navegação à mensagem, leitura, persistência, PiP nativo, bandeja, chamada preservada, fim de câmera fecha PiP.",
          errors,
        },
        null,
        2,
      ),
    );
    const exited = new Promise<void>((resolve) =>
      apps[0].process().once("exit", () => resolve()),
    );
    await apps[0].evaluate(() => {
      const menu = (globalThis as any).__trayMenu;
      menu.items.find((i: any) => i.label === "Sair").click();
    });
    await exited;
    console.log("Notificações, PiP e bandeja verificados.", root);
  } finally {
    for (const app of apps.reverse()) await app.close().catch(() => {});
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
