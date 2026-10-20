import { PushToTalk } from "../src/main/pushToTalk";
import { spawn } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";
function key(up: boolean) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class VoxyTestKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [VoxyTestKey]::keybd_event(120,0,${up ? 2 : 0},[UIntPtr]::Zero)`;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Falha ao simular F9")),
    );
  });
}
async function main() {
  const events: { pressed: boolean; error?: string }[] = [];
  const ptt = new PushToTalk((pressed, error) =>
    events.push({ pressed, error }),
  );
  try {
    ptt.configure(true, "F9");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Leitor global não iniciou")),
        12000,
      );
      (ptt as any).child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await key(false);
    await wait(() => events.some((e) => e.pressed));
    assert(!events.some((e) => e.error));
    await key(true);
    await wait(() => events.length >= 2 && !events[events.length - 1].pressed);
    await key(false);
    await wait(() => events[events.length - 1].pressed);
    ptt.stop();
    assert.equal(events[events.length - 1].pressed, false);
    assert(!(ptt as any).child);
    console.log(
      "Windows global PTT: F9 pressionada/solta detectada e parada libera o microfone.",
    );
  } finally {
    ptt.stop();
    await key(true);
  }
}
async function wait(check: () => boolean) {
  for (let n = 0; n < 60; n++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Transição global de tecla não detectada.");
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
