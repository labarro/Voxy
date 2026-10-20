import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { z } from "zod";
import { parseInvite, roomIPv4, avatarSchema } from "../shared/validation";
import type { Community, SavedRoom, RoomAvailability } from "../shared/types";

type Vault = {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  isEncryptionAvailable(): boolean;
};
const entrySchema = z.object({
  id: z.uuid(),
  serverId: z.string().min(1).max(100),
  name: z.string().max(60),
  icon: avatarSchema.nullable(),
  address: z.string().refine(roomIPv4),
  port: z.number().int().min(1024).max(65535),
  lastAccess: z.number(),
  hosted: z.boolean(),
  secret: z.string().max(2000),
});
type Entry = z.infer<typeof entrySchema>;
export class RecentRooms {
  private entries: Entry[];
  constructor(
    private path: string,
    private vault: Vault,
  ) {
    try {
      this.entries = existsSync(path)
        ? z
            .array(entrySchema)
            .max(40)
            .parse(JSON.parse(readFileSync(path, "utf8")))
        : [];
    } catch {
      if (existsSync(path)) renameSync(path, path + ".corrupt-" + Date.now());
      this.entries = [];
    }
  }
  list(): SavedRoom[] {
    return this.entries
      .map(({ secret, ...publicEntry }) => publicEntry)
      .sort((a, b) => b.lastAccess - a.lastAccess);
  }
  remember(
    invite: string,
    servers: Community[],
    avatars: Record<string, string>,
    hosted: boolean,
    accessed: boolean,
  ) {
    const v = parseInvite(invite);
    if (!this.vault.isEncryptionAvailable())
      throw Error("O Windows não pode proteger os convites salvos.");
    for (const server of servers) {
      let entry = this.entries.find(
        (e) =>
          e.address === v.address &&
          e.port === v.port &&
          e.serverId === server.id,
      );
      if (!entry) {
        if (!accessed) continue;
        entry = {
          id: randomUUID(),
          serverId: server.id,
          name: server.name,
          icon: null,
          address: v.address,
          port: v.port,
          lastAccess: Date.now(),
          hosted,
          secret: "",
        };
        this.entries.push(entry);
      }
      entry.name = server.name;
      entry.icon = server.icon ? (avatars[server.icon] ?? null) : null;
      entry.hosted = hosted;
      if (accessed) entry.lastAccess = Date.now();
      // Rotate the protected secret only when it changes, not on every snapshot.
      let same = false;
      try {
        same =
          this.vault.decryptString(Buffer.from(entry.secret, "base64")) ===
          invite;
      } catch {}
      if (!same)
        entry.secret = this.vault.encryptString(invite).toString("base64");
    }
    this.entries.sort((a, b) => b.lastAccess - a.lastAccess);
    this.entries = this.entries.slice(0, 40);
    this.flush();
  }
  get(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw Error("Servidor salvo não encontrado.");
    try {
      const invite = this.vault.decryptString(
        Buffer.from(entry.secret, "base64"),
      );
      parseInvite(invite);
      return { ...entry, invite };
    } catch {
      throw Error(
        "Não foi possível abrir o convite salvo. Receba um novo convite do host.",
      );
    }
  }
  remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.flush();
  }
  private flush() {
    const json = JSON.stringify(this.entries);
    try {
      if (readFileSync(this.path, "utf8") === json) return;
    } catch {}
    writeFileSync(this.path + ".tmp", json);
    renameSync(this.path + ".tmp", this.path);
  }
  async availability(
    canProbe: (address: string) => boolean = () => true,
  ): Promise<RoomAvailability[]> {
    const result: RoomAvailability[] = [];
    const list = this.list();
    // Bounded batches keep an offline VPN from creating dozens of hanging sockets.
    for (let i = 0; i < list.length; i += 4)
      result.push(
        ...(await Promise.all(
          list.slice(i, i + 4).map(async (entry) => {
            try {
              if (!canProbe(entry.address))
                return { id: entry.id, status: "unavailable" as const };
              const saved = this.get(entry.id),
                v = parseInvite(saved.invite);
              const status = await probeRoom(
                v.address,
                v.port,
                v.token,
                saved.serverId,
              );
              return { id: entry.id, status };
            } catch {
              return { id: entry.id, status: "unavailable" as const };
            }
          }),
        )),
      );
    return result;
  }
}
export function probeRoom(
  address: string,
  port: number,
  token: string,
  serverId: string,
): Promise<RoomAvailability["status"]> {
  if (!roomIPv4(address)) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    const req = request(
      {
        host: address,
        port,
        path: "/availability",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > 2048) req.destroy();
        });
        res.on("end", () => {
          if (res.statusCode === 401) return resolve("invalid");
          try {
            const value = JSON.parse(data);
            resolve(
              res.statusCode === 200 &&
                ["available", "full", "missing"].includes(value.status)
                ? value.status
                : "unavailable",
            );
          } catch {
            resolve("unavailable");
          }
        });
        res.on("error", () => resolve("unavailable"));
      },
    );
    const timer = setTimeout(() => req.destroy(), 1800);
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => resolve("unavailable"));
    req.end(JSON.stringify({ token, serverId }));
  });
}
