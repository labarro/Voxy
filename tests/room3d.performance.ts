import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { execFileSync } from "node:child_process";

async function main() {
  const label =
    process.argv.find((v) => v.startsWith("--label="))?.slice(8) ?? "1.2.0";
  const baseline = process.argv.includes("--baseline"),
    gpu = process.argv.includes("--gpu");
  // Preserve every historical module, not just scene.ts with current dependencies.
  const baselineRoot = resolve(".local/performance-v1.1.0");
  if (baseline) {
    const files = execFileSync(
      "git",
      [
        "ls-tree",
        "-r",
        "--name-only",
        "v1.1.0",
        "src/renderer/room3d",
        "src/shared",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/);
    for (const file of files) {
      const path = resolve(baselineRoot, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, execFileSync("git", ["show", `v1.1.0:${file}`]));
    }
  }
  const source = {
    entryPoints: [
      baseline
        ? resolve(baselineRoot, "src/renderer/room3d/scene.ts")
        : "src/renderer/room3d/scene.ts",
    ],
  };
  const bundle = await build({
    ...source,
    bundle: true,
    format: "iife",
    globalName: "RoomScene",
    write: false,
  });
  const publicRoot = resolve("src/renderer/public");
  const server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (req.url?.startsWith("/assets/")) {
      const path = resolve(publicRoot, "." + req.url.split("?")[0]);
      if (!path.startsWith(publicRoot)) {
        res.writeHead(403).end();
        return;
      }
      try {
        res.setHeader(
          "Content-Type",
          extname(path) === ".glb"
            ? "model/gltf-binary"
            : "application/octet-stream",
        );
        res.end(await readFile(path));
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    res.end(
      '<html><body style="margin:0"><div id="room" style="width:1024px;height:600px"></div><script src="/bundle.js"></script></body></html>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: gpu ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const results: any[] = [];
  await mkdir("test-results", { recursive: true });
  try {
    for (const quality of ["low", "medium", "high"]) {
      const page = await browser.newPage({
        viewport: { width: 1024, height: 600 },
      });
      await page.addInitScript("window.__name=fn=>fn;");
      await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
      const result = await page.evaluate(async (quality) => {
        const w = window as any;
        const people = Array.from({ length: 10 }, (_, i) => ({
          id: String(i),
          profile: { id: String(i), name: "Amigo " + i, avatar: "A" },
          channelId: "voice",
          muted: false,
          deafened: false,
          sharing: false,
          host: i === 0,
          roomPose: {
            x: ((i % 5) - 2) * 1.3,
            z: Math.floor(i / 5) * 2.5 + 3,
            yaw: Math.PI,
            seat: null,
            moving: i % 2 === 0,
          },
        }));
        const data = {
          people,
          speaking: new Set(["1", "3"]),
          settings: {
            entry: "ask",
            quality,
            proximity: true,
            volume: 1,
            range: 10,
            sensitivity: 1,
            names: true,
          },
          paused: false,
        };
        const scene = new w.RoomScene.SocialScene(
          document.getElementById("room"),
          "lounge",
          "0",
          data,
          async (pose: any) => {
            people[0].roomPose = pose;
          },
          () => {},
          (message: string) => {
            throw Error(message);
          },
        );
        await new Promise((r) => setTimeout(r, 2000));
        const renderer = scene.renderer;
        let frames = 0,
          cpu = 0,
          calls = 0,
          triangles = 0;
        const original = renderer.render.bind(renderer);
        renderer.render = (...args: any[]) => {
          const start = performance.now();
          original(...args);
          cpu += performance.now() - start;
          calls += renderer.info.render.calls;
          triangles += renderer.info.render.triangles;
          frames++;
        };
        const started = performance.now();
        await new Promise((r) => setTimeout(r, 4000));
        const elapsed = performance.now() - started;
        const gl = renderer.getContext(),
          debug = gl.getExtension("WEBGL_debug_renderer_info");
        const metrics = {
          quality,
          frames,
          fps: (frames * 1000) / elapsed,
          renderCpuMs: cpu / Math.max(1, frames),
          drawCalls: calls / Math.max(1, frames),
          triangles: triangles / Math.max(1, frames),
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          renderer: debug
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          viewport: "1024x600",
          avatars: 10,
        };
        w.scene = scene;
        return metrics;
      }, quality);
      await page.screenshot({
        path: `test-results/room3d-${label}-${quality}.png`,
      });
      const afterDispose = await page.evaluate(() => {
        const w = window as any;
        w.scene.dispose();
        return { ...w.scene.renderer.info.memory };
      });
      results.push({ ...result, afterDispose });
      await page.close();
    }
    await mkdir("test-results", { recursive: true });
    await writeFile(
      `test-results/room3d-performance-${label}.json`,
      JSON.stringify(
        { label, measuredAt: new Date().toISOString(), results },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
