import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
async function main() {
  const root = resolve("test-results", "social-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    errors: string[] = [];
  const metrics: Record<string, unknown> = {};
  const measure = async (app: ElectronApplication) =>
    await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((p) => ({
          type: p.type,
          cpu: p.cpu.percentCPUUsage,
          workingSetKB: p.memory.workingSetSize,
          peakWorkingSetKB: p.memory.peakWorkingSetSize,
        })),
    );
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  async function settings(page: Page, category = "Conta") {
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page.getByRole("button", { name: category, exact: true }).click();
  }
  async function save(page: Page) {
    await page
      .getByRole("button", { name: "Salvar perfil e dispositivos" })
      .click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
  }
  try {
    for (let i = 0; i < 3; i++) {
      const data = join(root, String(i));
      await mkdir(data, { recursive: true });
      await writeFile(
        join(data, "profile.json"),
        JSON.stringify({
          id: ids[i],
          name: ["Ana", "Bruno", "Caio"][i],
          avatar: ["A", "B", "C"][i],
          input: "",
          output: "",
          callSounds: false,
        }),
      );
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      env.VOXY_DATA_DIR = data;
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
        .getByRole("button", { name: "Configurações", exact: true })
        .waitFor();
      const notes = page.getByRole("button", { name: "Entendi, vamos lá" });
      if (await notes.count()) await notes.click();
      await page.evaluate(() => {
        window.voxy.onEvent((event) => {
          if (event.type === "state") (window as any).room = event.state;
        });
      });
    }
    const [a, b, c] = pages;
    await settings(b, "Conta");
    await b.getByLabel("Cor do nickname", { exact: true }).fill("#ee88cc");
    const banner = await b.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 500;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#b98cdd";
      ctx.fillRect(0, 0, 1200, 500);
      ctx.fillStyle = "#f4b5d6";
      ctx.fillRect(600, 0, 600, 500);
      return canvas.toDataURL();
    });
    await b
      .getByLabel("Arquivo de capa do perfil")
      .setInputFiles({
        name: "capa.png",
        mimeType: "image/png",
        buffer: Buffer.from(banner.split(",")[1], "base64"),
      });
    await b
      .getByRole("button", { name: "Alterar capa", exact: true })
      .waitFor();
    await b.getByRole("button", { name: "Aparência", exact: true }).click();
    await b.getByRole("button", { name: "Kuromi", exact: true }).click();
    await b.getByLabel("Cor principal", { exact: true }).fill("#cd9cf4");
    await b.screenshot({ path: join(root, "appearance.png") });
    await save(b);
    const pref = await b.evaluate(() => window.voxy.profile());
    assert.equal(pref.theme, "kuromi");
    assert.equal(pref.nicknameColor, "#ee88cc");
    assert(pref.banner?.startsWith("data:image/webp"));
    const info = await a.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43178,
        name: "Amigos de teste",
      }),
    );
    for (const page of [b, c])
      await page.evaluate((invite) => window.voxy.connect(invite), info.invite);
    await a.locator(".member-row").filter({ hasText: "Bruno" }).waitFor();
    await a
      .getByRole("button", { name: "Gerenciar servidor e canais" })
      .click();
    await a.getByLabel("Nome do cargo", { exact: true }).fill("Moderadores");
    await a.getByLabel("Cor de identificação", { exact: true }).fill("#99bbff");
    await a.getByRole("button", { name: "Criar cargo", exact: true }).click();
    await a.getByText("Membros com este cargo", { exact: true }).click();
    await a
      .locator(".role-editor")
      .getByLabel("Bruno", { exact: true })
      .check();
    await a.screenshot({ path: join(root, "roles.png") });
    await a.getByRole("button", { name: "Fechar", exact: true }).click();
    await a
      .locator(".member-row")
      .filter({ hasText: "Bruno" })
      .click({ button: "right" });
    const card = a.getByRole("dialog", { name: "Perfil de Bruno" });
    await card.waitFor();
    await card.locator(".profile-banner img").waitFor();
    assert.equal(
      await card
        .locator(".profile-banner img")
        .evaluate((img) => getComputedStyle(img).objectFit),
      "cover",
    );
    assert.equal(await card.getByRole("slider").count(), 0);
    await a.screenshot({ path: join(root, "mini-profile.png") });
    await a.keyboard.press("Escape");
    await a.getByRole("button", { name: "Amigos", exact: true }).click();
    await a.getByLabel("Adicionar por ID", { exact: true }).fill(ids[1]);
    await a
      .getByRole("button", { name: "Enviar solicitação", exact: true })
      .click();
    await b.getByRole("button", { name: "Amigos", exact: true }).click();
    await b.getByRole("button", { name: "Aceitar", exact: true }).click();
    await a.getByRole("button", { name: "Ligar", exact: true }).waitFor();
    await a.screenshot({ path: join(root, "friends.png") });
    metrics.idle = await measure(apps[0]);
    await a.getByRole("button", { name: "Ligar", exact: true }).click();
    await b
      .getByRole("button", { name: "Aceitar chamada", exact: true })
      .click();
    await a.locator(".voice-status").waitFor();
    await b.locator(".voice-status").waitFor();
    metrics.voice = await measure(apps[0]);
    await c.waitForFunction(
      () =>
        !(window as any).room.channels.some(
          (channel: any) => channel.privateMembers,
        ),
    );
    await a
      .getByRole("button", { name: "Encerrar chamada", exact: true })
      .click();
    await a.locator(".voice-status").waitFor({ state: "hidden" });
    await b.locator(".voice-status").waitFor({ state: "hidden" });
    metrics.afterCall = await measure(apps[0]);
    for (const page of [a, b])
      await page.getByRole("button", { name: "geral", exact: true }).click();
    await a
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .fill("Mensagem original para responder");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    const original = b
      .locator(".message")
      .filter({ hasText: "Mensagem original para responder" })
      .first();
    await original.hover();
    await original
      .getByRole("button", { name: "Responder mensagem", exact: true })
      .click();
    await b
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .fill("Olá @An");
    await b.getByRole("option", { name: "@Ana", exact: true }).click();
    await b
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await a.locator(".message.mentioned").waitFor();
    await a.locator(".reply-reference").click();
    await a.locator(".message.located").waitFor();
    await original.hover();
    await original
      .getByRole("button", { name: "Reagir à mensagem", exact: true })
      .click();
    await b.getByRole("button", { name: "Reagir 👍", exact: true }).click();
    await a
      .getByRole("button", { name: "Reação 👍, 1", exact: true })
      .waitFor();
    await a
      .getByLabel("Buscar no histórico", { exact: true })
      .fill("Mensagem original");
    await a
      .locator(".history-search")
      .getByRole("button", { name: "Buscar", exact: true })
      .click();
    await a
      .locator(".history-results")
      .getByRole("button")
      .filter({ hasText: "Mensagem original" })
      .click();
    await a.screenshot({ path: join(root, "chat.png") });
    await a
      .locator(".member-row")
      .filter({ hasText: "Bruno" })
      .click({ button: "right" });
    await a
      .getByRole("button", { name: "Mensagem privada", exact: true })
      .click();
    await a
      .getByRole("heading", { name: "Sua conversa com Bruno", exact: true })
      .waitFor();
    await a
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .fill("DM de amigos");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await settings(b, "Conta");
    await b.getByRole("button", { name: "Remover capa", exact: true }).click();
    await save(b);
    assert.equal((await b.evaluate(() => window.voxy.profile())).banner, "");
    await apps[1].evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await b.waitForFunction(
      () => document.documentElement.dataset.background === "true",
    );
    metrics.minimized = await measure(apps[1]);
    await writeFile(
      join(root, "metrics.json"),
      JSON.stringify(metrics, null, 2),
    );
    assert.deepEqual(errors, []);
    console.log(
      "Configurações, tema, capa, cargos, mini perfil, amizade, chamada privada, menção, resposta, reação, busca e DM verificados. Capturas:",
      root,
    );
  } catch (e) {
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({ path: join(root, "failure-" + i + ".png") })
        .catch(() => {});
    throw e;
  } finally {
    for (const app of apps.reverse()) await app.close().catch(() => {});
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
