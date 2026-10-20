import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { protectKey } from "./update-key-store.mjs";
const path = ".local/update-signing-key.dpapi",
  configPath = "src/shared/update-trust.json";
if (process.argv.includes("--export")) {
  const key = protectKey(readFileSync(path), true);
  const child = spawnSync(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "clip.exe"),
    [],
    { input: key, windowsHide: true },
  );
  key.fill(0);
  if (child.status !== 0) throw Error("Não foi possível copiar a chave.");
  console.log(
    "Chave privada copiada para a área de transferência. Cole somente no secret VOXY_UPDATE_SIGNING_PRIVATE_KEY do GitHub e limpe a área de transferência depois.",
  );
} else {
  if (existsSync(path) && !process.argv.includes("--rotate"))
    throw Error(
      "Já existe uma chave local. Use --export para configurar o CI; rotação exige --rotate.",
    );
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  mkdirSync(".local", { recursive: true });
  // Keep the previous protected key during rotation, never commit private material.
  if (existsSync(path))
    writeFileSync(path + ".previous-" + Date.now(), readFileSync(path));
  writeFileSync(path, protectKey(Buffer.from(privateKey)));
  config.publicKeys = [...new Set([...(config.publicKeys ?? []), publicKey])];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(
    "Chave Ed25519 gerada. Pública em " +
      configPath +
      "; privada protegida pelo Windows em " +
      path +
      ". Faça backup antes de publicar.",
  );
}
