import { spawnSync } from "node:child_process";
import { join } from "node:path";
export function protectKey(value, decrypt = false) {
  if (process.platform !== "win32")
    throw Error(
      "Use Windows para acessar a chave local protegida, ou configure VOXY_UPDATE_SIGNING_PRIVATE_KEY no CI.",
    );
  const operation = decrypt ? "Unprotect" : "Protect";
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[System.Security.Cryptography.ProtectedData]::${operation}($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  const result = spawnSync(
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
    {
      input: Buffer.from(value).toString("base64"),
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    },
  );
  if (result.status !== 0)
    throw Error("Não foi possível abrir/proteger a chave local do Windows.");
  return Buffer.from(result.stdout.trim(), "base64");
}
