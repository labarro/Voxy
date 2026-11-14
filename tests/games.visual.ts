import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
async function main() {
  const bundle = await build({
      entryPoints: ["tests/games.visual.fixture.ts"],
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
    }),
    dir = "test-results/games-visual-1.4.0";
  await mkdir(dir, { recursive: true });
  try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      }),
      errors: string[] = [],
      results: any[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript("window.__name=fn=>fn;");
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.waitForFunction(() => (window as any).ready);
    const capture = async (kind: string, args: any[], name: string) => {
      const result = await page.evaluate(
        ({ kind, args }) => (window as any)[kind](...args),
        { kind, args },
      );
      results.push({ kind, args, ...result });
      await page.screenshot({ path: `${dir}/${name}.png` });
    };
    for (let index = 0; index < 4; index++)
      for (const height of [0.9, 1.1])
        await capture(
          "cards",
          [index, height, 0.3],
          `cards-${index}-${height}`,
        );
    for (let index = 0; index < 2; index++)
      for (const height of [0.9, 1, 1.1])
        for (const age of [0.26, 0.5, 0.74])
          await capture(
            "chess",
            [index, height, age],
            `chess-${index}-${height}-${age}`,
          );
    for (const emote of [
      "wave",
      "laugh",
      "dance",
      "clap",
      "celebrate",
      "greet",
      "point",
      "sitfloor",
      "pose",
      "surprise",
      "smoke",
    ])
      for (const angle of [0, Math.PI / 2, Math.PI])
        await capture(
          "emote",
          [emote, angle, 1],
          `emote-${emote}-${angle.toFixed(2)}`,
        );
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      await capture("roof", [angle], `rooftop-${angle.toFixed(2)}`);
    await writeFile(
      `${dir}/results.json`,
      JSON.stringify({ errors, results }, null, 2),
    );
    assert.deepEqual(errors, []);
    assert(
      results
        .filter((r) => r.errors)
        .every((r) => r.errors.every((e: number) => e < 0.065)),
      "Both hands must reach game targets across supported heights",
    );
    assert(
      results
        .filter((r) => r.soles)
        .every((r) => r.soles.every((y: number) => y > -0.045)),
      "Emote soles must clear the floor",
    );
    assert(
      results.filter((r) => r.kind === "roof").every((r) => r.calls < 450),
      "Rooftop draw budget",
    );
    console.log(dir);
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
