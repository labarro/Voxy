import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import electron from "electron";
mkdirSync("test-results", { recursive: true });
await build({
  entryPoints: ["tests/updater.runtime.ts"],
  outfile: "test-results/updater-native.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["test-results/updater-native.cjs"], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
const timer = setTimeout(() => {
  child.kill();
  console.error("Tempo esgotado no teste do updater");
  process.exitCode = 1;
}, 180000);
child.on("error", () => {
  clearTimeout(timer);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
