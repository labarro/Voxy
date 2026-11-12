import { chromium } from "playwright";
import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { resolve, extname } from "node:path";

async function main() {
  const bundle = await build({
    entryPoints: ["tests/room3d.fixture.tsx"],
    bundle: true,
    format: "iife",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const css = await readFile(
    "dist/renderer/assets/" +
      (await readdir("dist/renderer/assets")).find((f) => f.endsWith(".css")),
    "utf8",
  );
  const publicRoot = resolve("src/renderer/public");
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith("/assets/")) {
      const path = resolve(publicRoot, "." + req.url.split("?")[0]);
      if (!path.startsWith(publicRoot)) {
        res.writeHead(403).end();
        return;
      }
      try {
        res.setHeader(
          "Content-Type",
          extname(path) === ".png" ? "image/png" : "model/gltf-binary",
        );
        res.end(await readFile(path));
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js" ? "application/javascript" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? bundle.outputFiles[0].text
        : `<html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript("window.__name = fn => fn;");
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.locator('.room3d canvas[data-ready="true"]').waitFor();
    await page.waitForFunction(() =>
      (window as any).commands.some((c: any) => c.pose),
    );
    await page.waitForFunction(() =>
      (window as any).viewing?.screens.includes("friend"),
    );
    assert.equal(await page.locator(".player").count(), 1); // camera stays available beside the 3D TV
    const scene = page.locator(".room3d canvas");
    await scene.focus();
    const initial = await page.evaluate(() => (window as any).pose());
    await page.keyboard.down("KeyW");
    try {
      await page
        .getByRole("button", { name: "Sentar / levantar (E)" })
        .waitFor();
    } finally {
      await page.keyboard.up("KeyW");
    }
    await page.waitForFunction(
      (z: number) => (window as any).pose()?.z < z - 1,
      initial.z,
    );
    await page.getByRole("button", { name: "Sentar / levantar (E)" }).click();
    await page.waitForFunction(() => (window as any).pose()?.seat !== null);
    await mkdir("test-results", { recursive: true });
    await page.getByRole("button", { name: "Opções da câmera" }).click();
    await page
      .getByRole("button", { name: "Explorar ambiente", exact: false })
      .click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/room3d-lounge.png" });
    await page.getByRole("button", { name: "Sentar / levantar (E)" }).click();
    await page.waitForFunction(() => (window as any).pose()?.seat === null);
    await page
      .getByRole("button", { name: "Assistir na TV", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector(".room3d")?.getAttribute("data-camera-mode") ===
        "watch",
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/room3d-watch.png" });
    const beforeFullscreen = await page.evaluate(() => (window as any).pose());
    await page
      .getByRole("button", { name: "Tela cheia da sala", exact: true })
      .click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    assert.deepEqual(
      await page.evaluate(() => (window as any).pose()),
      beforeFullscreen,
    );
    await page.screenshot({ path: "test-results/room3d-fullscreen.png" });
    await page
      .getByRole("button", { name: "Sair da tela cheia da sala", exact: true })
      .click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.getByRole("button", { name: "Ampliar TV", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.player[data-kind="screen"] video') instanceof
        HTMLVideoElement,
    );
    assert.equal(
      (await page.evaluate(() => (window as any).viewing.screens)).filter(
        (id: string) => id === "friend",
      ).length,
      1,
    );
    await page
      .getByRole("button", { name: "Voltar à sala", exact: false })
      .first()
      .click();
    await page
      .getByRole("combobox", { name: "Transmissão na TV" })
      .selectOption("other");
    await page.waitForFunction(
      () => (window as any).viewing.screens[0] === "other",
    );
    await page
      .getByRole("button", { name: "Personalizar", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Seu personagem, do seu jeito/ })
      .click();
    await page.locator('.avatar-studio[data-ready="true"]').waitFor();
    await page
      .getByRole("button", { name: "Cabelo Topete", exact: true })
      .click();
    await page.getByRole("button", { name: /Salvar visual/ }).click();
    await page
      .getByRole("button", { name: "Cabelo Afro", exact: true })
      .click();
    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Cabelo Topete", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("tab", { name: "Rosto", exact: true }).click();
    await page
      .getByRole("button", { name: "Formato Quadrado", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Barba Cheia", exact: true })
      .click();
    await page.getByRole("tab", { name: "Roupas", exact: true }).click();
    await page
      .getByRole("button", { name: "Parte inferior Saia", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Calçados Botas", exact: true })
      .click();
    // Applying a saved base look replaces optional fields rather than merging stale pieces.
    await page.getByRole("button", { name: "Visual 1", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Parte inferior Calça", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page
      .getByRole("button", { name: "Parte inferior Saia", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Calçados Botas", exact: true })
      .click();
    await page.getByRole("tab", { name: "Roupas", exact: true }).click();
    await page
      .getByRole("button", { name: "Roupa Jaqueta", exact: true })
      .click();
    await page.getByRole("tab", { name: "Acessórios", exact: true }).click();
    await page
      .getByRole("button", { name: "Acessório Fones", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Acessório Mochila", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Acessório Colar", exact: true })
      .click();
    await page.getByRole("button", { name: "Andando", exact: true }).click();
    await page.waitForTimeout(350);
    await page.screenshot({
      path: "test-results/room3d-character-creator.png",
    });
    assert.equal(
      await page.evaluate(() => (window as any).profile().avatar3d.hair),
      "short",
      "preview edits remain a draft",
    );
    await page.locator(".avatar-studio canvas").evaluate((canvas) => {
      (canvas as HTMLCanvasElement)
        .getContext("webgl2")!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    await page
      .getByRole("button", { name: "Recarregar preview", exact: true })
      .click();
    await page.locator('.avatar-studio[data-ready="true"]').waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Acessório Fones", exact: true })
        .getAttribute("aria-pressed"),
      "true",
      "context recovery preserves the draft",
    );
    await page
      .getByRole("button", { name: "Aplicar personagem", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => (window as any).profile().avatar3d.hair),
      "crest",
    );
    await page
      .getByRole("button", { name: /Seu personagem, do seu jeito/ })
      .click();
    await page.locator('.avatar-studio[data-ready="true"]').waitFor();
    await page
      .getByRole("button", { name: "Restaurar padrão", exact: true })
      .click();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(
      await page.evaluate(() => (window as any).profile().avatar3d.hair),
      "crest",
      "cancel never persists the reset",
    );
    await page.getByLabel("Qualidade gráfica").selectOption("low");
    await page.getByLabel("Mostrar cigarro virtual e fumaça").uncheck();
    assert.equal(
      await page.evaluate(() => (window as any).profile().room3d.smokeEffects),
      false,
    );
    await page
      .getByRole("button", { name: "Personalizar", exact: true })
      .click();
    await page.getByRole("button", { name: "Trocar ambiente" }).click();
    await page.getByRole("region", { name: "Cinema 3D" }).waitFor();
    await page.locator('.room3d canvas[data-ready="true"]').waitFor();
    await page.getByRole("button", { name: "Opções da câmera" }).click();
    await page
      .getByRole("button", { name: "Explorar ambiente", exact: false })
      .click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: "test-results/room3d-cinema.png" });
    const mixed = await page.evaluate(() => (window as any).mix);
    assert(mixed.friend.gain < 1);
    assert(mixed.friend.pan > 0);
    const audio = await page.evaluate(() => (window as any).testVoiceSpatial());
    assert(
      audio.normal[0] > 0.05 && audio.normal[1] > 0.05,
      JSON.stringify(audio),
    );
    assert(audio.far[0] < 0.005 && audio.far[1] < 0.005);
    assert(audio.panned[1] > audio.panned[0] * 5);
    assert(audio.restored[0] > 0.05 && audio.restored[1] > 0.05);
    await page
      .getByRole("button", { name: "Tradicional", exact: true })
      .click();
    assert.equal(await scene.count(), 0);
    await page.waitForFunction(
      () => Object.keys((window as any).mix).length === 0,
    );
    await page.getByRole("button", { name: "Entrar 3D", exact: true }).click();
    await page.locator(".room3d canvas").waitFor();
    await page.waitForTimeout(250);
    await page
      .locator(".room3d canvas")
      .evaluate((el) =>
        (el as HTMLCanvasElement)
          .getContext("webgl2")!
          .getExtension("WEBGL_lose_context")!
          .loseContext(),
      );
    await page
      .getByRole("status")
      .filter({ hasText: "placa gráfica" })
      .waitFor();
    assert.equal(await scene.count(), 0);
    assert.deepEqual(errors, []);
    await writeFile(
      "test-results/room3d-results.json",
      JSON.stringify(
        {
          audio,
          errors,
          checks: [
            "lounge",
            "cinema",
            "walk",
            "seat",
            "stand",
            "TV subscription",
            "TV focus",
            "camera gallery",
            "customization",
            "quality",
            "spatial audio",
            "traditional fallback",
            "context loss",
            "smooth watch camera",
            "room fullscreen",
            "creator live preview",
            "apply and cancel isolation",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "3D rooms: rendering, movement, seating, TV, webcams, settings, spatial audio and fallback passed.",
    );
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
