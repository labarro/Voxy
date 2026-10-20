import { chromium } from "playwright";
import { build } from "esbuild";
import assert from "node:assert/strict";

async function main() {
  const bundle = await build({
    entryPoints: ["src/services/webrtc/microphone.ts"],
    bundle: true,
    format: "iife",
    globalName: "Microphone",
    write: false,
  });
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    await page.addInitScript("window.__name = (fn) => fn;");
    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const w = window as any;
      const context = new AudioContext();
      await context.resume();
      const source = context.createOscillator(),
        amplitude = context.createGain(),
        raw = context.createMediaStreamDestination();
      source.frequency.value = 440;
      amplitude.gain.value = 0.001;
      source.connect(amplitude).connect(raw);
      source.start();
      const pipeline = new w.Microphone.MicrophonePipeline(
        context,
        raw.stream,
        () => {},
      );
      const prefs = {
        inputVolume: 1,
        voiceDetection: true,
        voiceThreshold: -35,
      };
      pipeline.configure(prefs);
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(pipeline.stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const rms = () => {
        analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(
          samples.reduce((sum, v) => sum + v * v, 0) / samples.length,
        );
      };
      await sleep(500);
      const noise = rms();
      amplitude.gain.value = 0.2;
      await sleep(500);
      const speech = rms();
      pipeline.configure({ ...prefs, inputVolume: 0.25 });
      await sleep(400);
      const quieter = rms();
      amplitude.gain.value = 0.001;
      await sleep(650);
      const closed = rms();
      pipeline.configure({ ...prefs, voiceDetection: false });
      await sleep(400);
      const bypass = rms();
      pipeline.configure({ ...prefs, voiceDetection: false, inputVolume: 0 });
      await sleep(400);
      const zero = rms();
      const track = pipeline.stream.getAudioTracks()[0];
      pipeline.close();
      source.stop();
      const released =
        track.readyState === "ended" &&
        raw.stream.getTracks().every((t) => t.readyState === "ended");
      await context.close();
      return { noise, speech, quieter, closed, bypass, zero, released };
    });
    assert(result.noise < 0.00001, JSON.stringify(result));
    assert(result.speech > 0.1, JSON.stringify(result));
    assert(
      Math.abs(result.quieter / result.speech - 0.25) < 0.03,
      JSON.stringify(result),
    );
    assert(
      result.closed < 0.00001 &&
        result.bypass > 0.0001 &&
        result.zero < 0.00001,
      JSON.stringify(result),
    );
    assert(result.released);
    console.log(
      "Web Audio real: ruído bloqueado, voz liberada, volume proporcional, filtro desativável, volume zero e tracks liberadas.",
      result,
    );
  } finally {
    await browser.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
