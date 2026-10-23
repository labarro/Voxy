import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { z } from "zod";
import { avatarSchema } from "../shared/validation";
import type { DirectRoom, DirectSnapshot, Inbox } from "../shared/types";
const contact = z.object({
  id: z.uuid(),
  name: z.string().max(60),
  avatar: z.string().max(44000),
  directEnabled: z.boolean(),
});
const message = z.object({
  replyTo: z.uuid().nullish(),
  reactions: z
    .record(z.string().max(16), z.array(z.uuid()).max(1000))
    .optional(),
  id: z.uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  author: z.uuid(),
  recipient: z.uuid(),
  name: z.string().max(60),
  avatar: z.string().max(44000),
  text: z.string().max(4000),
  time: z.number(),
  imageId: z.uuid().nullish(),
  editedAt: z.number().nullish(),
});
const snapshot = z.object({
  friendships: z
    .array(
      z.object({
        requester: z.uuid(),
        recipient: z.uuid(),
        status: z.enum(["pending", "accepted"]),
      }),
    )
    .max(2000)
    .default([]),
  contacts: z.array(contact).max(1000),
  messages: z.array(message).max(5000),
  avatars: z.record(z.string().max(100), avatarSchema),
});
const room = z.object({
  friendships: z
    .array(
      z.object({
        requester: z.uuid(),
        recipient: z.uuid(),
        status: z.enum(["pending", "accepted"]),
      }),
    )
    .max(2000)
    .default([]),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().max(60),
  contacts: z.array(contact).max(1000),
  messages: z.array(message).max(5000),
  read: z.record(z.uuid(), z.number().int().nonnegative()),
});
export class DirectInbox {
  private rooms: DirectRoom[] = [];
  activeScope?: string;
  constructor(
    private path: string,
    private owner: string,
  ) {
    try {
      if (existsSync(path)) {
        const saved = z
          .object({ owner: z.uuid(), rooms: z.array(room).max(40) })
          .parse(JSON.parse(readFileSync(path, "utf8")));
        if (saved.owner === owner) this.rooms = saved.rooms;
      }
    } catch {
      if (existsSync(path)) renameSync(path, path + ".corrupt-" + Date.now());
    }
  }
  view(): Inbox {
    return { rooms: this.rooms, activeScope: this.activeScope };
  }
  receive(scope: string, name: string, raw: DirectSnapshot) {
    const value = snapshot.parse(raw);
    if (
      value.messages.some(
        (m) => m.author !== this.owner && m.recipient !== this.owner,
      )
    )
      throw Error("Histórico privado destinado a outro perfil.");
    const prior = this.rooms.find((r) => r.scope === scope),
      known = new Set(prior?.messages.map((m) => m.id));
    const incoming = value.messages.filter(
      (m) => m.recipient === this.owner && !known.has(m.id),
    );
    const resolve = (avatar: string) => value.avatars[avatar] ?? avatar;
    const next: DirectRoom = {
      scope,
      friendships: value.friendships,
      name,
      contacts: value.contacts.map((c) => ({
        ...c,
        avatar: resolve(c.avatar),
      })),
      messages: value.messages.map((m) => ({
        ...m,
        avatar: resolve(m.avatar),
      })),
      read: prior?.read ?? {},
    };
    this.rooms = [next, ...this.rooms.filter((r) => r.scope !== scope)].slice(
      0,
      40,
    );
    this.save();
    return incoming;
  }
  markRead(scope: string, peer: string, sequence: number) {
    const item = this.rooms.find((r) => r.scope === scope);
    if (!item) throw Error("Conversa não encontrada.");
    const max = Math.max(
      0,
      ...item.messages
        .filter((m) => m.author === peer || m.recipient === peer)
        .map((m) => m.sequence),
    );
    if (sequence > max) throw Error("Marcador de leitura inválido.");
    if (sequence <= (item.read[peer] ?? 0)) return;
    item.read[peer] = sequence;
    this.save();
  }
  private save() {
    writeFileSync(
      this.path + ".tmp",
      JSON.stringify({ owner: this.owner, rooms: this.rooms }),
    );
    renameSync(this.path + ".tmp", this.path);
  }
}
