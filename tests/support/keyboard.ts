import { spawn } from "node:child_process";
import { join } from "node:path";
export function key(up: boolean, vk = 120) {
  if (!Number.isInteger(vk) || vk < 1 || vk > 255)
    throw Error("Tecla de teste inválida");
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class VoxyTestKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [VoxyTestKey]::keybd_event(${vk},0,${up ? 2 : 0},[UIntPtr]::Zero)`;
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
