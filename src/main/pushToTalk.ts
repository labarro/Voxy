import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { PTT_KEYS, type PttKey } from "../shared/preferences";
export class PushToTalk {
  private child?: ChildProcessWithoutNullStreams;
  private key?: PttKey;
  private timer?: ReturnType<typeof setInterval>;
  private pressed = false;
  private generation = 0;
  constructor(private changed: (pressed: boolean, error?: string) => void) {}
  configure(enabled: boolean, key: PttKey) {
    if (enabled && key === this.key && this.child) return;
    this.stop();
    if (!enabled) return;
    if (process.platform !== "win32") {
      this.changed(false, "Push to Talk global disponível somente no Windows.");
      return;
    }
    const vk = PTT_KEYS[key]?.vk;
    if (!vk) throw Error("Tecla de Push to Talk inválida.");
    const generation = ++this.generation;
    this.key = key;
    // Only a validated numeric virtual-key code is interpolated. No renderer code,
    // file path or shell command is accepted. High bit means held, not toggle.
    const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class VoxyKey { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key); }'; $parentProcess=[System.Diagnostics.Process]::GetProcessById(${process.pid}); $lastState=$null; $clock=[System.Diagnostics.Stopwatch]::StartNew(); while(-not $parentProcess.HasExited){ $held=([VoxyKey]::GetAsyncKeyState(${vk}) -lt 0); if($held -ne $lastState -or $clock.ElapsedMilliseconds -gt 500){ if($held){[Console]::WriteLine('1')}else{[Console]::WriteLine('0')}; [Console]::Out.Flush(); $lastState=$held; $clock.Restart() }; Start-Sleep -Milliseconds 15 }`;
    const executable = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const child = spawn(
      executable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, stdio: "pipe" },
    );
    this.child = child;
    let pending = "",
      last = Date.now(),
      ready = false;
    const fail = () => {
      if (generation !== this.generation) return;
      this.stop();
      this.changed(
        false,
        "Push to Talk indisponível. Verifique as permissões do Windows ou desative a opção nas configurações.",
      );
    };
    child.stdout.on("data", (data) => {
      pending += data.toString();
      if (pending.length > 200) {
        fail();
        return;
      }
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        if (line !== "0" && line !== "1") continue;
        last = Date.now();
        ready = true;
        const next = line === "1";
        if (next !== this.pressed) {
          this.pressed = next;
          this.changed(next);
        }
      }
    });
    child.stderr.on("data", () => {
      /* Do not log helper output or keyboard state. */
    });
    child.on("error", fail);
    child.on("exit", fail);
    this.timer = setInterval(() => {
      if (Date.now() - last > (ready ? 2000 : 12000)) fail();
    }, 500);
  }
  stop() {
    ++this.generation;
    clearInterval(this.timer);
    this.timer = undefined;
    const child = this.child;
    this.child = undefined;
    this.key = undefined;
    child?.kill();
    if (this.pressed) {
      this.pressed = false;
      this.changed(false);
    }
  }
}
