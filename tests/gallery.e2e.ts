import { chromium } from "playwright";
import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
async function main() {
  const bundle = await build({
    entryPoints: ["tests/gallery.fixture.tsx"],
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
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js" ? "application/javascript" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? bundle.outputFiles[0].text
        : `<html><head><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    });
    await page.addInitScript("window.__name = fn => fn;");
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".player video").length === 3 &&
        [...document.querySelectorAll<HTMLVideoElement>(".player video")].every(
          (v) => v.readyState >= 2,
        ),
    );
    assert.deepEqual(await page.evaluate(() => (window as any).viewing), {
      screens: ["a", "b"],
      cameras: ["a"],
    });
    await mkdir("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/media-grid.png" });
    await page
      .getByRole("button", { name: "Ampliar ou voltar à grade", exact: true })
      .first()
      .click();
    assert.equal(await page.locator(".player").count(), 1);
    await page.waitForFunction(
      () =>
        (window as any).viewing.screens.length === 1 &&
        !(window as any).viewing.cameras.length,
    );
    await page.screenshot({ path: "test-results/media-expanded.png" });
    await page
      .getByRole("button", { name: "Voltar à grade", exact: true })
      .click();
    assert.equal(await page.locator(".player").count(), 3);
    await page
      .getByRole("button", { name: "Fechar visualização", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () => (window as any).viewing.screens.length === 1,
    );
    assert.equal(await page.locator(".player").count(), 2);
    await page
      .getByRole("button", { name: "Mostrar todas", exact: true })
      .click();
    assert.equal(await page.locator(".player").count(), 3);
    await page
      .getByLabel("Volume da transmissão", { exact: true })
      .last()
      .fill("0.25");
    assert.deepEqual(await page.evaluate(() => (window as any).volume), {
      id: "b",
      value: 0.25,
    });
    await page.evaluate(() => (window as any).setGalleryBackground(true));
    await page.waitForFunction(
      () =>
        !document.querySelectorAll(".player video").length &&
        !(window as any).viewing.screens.length &&
        !(window as any).viewing.cameras.length,
    );
    await page.evaluate(() => (window as any).setGalleryBackground(false));
    await page.waitForFunction(
      () => document.querySelectorAll(".player video").length === 3,
    );
    await page.setViewportSize({ width: 580, height: 760 });
    await page.screenshot({ path: "test-results/media-grid-narrow.png" });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert(await page.evaluate(() => (window as any).stopGallery()));
    assert.deepEqual(await page.evaluate(() => (window as any).viewing), {
      screens: [],
      cameras: [],
    });
    await writeFile(
      "test-results/gallery.json",
      JSON.stringify(
        {
          grid: true,
          expanded: true,
          individualVolume: true,
          background: true,
          responsive: true,
          tracksReleased: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "Grade com duas telas e webcam, ampliação, retorno, controles individuais, suspensão em segundo plano, responsividade e limpeza verificados.",
    );
  } finally {
    await browser.close();
    server.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
