// Voxy 1.7 — real Electron instances (separate identities and data folders)
// for screen-share watch states, the Friends page, animated profile images
// and the navigation rail. `--before` only captures the same screens on the
// previous build (no assertions on new behavior) for before/after evidence.
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

const before = process.argv.includes("--before");
const packed = process.argv.includes("--packaged");
const ids = [
  "f1093c4f-c536-4c05-ab85-fde58c78dc26",
  "d24513cf-e7be-40b5-b009-b2153292af1d",
  "0b7e4d1a-4c4e-4f7e-9a51-6c7e2a9d3b11",
];
const names = ["Ana", "Bruno", "Carla"];

/** Animated test GIF: moving color bands, `frames` frames of w × h. */
function makeGif(w: number, h: number, frames: number, noise = false) {
  const enc = GIFEncoder();
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const band = Math.floor((x + y + f * 12) / 24) % 3;
        const n = noise ? (Math.random() * 120) | 0 : 0;
        rgba[i] = band === 0 ? 230 : 60 + n;
        rgba[i + 1] = band === 1 ? 200 : 40 + n;
        rgba[i + 2] = band === 2 ? 255 : 90 + n;
        rgba[i + 3] = 255;
      }
    const palette = quantize(rgba, 256);
    enc.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay: 80 });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

async function main() {
  const root = resolve(
    "test-results",
    (before ? "social-before-" : "social-after-") + Date.now(),
  );
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const checks: string[] = [];
  const measures: Record<string, unknown> = {};
  let executablePath: string | undefined;
  if (packed) {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    const { directory } = JSON.parse(
      await readFile(`release/${version}/latest-build.json`, "utf8"),
    );
    executablePath = join(directory, "win-unpacked", "Voxy.exe");
  }
  const shot = async (p: Page, name: string) => {
    await p.mouse.move(2, 400);
    await p.waitForTimeout(250);
    await p.screenshot({ path: join(root, name + ".png") });
  };
  const size = async (i: number, w: number, h: number) => {
    await apps[i].evaluate(
      ({ BrowserWindow }, s) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.unmaximize();
        win.setSize(s[0], s[1]);
      },
      [w, h],
    );
    await pages[i].waitForTimeout(300);
  };
  const ok = (label: string) => {
    checks.push(label);
    console.log("✓ " + label);
  };
  /** No two of avatar, name and action may overlap inside any lobby card. */
  const cardOverlaps = (p: Page) =>
    p.evaluate(() => {
      const bad: string[] = [];
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      for (const card of document.querySelectorAll<HTMLElement>(
        ".participant-grid .participant-card",
      )) {
        const parts = [
          ".large-avatar",
          ".participant-name",
          ".watch-button",
          ".tile-badges .live-label",
          ".participant-options",
        ]
          .map((s) => [s, card.querySelector<HTMLElement>(s)] as const)
          .filter(([, e]) => e && e.offsetParent)
          .map(([s, e]) => [s, e!.getBoundingClientRect()] as const);
        const box = card.getBoundingClientRect();
        for (const [s, r] of parts)
          if (
            r.left < box.left - 0.5 ||
            r.right > box.right + 0.5 ||
            r.top < box.top - 0.5 ||
            r.bottom > box.bottom + 0.5
          )
            bad.push(card.innerText.split("\n")[0] + ": " + s + " clipped");
        for (let i = 0; i < parts.length; i++)
          for (let j = i + 1; j < parts.length; j++)
            if (hit(parts[i][1], parts[j][1]))
              bad.push(
                card.innerText.split("\n")[0] +
                  ": " +
                  parts[i][0] +
                  " × " +
                  parts[j][0],
              );
      }
      return bad;
    });
  try {
    for (let i = 0; i < 3; i++) {
      const data = join(root, "profile-" + i);
      await mkdir(data, { recursive: true });
      await writeFile(
        join(data, "profile.json"),
        JSON.stringify({
          id: ids[i],
          name: names[i],
          avatar: ["🌙", "🦊", "🐙"][i],
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
      p.on("pageerror", (e) => errors.push(names[i] + ": " + e.message));
      // tsx keeps function names with __name(); define it in the page.
      await p.evaluate("window.__name = (fn) => fn");
      await p.getByRole("heading", { name: /Sua frequência/ }).waitFor();
      const notes = p.getByRole("button", { name: "Entendi, vamos lá" });
      if (await notes.count()) await notes.click();
      await p.evaluate(() =>
        window.voxy.onEvent((e) => {
          if (e.type === "state") (window as any).room = e.state;
        }),
      );
      await size(i, 1280, 820);
    }
    const [a, b, c] = pages;
    // ── Host and join through the launcher ─────────────────────────────
    await a
      .locator(".launcher-actions")
      .getByRole("button", { name: /Hospedar sala/ })
      .click();
    await a.getByLabel("Nome do primeiro servidor").fill("Estúdio");
    await a.getByLabel("Endereço de escuta").selectOption("127.0.0.1");
    await a.getByLabel("Porta", { exact: true }).fill("43197");
    await a
      .getByRole("button", { name: "Criar sala / Hospedar servidor" })
      .click();
    await a.locator("dialog[open]").waitFor({ state: "detached" });
    await a.getByRole("button", { name: "Copiar convite", exact: true }).click();
    const invite = await apps[0].evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    for (const p of [b, c]) {
      await p
        .locator(".launcher-actions")
        .getByRole("button", { name: /Entrar em sala/ })
        .click();
      await p.getByLabel("Convite", { exact: true }).fill(invite);
      await p.getByRole("button", { name: "Conectar à sala", exact: true }).click();
      await p.locator("dialog[open]").waitFor({ state: "detached" });
    }
    await a.waitForFunction(
      () => (window as any).room?.participants.length === 3,
    );
    ok("três instâncias reais conectadas ao host local");
    // Enough servers for the rail list to scroll at small window heights.
    for (let n = 1; n <= 8; n++) {
      await a.locator(".server-rail button[aria-label='Criar servidor']").click();
      await a.locator("dialog[open] input").first().fill("Servidor " + n);
      await a.getByRole("button", { name: "Criar servidor", exact: true }).last().click();
      await a.locator("dialog[open]").waitFor({ state: "detached" });
    }
    await a.waitForFunction(() => (window as any).room.servers.length === 9);
    await a.locator(".server-rail button[aria-label='Estúdio']").click();

    // ── Navigation rail ────────────────────────────────────────────────
    const railLabels = [
      "Home",
      "Mensagens privadas",
      "Amigos",
      "Notificações",
      "Estúdio",
      "Criar servidor",
      "Entrar em sala",
      "Novidades do Voxy",
    ];
    for (const [w, h] of [
      [1440, 960],
      [1024, 720],
      [900, 640],
    ]) {
      await size(0, w, h);
      const m = await a.evaluate((labels) => {
        const rail = document.querySelector(".server-rail")!.getBoundingClientRect();
        const axis = rail.left + rail.width / 2;
        return labels.map((label) => {
          const el = [
            ...document.querySelectorAll<HTMLElement>(".server-rail button"),
          ].find(
            (e) =>
              e.getAttribute("aria-label") === label ||
              e.getAttribute("title") === label ||
              e.dataset.tip === label,
          );
          if (!el) return { label, missing: true };
          const r = el.getBoundingClientRect();
          const glyph = el.querySelector("svg, img, .server-photo")
            ?.getBoundingClientRect();
          return {
            label,
            width: +r.width.toFixed(2),
            height: +r.height.toFixed(2),
            offset: +(r.left + r.width / 2 - axis).toFixed(2),
            glyphOffsetX: glyph
              ? +(glyph.left + glyph.width / 2 - (r.left + r.width / 2)).toFixed(2)
              : null,
            glyphOffsetY: glyph
              ? +(glyph.top + glyph.height / 2 - (r.top + r.height / 2)).toFixed(2)
              : null,
          };
        });
      }, railLabels);
      measures["rail-" + w] = m;
      await a.screenshot({
        path: join(root, `rail-${w}.png`),
        clip: { x: 0, y: 0, width: 90, height: h - 40 },
      });
      if (!before) {
        for (const item of m as any[]) {
          assert(!item.missing, "rail item missing " + item.label);
          assert.equal(item.width, 44, item.label + " width " + w);
          assert.equal(item.height, 44, item.label + " height " + w);
          assert(Math.abs(item.offset) <= 0.6, item.label + " axis " + JSON.stringify(item));
          if (item.glyphOffsetX !== null)
            assert(
              Math.abs(item.glyphOffsetX) <= 0.6 && Math.abs(item.glyphOffsetY) <= 0.6,
              item.label + " glyph " + JSON.stringify(item),
            );
        }
      }
    }
    // Tooltip next to the create button.
    await size(0, 1280, 820);
    const create = a.locator(".server-rail button[aria-label='Criar servidor']");
    await create.hover();
    await a.locator(".vx-tooltip").waitFor({ timeout: 3000 }).catch(() => {});
    const tip = await a.evaluate(() => {
      const t = document.querySelector(".vx-tooltip")?.getBoundingClientRect();
      const btn = document
        .querySelector(".server-rail button[aria-label='Criar servidor']")!
        .getBoundingClientRect();
      return t
        ? {
            gap: +(t.left - btn.right).toFixed(1),
            dy: +(t.top + t.height / 2 - (btn.top + btn.height / 2)).toFixed(1),
          }
        : null;
    });
    measures.tooltip = tip;
    await a.screenshot({
      path: join(root, "rail-tooltip.png"),
      clip: { x: 0, y: 0, width: 300, height: 520 },
    });
    if (!before) {
      assert(tip && tip.gap > 0 && Math.abs(tip.dy) <= 1.5, "tooltip " + JSON.stringify(tip));
      ok("barra lateral: 8 entradas 44×44 no mesmo eixo, SVGs centrados, em 1440/1024/900 px; tooltip alinhado");
    }

    // ── Voice + screen share ───────────────────────────────────────────
    for (const p of pages) {
      await p.getByRole("button", { name: "Sala dos amigos", exact: true }).click();
      await p.locator(".voice-status").waitFor();
    }
    await a.waitForFunction(
      () =>
        (window as any).room.participants.filter((p: any) => p.channelId)
          .length === 3,
    );
    await shot(a, "lobby-three");
    const startShare = async (p: Page) => {
      await p.getByRole("button", { name: "Compartilhar tela", exact: true }).click();
      await p.locator(".source").first().click();
      await p.getByRole("button", { name: "Iniciar transmissão", exact: true }).click();
      await p.locator("dialog[open]").waitFor({ state: "detached" });
    };
    await startShare(b);
    await a.waitForFunction(() =>
      (window as any).room.participants.some((p: any) => p.sharing),
    );
    await a.waitForTimeout(1500);
    await shot(a, "lobby-share-available");
    await b.locator('.player[data-kind="screen"] video').waitFor();
    await shot(b, "sharer-local-preview");
    if (!before) {
      assert.equal(
        await a.locator('.player[data-kind="screen"]').count(),
        0,
        "remote screen must not open by itself",
      );
      assert.equal(await a.locator("audio, video").evaluateAll((els) =>
        els.filter((e) => e instanceof HTMLVideoElement && e.srcObject).length), 0);
      await a
        .locator(".participant-card.is-sharing .watch-button")
        .waitFor();
      assert.deepEqual(await cardOverlaps(a), []);
      ok("transmissão iniciada atualiza o cartão sem abrir o player remoto; prévia local do transmissor preservada");
      await a
        .getByRole("button", { name: "Assistir à tela de Bruno", exact: true })
        .click();
      await a.waitForFunction(() => {
        const v = document.querySelector<HTMLVideoElement>(
          '.player[data-kind="screen"] video',
        );
        return !!v && v.readyState >= 2 && v.videoWidth > 0;
      }, undefined, { timeout: 20000 });
      await shot(a, "lobby-watching");
      assert.deepEqual(await cardOverlaps(a), []);
      ok("clique voluntário em Assistir abre e decodifica a transmissão");
      await a
        .getByRole("button", { name: "Parar de assistir à tela de Bruno", exact: true })
        .click();
      await a.locator('.player[data-kind="screen"]').waitFor({ state: "detached" });
      assert(await a.locator(".call-dock").isVisible());
      assert.equal(
        await a.evaluate(
          () =>
            (window as any).room.participants.find(
              (p: any) => p.profile.name === "Ana",
            ).channelId !== null,
        ),
        true,
      );
      await shot(a, "lobby-stopped-watching");
      ok("Parar de assistir fecha só a visualização; a chamada continua");
    }
    await startShare(c);
    await a.waitForFunction(
      () =>
        (window as any).room.participants.filter((p: any) => p.sharing).length === 2,
    );
    await a.waitForTimeout(1200);
    await shot(a, "lobby-two-shares-available");
    if (!before) {
      await a.locator(".stream-picker").waitFor();
      await a
        .locator(".stream-picker")
        .getByRole("button", { name: /Carla/ })
        .click();
      await a.waitForFunction(
        () => document.querySelectorAll('.player[data-kind="screen"]').length === 1,
      );
      await a
        .locator(".stream-picker")
        .getByRole("button", { name: /Bruno/ })
        .click();
      await a.waitForFunction(
        () => document.querySelectorAll('.player[data-kind="screen"] video').length === 2,
      );
      await a.waitForTimeout(800);
      await shot(a, "lobby-watching-two");
      assert.deepEqual(await cardOverlaps(a), []);
      for (const [w, h] of [
        [1024, 720],
        [900, 640],
      ]) {
        await size(0, w, h);
        await shot(a, `lobby-watching-two-${w}`);
        assert.deepEqual(await cardOverlaps(a), [], "overlap at " + w);
        assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      await size(0, 1280, 820);
      ok("várias transmissões: seletor escolhe quais assistir; sem sobreposição em 1280/1024/900 px");
      // Bruno stops: his controls, indicator and player go away for Ana.
      await b.getByRole("button", { name: "Parar transmissão", exact: true }).click();
      await a.waitForFunction(
        () =>
          !document.querySelector(".stream-picker") &&
          document.querySelectorAll('.player[data-kind="screen"]').length === 1 &&
          ![...document.querySelectorAll(".participant-card")].some(
            (c) => c.textContent?.includes("Bruno") && c.classList.contains("is-sharing"),
          ),
      );
      await shot(a, "lobby-share-ended");
      ok("transmissão encerrada remove player, botão, selo e seletor");
      await c.getByRole("button", { name: "Parar transmissão", exact: true }).click();
      await a.waitForFunction(() => !document.querySelector('.player[data-kind="screen"]'));
    }

    // ── Friends ────────────────────────────────────────────────────────
    const openFriends = (p: Page) =>
      p.locator(".server-rail").getByRole("button", { name: "Amigos", exact: true }).click();
    const request = async (p: Page, id: string) => {
      await openFriends(p);
      if (before) {
        await p.getByLabel("Adicionar por ID").fill(id);
      } else {
        await p.getByRole("tab", { name: /Adicionar amigo/ }).click();
        await p.getByLabel("ID do amigo", { exact: true }).fill(id);
      }
      await p.getByRole("button", { name: "Enviar solicitação", exact: true }).click();
    };
    await request(b, ids[0]);
    await request(c, ids[0]);
    await a.waitForFunction(
      () =>
        ((window as any).room.friendships || []).filter(
          (f: any) => f.status === "pending",
        ).length === 2,
    );
    await openFriends(a);
    await shot(a, "friends-pending-all");
    if (before) {
      await a
        .locator(".friend-row", { hasText: "Bruno" })
        .getByRole("button", { name: "Aceitar", exact: true })
        .click();
      await a.waitForTimeout(800);
      await shot(a, "friends");
    } else {
      await a.getByRole("tab", { name: /Pendentes/ }).click();
      await a.getByRole("button", { name: "Aceitar Bruno", exact: true }).waitFor();
      await shot(a, "friends-pending");
      await a.getByRole("button", { name: "Aceitar Bruno", exact: true }).click();
      await a.getByText("Agora vocês são amigos.").waitFor();
      await a.getByRole("tab", { name: /Todos/ }).click();
      const row = a.locator(".friend-item", { hasText: "Bruno" });
      await row.getByText(/Online · Em voz · Sala dos amigos/).waitFor();
      assert(await row.getByRole("button", { name: "Ligar para Bruno" }).isVisible());
      await shot(a, "friends-all");
      await a.getByRole("tab", { name: /Online/ }).click();
      assert.equal(await a.locator(".friend-item").count(), 1);
      await a.getByRole("tab", { name: /Todos/ }).click();
      await a.getByLabel("Buscar amigos").fill("zzz");
      await a.getByText("Ninguém encontrado").waitFor();
      await a.getByLabel("Buscar amigos").fill("bru");
      assert.equal(await a.locator(".friend-item").count(), 1);
      await a.getByLabel("Buscar amigos").fill("");
      ok("Amigos: Todos/Online/Pendentes, aceitar solicitação, busca e estado vazio");
      await row.getByRole("button", { name: "Mais opções para Bruno" }).click();
      await shot(a, "friends-menu");
      await a.keyboard.press("Escape");
      await a.getByRole("tab", { name: /Adicionar amigo/ }).click();
      await shot(a, "friends-add");
      await a.getByRole("button", { name: "Copiar", exact: true }).click();
      assert.equal(
        await apps[0].evaluate(({ clipboard }) => clipboard.readText()),
        ids[0],
      );
      ok("Adicionar amigo: copiar o próprio ID");
      await a.getByRole("tab", { name: /Todos/ }).click();
      await a.getByRole("button", { name: "Mensagem para Bruno" }).click();
      await a.locator(".page-header, .chat-header, header").getByText("Bruno").first().waitFor();
      await shot(a, "friends-dm-opened");
      ok("Mensagem abre a conversa privada");
      await openFriends(a);
      await a.getByRole("button", { name: "Ligar para Bruno" }).click();
      await b.getByRole("button", { name: "Recusar chamada", exact: true }).waitFor();
      await shot(b, "friends-call-incoming");
      await b.getByRole("button", { name: "Recusar chamada", exact: true }).click();
      await b.locator(".direct-call-banner").waitFor({ state: "detached" });
      ok("Chamada privada entregue ao amigo presente e recusada");
      for (const [w, h] of [
        [1024, 720],
        [900, 640],
      ]) {
        await size(0, w, h);
        await shot(a, `friends-${w}`);
        assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      await size(0, 1280, 820);
    }

    // ── Animated avatar and banner ─────────────────────────────────────
    if (!before) {
      const avatarGif = makeGif(200, 200, 8);
      const hugeGif = makeGif(720, 720, 40, true);
      const bigGif = makeGif(480, 480, 30, true);
      const bannerGif = makeGif(900, 340, 10);
      measures.gifInput = {
        avatar: avatarGif.length,
        big: bigGif.length,
        banner: bannerGif.length,
      };
      const settings = () =>
        a.getByRole("button", { name: "Configurações", exact: true }).click();
      await settings();
      await a
        .locator("dialog[open] .hub-nav")
        .getByRole("button", { name: "Perfil", exact: true })
        .click();
      // Invalid file: GIF header followed by garbage.
      await a.getByLabel("Arquivo de foto de perfil").setInputFiles({
        name: "quebrado.gif",
        mimeType: "image/gif",
        buffer: Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(200, 7)]),
      });
      await a.getByText(/GIF inválido|corrompido/).waitFor();
      ok("GIF malformado rejeitado antes da decodificação");
      assert(hugeGif.length > 15 * 1024 * 1024, "huge " + hugeGif.length);
      await a.getByLabel("Arquivo de foto de perfil").setInputFiles({
        name: "enorme.gif",
        mimeType: "image/gif",
        buffer: hugeGif,
      });
      await a.getByText("Escolha um GIF de até 15 MB.").waitFor();
      ok("GIF acima de 15 MB (" + hugeGif.length + " bytes) recusado sem decodificar");
      // Large GIF is re-encoded (still animated) under the limit.
      await a.getByLabel("Arquivo de foto de perfil").setInputFiles({
        name: "grande.gif",
        mimeType: "image/gif",
        buffer: bigGif,
      });
      await a
        .locator('.profile-photo-picker .profile-avatar[data-animated="true"]')
        .waitFor({ timeout: 30000 })
        .catch(async (e) => {
          await shot(a, "big-gif-failure");
          throw Error(
            "big GIF: " +
              (await a.locator(".settings-content [role=alert]").allInnerTexts()).join(" | ") +
              " — " + e.message,
          );
        });
      const reencoded = await a
        .locator(".profile-photo-picker .profile-avatar img")
        .evaluate(async (img: HTMLImageElement) => {
          const blob = await (await fetch(img.src)).blob();
          const dec = new (window as any).ImageDecoder({
            data: await blob.arrayBuffer(),
            type: "image/gif",
          });
          await dec.tracks.ready;
          return {
            bytes: blob.size,
            frames: dec.tracks.selectedTrack.frameCount,
            width: (await dec.decode({ frameIndex: 0 })).image.displayWidth,
          };
        });
      measures.bigGifReencoded = reencoded;
      assert(reencoded.bytes <= 384 * 1024 && reencoded.frames > 1, JSON.stringify(reencoded));
      ok("GIF grande (" + bigGif.length + " bytes, 480 px, 30 quadros) reduzido a " + reencoded.bytes + " bytes mantendo " + reencoded.frames + " quadros");
      // Then the real avatar.
      await a.getByLabel("Arquivo de foto de perfil").setInputFiles({
        name: "avatar.gif",
        mimeType: "image/gif",
        buffer: avatarGif,
      });
      await a
        .locator('.profile-photo-picker .profile-avatar[data-animated="true"]')
        .waitFor();
      await a.getByLabel("Arquivo de capa do perfil").setInputFiles({
        name: "capa.gif",
        mimeType: "image/gif",
        buffer: bannerGif,
      });
      await a.locator('.banner-picker img[data-animated="true"]').waitFor();
      await shot(a, "profile-gif-preview");
      ok("prévia animada de avatar e capa antes de salvar");
      await a.getByRole("button", { name: "Salvar perfil e dispositivos" }).click();
      await a.locator("dialog[open]").waitFor({ state: "detached" });
      const saved = await a.evaluate(() => window.voxy.profile());
      assert(saved.avatarMotion?.startsWith("data:image/gif"));
      assert(saved.banner?.startsWith("data:image/gif"));
      assert(saved.avatar.startsWith("data:image/webp"));
      ok("GIF persistido no perfil (avatar animado + pôster estático, capa GIF)");
      // Remote playback on Bruno.
      await openFriends(b);
      await b.locator(".server-rail button[aria-label='Estúdio']").click();
      const remote = b.locator(
        `.participant-card:has-text("Ana") .profile-avatar[data-animated="true"] img`,
      );
      await remote.waitFor({ timeout: 20000 });
      const remoteInfo = await remote.evaluate(async (img: HTMLImageElement) => {
        const blob = await (await fetch(img.src)).blob();
        const dec = new (window as any).ImageDecoder({
          data: await blob.arrayBuffer(),
          type: blob.type || "image/gif",
        });
        await dec.tracks.ready;
        return {
          src: img.src.slice(0, 5),
          type: blob.type,
          frames: dec.tracks.selectedTrack.frameCount,
          bytes: blob.size,
        };
      });
      measures.remoteAvatar = remoteInfo;
      assert(remoteInfo.frames > 1, "remote avatar must stay animated");
      await shot(b, "remote-avatar-gif");
      await b
        .locator(".participant-card", { hasText: "Ana" })
        .click({ button: "right" });
      const banner = b.locator('.participant-menu .profile-banner img[data-animated="true"]');
      await banner.waitFor({ timeout: 20000 });
      const bannerInfo = await banner.evaluate(async (img: HTMLImageElement) => {
        const blob = await (await fetch(img.src)).blob();
        const dec = new (window as any).ImageDecoder({
          data: await blob.arrayBuffer(),
          type: "image/gif",
        });
        await dec.tracks.ready;
        return { frames: dec.tracks.selectedTrack.frameCount, bytes: blob.size };
      });
      measures.remoteBanner = bannerInfo;
      assert(bannerInfo.frames > 1, "remote banner must stay animated");
      const bannerBox = await b.evaluate(() => {
        const box = document
          .querySelector(".participant-menu .profile-banner")!
          .getBoundingClientRect();
        const menu = document.querySelector(".participant-menu")!.getBoundingClientRect();
        return { w: box.width, h: box.height, menuW: menu.width };
      });
      assert(bannerBox.h <= 120 && bannerBox.w <= bannerBox.menuW + 1, JSON.stringify(bannerBox));
      await shot(b, "remote-banner-gif");
      await b.keyboard.press("Escape");
      ok("avatar e capa GIF reproduzidos animados em outra instância (ImageDecoder: >1 quadro)");
      // Reduced motion: the still poster is shown instead.
      await b.emulateMedia({ reducedMotion: "reduce" });
      await b
        .locator('.participant-card:has-text("Ana") .profile-avatar[data-animated="true"]')
        .waitFor({ state: "detached" });
      const still = await b
        .locator('.participant-card:has-text("Ana") .profile-avatar img')
        .getAttribute("src");
      assert(still?.startsWith("data:image/webp"));
      await b.emulateMedia({ reducedMotion: "no-preference" });
      ok("movimento reduzido exibe o pôster estático");
      // Voice continued through all of the above.
      assert(
        await a.evaluate(
          () =>
            (window as any).room.participants.filter((p: any) => p.channelId)
              .length === 3,
        ),
      );
      ok("os três continuam na chamada de voz durante todo o roteiro");
    }
    assert.deepEqual(errors, []);
  } finally {
    await writeFile(
      join(root, "result.json"),
      JSON.stringify({ before, checks, measures, errors }, null, 2),
    );
    console.log("Resultados em " + root);
    for (const app of apps) await app.close().catch(() => {});
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
