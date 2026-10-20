import { _electron as electron } from "playwright";
import { resolve } from "node:path";
import assert from "node:assert/strict";
async function main() {
  const { createServer } = await import("vite");
  const server = await createServer();
  await server.listen();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VOXY_DEV = "1";
  env.VOXY_DATA_DIR = resolve(`test-results/dev-${Date.now()}`);
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("heading", { name: "Sua frequência.", exact: false })
      .waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: "Entendi, vamos l\u00e1", exact: true })
      .click();
    const p = await page.evaluate(() => window.voxy.profile());
    assert(p.id);
    assert.deepEqual(errors, []);
    console.log(
      "Vite + Electron: UI, React Refresh e preload carregados sem pageerror.",
    );
  } finally {
    await app.close();
    await server.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
