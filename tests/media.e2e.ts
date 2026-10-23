import { chromium, type Page } from "playwright";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
async function cameraPixel(page: Page, color: "green" | "red") {
  await page.waitForFunction(
    () =>
      !!(window as any).view.cameraStreams?.get("0")?.getVideoTracks().length,
  );
  const pixel = await page.evaluate(async (color) => {
    const v = document.createElement("video");
    v.muted = true;
    v.srcObject = (window as any).view.cameraStreams.get("0");
    await v.play();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    let callback = 0;
    try {
      return await new Promise<number[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          v.cancelVideoFrameCallback(callback);
          reject(Error("Webcam: novos pixels não chegaram"));
        }, 10000);
        const next = () => {
          callback = v.requestVideoFrameCallback(() => {
            canvas.getContext("2d")!.drawImage(v, 200, 100, 1, 1, 0, 0, 1, 1);
            const pixel = [
              ...canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data,
            ];
            if (
              color === "green"
                ? pixel[1] > 150 && pixel[0] < 150
                : pixel[0] > 180 && pixel[1] < 100
            ) {
              clearTimeout(timer);
              resolve(pixel);
            } else next();
          });
        };
        next();
      });
    } finally {
      v.pause();
      v.srcObject = null;
    }
  }, color);
  assert(pixel.length === 4);
}
async function main() {
  const bundle = await build({
    entryPoints: ["src/services/webrtc/engine.ts"],
    bundle: true,
    format: "iife",
    globalName: "VoxyMedia",
    write: false,
  });
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<html><body>Voxy media integration</body></html>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const pages = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => browser.newPage()),
  );
  const results: string[] = [];
  try {
    for (let i = 0; i < 10; i++) {
      const page = pages[i];
      await page.exposeFunction("relay", async (s: any) => {
        await pages[Number(s.to)].evaluate(
          ({ s, from }) => {
            (window as any).engine.signal({ ...s, from: String(from) });
          },
          { s, from: i },
        );
      });
      await page.addInitScript("window.__name = (fn) => fn;");
      await page.goto(`http://127.0.0.1:${port}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(async (index) => {
        const w = window as any;
        w.engine = new w.VoxyMedia.VoiceEngine(
          w.relay,
          (view: any) => {
            w.view = view;
          },
          () => {},
        );
        await w.engine.join(String(index), "");
      }, i);
    }
    const participants = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({
      id: String(i),
      profile: {
        id: String(i),
        name: String(i),
        avatar: "x",
        mediaSubscriptions: true,
      },
      channelId: "voice",
      muted: false,
      deafened: false,
      sharing: false,
      host: i === 0,
    }));
    for (let i = 0; i < 10; i++)
      await pages[i].evaluate(
        ({ participants, i }) =>
          (window as any).engine.sync(participants, String(i)),
        { participants, i },
      );
    for (const page of pages) {
      await page.waitForFunction(
        () => {
          const peers = [...(window as any).engine.peers.values()] as any[];
          return (
            peers.length === 9 &&
            peers.every(
              (p) =>
                p.pc.connectionState === "connected" &&
                p.pc.getTransceivers().length === 4,
            )
          );
        },
        {},
        { timeout: 20000 },
      );
      await page.waitForFunction(
        async () => {
          const peers = [...(window as any).engine.peers.values()] as any[];
          for (const p of peers) {
            const stats = await p.pc.getStats();
            let received = false;
            stats.forEach((s: any) => {
              if (
                s.type === "inbound-rtp" &&
                s.kind === "audio" &&
                s.packetsReceived > 5
              )
                received = true;
            });
            if (!received) return false;
          }
          return true;
        },
        {},
        { timeout: 15000 },
      );
    }
    results.push(
      "45 pares mesh conectados; exatamente 4 transceivers por par; pacotes de áudio recebidos nos 90 sentidos.",
    );
    await pages[0].evaluate(() => {
      const w = window as any;
      w.engine.setMuted(true);
      if (w.engine.microphone.getAudioTracks()[0].enabled)
        throw Error("mute failed");
      w.engine.setMuted(false);
    });
    results.push("Mute/desmute altera track do microfone.");
    await pages[0].evaluate(() => {
      const w = window as any;
      const prefs = {
        id: "0",
        name: "Teste",
        avatar: "x",
        input: "",
        output: "",
        pttEnabled: true,
        callSounds: false,
        volumes: { "1": 0.35 },
        streamVolumes: { "1": 0.2 },
      };
      w.engine.configurePreferences(prefs);
      if (w.engine.microphone.getAudioTracks()[0].enabled)
        throw Error("PTT opened without key");
      w.engine.setPttPressed(true);
      if (!w.engine.microphone.getAudioTracks()[0].enabled)
        throw Error("PTT held did not open");
      w.engine.setMuted(true);
      if (w.engine.microphone.getAudioTracks()[0].enabled)
        throw Error("Manual mute bypassed");
      w.engine.setMuted(false);
      w.engine.setPttPressed(false);
      if (w.engine.microphone.getAudioTracks()[0].enabled)
        throw Error("PTT release failed");
      const peer = w.engine.peers.get("1");
      if (
        w.engine.getVolume("1") !== 0.35 ||
        peer.audio.volume !== 1 ||
        peer.systemAudio.volume !== 0.2
      )
        throw Error("Independent volumes failed");
      w.engine.setDeafened(true);
      if (!peer.audio.muted || !peer.systemAudio.muted)
        throw Error("Deafen failed");
      w.engine.setDeafened(false);
      w.engine.setWatching("1");
      w.engine.muteParticipant("1", true);
      if (
        !peer.audio.muted ||
        peer.systemAudio.muted ||
        w.engine.getVolume("1") !== 0.35 ||
        peer.audio.volume !== 1
      )
        throw Error(
          "Local mute must only silence that voice and preserve volumes",
        );
      w.engine.setDeafened(true);
      w.engine.setDeafened(false);
      if (!peer.audio.muted || peer.systemAudio.muted)
        throw Error("Local mute lost after deafen");
      if (w.engine.peers.get("2").audio.muted)
        throw Error("Local mute affected another voice");
      w.engine.muteParticipant("1", false);
      if (peer.audio.muted) throw Error("Local unmute failed");
      w.engine.configurePreferences({ ...prefs, pttEnabled: false });
    });
    results.push(
      "PTT abre/fecha a track; mute tem prioridade; volumes independentes; mute local isola uma voz e sobrevive a deafen.",
    );
    for (const page of pages.slice(1))
      await page.evaluate(() =>
        (window as any).engine.setViewing(["0"], ["0"]),
      );
    await pages[0].evaluate(async () => {
      const w = window as any,
        original = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
      w.voxy = {
        authorizeCamera: async () => {},
        selectSource: async () => {},
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          if (!constraints.video) return original(constraints);
          if (w.denyCamera)
            throw new DOMException("Negado no teste", "NotAllowedError");
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext("2d")!;
          const draw = () => {
            ctx.fillStyle = w.cameraColor ?? "#33dd88";
            ctx.fillRect(0, 0, 640, 360);
          };
          draw();
          const stream = canvas.captureStream(15),
            timer = setInterval(draw, 60),
            track = stream.getVideoTracks()[0],
            stop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            stop();
          };
          w.testCameraTrack = track;
          return stream;
        },
      });
      await w.engine.startCamera("camera-1");
    });
    for (const page of pages.slice(1)) await cameraPixel(page, "green");
    results.push(
      "Webcam em slot independente: pixels recebidos pelos nove espectadores.",
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      // Only the capture source is substituted in this test. The production engine, SDP, ICE and RTP are unchanged.
      await pages[0].evaluate(async (cycle) => {
        const w = window as any;
        w.voxy = { ...w.voxy, selectSource: async () => {} };
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d")!;
        let n = 0;
        const timer = setInterval(() => {
          ctx.fillStyle = cycle ? "#ff2255" : "#2255ff";
          ctx.fillRect(0, 0, 1280, 720);
          ctx.fillStyle = "white";
          ctx.fillText("Frame " + n++, 20, 20);
        }, 30);
        const stream = canvas.captureStream(30);
        w.syntheticTimer = timer;
        Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
          configurable: true,
          value: async () => stream,
        });
        await w.engine.share("test", false, "720p30");
      }, cycle);
      for (const page of pages.slice(1)) {
        await page.waitForFunction(
          () =>
            (window as any).view.streams.get("0")?.getVideoTracks().length ===
            1,
        );
        const frame = await page.evaluate(async (cycle) => {
          const stream = (window as any).view.streams.get("0");
          const v = document.createElement("video");
          v.muted = true;
          v.srcObject = stream;
          await v.play();
          const c = document.createElement("canvas");
          c.width = 1;
          c.height = 1;
          let callback = 0;
          try {
            return await new Promise<number[]>((resolve, reject) => {
              const timeout = setTimeout(() => {
                v.cancelVideoFrameCallback(callback);
                reject(Error("Novos pixels não chegaram em 10 segundos"));
              }, 10000);
              const next = () => {
                callback = v.requestVideoFrameCallback(() => {
                  c.getContext("2d")!.drawImage(v, 600, 300, 1, 1, 0, 0, 1, 1);
                  const pixel = [
                    ...c.getContext("2d")!.getImageData(0, 0, 1, 1).data,
                  ];
                  // replaceTrack can initially deliver a frame buffered from the previous source.
                  if (
                    cycle
                      ? pixel[0] > 180 && pixel[2] < 150
                      : pixel[2] > 180 && pixel[0] < 150
                  ) {
                    clearTimeout(timeout);
                    resolve(pixel);
                  } else next();
                });
              };
              next();
            });
          } finally {
            v.pause();
            v.srcObject = null;
          }
        }, cycle);
        assert(
          cycle
            ? frame[0] > 180 && frame[2] < 150
            : frame[2] > 180 && frame[0] < 150,
          `pixel received ${frame}`,
        );
      }
      if (cycle === 0) {
        const counts = async () =>
          await pages[0].evaluate(async () => {
            const stats = await (window as any).engine.peers
              .get("1")
              .pc.getStats();
            let video = 0,
              audio = 0;
            stats.forEach((s: any) => {
              if (s.type === "outbound-rtp") {
                if (s.kind === "video") video += s.bytesSent || 0;
                if (s.kind === "audio") audio += s.bytesSent || 0;
              }
            });
            return { video, audio };
          });
        const before = await counts();
        await new Promise((r) => setTimeout(r, 1200));
        const active = await counts();
        await pages[1].evaluate(() =>
          (window as any).engine.setViewing([], []),
        );
        await pages[0].waitForFunction(() => {
          const p = (window as any).engine.peers.get("1");
          return (
            !p.video.sender.track &&
            !p.camera.sender.track &&
            !p.system.sender.track
          );
        });
        await new Promise((r) => setTimeout(r, 300));
        const pausedBefore = await counts();
        await new Promise((r) => setTimeout(r, 1200));
        const paused = await counts();
        assert(active.video > before.video);
        assert(
          paused.video - pausedBefore.video <
            (active.video - before.video) * 0.05,
          JSON.stringify({ before, active, pausedBefore, paused }),
        );
        assert(paused.audio > pausedBefore.audio);
        results.push(
          `Sem espectador: vídeo ${active.video - before.video} → ${paused.video - pausedBefore.video} bytes / 1,2 s; voz continua (${paused.audio - pausedBefore.audio} bytes).`,
        );
        await pages[1].evaluate(() =>
          (window as any).engine.setViewing(["0", "2"], ["0"]),
        );
        await pages[2].evaluate(async () => {
          const w = window as any;
          w.voxy = { selectSource: async () => {} };
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const draw = () => {
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "#22bb77";
            ctx.fillRect(0, 0, 640, 360);
            ctx.fillStyle = "white";
            ctx.fillText(String(Date.now()), 10, 20);
          };
          draw();
          w.secondScreenTimer = setInterval(draw, 80);
          const stream = canvas.captureStream(12);
          Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
            configurable: true,
            value: async () => stream,
          });
          await w.engine.share("second", false, "720p15");
        });
        await pages[1].waitForFunction(async () => {
          for (const id of ["0", "2"]) {
            const p = (window as any).engine.peers.get(id);
            const stats = await p.pc.getStats();
            let frames = 0;
            stats.forEach((s: any) => {
              if (s.type === "inbound-rtp" && s.mid === "1")
                frames += s.framesDecoded || 0;
            });
            if (frames < 3) return false;
          }
          return true;
        });
        await cameraPixel(pages[1], "green");
        await pages[2].evaluate(async () => {
          await (window as any).engine.stopShare();
          clearInterval((window as any).secondScreenTimer);
        });
        await pages[1].evaluate(() =>
          (window as any).engine.setViewing(["0"], ["0"]),
        );
        results.push(
          "Duas telas de emissores diferentes e webcam simultâneas; retomada após suspensão com quadros decodificados.",
        );
      }
      const audioCounts = await Promise.all(
        pages.map((page) =>
          page.evaluate(async () => {
            const values: number[] = [];
            for (const p of (window as any).engine.peers.values()) {
              const stats = await p.pc.getStats();
              stats.forEach((s: any) => {
                if (s.type === "inbound-rtp" && s.kind === "audio")
                  values.push(s.packetsReceived);
              });
            }
            return values;
          }),
        ),
      );
      await pages[0].evaluate(async () => {
        const w = window as any;
        await w.engine.stopShare();
        clearInterval(w.syntheticTimer);
        if (!w.engine.microphone.getAudioTracks()[0].enabled)
          throw Error("microphone lost");
      });
      for (let i = 0; i < 10; i++)
        await pages[i].waitForFunction(
          async (before) => {
            const values: number[] = [];
            for (const p of (window as any).engine.peers.values()) {
              const stats = await p.pc.getStats();
              stats.forEach((s: any) => {
                if (s.type === "inbound-rtp" && s.kind === "audio")
                  values.push(s.packetsReceived);
              });
            }
            return (
              values.length === before.length &&
              values.every((v, i) => v > before[i])
            );
          },
          audioCounts[i],
          { timeout: 10000 },
        );
      results.push(
        `Transmissão ${cycle + 1}: pixels RTP corretos nos nove espectadores; pacotes de voz continuam crescendo nos 90 sentidos após parar.`,
      );
      for (const page of pages.slice(1)) await cameraPixel(page, "green");
    }
    await pages[0].evaluate(async () => {
      const w = window as any;
      const old = w.testCameraTrack;
      w.cameraColor = "#ee2255";
      await w.engine.startCamera("camera-2");
      if (old.readyState !== "ended")
        throw Error("Câmera anterior não foi liberada");
    });
    for (const page of pages.slice(1)) await cameraPixel(page, "red");
    await pages[0].evaluate(async () => {
      const w = window as any;
      const track = w.testCameraTrack;
      await w.engine.stopCamera();
      if (track.readyState !== "ended" || w.view.cameraActive)
        throw Error("Câmera não parou");
      w.denyCamera = true;
      let failed = false;
      try {
        await w.engine.startCamera("denied");
      } catch {
        failed = true;
      }
      if (!failed || !w.engine.microphone.getAudioTracks()[0].enabled)
        throw Error("Falha de permissão afetou voz");
      w.denyCamera = false;
      w.cameraColor = "#33dd88";
      await w.engine.startCamera("camera-1");
      w.engine.camera.getVideoTracks()[0].dispatchEvent(new Event("ended"));
    });
    await pages[0].waitForFunction(() => !(window as any).view.cameraActive);
    results.push(
      "Webcam e tela simultâneas nos nove espectadores; troca, parada, reinício, permissão negada e track encerrada preservam a voz.",
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      await pages[0].evaluate((cycle) => {
        const w = window as any;
        w.soundFrequencies = [];
        w.engine.configurePreferences({
          id: "0",
          name: "Teste",
          avatar: "x",
          input: "",
          output: "",
          callSounds: cycle !== 1,
        });
        w.engine.setDeafened(cycle === 2);
        if (!w.soundProbe) {
          w.soundProbe = true;
          const ctx = w.engine.context;
          const original = ctx.createOscillator.bind(ctx);
          ctx.createOscillator = () => {
            const osc = original();
            const start = osc.start.bind(osc);
            osc.start = (time: number) => {
              w.soundFrequencies.push(osc.frequency.value);
              start(time);
            };
            return osc;
          };
        }
      }, cycle);
      await pages[9].evaluate(() => (window as any).engine.leave());
      for (let i = 0; i < 9; i++)
        await pages[i].evaluate(
          ({ participants, i }) =>
            (window as any).engine.sync(participants.slice(0, 9), String(i)),
          { participants, i },
        );
      await pages[9].evaluate(async () => (window as any).engine.join("9", ""));
      for (let i = 0; i < 10; i++)
        await pages[i].evaluate(
          ({ participants, i }) =>
            (window as any).engine.sync(participants, String(i)),
          { participants, i },
        );
      for (const page of pages)
        await page.waitForFunction(
          () => {
            const peers = [...(window as any).engine.peers.values()] as any[];
            return (
              peers.length === 9 &&
              peers.every((p) => p.pc.connectionState === "connected")
            );
          },
          {},
          { timeout: 20000 },
        );
      const sounds = await pages[0].evaluate(
        () => (window as any).soundFrequencies,
      );
      assert.deepEqual(sounds, cycle === 0 ? [660, 330, 440, 660] : []);
    }
    results.push("3 ciclos de saída/reentrada com reconexão dos pares.");
    results.push(
      "Sons distintos de saída/entrada gerados; opção desativada e deafen impedem os efeitos.",
    );
    for (const page of pages)
      await page.evaluate(() => {
        const w = window as any;
        w.engine.setDeafened(false);
        w.engine.configurePreferences({ callSounds: true });
        w.shareSounds = [];
        const ctx = w.engine.context;
        const original = ctx.createOscillator.bind(ctx);
        ctx.createOscillator = () => {
          const osc = original(),
            start = osc.start.bind(osc);
          osc.start = (time: number) => {
            w.shareSounds.push(osc.frequency.value);
            start(time);
          };
          return osc;
        };
      });
    const screenState = participants.map((p, i) => ({
      ...p,
      sharing: i === 2,
    }));
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      await page.evaluate(
        ({ screenState, participants, i }) => {
          const w = window as any;
          w.engine.sync(screenState, String(i));
          w.engine.sync(screenState, String(i)); // repeated snapshots must not replay
          w.engine.sync(participants, String(i));
          w.engine.sync(
            [
              ...participants,
              {
                ...participants[0],
                id: "outside",
                sharing: true,
                channelId: "other",
              },
            ],
            String(i),
          );
        },
        { screenState, participants, i },
      );
      const sounds = await page.evaluate(() => (window as any).shareSounds);
      assert.deepEqual(sounds.map(Math.round), [523, 659, 1047, 784, 587, 392]);
      await page.evaluate(
        ({ screenState, participants, i }) => {
          const w = window as any;
          w.engine.configurePreferences({ callSounds: false });
          w.engine.sync(screenState, String(i));
          w.engine.sync(participants, String(i));
          w.engine.configurePreferences({ callSounds: true });
          w.engine.setDeafened(true);
          w.engine.sync(screenState, String(i));
          w.engine.sync(participants, String(i));
          w.engine.setDeafened(false);
          w.engine.sync(screenState, String(i));
        },
        { screenState, participants, i },
      );
      assert.deepEqual(
        (await page.evaluate(() => (window as any).shareSounds)).map(
          Math.round,
        ),
        [523, 659, 1047, 784, 587, 392, 523, 659, 1047],
      );
    }
    for (let i = 0; i < pages.length; i++)
      await pages[i].evaluate(
        ({ participants, i }) => {
          const w = window as any;
          w.engine.configurePreferences({ callSounds: false });
          w.engine.sync(participants, String(i));
        },
        { participants, i },
      );
    results.push(
      "Início de transmissão notifica os dez participantes, incluindo o transmissor, uma vez por transição.",
    );
    for (const page of pages)
      await page.evaluate(() => {
        const w = window as any;
        w.engine.leave();
        if (
          w.engine.peers.size ||
          w.engine.microphone ||
          w.engine.screen ||
          w.engine.context
        )
          throw Error("cleanup failed");
      });
    results.push("Recursos de mídia liberados nos dez clientes.");
    console.log(results.join("\n"));
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/media.json",
      JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
    );
  } catch (e) {
    for (const page of pages)
      console.error(
        await page.evaluate(() => ({
          error: (window as any).view?.error,
          diagnostics: (window as any).view?.diagnostics,
        })),
      );
    throw e;
  } finally {
    await browser.close();
    server.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
