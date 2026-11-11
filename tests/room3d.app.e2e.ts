import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

async function main() {
  const packed = process.argv.includes("--packaged");
  let executablePath: string | undefined;
  if (packed) {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    const { directory } = JSON.parse(
      await readFile(`release/${version}/latest-build.json`, "utf8"),
    );
    executablePath = join(directory, "win-unpacked", "Voxy.exe");
  }
  const root = resolve("test-results", "room3d-app-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    errors: string[] = [];
  const activate = async (index: number) => {
    for (const [other, app] of apps.entries()) {
      if (
        other === index ||
        !(process.env.CI || process.env.VOXY_TEST_SOFTWARE_GL)
      )
        continue;
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].minimize(),
      );
      if (pages[other])
        await pages[other].waitForFunction(
          () => document.documentElement.dataset.background === "true",
        );
    }
    await apps[index].evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
  };
  try {
    for (let i = 0; i < 2; i++) {
      const env = Object.fromEntries(
        Object.entries({
          ...process.env,
          VOXY_DATA_DIR: join(root, String(i)),
        }).filter((p): p is [string, string] => p[1] !== undefined),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({
        executablePath,
        args: [
          ...(packed ? [] : ["."]),
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          ...(process.env.CI || process.env.VOXY_TEST_SOFTWARE_GL
            ? [
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--disable-features=CalculateNativeWinOcclusion",
              ]
            : []),
        ],
        env,
      });
      apps.push(app);
      const page = await app.firstWindow();
      pages.push(page);
      await app.evaluate(({ BrowserWindow }, index) => {
        // Two desktop processes must remain partially visible on a single CI display.
        // Playwright input injection alone does not activate native Electron windows.
        BrowserWindow.getAllWindows()[0].setPosition(
          60 + index * 90,
          40 + index * 70,
        );
      }, i);
      await activate(i);
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .getByRole("heading", { name: "Sua frequência.", exact: false })
        .waitFor({ timeout: 20000 });
      const notes = page.getByRole("button", {
        name: "Entendi, vamos lá",
        exact: true,
      });
      if (await notes.count()) await notes.click();
      await page
        .getByRole("button", { name: "Configurações", exact: true })
        .click();
      await page.getByLabel("Nome de exibição").fill(i ? "Bruno 3D" : "Ana 3D");
      await page.getByRole("button", { name: "Salas 3D", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Ao entrar em canal compatível" })
        .selectOption("always");
      if (process.env.CI || process.env.VOXY_TEST_SOFTWARE_GL)
        await page
          .getByRole("combobox", { name: "Qualidade gráfica", exact: true })
          .selectOption("low");
      await page
        .getByRole("button", { name: "Salvar perfil e dispositivos" })
        .click();
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      await page
        .getByRole("button", { name: "Configurações", exact: true })
        .click();
      await page.getByRole("button", { name: "Salas 3D", exact: true }).click();
      await page
        .getByRole("button", { name: /Seu personagem, do seu jeito/ })
        .click();
      await page.locator('.avatar-studio[data-ready="true"]').waitFor();
      await page
        .getByRole("button", { name: "Cabelo Longo", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Aplicar personagem", exact: true })
        .click();
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      assert.equal(
        (await page.evaluate(() => window.voxy.profile())).avatar3d?.hair,
        "long",
      );
    }
    const [a, b] = pages;
    const host = await a.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43174,
        name: "Espaço 3D",
      }),
    );
    await b.evaluate((invite) => window.voxy.connect(invite), host.invite);
    await a
      .getByRole("button", { name: "Gerenciar servidor e canais", exact: true })
      .click();
    await a
      .getByRole("combobox", {
        name: "Ambiente de Sala dos amigos",
        exact: true,
      })
      .selectOption("lounge");
    await a
      .locator("dialog[open]")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    for (const [index, page] of pages.entries()) {
      await activate(index);
      await page
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
      await page
        .locator('.room3d canvas[data-ready="true"]')
        .waitFor({ timeout: 30000 });
    }
    await activate(0);
    await a.waitForFunction(() =>
      document
        .querySelector(".room-identity")
        ?.textContent?.includes("2 no ambiente"),
    );
    await activate(1);
    const canvas = b.locator(".room3d canvas");
    await canvas.focus();
    await b.keyboard.down("KeyD");
    await b.waitForTimeout(500);
    await b.keyboard.up("KeyD");
    // Switching views must not start another microphone capture.
    await b.evaluate(() => {
      const w = window as any;
      w.beforeVoiceStatus =
        document.querySelector(".voice-status")?.textContent;
      w.captureCalls = 0;
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (c) => {
        w.captureCalls++;
        return original(c);
      };
    });
    await b
      .getByRole("button", { name: "Voltar ao canal", exact: true })
      .click();
    assert.equal(await b.locator(".room3d canvas").count(), 0);
    assert(await b.locator(".voice-status").count());
    await b
      .getByRole("button", { name: "Entrar na sala 3D", exact: true })
      .click();
    await b.locator('.room3d canvas[data-ready="true"]').waitFor();
    assert.equal(await b.evaluate(() => (window as any).captureCalls), 0);
    await b
      .getByRole("button", { name: "Tela cheia da sala", exact: true })
      .click();
    await b.waitForFunction(() => !!document.fullscreenElement);
    await b
      .getByRole("button", { name: "Personalizar personagem", exact: true })
      .click();
    await b.waitForFunction(() => !document.fullscreenElement);
    await b
      .getByRole("heading", { name: "Do seu jeito.", exact: true })
      .waitFor();
    await b.locator('.avatar-studio[data-ready="true"]').waitFor();
    await a.evaluate(() => {
      const w = window as any;
      w.avatarOff = window.voxy.onEvent((event) => {
        if (event.type === "state")
          w.latestAvatarProfiles = event.state.participants.map(
            (p) => p.profile,
          );
      });
    });
    await b.getByRole("button", { name: "Cabelo Coques", exact: true }).click();
    await b.getByRole("tab", { name: "Roupas", exact: true }).click();
    await b.getByRole("button", { name: "Roupa Moletom", exact: true }).click();
    await b.screenshot({
      path: join(root, "integrated-character-creator.png"),
    });
    await b
      .getByRole("button", { name: "Aplicar personagem", exact: true })
      .click();
    await b.locator("dialog[open]").waitFor({ state: "detached" });
    assert.equal(
      (await b.evaluate(() => window.voxy.profile())).avatar3d?.outfitStyle,
      "hoodie",
    );
    await activate(0);
    await a.waitForFunction(
      () =>
        (window as any).latestAvatarProfiles?.find(
          (p: any) => p.name === "Bruno 3D",
        )?.avatar3d?.hairStyle === "curly",
    );
    await a.evaluate(() => (window as any).avatarOff());
    await activate(1);
    await b
      .getByRole("button", { name: "Tela cheia da sala", exact: true })
      .click();
    await b.waitForFunction(() => !!document.fullscreenElement);
    await b.keyboard.press("Escape");
    await b.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await b.evaluate(() => (window as any).captureCalls), 0);
    await b
      .locator(".room-dock")
      .getByRole("button", { name: "Mutar microfone", exact: true })
      .click();
    await b
      .locator(".room-dock")
      .getByRole("button", { name: "Ativar microfone", exact: true })
      .waitFor();
    await b
      .locator(".room-dock")
      .getByRole("button", { name: "Silenciar áudio", exact: true })
      .click();
    await b
      .locator(".room-dock")
      .getByRole("button", { name: "Desativar Deafen", exact: true })
      .waitFor();
    await a.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        const timer = setInterval(() => {
          ctx.fillStyle = "#26b389";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "#ffffff";
          ctx.font = "42px sans-serif";
          ctx.fillText("TV integrada / WebRTC", 40, 190);
        }, 80);
        const stream = canvas.captureStream(12);
        stream
          .getVideoTracks()[0]
          .addEventListener("ended", () => clearInterval(timer));
        return stream;
      };
    });
    await activate(0);
    await a
      .locator(".room-dock")
      .getByRole("button", { name: "Compartilhar tela", exact: true })
      .click();
    await a
      .locator("dialog[open]")
      .getByRole("button", { name: "Iniciar transmissão", exact: true })
      .click();
    await activate(1);
    await b
      .getByRole("button", { name: "Assistir na TV", exact: true })
      .click();
    await b.waitForFunction(
      () =>
        document.querySelector(".room3d")?.getAttribute("data-camera-mode") ===
        "watch",
    );
    await b.getByRole("button", { name: "Ampliar TV", exact: true }).click();
    await b.waitForFunction(
      () =>
        document.querySelector<HTMLVideoElement>(
          '.player[data-kind="screen"] video',
        )?.readyState === 4,
    );
    const pixel = await b
      .locator('.player[data-kind="screen"] video')
      .evaluate((video) => {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        c.getContext("2d")!.drawImage(video as HTMLVideoElement, 0, 0, 1, 1);
        return [...c.getContext("2d")!.getImageData(0, 0, 1, 1).data];
      });
    assert(
      pixel[1] > 140 && pixel[0] < 100,
      "TV must receive the remote synthetic video through WebRTC",
    );
    await b.getByRole("button", { name: "Tela cheia", exact: true }).click();
    await b.waitForFunction(() =>
      document.fullscreenElement?.classList.contains("player"),
    );
    await b.keyboard.press("Escape");
    await b.waitForFunction(() => !document.fullscreenElement);
    const backToRoom = b.getByRole("button", {
      name: "Voltar à sala",
      exact: false,
    });
    if (await backToRoom.count()) await backToRoom.first().click();
    assert.equal(await b.locator(".room-tv-expanded").count(), 0);
    await b.waitForTimeout(250);
    await b.screenshot({ path: join(root, "integrated-tv.png") });
    await activate(0);
    await a
      .locator(".room-dock")
      .getByRole("button", { name: "Parar transmissão", exact: true })
      .click();
    await a.waitForFunction(() =>
      document
        .querySelector(".room-identity")
        ?.textContent?.includes("2 no ambiente"),
    );
    await apps[0].evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    });
    await a.waitForTimeout(850);
    await a.screenshot({ path: join(root, "integrated-lounge.png") });
    await a
      .getByRole("button", { name: "Gerenciar servidor e canais", exact: true })
      .click();
    await a
      .getByRole("combobox", {
        name: "Ambiente de Sala dos amigos",
        exact: true,
      })
      .selectOption("cinema");
    await a
      .locator("dialog[open]")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    for (const page of pages)
      await page
        .getByRole("region", { name: "Cinema 3D", exact: true })
        .waitFor();
    await a.locator('.room3d canvas[data-ready="true"]').waitFor();
    await a.waitForTimeout(850);
    await a.screenshot({ path: join(root, "integrated-cinema.png") });
    assert.deepEqual(errors, []);
    await writeFile(
      join(root, "results.json"),
      JSON.stringify(
        {
          errors,
          checks: [
            "two Electron clients",
            "native background rendering suspension with call preserved",
            "profile persistence",
            "host preset UI",
            "automatic 3D entry",
            "remote occupancy",
            "movement",
            "view switching without new microphone capture",
            "mute",
            "deafen",
            "remote WebRTC video decoded in TV and expanded player",
            "direct 3D settings shortcut",
            "character creator apply without microphone recapture",
            "extended avatar styles synchronized to the other client",
            "room fullscreen and native Escape",
            "watch camera and transmission fullscreen",
            "live preset change",
          ],
        },
        null,
        2,
      ),
    );
    console.log("Integrated 3D rooms passed in two Electron clients. " + root);
  } catch (error) {
    const diagnostics = [];
    for (const [index, page] of pages.entries()) {
      if (page.isClosed()) continue;
      await page
        .screenshot({ path: join(root, `failure-${index}.png`) })
        .catch(() => {});
      diagnostics.push(
        await page
          .evaluate(() => ({
            errors: [...document.querySelectorAll('.error,[role="alert"]')].map(
              (el) => el.textContent,
            ),
            room: document.querySelector(".room3d")?.getAttribute("aria-label"),
            invitation: document.querySelector(".room-invitation")?.textContent,
            voice: document.querySelector(".voice-status")?.textContent,
            canvas: document
              .querySelector(".room3d canvas")
              ?.getAttribute("data-ready"),
          }))
          .catch(() => ({ errors: ["Page unavailable"] })),
      );
    }
    await writeFile(
      join(root, "failure.json"),
      JSON.stringify({ diagnostics, errors, error: String(error) }, null, 2),
    );
    console.error(JSON.stringify({ diagnostics, errors }));
    throw error;
  } finally {
    for (const app of apps.reverse()) await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
