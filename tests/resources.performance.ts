import { _electron as electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

async function main() {
  // Real Electron process totals; fake capture is deliberately disclosed in output.
  const label =
    process.argv.find((v) => v.startsWith("--label="))?.slice(8) ?? "current";
  const root = resolve("test-results", `resources-${label}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  // Use the app's default profile, matching the recorded baseline.
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
    VOXY_DATA_DIR: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [
      ".",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
    env,
  });
  const results: unknown[] = [];
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .waitFor();
    const notes = page.getByRole("button", { name: "Entendi, vamos lá" });
    if (await notes.count()) await notes.click();
    if (process.argv.includes("--low")) {
      await page.evaluate(async () => {
        await window.voxy.saveProfile({
          ...(await window.voxy.profile()),
          lowResourceMode: true,
        });
      });
      await page.reload();
      await page
        .getByRole("button", { name: "Configurações", exact: true })
        .waitFor();
    }
    async function sample(scenario: string) {
      await page.waitForTimeout(3000);
      const samples = [];
      for (let i = 0; i < 6; i++) {
        const metrics = await app.evaluate(({ app }) => app.getAppMetrics());
        const pids = metrics.map((m) => m.pid);
        let gpu: number | null = null;
        try {
          const raw = execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `$ids=@(${pids.join(",")}); $v=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -match 'pid_(\\d+)_' -and $ids -contains [int]$Matches[1] }; if($v){($v | Measure-Object UtilizationPercentage -Sum).Sum}else{0}`,
            ],
            { encoding: "utf8", windowsHide: true, timeout: 10000 },
          ).trim();
          if (raw && Number.isFinite(Number(raw))) gpu = Number(raw);
        } catch {
          /* Counter unavailable, never substitute a synthetic zero. */
        }
        samples.push({
          ramMiB: metrics.reduce(
            (n, m) => n + m.memory.workingSetSize / 1024,
            0,
          ),
          privateMiB: metrics.reduce(
            (n, m) => n + (m.memory.privateBytes ?? 0) / 1024,
            0,
          ),
          cpu: metrics.reduce((n, m) => n + m.cpu.percentCPUUsage, 0),
          gpuEngineSum: gpu,
          processes: metrics.length,
        });
        await page.waitForTimeout(1000);
      }
      const renderer = await page.evaluate(() => ({
        canvases: document.querySelectorAll("canvas").length,
        webgl: document.querySelectorAll(".room3d canvas").length,
        heap: (performance as any).memory?.usedJSHeapSize,
      }));
      const result = { scenario, samples, renderer };
      results.push(result);
      console.log(scenario, JSON.stringify(samples));
      await writeFile(
        join(root, "metrics.json"),
        JSON.stringify(
          {
            label,
            syntheticDevices: true,
            scope:
              "all Electron app.getAppMetrics processes, working set sum, CPU percent per Electron, sum GPU engine counters (not whole adapter utilization)",
            results,
          },
          null,
          2,
        ),
      );
    }
    await sample("home");
    await page.evaluate(() =>
      window.voxy.onEvent((e) => {
        if (e.type === "state") (window as any).room = e.state;
      }),
    );
    await page.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43391,
        name: "Resource baseline",
      }),
    );
    await page.waitForFunction(() => !!(window as any).room?.channels.length);
    await sample("server");
    const joinVoice = async () => {
      await page
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
      await page
        .getByTitle("Sair do canal de voz", { exact: true })
        .first()
        .waitFor({ timeout: 30000 });
    };
    await joinVoice();
    await sample("voice");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await sample("minimized");
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.restore();
      w.show();
    });
    await page.evaluate(async () => {
      const c = (window as any).room.channels.find(
        (c: any) => c.kind === "voice",
      );
      await window.voxy.command({
        type: "channel.room",
        id: c.id,
        preset: "lounge",
      });
    });
    await page
      .getByRole("button", { name: "Entrar na sala 3D", exact: true })
      .click();
    await page
      .locator('.room3d canvas[data-ready="true"]')
      .waitFor({ timeout: 30000 });
    await sample("room3d");
    await page
      .getByRole("button", { name: "Voltar ao canal", exact: true })
      .click();
    await sample("after3d");
    await page
      .getByRole("button", { name: "Compartilhar tela", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Iniciar transmissão", exact: true })
      .click();
    await sample("sharing");
    await page
      .getByRole("button", { name: "Parar transmissão", exact: true })
      .click();
    await page.getByRole("button", { name: "Ativar câmera" }).first().click();
    await page
      .getByRole("button", { name: "Ligar câmera selecionada", exact: true })
      .click();
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    await sample("camera");
    await page.getByRole("button", { name: "Desligar câmera" }).first().click();
    for (let i = 0; i < 5; i++) {
      await page
        .getByTitle("Sair do canal de voz", { exact: true })
        .first()
        .click();
      await joinVoice();
      await page
        .getByRole("button", { name: "Entrar na sala 3D", exact: true })
        .click();
      await page
        .locator('.room3d canvas[data-ready="true"]')
        .waitFor({ timeout: 30000 });
      await page
        .getByRole("button", { name: "Voltar ao canal", exact: true })
        .click();
    }
    await sample("after5cycles");
    if (process.argv.includes("--soak")) {
      for (let i = 1; i <= 4; i++) {
        await page.waitForTimeout(15000);
        await sample(`soak-${i}`);
      }
    }
  } finally {
    console.log("Evidence:", root);
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
