import { readFileSync } from "node:fs";
import { writeAtomicFileSync } from "../services/atomicFile";
import releases from "../shared/releases.json";
import type { ReleaseNotes } from "../shared/types";
export class ReleaseNotesStore {
  constructor(
    private path: string,
    private version: string,
  ) {}
  private seen(): string[] {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(value)
        ? value.filter((v) => typeof v === "string").slice(-100)
        : [];
    } catch {
      return [];
    }
  }
  notes(): ReleaseNotes | null {
    const entry = (
      releases as Record<string, { title: string; items: string[] }>
    )[this.version];
    return entry && !this.seen().includes(this.version)
      ? { version: this.version, ...entry }
      : null;
  }
  mark(version: string) {
    if (version !== this.version) throw Error("Versão de novidades inválida.");
    const seen = this.seen();
    if (!seen.includes(version)) seen.push(version);
    writeAtomicFileSync(this.path, JSON.stringify(seen.slice(-100)));
  }
}
