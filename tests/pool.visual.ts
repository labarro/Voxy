import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
async function main() {
  const bundle = await build({
      entryPoints: ["tests/pool.visual.fixture.ts"],
      bundle: true,
      write: false,
      format: "iife",
    }),
    server = createServer((req, res) => {
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "application/javascript");
        res.end(bundle.outputFiles[0].text);
      } else
        res.end('<body style="margin:0"><script src="/bundle.js"></script>');
    });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: [
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const dir = "test-results/pool-1.4.0";
  await mkdir(dir, { recursive: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    });
    await page.addInitScript("window.__name=fn=>fn;");
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.waitForFunction(() => (window as any).ready);
    const results = [];
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      for (const height of [0.9, 1, 1.1]) {
        const result = await page.evaluate(
          (v) => (window as any).posePool(...v),
          [angle, 0.65, height],
        );
        results.push({ angle, height, ...result });
        await page.screenshot({
          path: `${dir}/contact-${angle.toFixed(2)}-${height}.png`,
        });
      }
    await writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
    assert(
      results.every((r) => r.errors.every((e: number) => e < 0.045)),
      "Hands must reach their cue contact targets",
    );
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
