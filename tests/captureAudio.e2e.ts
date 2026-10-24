import { _electron as electron, type ElectronApplication } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

// Real Windows loopback, two independent processes and synthetic tones. No
// physical microphone or getDisplayMedia mock; never reports hardware validation.
async function main() {
  const root = resolve("test-results", "capture-audio-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const env: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (p): p is [string, string] => p[1] !== undefined,
          ),
        ),
        VOXY_DATA_DIR: join(root, String(i)),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      apps.push(
        await electron.launch({
          args: [".", "--autoplay-policy=no-user-gesture-required"],
          env,
        }),
      );
    }
    const pages = await Promise.all(apps.map((app) => app.firstWindow()));
    for (const [i, page] of pages.entries()) {
      await page.waitForFunction(() => !!window.voxy);
      await page.evaluate("window.__name = (fn) => fn");
      await page.evaluate(async (i) => {
        const ctx = new AudioContext();
        await ctx.resume();
        const tone = ctx.createOscillator(),
          gain = ctx.createGain();
        tone.frequency.value = i ? 880 : 440;
        gain.gain.value = 0.15;
        tone.connect(gain).connect(ctx.destination);
        tone.start();
        (window as any).__tone = { ctx, tone, gain };
      }, i);
    }
    const page = pages[0];
    assert(
      await page.evaluate(() => window.voxy.captureAudioAvailable()),
      "Windows sem exclusão por processo",
    );
    const sources = await page.evaluate(() => window.voxy.sources());
    const screen = sources.find((s) => s.id.startsWith("screen:"));
    const windowSource = sources.find(
      (s) => s.id.startsWith("window:") && s.name.includes("Voxy"),
    );
    assert(screen && windowSource, "Fontes de monitor e janela devem existir");
    const results = [];
    for (const source of [screen, windowSource]) {
      const result = await page.evaluate(async (id) => {
        await window.voxy.selectSource(id, true);
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            restrictOwnAudio: true,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as MediaTrackConstraints,
        });
        try {
          const track = stream.getAudioTracks()[0];
          if (!track) throw Error("Captura não forneceu track de áudio");
          const ctx: AudioContext = (window as any).__tone.ctx;
          const input = ctx.createMediaStreamSource(new MediaStream([track]));
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 32768;
          input.connect(analyser);
          await new Promise((r) => setTimeout(r, 1500));
          const bins = new Float32Array(analyser.frequencyBinCount);
          analyser.getFloatFrequencyData(bins);
          const peak = (frequency: number) => {
            const bin = Math.round(
              (frequency * analyser.fftSize) / ctx.sampleRate,
            );
            return Math.max(...bins.slice(bin - 3, bin + 4));
          };
          const result = {
            settings: track.getSettings(),
            ownDb: peak(440),
            externalDb: peak(880),
          };
          input.disconnect();
          analyser.disconnect();
          return result;
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      }, source.id);
      assert.equal(
        (result.settings as any).restrictOwnAudio,
        true,
        "A track deve confirmar exclusão",
      );
      assert(
        result.externalDb > -50,
        "Tom do outro processo deve ser capturado: " + JSON.stringify(result),
      );
      assert(
        result.ownDb < -65 && result.ownDb < result.externalDb - 25,
        "Áudio do próprio Voxy deve ficar no piso de ruído: " +
          JSON.stringify(result),
      );
      results.push({ source: source.id, ...result });
    }
    await writeFile(
      join(root, "result.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      "Loopback real de monitor e janela: tom externo preservado, tom do Voxy excluído.",
      results,
    );
  } finally {
    for (const app of apps.reverse()) await app.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
