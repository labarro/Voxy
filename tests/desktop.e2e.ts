import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { key as globalF9 } from "./support/keyboard";
async function centered(page: Page) {
  const r = await page.locator("dialog[open]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      vw: innerWidth,
      vh: innerHeight,
      w: r.width,
      h: r.height,
    };
  });
  assert(
    Math.abs(r.x - r.vw / 2) < 2 && Math.abs(r.y - r.vh / 2) < 2,
    JSON.stringify(r),
  );
  assert(r.w <= r.vw && r.h <= r.vh);
}
async function main() {
  const testCamera = process.env.VOXY_TEST_NATIVE_MEDIA !== "1";
  await mkdir("test-results", { recursive: true });
  const apps: ElectronApplication[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const results: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const env: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      env.VOXY_DATA_DIR = resolve(`test-results/desktop-${Date.now()}-${i}`);
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({
        args: [
          ".",
          "--use-fake-ui-for-media-stream",
          ...(testCamera ? ["--use-fake-device-for-media-stream"] : []),
        ],
        env,
      });
      apps.push(app);
      const page = await app.firstWindow();
      pages.push(page);
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error(e.stack);
      });
      await page
        .getByRole("heading", { name: "Sua frequência.", exact: false })
        .waitFor({ timeout: 20000 });
      await page
        .getByRole("button", { name: "Entendi, vamos l\u00e1", exact: true })
        .click();
      await page.evaluate(async (i) => {
        const p = await window.voxy.profile();
        await window.voxy.saveProfile({
          ...p,
          name: "Amigo " + i,
          avatar: ["🪻", "🦊", "🐳"][i],
        });
      }, i);
    }
    const a = pages[0];
    await a.getByRole("button", { name: "Configurações", exact: true }).click();
    await centered(a);
    await a.getByLabel("Nome de exibição").fill("Amigo 0");
    await a.getByRole("button", { name: "Avatar 👴", exact: true }).click();
    await a.getByLabel("Sons de entrada e saída da chamada").uncheck();
    await a
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await a
      .getByRole("main")
      .getByRole("button", { name: "Hospedar sala", exact: true })
      .click();
    await a.getByLabel("Nome do primeiro servidor").fill("Teste de amigos");
    await a.getByLabel("Endereço de escuta").selectOption("127.0.0.1");
    await a.getByLabel("Porta").fill("43129");
    await a
      .getByRole("button", { name: "Criar sala / Hospedar servidor" })
      .click();
    await a.getByText("Você está hospedando").waitFor();
    await a.getByRole("button", { name: "Copiar convite" }).click();
    const invite = await apps[0].evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    assert(invite.startsWith("voxy://127.0.0.1:43129/"));
    for (const page of pages.slice(1)) {
      await page
        .getByRole("main")
        .getByRole("button", { name: "Entrar em sala", exact: true })
        .click();
      await page.getByLabel("Convite", { exact: true }).fill(invite);
      await page
        .getByLabel("Seu nome", { exact: true })
        .fill("Amigo " + pages.indexOf(page));
      await page.getByRole("button", { name: "Conectar à sala" }).click();
      await page
        .locator(".profile-identity small")
        .filter({ hasText: "Conectado" })
        .waitFor({ timeout: 10000 });
    }
    const image = await a.screenshot();
    await a
      .getByRole("button", { name: "Gerenciar servidor e canais", exact: true })
      .click();
    await a.getByLabel("Arquivo de imagem do servidor").setInputFiles({
      name: "servidor.png",
      mimeType: "image/png",
      buffer: image,
    });
    for (const page of pages)
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLImageElement>(".server-photo img")
            ?.naturalWidth === 128,
      );
    await a
      .getByRole("button", { name: "Remover imagem do servidor", exact: true })
      .click();
    for (const page of pages)
      await page.locator(".server-photo").waitFor({ state: "detached" });
    await a.getByLabel("Arquivo de imagem do servidor").setInputFiles({
      name: "servidor.png",
      mimeType: "image/png",
      buffer: image,
    });
    await a.waitForFunction(
      () =>
        document.querySelector<HTMLImageElement>(".server-photo img")
          ?.naturalWidth === 128,
    );
    await a.getByRole("button", { name: "Fechar", exact: true }).click();
    await pages[1]
      .getByRole("button", { name: "Gerenciar servidor e canais", exact: true })
      .click();
    assert(
      await pages[1].getByLabel("Arquivo de imagem do servidor").isDisabled(),
    );
    assert(
      await pages[1]
        .getByRole("button", {
          name: "Remover imagem do servidor",
          exact: true,
        })
        .isDisabled(),
    );
    await pages[1].getByRole("button", { name: "Fechar", exact: true }).click();
    await pages[1].getByRole("button", { name: "Home", exact: true }).click();
    await pages[1].locator(".availability.available").waitFor();
    await pages[1]
      .getByRole("button", { name: "Desconectar da sala", exact: true })
      .click();
    await pages[1]
      .getByRole("main")
      .getByRole("button", {
        name: "Reconectar a Teste de amigos",
        exact: true,
      })
      .click();
    await pages[1]
      .locator(".profile-identity small")
      .filter({ hasText: "Conectado" })
      .waitFor();
    results.push(
      "Imagem do servidor adicionada/removida pelo criador; outro cliente bloqueado. Home reconecta usando convite salvo.",
    );
    await a.getByRole("button", { name: "Configurações", exact: true }).click();
    await centered(a);
    await a.getByLabel("Arquivo de foto de perfil").setInputFiles({
      name: "perfil.png",
      mimeType: "image/png",
      buffer: image,
    });
    await a.waitForFunction(
      () =>
        document.querySelector<HTMLImageElement>(".profile-photo-picker img")
          ?.naturalWidth === 128,
    );
    await a
      .getByRole("button", {
        name: "Salvar perfil e dispositivos",
        exact: true,
      })
      .click();
    const uploadedAvatar = await a.evaluate(
      async () => (await window.voxy.profile()).avatar,
    );
    assert(uploadedAvatar.startsWith("data:image/webp;base64,"));
    await a.getByLabel("Arquivo de imagem").setInputFiles({
      name: "teste.png",
      mimeType: "image/png",
      buffer: image,
    });
    await a.getByLabel("Mensagem", { exact: true }).fill("Imagem integrada");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    for (const page of pages) {
      await page.getByText("Imagem integrada", { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLImageElement>(
            ".message .profile-avatar img",
          )?.naturalWidth === 128,
      );
      await page.waitForFunction(() => {
        const image = document.querySelector(
          ".chat-image img",
        ) as HTMLImageElement;
        return !!image && image.naturalWidth > 0;
      });
    }
    await pages[1]
      .getByRole("button", { name: "Ampliar imagem", exact: true })
      .click();
    await pages[1].getByRole("heading", { name: "Imagem do chat" }).waitFor();
    await centered(pages[1]);
    await pages[1].getByRole("button", { name: "Fechar", exact: true }).click();
    results.push(
      "Imagem enviada, recebida e ampliada; emoji selecionável e foto do PC redimensionada, salva e exibida nos outros clientes.",
    );
    await a
      .getByRole("button", { name: "Editar mensagem", exact: true })
      .click();
    await centered(a);
    await a.getByLabel("Texto da mensagem").fill("Imagem editada");
    await a
      .getByRole("button", { name: "Salvar mensagem", exact: true })
      .click();
    for (const page of pages)
      await page.getByText("Imagem editada", { exact: true }).waitFor();
    assert.equal(
      await pages[1]
        .getByRole("button", { name: "Editar mensagem", exact: true })
        .count(),
      0,
    );
    await a
      .getByRole("button", { name: "Excluir mensagem", exact: true })
      .click();
    await centered(a);
    await a.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await a.locator(".chat-image").count(), 1);
    await a
      .getByRole("button", { name: "Excluir mensagem", exact: true })
      .click();
    await a
      .getByRole("button", { name: "Confirmar exclusão", exact: true })
      .click();
    for (const page of pages)
      await page
        .getByText("Imagem editada", { exact: true })
        .waitFor({ state: "detached" });
    results.push(
      "Edição e exclusão da própria mensagem propagadas; confirmação e modais centralizados.",
    );
    for (const page of pages) {
      await page
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Compartilhar tela", exact: true })
        .waitFor({ timeout: 15000 });
    }
    await a.getByRole("button", { name: "Diagnóstico de conexão" }).click();
    await a
      .getByText("connected", { exact: true })
      .first()
      .waitFor({ timeout: 15000 });
    await a.getByRole("button", { name: "Fechar", exact: true }).click();
    results.push("3 janelas Electron de produção conectadas e no mesmo canal.");
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 620),
    );
    await a.waitForFunction(() => {
      const controls = document
        .querySelector(".call-controls")
        ?.getBoundingClientRect();
      return (
        !!controls &&
        controls.bottom <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth
      );
    });
    await a.screenshot({ path: "test-results/responsive-900.png" });
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 820),
    );
    await a.getByRole("button", { name: "Configurações", exact: true }).click();
    await centered(a);
    await a.getByLabel("Volume de entrada", { exact: true }).fill("0.75");
    await a
      .getByLabel("Ativar detecção de voz (filtro por sensibilidade)", {
        exact: true,
      })
      .check();
    await a.getByLabel("Limite de ativação", { exact: true }).fill("-40");
    await a.getByLabel("Push to Talk: falar enquanto segura uma tecla").check();
    await a
      .getByRole("button", { name: "Configurar tecla para falar" })
      .click();
    await a
      .getByRole("button", { name: "Configurar tecla para falar" })
      .press("F9");
    await a
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await a.getByText("Segure F9 para falar · PTT", { exact: true }).waitFor();
    const prefs = await a.evaluate(() => window.voxy.profile());
    assert.equal(prefs.inputVolume, 0.75);
    assert.equal(prefs.voiceDetection, true);
    assert.equal(prefs.voiceThreshold, -40);
    try {
      await globalF9(false);
      await a
        .getByText("Falando · PTT", { exact: true })
        .waitFor({ timeout: 15000 });
      await globalF9(true);
      await a
        .getByText("Segure F9 para falar · PTT", { exact: true })
        .waitFor();
    } finally {
      await globalF9(true);
    }
    await a.getByRole("button", { name: "Configurações", exact: true }).click();
    await a
      .getByLabel("Push to Talk: falar enquanto segura uma tecla")
      .uncheck();
    await a
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    results.push(
      "Push to Talk global passa pelo main/IPC e abre/fecha a fala no aplicativo.",
    );
    const cProfile = await pages[2].evaluate(() => window.voxy.profile());
    const localCard = pages[1]
      .locator(".participant-card")
      .filter({ hasText: "Amigo 2" });
    await localCard.click({ button: "right" });
    await centered(pages[1]);
    await pages[1]
      .getByRole("dialog")
      .getByRole("button", { name: "Mutar voz para mim", exact: true })
      .click();
    await localCard
      .getByRole("img", { name: "Voz mutada só para você", exact: true })
      .waitFor();
    assert.equal(
      await a
        .getByRole("img", { name: "Voz mutada só para você", exact: true })
        .count(),
      0,
    );
    await pages[1].waitForFunction(
      async (id) =>
        (await window.voxy.profile()).mutedParticipants?.[id] === true,
      cProfile.id,
    );
    const volume = pages[1].getByRole("slider", {
      name: "Volume de Amigo 2",
      exact: true,
    });
    await volume.focus();
    await volume.press("Home");
    for (let i = 0; i < 7; i++) await volume.press("ArrowRight");
    await pages[1].waitForFunction(
      async (id) => (await window.voxy.profile()).volumes?.[id] === 0.35,
      cProfile.id,
    );
    await pages[2].evaluate(() => window.voxy.disconnect());
    await pages[2].evaluate((invite) => window.voxy.connect(invite), invite);
    await pages[2]
      .getByRole("button", { name: "Sala dos amigos", exact: true })
      .click();
    await pages[1]
      .getByRole("slider", { name: "Volume de Amigo 2", exact: true })
      .waitFor();
    assert.equal(
      await pages[1]
        .getByRole("slider", { name: "Volume de Amigo 2", exact: true })
        .inputValue(),
      "0.35",
    );
    await localCard
      .getByRole("img", { name: "Voz mutada só para você", exact: true })
      .waitFor();
    await localCard
      .getByRole("button", { name: "Ouvir voz novamente", exact: true })
      .click();
    await localCard
      .getByRole("img", { name: "Voz mutada só para você", exact: true })
      .waitFor({ state: "detached" });
    results.push(
      "Mute local via clique direito, isolado e persistido após reconexão; voz pode ser restaurada.",
    );
    results.push(
      "Volume de voz persistido por UUID após desconexão e nova sessão do participante.",
    );
    if (testCamera) {
      await a
        .getByRole("button", { name: "Ativar câmera", exact: true })
        .click();
      await a
        .getByRole("button", { name: "Ligar câmera selecionada", exact: true })
        .click();
      for (const page of pages)
        await page.waitForFunction(() => {
          const v =
            document.querySelector<HTMLVideoElement>(".camera-tile video");
          return !!v && v.videoWidth > 0 && v.readyState >= 2;
        });
      await pages[1]
        .getByRole("button", { name: "Ampliar câmera de Amigo 0", exact: true })
        .click();
      await pages[1]
        .getByRole("button", { name: "Tela cheia", exact: true })
        .click();
      await pages[1].waitForFunction(() => !!document.fullscreenElement);
      await pages[1].evaluate(() => document.exitFullscreen());
      await pages[1]
        .getByRole("button", { name: "Fechar visualização", exact: true })
        .click();
      await a
        .getByRole("button", { name: "Trocar câmera", exact: true })
        .click();
      await a
        .getByRole("button", { name: "Ligar câmera selecionada", exact: true })
        .click();
    }
    for (let cycle = 0; cycle < 2; cycle++) {
      await a
        .getByRole("button", { name: "Compartilhar tela", exact: true })
        .click();
      await a.getByRole("button", { name: "Iniciar transmissão" }).waitFor();
      await a.getByRole("button", { name: "Iniciar transmissão" }).click();
      await a
        .getByRole("button", { name: "Parar transmissão" })
        .waitFor({ timeout: 15000 });
      for (const page of pages) {
        await page
          .locator(".sidebar-live")
          .getByText("AO VIVO", { exact: true })
          .waitFor();
      }
      if (cycle === 0)
        await a.screenshot({ path: "test-results/live-badge-0.3.0.png" });
      for (const page of pages.slice(1)) {
        await page.getByRole("button", { name: "Assistir à tela" }).click();
        await page.waitForFunction(
          () => {
            const v = document.querySelector("video");
            return !!v && v.readyState >= 2 && v.videoWidth > 0;
          },
          {},
          { timeout: 20000 },
        );
        const info = await page.locator(".player video").evaluate((el) => {
          const v = el as HTMLVideoElement;
          return {
            width: v.videoWidth,
            height: v.videoHeight,
            time: v.currentTime,
          };
        });
        assert(info.width > 0);
        const transmission = page.getByRole("slider", {
          name: "Volume da transmissão",
          exact: true,
        });
        await transmission.focus();
        await transmission.press("Home");
        await transmission.press("ArrowRight");
        await transmission.press("ArrowRight");
        assert.equal(await transmission.inputValue(), "0.1");
        await page
          .getByRole("button", { name: "Silenciar transmissão", exact: true })
          .click();
        assert.equal(await transmission.inputValue(), "0");
        await page
          .getByRole("button", {
            name: "Ativar áudio da transmissão",
            exact: true,
          })
          .click();
        assert.equal(await transmission.inputValue(), "0.1");
        if (cycle === 0) {
          await page
            .getByRole("button", { name: "Tela cheia", exact: true })
            .click();
          await page.waitForFunction(() => !!document.fullscreenElement);
          const rects = await page
            .locator(".player video")
            .evaluate((video) => {
              const r = video.getBoundingClientRect();
              return {
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                viewportWidth: innerWidth,
                viewportHeight: innerHeight,
              };
            });
          assert.equal(rects.left, 0);
          assert.equal(rects.top, 0);
          assert.equal(rects.width, rects.viewportWidth);
          assert.equal(rects.height, rects.viewportHeight);
          await page.waitForFunction(() =>
            document.querySelector(".player")?.classList.contains("hud-hidden"),
          );
          assert.equal(
            await page
              .locator(".player-head")
              .evaluate((el) => getComputedStyle(el).visibility),
            "hidden",
          );
          assert.equal(
            await page
              .locator(".stream-audio")
              .evaluate((el) => getComputedStyle(el).visibility),
            "hidden",
          );
          await page.mouse.move(240, 180);
          await page.waitForFunction(
            () =>
              !document
                .querySelector(".player")
                ?.classList.contains("hud-hidden"),
          );
          assert.equal(
            await page
              .locator(".player-head")
              .evaluate((el) => getComputedStyle(el).visibility),
            "visible",
          );
          await page.evaluate(() => document.exitFullscreen());
        }
        await page.screenshot({
          path: `test-results/viewer-${cycle}-${pages.indexOf(page)}.png`,
        });
        await page.getByRole("button", { name: "Fechar visualização" }).click();
        await page
          .getByRole("button", { name: "Compartilhar tela", exact: true })
          .waitFor();
      }
      await a.getByRole("button", { name: "Parar transmissão" }).click();
      for (const page of pages)
        await page
          .getByRole("button", { name: "Compartilhar tela", exact: true })
          .waitFor();
      results.push(
        `Captura desktop Electron ${cycle + 1}: frames recebidos pelos dois clientes; parar e reiniciar sem sair da voz.`,
      );
    }
    results.push(
      "Player ocupa 100% da viewport em fullscreen; volume/mute da transmissão são independentes e persistidos.",
    );
    if (testCamera) {
      await a
        .getByRole("button", { name: "Desligar câmera", exact: true })
        .click();
      for (const page of pages)
        await page.locator(".camera-tile").waitFor({ state: "detached" });
      await a
        .getByRole("button", { name: "Ativar câmera", exact: true })
        .click();
      await a
        .getByRole("button", { name: "Ligar câmera selecionada", exact: true })
        .click();
      for (const page of pages)
        await page.waitForFunction(() => {
          const v =
            document.querySelector<HTMLVideoElement>(".camera-tile video");
          return !!v && v.videoWidth > 0;
        });
      await a
        .getByRole("button", { name: "Desligar câmera", exact: true })
        .click();
      results.push(
        "Webcam via getUserMedia no Electron: prévia, recepção, fullscreen, troca, parada e reinício junto da captura nativa de tela.",
      );
    }
    await a
      .getByRole("button", { name: "Mutar microfone", exact: true })
      .first()
      .click();
    await a
      .getByRole("button", { name: "Ativar microfone", exact: true })
      .first()
      .waitFor();
    results.push("Controle de mute responde no aplicativo.");
    await a
      .getByRole("button", { name: "Silenciar áudio", exact: true })
      .first()
      .click();
    for (const page of pages) {
      await page
        .locator(".participant-card")
        .filter({ hasText: "Amigo 0" })
        .getByRole("img", { name: "Áudio silenciado", exact: true })
        .waitFor();
      await page
        .locator(".channel-person")
        .filter({ hasText: "Amigo 0" })
        .getByRole("img", { name: "Áudio silenciado", exact: true })
        .waitFor();
    }
    await a
      .getByRole("button", { name: "Ouvir áudio", exact: true })
      .first()
      .click();
    for (const page of pages)
      await page
        .getByRole("img", { name: "Áudio silenciado", exact: true })
        .waitFor({ state: "detached" });
    results.push(
      "Ícone de áudio silenciado e mute coexistem; deafen propagado aos cartões e lista do canal.",
    );
    for (const page of pages)
      await page
        .getByRole("button", { name: "Sair do canal de voz", exact: true })
        .first()
        .click();
    results.push("Saída de voz nas três janelas.");
    for (const page of pages)
      await page
        .getByRole("button", { name: "Novidades do Voxy", exact: true })
        .click();
    for (const page of pages)
      await page.getByText("Voxy 0.4.0", { exact: true }).waitFor();
    await pages[1]
      .getByRole("button", { name: "Desconectar da sala", exact: true })
      .click();
    await pages[1]
      .getByRole("button", { name: "Novidades do Voxy", exact: true })
      .click();
    await pages[1].getByText("Voxy 0.2.0", { exact: true }).waitFor();
    await pages[1].screenshot({ path: "test-results/news-0.4.0.png" });
    await pages[1].getByRole("button", { name: "Home", exact: true }).click();
    await pages[1].screenshot({ path: "test-results/home-0.4.0.png" });
    await pages[1]
      .getByRole("button", {
        name: "Remover Teste de amigos dos recentes",
        exact: true,
      })
      .click();
    assert.equal(
      (await pages[1].evaluate(() => window.voxy.savedRooms())).length,
      0,
    );
    results.push(
      "Novidades offline preserva histórico por versão; Home permite remover servidor sem apagar os dados da sala.",
    );
    await a.screenshot({ path: "test-results/desktop-final.png" });
    assert.deepEqual(errors, []);
    console.log(results.join("\n"));
    await writeFile(
      "test-results/desktop.json",
      JSON.stringify(
        { date: new Date().toISOString(), results, errors },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error("EARLY ERRORS", errors);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      console.error(
        "VIDEO",
        i,
        await page.locator("video").evaluateAll((elements) =>
          elements.map((el) => {
            const v = el as HTMLVideoElement;
            return {
              ready: v.readyState,
              paused: v.paused,
              error: v.error?.message,
              tracks: (v.srcObject as MediaStream)?.getTracks().map((t) => ({
                kind: t.kind,
                muted: t.muted,
                enabled: t.enabled,
                state: t.readyState,
              })),
            };
          }),
        ),
      );
      await page
        .screenshot({ path: `test-results/failure-${i}.png` })
        .catch(() => {});
      await page
        .getByRole("button", { name: "Diagnóstico de conexão" })
        .click({ timeout: 1000 })
        .catch(() => {});
      console.error(
        "DIAGNOSTICS",
        i,
        await page
          .locator(".diagnostics")
          .innerText({ timeout: 1000 })
          .catch(() => ""),
      );
    }
    console.error({ errors });
    throw e;
  } finally {
    for (const app of apps.reverse()) await app.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
