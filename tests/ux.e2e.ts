import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
async function main() {
  const root = resolve("test-results", "ux-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    errors: string[] = [],
    results: string[] = [];
  const names = ["Ana", "Bruno", "Caio"],
    ids = names.map(() => randomUUID());
  async function launch(i: number) {
    const path = join(root, String(i));
    await mkdir(path, { recursive: true });
    if (!apps[i])
      await writeFile(
        join(path, "profile.json"),
        JSON.stringify({
          id: ids[i],
          name: names[i],
          avatar: ["🪻", "🦊", "🐳"][i],
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
    env.VOXY_DATA_DIR = path;
    const app = await electron.launch({
      args: [
        ".",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
      env,
    });
    apps[i] = app;
    const page = await app.firstWindow();
    pages[i] = page;
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("heading", { name: "Sua frequência.", exact: false })
      .waitFor({ timeout: 20000 });
    const notes = page.getByRole("button", {
      name: "Entendi, vamos lá",
      exact: true,
    });
    if (await notes.count()) await notes.click();
    return page;
  }
  async function focus(i: number) {
    await apps[i].evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    });
    await pages[i].waitForFunction(() => document.hasFocus());
  }
  async function settingsPresence(i: number, presence: string) {
    await focus(i);
    const page = pages[i];
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page.getByLabel("Seu status").selectOption(presence);
    await page
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
  }
  async function openDm(i: number, name: string) {
    await focus(i);
    await pages[i]
      .getByRole("button", { name: "Mensagens privadas", exact: true })
      .click();
    await pages[i]
      .getByRole("button", { name: "Conversa com " + name, exact: true })
      .click();
    await pages[i]
      .getByRole("heading", { name: "Sua conversa com " + name, exact: true })
      .waitFor();
  }
  try {
    for (let i = 0; i < 3; i++) await launch(i);
    const a = pages[0],
      c = pages[2];
    let b = pages[1];
    const temporary = await c.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43147,
        name: "Sala fora de alcance",
      }),
    );
    await b.evaluate((invite) => window.voxy.connect(invite), temporary.invite);
    const info = await a.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43146,
        name: "UX dos amigos",
      }),
    );
    for (const page of [b, c])
      await page.evaluate((invite) => window.voxy.connect(invite), info.invite);
    await a.waitForFunction(
      () => document.querySelectorAll(".member-row").length === 3,
    );
    const server = (await a.evaluate(() => window.voxy.savedRooms()))[0];
    await a.evaluate(async (id) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f55";
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#55f";
      ctx.fillRect(64, 0, 64, 128);
      await window.voxy.command({
        type: "server.icon",
        id,
        image: canvas.toDataURL(),
      });
      await window.voxy.command({
        type: "channel.create",
        serverId: id,
        name: "projetos",
        kind: "text",
      });
    }, server.serverId);
    await a.waitForFunction(
      () =>
        !!document.querySelector<HTMLImageElement>(
          ".server-rail .server-photo img",
        )?.naturalWidth,
    );
    const size = await a
      .locator(".server-rail .server-photo img")
      .evaluate((img) => {
        const image = img.getBoundingClientRect(),
          button = img.closest("button")!.getBoundingClientRect();
        return {
          image: { x: image.x, y: image.y, w: image.width, h: image.height },
          button: {
            x: button.x,
            y: button.y,
            w: button.width,
            h: button.height,
          },
          fit: getComputedStyle(img).objectFit,
        };
      });
    assert(
      Math.abs(size.image.w - size.button.w) < 2 &&
        Math.abs(size.image.h - size.button.h) < 2,
      JSON.stringify(size),
    );
    assert.equal(size.fit, "cover");
    results.push(
      "Imagem do servidor preenche o botão inteiro com object-fit cover, sem padding interno.",
    );
    await focus(0);
    for (const name of ["geral", "projetos", "geral"]) {
      await a
        .getByRole("button", { name: "Novidades do Voxy", exact: true })
        .click();
      assert.equal(await a.locator(".channel.active").count(), 0);
      await a.getByRole("button", { name, exact: true }).click();
      await a
        .getByRole("heading", { name: "Este é o #" + name, exact: true })
        .waitFor();
      assert.equal(await a.locator(".channel.active").count(), 1);
      assert.equal(
        await a
          .getByRole("button", { name: "Novidades do Voxy", exact: true })
          .getAttribute("aria-current"),
        null,
      );
    }
    await a.getByRole("button", { name: "Home", exact: true }).click();
    await a.getByRole("button", { name: "projetos", exact: true }).click();
    await a
      .getByRole("heading", { name: "Este é o #projetos", exact: true })
      .waitFor();
    results.push(
      "Novidades → mesmo canal, outro canal e Home → canal funcionam em um clique e sem seleção presa.",
    );
    await a
      .getByRole("button", { name: "Sala dos amigos", exact: true })
      .click();
    await a.locator(".voice-status").waitFor();
    await focus(1);
    await b
      .getByRole("button", { name: "Sala dos amigos", exact: true })
      .click();
    await b.waitForFunction(
      () =>
        document.querySelector(".voice-status strong")?.textContent ===
        "Voz conectada",
    );
    await b
      .locator(".server-rail")
      .getByRole("button", {
        name: "Reconectar a Sala fora de alcance",
        exact: true,
      })
      .click();
    await b
      .locator(".error-banner")
      .filter({ hasText: "Sua conexão atual foi mantida" })
      .waitFor();
    assert.equal(await b.locator(".voice-status").count(), 1);
    assert(
      (await b.locator(".profile-identity small").textContent())?.includes(
        "Conectado",
      ),
    );
    await b.getByRole("button", { name: "Fechar aviso", exact: true }).click();
    results.push(
      "Tentar um servidor salvo indisponível preserva a conexão e a chamada atuais.",
    );
    await settingsPresence(0, "away");
    await b
      .locator(".member-row")
      .filter({ hasText: "Ana" })
      .getByRole("img", { name: "Status: Ausente" })
      .waitFor();
    await settingsPresence(0, "busy");
    await c
      .locator(".member-row")
      .filter({ hasText: "Ana" })
      .getByRole("img", { name: "Status: Ocupado" })
      .waitFor();
    assert.equal(
      (await a.evaluate(() => window.voxy.profile())).presence,
      "busy",
    );
    await settingsPresence(0, "online");
    assert.equal(await a.locator(".voice-status").count(), 1);
    results.push(
      "Online, Ausente e Ocupado salvos e propagados aos participantes sem interromper a voz.",
    );
    await settingsPresence(0, "busy");
    await a
      .getByRole("button", { name: "Novidades do Voxy", exact: true })
      .click();
    await openDm(1, "Ana");
    await b
      .getByLabel("Mensagem", { exact: true })
      .fill("Mensagem sem aviso enquanto ocupado");
    await b
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await a.locator(".rail-unread").waitFor();
    assert.equal(await a.locator(".direct-notice").count(), 0);
    await settingsPresence(0, "online");
    assert.equal(await a.locator(".direct-notice").count(), 0);
    await openDm(0, "Bruno");
    await a.waitForFunction(() => !document.querySelector(".rail-unread"));
    await a
      .getByRole("button", { name: "Novidades do Voxy", exact: true })
      .click();
    await focus(1);
    await b
      .getByLabel("Mensagem", { exact: true })
      .fill("Uma mensagem só para Ana");
    await b
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await a.locator(".rail-unread").waitFor();
    assert.equal(await a.locator(".rail-unread").textContent(), "1");
    await a.locator(".direct-notice").waitFor();
    assert.equal(
      (await c.evaluate(() => window.voxy.inbox())).rooms.flatMap(
        (r) => r.messages,
      ).length,
      0,
    );
    await openDm(0, "Bruno");
    await a
      .locator(".message-list")
      .getByText("Uma mensagem só para Ana", { exact: true })
      .waitFor();
    await a.waitForFunction(() => !document.querySelector(".rail-unread"));
    await a.getByLabel("Mensagem", { exact: true }).fill("Resposta reservada");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await b
      .locator(".message-list")
      .getByText("Resposta reservada", { exact: true })
      .waitFor();
    assert.equal(await a.locator(".voice-status").count(), 1);
    assert.equal(await b.locator(".voice-status").count(), 1);
    results.push(
      "DM entregue só ao destinatário; notificação e badge de não lidas aparecem e zeram ao abrir; voz permanece ativa na navegação.",
    );
    results.push(
      "Ocupado mantém o badge sem popup; voltar a Online não reapresenta o aviso silenciado.",
    );
    const png = await a.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
      return canvas.toDataURL().split(",")[1];
    });
    await a.getByLabel("Arquivo de imagem").setInputFiles({
      name: "privada.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await b.getByRole("img", { name: "Imagem enviada no chat" }).waitFor();
    const dm = (await a.evaluate(() => window.voxy.inbox())).rooms
      .flatMap((r) => r.messages)
      .find((m) => m.imageId)!;
    await assert.rejects(
      c.evaluate(({ id, scope }) => window.voxy.directImage(id, scope), {
        id: dm.imageId!,
        scope: (await c.evaluate(() => window.voxy.inbox())).activeScope!,
      }),
    );
    await focus(0);
    await a
      .locator(".message")
      .filter({ hasText: "Resposta reservada" })
      .getByRole("button", { name: "Editar mensagem", exact: true })
      .click();
    await a.getByLabel("Texto da mensagem").fill("Resposta revisada");
    await a
      .getByRole("button", { name: "Salvar mensagem", exact: true })
      .click();
    await b
      .locator(".message-list")
      .getByText("Resposta revisada", { exact: true })
      .waitFor();
    await a
      .locator(".message")
      .filter({ hasText: "Resposta revisada" })
      .getByRole("button", { name: "Excluir mensagem", exact: true })
      .click();
    await a
      .getByRole("button", { name: "Confirmar exclusão", exact: true })
      .click();
    await b
      .locator(".message-list")
      .getByText("Resposta revisada", { exact: true })
      .waitFor({ state: "hidden" });
    results.push(
      "Imagens, edição e exclusão funcionam em DMs; terceiro cliente não pode buscar a imagem privada.",
    );
    await a
      .locator(".server-rail")
      .getByRole("button", { name: "UX dos amigos", exact: true })
      .click();
    await a.getByRole("button", { name: "geral", exact: true }).click();
    await a
      .getByRole("heading", { name: "Este é o #geral", exact: true })
      .waitFor();
    await openDm(0, "Bruno");
    await focus(1);
    await b.waitForFunction(async () => {
      const inbox = await window.voxy.inbox();
      const owner = (await window.voxy.profile()).id;
      return inbox.rooms.every((r) =>
        r.messages.every(
          (m) => m.recipient !== owner || m.sequence <= (r.read[m.author] ?? 0),
        ),
      );
    });
    await apps[1].close();
    await a
      .locator(".direct-context")
      .getByText("Offline", { exact: true })
      .waitFor();
    await focus(0);
    await a
      .getByLabel("Mensagem", { exact: true })
      .fill("Para quando você voltar");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    b = await launch(1);
    await b
      .locator(".server-rail")
      .getByRole("button", { name: "Reconectar a UX dos amigos", exact: true })
      .waitFor();
    await b
      .locator(".server-rail")
      .getByRole("button", { name: "Reconectar a UX dos amigos", exact: true })
      .click();
    await openDm(1, "Ana");
    await b
      .locator(".message-list")
      .getByText("Para quando você voltar", { exact: true })
      .waitFor();
    await b.waitForFunction(() => !document.querySelector(".rail-unread"));
    results.push(
      "Reabertura preserva identidade e histórico; reconexão pela lateral entrega mensagem recebida enquanto o destinatário estava offline.",
    );
    await settingsPresence(1, "away");
    await focus(1);
    await b
      .getByRole("button", { name: "Mensagens privadas", exact: true })
      .click();
    await a.evaluate(() => window.voxy.disconnect());
    await b.waitForFunction(
      () =>
        !!document
          .querySelector(".direct-context")
          ?.textContent?.includes("Histórico salvo"),
    );
    await b
      .locator(".message-list")
      .getByText("Para quando você voltar", { exact: true })
      .waitFor();
    assert(await b.getByLabel("Mensagem", { exact: true }).isDisabled());
    await b
      .locator(
        ".server-rail .saved-server .server-availability:not(.available)",
      )
      .first()
      .waitFor();
    await apps[1].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 620),
    );
    await b.screenshot({ path: "test-results/ux-dm-offline.png" });
    assert(
      await b.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await b.getByRole("button", { name: "Home", exact: true }).click();
    await b
      .getByRole("heading", { name: "Sua frequência.", exact: false })
      .waitFor();
    await b
      .locator(".server-rail")
      .getByRole("button", { name: "Reconectar a UX dos amigos", exact: true })
      .waitFor();
    results.push(
      "Host offline mantém DMs legíveis e recentes na lateral; compositor desativado e disponibilidade visual correta em 900×620.",
    );
    assert.deepEqual(errors, []);
    await writeFile(
      "test-results/ux.json",
      JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
    );
    console.log(results.join("\n"));
  } catch (e) {
    for (let i = 0; i < pages.length; i++)
      try {
        await pages[i].screenshot({ path: `test-results/ux-failure-${i}.png` });
      } catch {}
    throw e;
  } finally {
    for (const app of apps)
      try {
        await app.close();
      } catch {}
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
