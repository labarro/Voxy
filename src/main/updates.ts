import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { open, stat, readFile, copyFile, mkdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import type { UpdatePackage } from "../shared/types";
export function newerVersion(next: string, current: string) {
  const parse = (s: string) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(s))
      throw Error("Versão inválida.");
    return s.split(".").map(Number);
  };
  const a = parse(next),
    b = parse(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex").toUpperCase();
}
export class UpdateManager {
  private pending?: UpdatePackage & { path: string };
  constructor(
    private dataDir: string,
    private version: string,
  ) {}
  async prepare(source: string): Promise<UpdatePackage> {
    const match = /^Voxy-Setup-(\d+\.\d+\.\d+)-x64\.exe$/.exec(
      basename(source),
    );
    if (!match || !newerVersion(match[1], this.version))
      throw Error("Escolha um instalador Voxy x64 de versão mais recente.");
    const info = await stat(source);
    if (!info.isFile() || info.size < 64 || info.size > 512 * 1024 * 1024)
      throw Error("Instalador inválido ou maior que 512 MB.");
    const file = await open(source, "r");
    try {
      const header = Buffer.alloc(64);
      await file.read(header, 0, 64, 0);
      if (header.toString("ascii", 0, 2) !== "MZ")
        throw Error("Executável inválido.");
      const offset = header.readUInt32LE(60);
      if (offset > info.size - 4) throw Error("Cabeçalho inválido.");
      const pe = Buffer.alloc(4);
      await file.read(pe, 0, 4, offset);
      if (pe.toString("hex") !== "50450000")
        throw Error("Instalador Windows inválido.");
    } finally {
      await file.close();
    }
    const id = randomUUID(),
      directory = join(this.dataDir, "updates");
    await mkdir(directory, { recursive: true });
    const target = join(directory, id + ".exe");
    await copyFile(source, target);
    const sha256 = await fileHash(target);
    let verified = false;
    const sums = join(dirname(source), "SHA256SUMS.txt");
    if (existsSync(sums)) {
      const content = await readFile(sums, "utf8");
      const entry = content
        .split(/\r?\n/)
        .map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line))
        .find((m) => m?.[2] === basename(source));
      if (!entry || entry[1].toUpperCase() !== sha256)
        throw Error(
          "O SHA-256 não confere. Baixe ou receba o instalador novamente.",
        );
      verified = true;
    }
    const result = { id, version: match[1], size: info.size, sha256, verified };
    this.pending = { ...result, path: target };
    return result;
  }
  async installer(id: string) {
    const update = this.pending;
    if (!update || update.id !== id)
      throw Error("Selecione o instalador novamente.");
    if ((await fileHash(update.path)) !== update.sha256)
      throw Error("O instalador foi alterado após a seleção.");
    return update.path;
  }
  backup() {
    const directory = join(
      this.dataDir,
      "backups",
      new Date().toISOString().replace(/[:.]/g, "-") + "-v" + this.version,
    );
    mkdirSync(directory, { recursive: true });
    for (const name of [
      "profile.json",
      "room.sqlite",
      "host-secret.bin",
      "release-notes.json",
      "recent-rooms.json",
      "remote-release-history.json",
    ]) {
      const source = join(this.dataDir, name);
      if (existsSync(source)) copyFileSync(source, join(directory, name));
    }
    return directory;
  }
}
