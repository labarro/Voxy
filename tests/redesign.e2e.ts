import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

async function main() {
  const root = resolve("test-results", "redesign-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [],
    errors: string[] = [],
    checks: string[] = [],
    layouts: unknown[] = [];
  const pages: Page[] = [];
  const packed = process.argv.includes("--packaged");
  let executablePath: string | undefined;
  if (packed) {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    const { directory } = JSON.parse(
      await readFile(`release/${version}/latest-build.json`, "utf8"),
    );
    executablePath = join(directory, "win-unpacked", "Voxy.exe");
  }
  const shot = async (p: Page, name: string) => {
    await p.mouse.move(10, 10);
    await p.waitForTimeout(180);
    await p.screenshot({ path: join(root, name + ".png") });
  };
  const settings = async (p: Page) =>
    p.getByRole("button", { name: "Configurações", exact: true }).click();
  const close = async (p: Page) =>
    p
      .locator("dialog[open]")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
  const tab = async (p: Page, name: string) =>
    p
      .locator("dialog[open] .hub-nav")
      .getByRole("button", { name, exact: true })
      .click();
  async function fit(p: Page, name: string) {
    const result = await p.evaluate(() => {
      const d = document.querySelector<HTMLDialogElement>("dialog[open]")!,
        f = d.querySelector<HTMLElement>(".hub-savebar")!,
        n = d.querySelector<HTMLElement>(".hub-nav")!,
        c = d.querySelector<HTMLElement>(
          ".settings-content,.management-content",
        )!;
      const r = d.getBoundingClientRect(),
        fr = f.getBoundingClientRect();
      return {
        width: innerWidth,
        height: innerHeight,
        dialog: [r.left, r.top, r.right, r.bottom],
        footer: [fr.top, fr.bottom],
        horizontalOverflow: d.scrollWidth - d.clientWidth,
        contentOverflow: c.scrollWidth - c.clientWidth,
        navOverflow: n.scrollHeight - n.clientHeight,
      };
    });
    assert(
      result.dialog[0] >= 0 &&
        result.dialog[1] >= 0 &&
        result.dialog[2] <= result.width + 1 &&
        result.dialog[3] <= result.height + 1,
      name + JSON.stringify(result),
    );
    assert(
      result.footer[1] <= result.height && result.footer[0] > 0,
      name + " footer",
    );
    assert(
      result.horizontalOverflow <= 1 &&
        result.contentOverflow <= 1 &&
        result.navOverflow <= 1,
      name + JSON.stringify(result),
    );
    layouts.push({ name, ...result });
  }
  try {
    for (let i = 0; i < 2; i++) {
      const data = join(root, String(i));
      await mkdir(data, { recursive: true });
      await writeFile(
        join(data, "profile.json"),
        JSON.stringify({
          id: i
            ? "d24513cf-e7be-40b5-b009-b2153292af1d"
            : "f1093c4f-c536-4c05-ab85-fde58c78dc26",
          name: i ? "Bruno" : "Ana",
          avatar: i ? "🦊" : "🌙",
          input: "",
          output: "",
          callSounds: false,
        }),
      );
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      env.VOXY_DATA_DIR = data;
      const app = await electron.launch({
        executablePath,
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
      p.on("pageerror", (e) => errors.push(e.message));
      await p.getByRole("heading", { name: /Sua frequência/ }).waitFor();
      const notes = p.getByRole("button", { name: "Entendi, vamos lá" });
      if (await notes.count()) await notes.click();
      await p.evaluate(() =>
        window.voxy.onEvent((e) => {
          if (e.type === "state") (window as any).room = e.state;
        }),
      );
    }
    const [a, b] = pages;
    await apps[0].evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setSize(1440, 960);
      w.focus();
    });
    await shot(a, "launcher");
    const original = await a.evaluate(() => window.voxy.profile());
    await settings(a);
    await a.getByLabel("Nome de exibição").fill("Rascunho");
    assert.equal(
      (await a.evaluate(() => window.voxy.profile())).name,
      original.name,
    );
    await tab(a, "Áudio e Voz");
    await a.getByRole("button", { name: "Sensibilidade", exact: true }).click();
    await a.getByLabel("Volume de entrada", { exact: true }).fill("1.4");
    await a
      .getByRole("button", { name: "Desfazer alterações", exact: true })
      .click();
    await tab(a, "Conta");
    assert.equal(
      await a.getByLabel("Nome de exibição").inputValue(),
      original.name,
    );
    await a.getByLabel("Nome de exibição").fill("Não salvar");
    await close(a);
    await settings(a);
    assert.equal(
      await a.getByLabel("Nome de exibição").inputValue(),
      original.name,
    );
    await tab(a, "Aparência");
    await a.getByRole("button", { name: "Bosque", exact: true }).click();
    assert.equal(
      (await a.evaluate(() => window.voxy.profile())).theme,
      original.theme,
    );
    await a
      .getByRole("button", { name: "Desfazer alterações", exact: true })
      .click();
    checks.push(
      "draft isolation, undo across categories, discard on close, theme preview without saving",
    );
    const nav = a.getByLabel("Buscar em categorias de configurações");
    await nav.fill("microfone");
    await a
      .locator(".hub-nav")
      .getByRole("button", { name: "Áudio e Voz", exact: true })
      .click();
    assert.equal(await a.locator(".hub-nav button").count(), 2);
    await nav.fill("");
    for (const category of [
      "Conta",
      "Perfil",
      "Aparência",
      "Áudio e Voz",
      "Vídeo",
      "Notificações",
      "Atalhos",
      "Salas 3D",
      "Windows",
      "Privacidade",
      "Atualizações",
      "Avançado",
    ]) {
      await tab(a, category);
      await fit(a, category);
      if (
        ["Perfil", "Aparência", "Áudio e Voz", "Notificações"].includes(
          category,
        )
      )
        await shot(a, "settings-" + category.replaceAll(" ", "-"));
    }
    await tab(a, "Perfil");
    await shot(a, "settings-profile");
    await tab(a, "Áudio e Voz");
    await a.getByRole("button", { name: "Dispositivos", exact: true }).click();
    await shot(a, "settings-audio");
    for (const [w, h] of [
      [1024, 720],
      [900, 640],
    ]) {
      await apps[0].evaluate(
        ({ BrowserWindow }, s) =>
          BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]),
        [w, h],
      );
      await a.waitForTimeout(200);
      await fit(a, `audio-${w}`);
      await shot(a, `settings-${w}`);
    }
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    await tab(a, "Conta");
    await a.getByLabel("Nome de exibição").fill("Ana");
    await a
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await a.locator("dialog[open]").waitFor({ state: "detached" });
    checks.push(
      "all twelve settings pages, searchable navigation, persistent footer at 900/1024/1440 widths",
    );
    // Host and join through the launcher, not a fabricated renderer state.
    await a
      .locator(".launcher-actions")
      .getByRole("button", { name: /Hospedar sala/ })
      .click();
    await a.getByLabel("Nome do primeiro servidor").fill("Estúdio dos amigos");
    await a.getByLabel("Endereço de escuta").selectOption("127.0.0.1");
    await a.getByLabel("Porta", { exact: true }).fill("43185");
    await a
      .getByRole("button", { name: "Criar sala / Hospedar servidor" })
      .click();
    await a.locator("dialog[open]").waitFor({ state: "detached" });
    await a
      .getByRole("button", { name: "Copiar convite", exact: true })
      .click();
    const invite = await apps[0].evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    await b
      .locator(".launcher-actions")
      .getByRole("button", { name: /Entrar em sala/ })
      .click();
    await b.getByLabel("Convite", { exact: true }).fill(invite);
    await b
      .getByRole("button", { name: "Conectar à sala", exact: true })
      .click();
    await b.locator("dialog[open]").waitFor({ state: "detached" });
    await a.waitForFunction(
      () => (window as any).room?.participants.length === 2,
    );
    await a
      .getByRole("button", { name: "Gerenciar servidor e canais", exact: true })
      .click();
    for (const category of [
      "Geral",
      "Imagem",
      "Cargos",
      "Canais de texto",
      "Salas de voz",
      "Ambientes 3D",
      "Convites",
    ]) {
      await tab(a, category);
      await fit(a, category);
      await shot(a, "admin-" + category.replaceAll(" ", "-"));
    }
    await tab(a, "Cargos");
    await a.getByLabel("Nome do cargo", { exact: true }).fill("Anfitriões");
    await a.getByRole("button", { name: "Criar cargo", exact: true }).click();
    await a.getByText("Anfitriões", { exact: true }).waitFor();
    await tab(a, "Imagem");
    const logo = await a.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const x = c.getContext("2d")!;
      x.fillStyle = "#315565";
      x.fillRect(0, 0, 128, 128);
      x.fillStyle = "#b7dfef";
      x.font = "bold 64px Segoe UI";
      x.fillText("E", 43, 88);
      return c.toDataURL();
    });
    await a.getByLabel("Arquivo de imagem do servidor").setInputFiles({
      name: "estudio.png",
      mimeType: "image/png",
      buffer: Buffer.from(logo.split(",")[1], "base64"),
    });
    await b.waitForFunction(
      () =>
        !!document.querySelector<HTMLImageElement>(".server-photo img")
          ?.naturalWidth,
    );
    await tab(a, "Canais de texto");
    await a.getByRole("button", { name: "Criar canal", exact: true }).click();
    await a
      .getByLabel("Nome do novo canal", { exact: true })
      .fill("temporário");
    await a
      .getByRole("button", { name: "Adicionar canal", exact: true })
      .click();
    await a.getByLabel("Nome de temporário", { exact: true }).waitFor();
    await a
      .getByRole("button", { name: "Excluir temporário", exact: true })
      .click();
    assert(
      await a.getByLabel("Nome de temporário", { exact: true }).isVisible(),
    );
    await a.getByRole("button", { name: "Cancelar", exact: true }).click();
    await a
      .getByRole("button", { name: "Excluir temporário", exact: true })
      .click();
    await a
      .getByRole("button", { name: "Confirmar exclusão", exact: true })
      .click();
    await a
      .getByLabel("Nome de temporário", { exact: true })
      .waitFor({ state: "detached" });
    const text = await a.evaluate(() =>
      (window as any).room.channels.find((c: any) => c.kind === "text"),
    );
    await a
      .getByLabel("Nome de " + text.name, { exact: true })
      .fill("conversas");
    await a
      .getByRole("button", { name: "Salvar novo nome", exact: true })
      .click();
    await a.getByLabel("Nome de conversas", { exact: true }).waitFor();
    await tab(a, "Ambientes 3D");
    await a.getByLabel("Ambiente de Sala dos amigos").selectOption("lounge");
    await close(a);
    await b
      .getByRole("button", { name: "Gerenciar servidor e canais", exact: true })
      .click();
    await tab(b, "Canais de texto");
    assert(
      await b.getByLabel("Nome de conversas", { exact: true }).isDisabled(),
    );
    await tab(b, "Imagem");
    assert(await b.getByLabel("Arquivo de imagem do servidor").isDisabled());
    await close(b);
    checks.push(
      "launcher host/join, real two-client synchronization, seven admin pages, roles, server image upload, inline channel creation, confirmed deletion, rename, 3D selection and participant permissions",
    );
    await a.getByLabel("Filtrar canais").fill("nada encontrado");
    assert.equal(await a.locator(".channel").count(), 0);
    await a.getByLabel("Filtrar canais").fill("");
    for (const p of pages) {
      await p.getByRole("button", { name: "conversas", exact: true }).click();
    }
    await a
      .getByLabel("Mensagem", { exact: true })
      .fill("A sala está pronta. Qual é o filme de hoje?");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await b
      .getByText("A sala está pronta. Qual é o filme de hoje?", { exact: true })
      .waitFor();
    await b
      .getByLabel("Mensagem", { exact: true })
      .fill("Cheguei! Vamos escolher juntos.");
    await b
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await a
      .getByText("Cheguei! Vamos escolher juntos.", { exact: true })
      .waitFor();
    await shot(a, "chat");
    for (const [w, h] of [
      [1024, 720],
      [900, 640],
    ]) {
      await apps[0].evaluate(
        ({ BrowserWindow }, s) =>
          BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]),
        [w, h],
      );
      await a.waitForTimeout(200);
      const overflow = await a.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      assert(overflow <= 1);
      await shot(a, "chat-" + w);
    }
    checks.push("channel filtering, chat send/receive and responsive shell");
    await apps[0].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    for (const [id, name] of [
      ["ocean", "Oceano"],
      ["forest", "Bosque"],
      ["voxy", "Voxy"],
      ["kuromi", "Kuromi"],
    ]) {
      await settings(a);
      await tab(a, "Aparência");
      await a.getByRole("button", { name, exact: true }).click();
      await a
        .locator('.settings-form[data-preview-theme="' + id + '"]')
        .waitFor();
      await fit(a, name + " preview");
      if (id === "kuromi") {
        await a
          .locator(".kuromi-theme-story img")
          .evaluate(async (img: HTMLImageElement) => img.decode());
        await shot(a, "kuromi-appearance");
      }
      await a
        .getByRole("button", { name: "Salvar perfil e dispositivos" })
        .click();
      await a.locator("dialog[open]").waitFor({ state: "detached" });
      await a.waitForFunction(
        (id) => document.documentElement.dataset.theme === id,
        id,
      );
      assert.equal((await a.evaluate(() => window.voxy.profile())).theme, id);
      await shot(a, "chat-theme-" + id);
      if (id === "kuromi") {
        await a.getByRole("button", { name: "Home", exact: true }).click();
        await a
          .locator(".kuromi-feature img")
          .evaluate(async (img: HTMLImageElement) => img.decode());
        await shot(a, "kuromi-launcher");
        await a.locator(".kuromi-feature").hover();
        await shot(a, "kuromi-hover");
        await settings(a);
        await tab(a, "Áudio e Voz");
        await fit(a, "Kuromi audio");
        await shot(a, "kuromi-settings");
        await close(a);
        await a
          .getByRole("button", {
            name: "Gerenciar servidor e canais",
            exact: true,
          })
          .click();
        await tab(a, "Ambientes 3D");
        await fit(a, "Kuromi admin");
        await shot(a, "kuromi-admin");
        await close(a);
        await a.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await a
            .locator(".kuromi-feature img")
            .evaluate((el) => getComputedStyle(el).animationDuration),
          "1e-05s",
        );
        await a.emulateMedia({ reducedMotion: "no-preference" });
      }
    }
    checks.push(
      "all four saved themes across shell and settings; official Kuromi images decoded offline, pink palette, themed administration, reduced-motion effects",
    );
    assert.deepEqual(errors, []);
    await writeFile(
      join(root, "results.json"),
      JSON.stringify({ packed, errors, checks, layouts }, null, 2),
    );
    console.log("Redesign validation passed:", root);
  } catch (e) {
    for (let i = 0; i < pages.length; i++)
      await shot(pages[i], "failure-" + i).catch(() => {});
    throw e;
  } finally {
    for (const app of apps) await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
