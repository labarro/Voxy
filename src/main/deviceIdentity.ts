import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
type Vault = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
export function deviceCredential(
  path: string,
  vault: Vault,
  profileId: string,
  roomSecret: string,
) {
  if (!vault.isEncryptionAvailable())
    throw Error("A proteção de identidade do Windows está indisponível.");
  let secret: string;
  if (existsSync(path)) {
    try {
      secret = vault.decryptString(readFileSync(path));
    } catch {
      throw Error(
        "Não foi possível abrir a identidade deste perfil. Restaure o backup no mesmo usuário do Windows.",
      );
    }
    if (!/^[a-f0-9]{64}$/.test(secret))
      throw Error("Identidade do perfil inválida. Restaure seu backup.");
  } else {
    secret = randomBytes(32).toString("hex");
    writeFileSync(path + ".tmp", vault.encryptString(secret));
    renameSync(path + ".tmp", path);
  }
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(profileId + ":" + roomSecret)
    .digest("hex");
}
