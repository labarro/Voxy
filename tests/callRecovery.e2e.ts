import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

async function main() {
  const root = resolve("test-results", "call-recovery-" + Date.now());
  await mkdir(root, { recursive: true });
  const env = Object.fromEntries(
    Object.entries({ ...process.env, VOXY_DATA_DIR: root }).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [
      ".",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
          "--mute-audio",
    ],
    env,
  });
  const passed: string[] = [];
  try {
    const p = await app.firstWindow();
    await p
      .getByRole("button", { name: "Configurações", exact: true })
      .waitFor();
    const notes = p.getByRole("button", { name: "Entendi, vamos lá" });
    if (await notes.count()) await notes.click();
    await p.evaluate(() => {
      (window as any).originalCapture =
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.voxy.onEvent((e) => {
        if (e.type === "state") (window as any).state = e.state;
      });
    });
    await p.evaluate(() =>
      window.voxy.host({ address: "127.0.0.1", port: 43392, name: "Recovery" }),
    );
    const channel = p.getByRole("button", {
      name: "Sala dos amigos",
      exact: true,
    });
    const leave = p.getByTitle("Sair do canal de voz", { exact: true }).first();
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () =>
        new Promise((resolve) => {
          (window as any).lateCapture = resolve;
        });
    });
    await channel.click();
    await p.getByText("Abrindo microfone…", { exact: true }).waitFor();
    await p
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .waitFor({ timeout: 18000 });
    await p.evaluate(async () => {
      const stream = await (window as any).originalCapture({ audio: true });
      (window as any).lateStream = stream;
      (window as any).lateCapture(stream);
    });
    await p.waitForFunction(() =>
      (window as any).lateStream
        .getTracks()
        .every((t: MediaStreamTrack) => t.readyState === "ended"),
    );
    passed.push(
      "pending microphone times out and late capture tracks are stopped",
    );
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(
          new DOMException(
            "private-device-label-should-not-leak",
            "NotAllowedError",
          ),
        );
    });
    await p
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await p
      .getByText(/Permita o acesso ao microfone/)
      .first()
      .waitFor();
    passed.push("denied permission produces actionable failure and retry");
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = (window as any).originalCapture;
    });
    await p
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await leave.waitFor();
    await leave.click();
    await p.waitForFunction(
      () => !(window as any).state.participants.some((v: any) => v.channelId),
    );
    passed.push("manual retry joins and leaving clears server membership");
    await p.evaluate(() => {
      (window as any).resumeAudio = AudioContext.prototype.resume;
      AudioContext.prototype.resume = () => new Promise(() => {});
    });
    await channel.click();
    await p
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .waitFor({ timeout: 10000 });
    await p.getByText(/áudio do Windows não iniciou/).waitFor();
    await p.evaluate(() => {
      AudioContext.prototype.resume = (window as any).resumeAudio;
    });
    passed.push(
      "pending AudioContext resume fails within five seconds and frees the call",
    );
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    });
    await channel.click();
    await p
      .getByRole("button", { name: "Cancelar conexão", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Cancelar conexão", exact: true })
      .waitFor({ state: "detached" });
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = (window as any).originalCapture;
    });
    await channel.click();
    await leave.waitFor();
    passed.push(
      "cancel releases the entry lock immediately and permits a fresh call",
    );
    console.log(
      JSON.stringify({ root, syntheticDevices: true, passed }, null, 2),
    );
    assert.equal(passed.length, 5);
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
