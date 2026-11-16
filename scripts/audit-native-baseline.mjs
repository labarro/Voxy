// Development-only phase-0 evidence. Never reads installed user profiles or secrets.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { _electron as electron } from 'playwright';

const output = resolve('evidence/native-2.0-phase0');
await mkdir(output, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/);
const files = [];
for (const path of tracked.filter(p => /^(src\/|tests\/|scripts\/|\.github\/|build\/)/.test(p) || /^(package(-lock)?\.json|.*\.md)$/.test(p))) {
  // Inventory the immutable audit base, even when planning docs have changed.
  const bytes = execFileSync('git', ['show', `${head}:${path}`], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const source = /\.(tsx?|mjs|css|json|html|md|ya?ml|nsh)$/.test(path) ? bytes.toString('utf8') : '';
  files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    ...(source ? { lines: source.split('\n').length,
      imports: [...new Set([...source.matchAll(/(?:from\s+|import\s*\(\s*|require(?:\.resolve)?\(\s*)["']([^"']+)["']/g)].map(m => m[1]))],
      exports: [...source.matchAll(/^export\s+(?:(?:async|default)\s+)?(?:class|function|const|type|interface)\s+(\w+)/gm)].map(m => m[1]),
      ipcHandlers: [...source.matchAll(/handle\("([^"]+)"/g)].map(m => m[1]),
      tables: [...source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]),
      radminLines: source.split('\n').flatMap((s,i) => /radmin/i.test(s) ? [i+1] : []) } : {}) });
}
await writeFile(join(output, 'source-inventory.json'), JSON.stringify({ head, generatedAt: new Date().toISOString(),
  scope: 'Tracked source, assets, tests, scripts, workflow and guides; static coverage is not a line-by-line correctness or security proof.', files }, null, 2) + '\n');
const machine = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
  '$osInfo=Get-CimInstance Win32_OperatingSystem; $cpuInfo=Get-CimInstance Win32_Processor; $gpuInfo=Get-CimInstance Win32_VideoController; [pscustomobject]@{os=$osInfo.Caption;build=$osInfo.BuildNumber;cpu=@($cpuInfo | ForEach-Object {$_.Name});gpus=@($gpuInfo | ForEach-Object {[pscustomobject]@{name=$_.Name;driver=$_.DriverVersion}})} | ConvertTo-Json -Depth 4'],
  { encoding: 'utf8', windowsHide: true }).trim());
await writeFile(join(output, 'environment.json'), JSON.stringify({ measuredAt: new Date().toISOString(), head,
  ...machine, logicalCpus: os.cpus().length, ramBytes: os.totalmem(), node: process.version,
  electron: JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version,
  packaged: false, syntheticDevices: true, pttHelperEnabled: false,
  note: 'No hostname, account name, IP, invite, device identifier or installed profile recorded. Resource scenario harness counts Electron processes; no PTT helper in these scenarios.' }, null, 2) + '\n');
const startup = [];
for (let trial = 1; trial <= 3; trial++) {
  const root = resolve('test-results', `native-audit-startup-${Date.now()}-${trial}`);
  await mkdir(root, { recursive: true });
  const env = { ...process.env, VOXY_DATA_DIR: root };
  delete env.ELECTRON_RUN_AS_NODE;
  const began = performance.now();
  const app = await electron.launch({ args: ['.', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Configurações', exact: true }).waitFor();
    const elapsedMs = performance.now() - began;
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics());
    startup.push({ trial, elapsedMs, workingSetMiB: metrics.reduce((s,m) => s + m.memory.workingSetSize / 1024, 0),
      privateMiB: metrics.reduce((s,m) => s + (m.memory.privateBytes ?? 0) / 1024, 0), processes: metrics.length });
  } finally { await app.close(); }
}
await writeFile(join(output, 'startup.json'), JSON.stringify({ head, measuredAt: new Date().toISOString(),
  method: 'Wall clock before Playwright Electron launch to settings button visible. Fresh isolated profile each trial, warm OS cache, first-run notes may still be visible; not cold boot or installed executable. Electron process sums only, no PTT helper.', startup }, null, 2) + '\n');
const baseline = process.argv[2];
if (baseline) {
  await copyFile(resolve(baseline), join(output, 'electron-resources.json'));
  const data = JSON.parse(await readFile(baseline, 'utf8'));
  const median = values => {
    const sorted = values.filter(v => v !== null).sort((a,b) => a-b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const summary = data.results.map(r => ({ scenario: r.scenario,
    ...Object.fromEntries(['ramMiB', 'privateMiB', 'cpu', 'gpuEngineSum', 'processes'].map(k => [k, median(r.samples.slice(1).map(s => s[k]))])),
    webglCanvases: r.renderer.webgl }));
  await writeFile(join(output, 'resource-summary.json'), JSON.stringify({ head,
    method: 'Median of last five of six samples in each scenario; first sample discarded. No peer, synthetic capture, Electron process sums only. GPU engine sum is not full-adapter utilization.', summary }, null, 2) + '\n');
}
console.log(JSON.stringify({ output, indexedFiles: files.length, startup }, null, 2));
