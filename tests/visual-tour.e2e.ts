// Visual tour: two real Electron clients (host + guest) on loopback, isolated
// VOXY_DATA_DIR profiles, fake media devices. Captures every main surface at
// several window sizes so before/after comparisons use identical conditions.
// Screen-capture sources are replaced by synthetic thumbnails in the main
// process so screenshots never include the tester's real windows.
//   npx tsx tests/visual-tour.e2e.ts --out evidence/1.5/visual/after [--packaged]
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = resolve(arg("--out") ?? join("test-results", "tour-" + Date.now()));
const packed = process.argv.includes("--packaged");
const only = arg("--only");

async function main() {
  await mkdir(out, { recursive: true });
  const apps: ElectronApplication[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const shots: string[] = [];
  const skipped: string[] = [];
  let executablePath: string | undefined;
  if (packed) {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    const { directory } = JSON.parse(
      await readFile(`release/${version}/latest-build.json`, "utf8"),
    );
    executablePath = join(directory, "win-unpacked", "Voxy.exe");
  }
  const size = (i: number, w: number, h: number) =>
    apps[i].evaluate(
      ({ BrowserWindow }, s) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win.isMaximized()) win.unmaximize();
        win.setContentSize(s[0], s[1]);
      },
      [w, h],
    );
  const shot = async (p: Page, name: string, hover = true) => {
    if (only && !name.includes(only)) return;
    if (hover) await p.mouse.move(2, 400);
    await p.waitForTimeout(260);
    await p.screenshot({ path: join(out, name + ".png") });
    shots.push(name);
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      skipped.push(name + ": " + (e as Error).message.split("\n")[0]);
      console.warn("skip", name, (e as Error).message.split("\n")[0]);
      for (const p of pages) await p.keyboard.press("Escape").catch(() => {});
    }
  };
  const button = (p: Page, name: string | RegExp) =>
    p.getByRole("button", { name, exact: typeof name === "string" }).first();
  const closeDialog = async (p: Page) => {
    const d = p.locator("dialog[open]");
    if (await d.count())
      await d.getByRole("button", { name: "Fechar", exact: true }).first().click();
    await p.locator("dialog[open]").waitFor({ state: "detached" });
  };
  const settings = (p: Page) => button(p, "Configurações").click();
  const tab = (p: Page, name: string) =>
    p
      .locator("dialog[open] .hub-nav")
      .getByRole("button", { name, exact: true })
      .click();
  try {
    for (let i = 0; i < 2; i++) {
      const data = join(out, "profile-" + i);
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
          ...(executablePath ? [] : ["."]),
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          "--mute-audio",
        ],
        env,
      });
      apps.push(app);
      const p = await app.firstWindow();
      pages.push(p);
      p.on("pageerror", (e) => errors.push(e.message));
      await p.waitForLoadState("domcontentloaded");
      await p.locator(".server-rail").waitFor();
      const notes = p.getByRole("button", { name: "Entendi, vamos lá" });
      await p.waitForTimeout(600);
      if (await notes.count()) await notes.click();
      await p.evaluate(() =>
        window.voxy.onEvent((e) => {
          if (e.type === "state") (window as any).room = e.state;
        }),
      );
    }
    const [a, b] = pages;
    // Synthetic capture sources (never the tester's real screen/windows).
    const thumbs: string[] = await a.evaluate(`(() => {
      const specs = [["#1d3557","#457b9d","Tela 1"],["#264653","#2a9d8f","Tela 2"],["#3d0e61","#c2185b","Jogo"],["#222","#555","Navegador"],["#0b3d2e","#2d6a4f","Planilha"],["#5f0f40","#9a031e","Vídeo"]];
      return specs.map(([bg, fg, label]) => {
        const c = document.createElement("canvas"); c.width = 320; c.height = 180;
        const x = c.getContext("2d"); const g = x.createLinearGradient(0, 0, 320, 180);
        g.addColorStop(0, bg); g.addColorStop(1, fg); x.fillStyle = g; x.fillRect(0, 0, 320, 180);
        x.fillStyle = "#ffffff22"; x.fillRect(0, 0, 320, 16); x.fillStyle = "#ffffffcc";
        x.font = "600 18px Segoe UI"; x.fillText(label, 16, 160); return c.toDataURL();
      });
    })()`);
    for (const app of apps)
      await app.evaluate(({ ipcMain }, t) => {
        ipcMain.removeHandler("voxy:sources");
        ipcMain.handle("voxy:sources", () => ({
          ok: true,
          value: [
            { id: "screen:0:0", name: "Tela 1", thumbnail: t[0], kind: "screen", display: "1920 × 1080 · Principal" },
            { id: "screen:1:0", name: "Tela 2", thumbnail: t[1], kind: "screen", display: "2560 × 1440" },
            { id: "window:101:0", name: "Partida ranqueada - Jogo", thumbnail: t[2], kind: "window" },
            { id: "window:102:0", name: "Voxy — Notas da versão - Google Chrome", thumbnail: t[3], kind: "window" },
            { id: "window:103:0", name: "Orçamento.xlsx - Excel", thumbnail: t[4], kind: "window" },
            { id: "window:104:0", name: "Trailer - Reprodutor de Mídia", thumbnail: t[5], kind: "window" },
          ],
        }));
      }, thumbs);
    await size(0, 1600, 900);
    await size(1, 1280, 760);
    await shot(a, "01-home-empty");
    await step("host", async () => {
      await a
        .getByRole("button", { name: /Hospedar sala|Criar servidor/ })
        .first()
        .click();
      await a.getByLabel("Nome do primeiro servidor").fill("Estúdio dos amigos");
      await a.getByLabel("Endereço de escuta").selectOption("127.0.0.1");
      await a.getByLabel("Porta", { exact: true }).fill("43187");
      await shot(a, "02-modal-host");
      await button(a, "Criar sala / Hospedar servidor").click();
      await a.locator("dialog[open]").waitFor({ state: "detached" });
    });
    let invite = "";
    await step("join", async () => {
      await button(a, /Copiar convite/).click();
      invite = await apps[0].evaluate(({ clipboard }) => clipboard.readText());
      await b
        .getByRole("button", { name: /Entrar em sala|Entrar por convite/ })
        .first()
        .click();
      await b.getByLabel("Convite", { exact: true }).fill(invite);
      await shot(b, "03-modal-join");
      await button(b, "Conectar à sala").click();
      await b.locator("dialog[open]").waitFor({ state: "detached" });
      await a.waitForFunction(
        () => (window as any).room?.participants.length === 2,
      );
    });
    await step("chat", async () => {
      for (const p of pages) await p.getByRole("button", { name: /^geral/ }).first().click();
      const say = async (p: Page, text: string) => {
        await p.getByLabel("Mensagem", { exact: true }).fill(text);
        await button(p, "Enviar mensagem").click();
        await p.getByText(text, { exact: true }).first().waitFor();
      };
      await say(a, "Oi pessoal! Partida às 21h, quem topa?");
      await say(b, "Chegando! Vou abrir a tela pra mostrar o mapa.");
      await say(b, "Link do mapa: https://example.com/mapa");
      await say(a, "Fechado. Vou criar a sala de voz.");
      await a.getByText("Fechado. Vou criar a sala de voz.").first().waitFor();
      await shot(a, "04-chat");
      await shot(b, "04-chat-guest-1280");
    });
    await step("mini-profile", async () => {
      await a.locator(".member-row, .member-item").filter({ hasText: "Bruno" }).first()
        .click({ button: "right" });
      await a.locator(".participant-menu").waitFor();
      await shot(a, "05-mini-profile", false);
      await a.keyboard.press("Escape");
    });
    await step("voice", async () => {
      for (const p of pages) await button(p, "Sala dos amigos").click();
      await a.waitForFunction(
        () =>
          (window as any).room?.participants.filter((p: any) => p.channelId)
            .length === 2,
      );
      await a.waitForTimeout(2500);
      await shot(a, "06-call-voice");
    });
    await step("participant-menu", async () => {
      await a.getByRole("button", { name: "Opções de Bruno" }).first().click();
      await a.locator(".participant-menu").waitFor();
      await shot(a, "07-call-participant-menu", false);
      await a.keyboard.press("Escape");
    });
    await step("camera", async () => {
      await button(a, "Ativar câmera").click();
      await shot(a, "08-modal-camera");
      await button(a, "Ligar câmera selecionada").click();
      await a.locator("dialog[open]").waitFor({ state: "detached" });
      await b.waitForTimeout(3500);
      await shot(a, "09-call-camera-self");
      await shot(b, "09-call-camera-remote-1280");
    });
    await step("share-modal", async () => {
      await a
        .getByRole("button", { name: /Compartilhar tela/ })
        .first()
        .click();
      await a.locator("dialog[open]").waitFor();
      await a.waitForTimeout(500);
      await shot(a, "10-modal-share", false);
      const win = a.locator("dialog[open]").getByText(/Partida ranqueada/).first();
      if (await win.count()) await win.click();
      await shot(a, "10-modal-share-selected", false);
      await closeDialog(a);
    });
    await step("call-sizes", async () => {
      for (const [w, h] of [
        [1280, 720],
        [1920, 1080],
      ]) {
        await size(0, w, h);
        await shot(a, `11-call-${w}x${h}`);
      }
      await apps[0].evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].maximize(),
      );
      await shot(a, "11-call-maximized");
      await size(0, 1600, 900);
    });
    await step("camera-off", async () => {
      await button(a, "Desligar câmera").click();
    });
    await step("chat-in-call", async () => {
      await a.getByRole("button", { name: /^geral/ }).first().click();
      await shot(a, "12-chat-during-call");
    });
    await step("dm", async () => {
      await a
        .locator(".member-row, .member-item")
        .filter({ hasText: "Bruno" })
        .first()
        .click();
      await a.getByLabel(/Mensagem/).first().fill("Te mando o mapa por aqui.");
      await a.keyboard.press("Enter");
      await a.waitForTimeout(800);
      await shot(a, "13-dm");
    });
    await step("friends", async () => {
      await button(a, "Amigos").click();
      await shot(a, "14-friends");
    });
    await step("notifications", async () => {
      await button(a, "Notificações").click();
      await shot(a, "15-notifications");
    });
    await step("news", async () => {
      await button(a, "Novidades do Voxy").click();
      await shot(a, "16-news");
    });
    await step("home-online", async () => {
      await button(a, /^(Home|Início)$/).click();
      await shot(a, "17-home-online");
    });
    await step("settings", async () => {
      await settings(a);
      for (const c of [
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
        await tab(a, c);
        await shot(a, "18-settings-" + c.replaceAll(" ", "-"), false);
      }
      await closeDialog(a);
    });
    await step("admin", async () => {
      await button(a, "Gerenciar servidor e canais").click();
      for (const c of [
        "Geral",
        "Imagem",
        "Cargos",
        "Canais de texto",
        "Salas de voz",
        "Ambientes 3D",
        "Convites",
      ]) {
        await tab(a, c);
        await shot(a, "19-admin-" + c.replaceAll(" ", "-"), false);
      }
      await closeDialog(a);
    });
    await step("kuromi", async () => {
      await settings(a);
      await tab(a, "Aparência");
      await button(a, "Kuromi").click();
      await shot(a, "20-kuromi-appearance", false);
      await button(a, "Salvar perfil e dispositivos").click();
      await a.locator("dialog[open]").waitFor({ state: "detached" });
      await button(a, /^(Home|Início)$/).click();
      await shot(a, "21-kuromi-home");
      await button(a, "Sala dos amigos").click();
      await shot(a, "21-kuromi-call");
      await a.getByRole("button", { name: /^geral/ }).first().click();
      await shot(a, "21-kuromi-chat");
    });
    await step("room3d", async () => {
      await a.evaluate(async () => {
        const c = (window as any).room.channels.find(
          (c: any) => c.kind === "voice",
        );
        await window.voxy.command({
          type: "channel.room",
          id: c.id,
          preset: "lounge",
        });
      });
      await button(a, "Sala dos amigos").click();
      await shot(a, "22-room3d-prompt");
      await button(a, "Entrar na sala 3D").click();
      await a
        .locator('.room3d canvas[data-ready="true"]')
        .waitFor({ timeout: 60000 });
      await a.waitForTimeout(1500);
      await shot(a, "22-room3d-hud", false);
      const emotes = a.getByRole("button", { name: /Abrir menu de emotes/ });
      if (await emotes.count()) {
        await emotes.first().click();
        await a.waitForTimeout(300);
        await shot(a, "22-room3d-emotes", false);
        await a.keyboard.press("Escape");
      }
      await button(a, "Voltar ao canal").click();
    });
    await writeFile(
      join(out, "tour.json"),
      JSON.stringify({ packed, errors, shots, skipped }, null, 2),
    );
    console.log("Tour:", out, shots.length, "shots;", skipped.length, "skipped");
    if (errors.length) console.log("page errors:", errors);
  } catch (e) {
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({ path: join(out, "failure-" + i + ".png") })
        .catch(() => {});
    throw e;
  } finally {
    for (const app of apps) await app.close().catch(() => {});
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
