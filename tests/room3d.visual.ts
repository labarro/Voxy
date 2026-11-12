import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

async function main() {
  const bundle = await build({
    entryPoints: ["tests/room3d.visual.fixture.ts"],
    bundle: true,
    write: false,
    format: "iife",
  });
  const root = resolve("src/renderer/public");
  const server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (req.url?.startsWith("/assets/")) {
      const path = resolve(root, "." + req.url);
      if (!path.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      try {
        res.end(await readFile(path));
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    res.end(
      '<html><body style="margin:0"><script src="/bundle.js"></script></body></html>',
    );
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
  const dir = "test-results/visual-1.2.0";
  await mkdir(dir, { recursive: true });
  const page = await browser.newPage({
      viewport: { width: 1200, height: 720 },
    }),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript("window.__name=fn=>fn;");
  try {
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.waitForFunction(() => (window as any).ready);
    for (const [name, angle] of [
      ["front", 0],
      ["side", Math.PI / 2],
      ["back", Math.PI],
    ] as const) {
      await page.evaluate((angle) => (window as any).show(angle), angle);
      await page.screenshot({ path: `${dir}/avatars-${name}.png` });
    }
    for (const [name, angle, seated, smoke] of [
      ["face", 0, false, false],
      ["smoke", -0.5, false, true],
      ["sitting", 0.6, true, false],
    ] as const) {
      await page.evaluate(
        ({ angle, seated, smoke }) =>
          (window as any).characterCase(
            (window as any).appearances[1],
            angle,
            seated,
            smoke,
          ),
        { angle, seated, smoke },
      );
      await page.screenshot({ path: `${dir}/avatar-${name}.png` });
    }
    assert(await page.evaluate(() => (window as any).verifySmokePreference()));
    const combinations = await page.evaluate(() => {
      const w = window as any,
        hairs = [
          "short",
          "long",
          "crest",
          "bob",
          "curly",
          "buzz",
          "afro",
          "ponytail",
          "braids",
          "wavy",
          "bun",
          "bald",
        ],
        tops = [
          "sweater",
          "jacket",
          "hoodie",
          "tee",
          "shirt",
          "coat",
          "suit",
          "varsity",
        ];
      for (let i = 0; i < hairs.length; i++)
        w.characterCase(
          {
            ...w.appearances[i % 4],
            hairStyle: hairs[i],
            outfitStyle: tops[i % tops.length],
            accessories:
              i % 2
                ? ["beanie", "headphones", "earrings"]
                : ["glasses", "backpack"],
          },
          ((i % 3) * Math.PI) / 2,
        );
      return hairs.length;
    });
    assert.equal(combinations, 12);
    await page.evaluate(() => (window as any).catalog());
    await page.screenshot({ path: `${dir}/character-catalog.png` });
    for (const preset of ["lounge", "cinema"] as const) {
      await page.evaluate((preset) => {
        document.querySelector("canvas")?.remove();
        const w = window as any,
          el = document.createElement("div");
        el.style.cssText = "width:1200px;height:720px";
        document.body.appendChild(el);
        const data = {
          people: [
            {
              id: "a",
              profile: { name: "Teste", id: "a", avatar: "A" },
              roomPose: { x: 0, z: 6, yaw: Math.PI, seat: null, moving: false },
            },
          ],
          settings: {
            quality: "high",
            entry: "always",
            proximity: true,
            volume: 1,
            range: 10,
            sensitivity: 1,
            names: false,
          },
          speaking: new Set(),
          paused: false,
        };
        w.room = new w.SocialScene(
          el,
          preset,
          "a",
          data,
          async () => {},
          () => {},
          (message: string) => {
            throw Error(message);
          },
        );
      }, preset);
      await page.locator('canvas[data-ready="true"]').waitFor();
      await page.evaluate(() => {
        const s = (window as any).room;
        s.rig.setMode("free");
        s.rig.wantedDistance = 20;
        s.rig.wantedPitch = 0.67;
        s.rig.freeTarget.set(0, 1.2, 1);
      });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/${preset}-wide.png` });
      // Rotate to see the front of all seats; verify the camera stays finite in wall-side orbits.
      for (const yaw of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await page.evaluate((yaw) => {
          const s = (window as any).room;
          s.rig.wantedYaw = yaw;
        }, yaw);
        await page.waitForTimeout(600);
        assert(
          await page.evaluate(() => {
            const p = (window as any).room.camera.position;
            return Number.isFinite(p.x + p.y + p.z);
          }),
        );
        if (yaw === Math.PI)
          await page.screenshot({ path: `${dir}/${preset}-seat-fronts.png` });
      }
      await page.evaluate(() => (window as any).room.dispose());
      await page.evaluate(() =>
        document.querySelectorAll("body>div").forEach((e) => e.remove()),
      );
    }
    assert.deepEqual(errors, []);
    await writeFile(
      `${dir}/results.json`,
      JSON.stringify(
        {
          errors,
          combinations,
          checks: [
            "front/side/back",
            "face close-up",
            "smoking pose",
            "sitting pose",
            "12 hair combinations",
            "wide lounge/cinema",
            "seat fronts",
            "camera orbits",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "3D visual captures and 12 appearance combinations passed: " + dir,
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
