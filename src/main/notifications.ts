import { existsSync, readFileSync, renameSync } from "node:fs";
import { writeAtomicFileSync } from "../services/atomicFile";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AppNotification,
  DirectMessage,
  Message,
  NotificationState,
  NotificationView,
  Profile,
  RoomState,
} from "../shared/types";

const viewSchema = z.object({
  scope: z.string().max(64).optional(),
  channelId: z.string().max(100).optional(),
  peer: z.string().max(100).optional(),
  friends: z.boolean().optional(),
});
export const notificationViewSchema = viewSchema;
const itemSchema = viewSchema.extend({
  id: z.string().max(200),
  kind: z.enum([
    "mention",
    "reply",
    "direct",
    "friend-request",
    "friend-accepted",
  ]),
  title: z.string().max(200),
  body: z.string().max(500),
  time: z.number(),
  read: z.boolean(),
  serverId: z.string().max(100).optional(),
  messageId: z.string().max(100).optional(),
});
const savedSchema = z.object({
  owner: z.string(),
  items: z.array(itemSchema).max(500),
  cursors: z.record(z.string(), z.object({ time: z.number(), id: z.string() })),
  friendships: z.record(z.string(), z.string()),
  unread: z.record(
    z.string(),
    z.object({ server: z.string(), count: z.number().int().nonnegative() }),
  ),
  scopes: z.array(z.string()).max(100),
});
export class Notifications {
  private serialized = "";
  private state: z.infer<typeof savedSchema>;
  constructor(
    private path: string,
    owner: string,
  ) {
    this.state = {
      owner,
      items: [],
      cursors: {},
      friendships: {},
      unread: {},
      scopes: [],
    };
    try {
      if (existsSync(path)) {
        const saved = savedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
        if (saved.owner === owner) this.state = saved;
      }
    } catch {
      if (existsSync(path)) renameSync(path, path + ".corrupt-" + Date.now());
    }
  }
  view(): NotificationState {
    const unreadChannels: Record<string, number> = {},
      unreadServers: Record<string, number> = {};
    for (const [key, value] of Object.entries(this.state.unread)) {
      unreadChannels[key] = value.count;
      unreadServers[value.server] =
        (unreadServers[value.server] ?? 0) + value.count;
    }
    return { items: this.state.items, unreadChannels, unreadServers };
  }
  find(id: string) {
    return this.state.items.find((n) => n.id === id);
  }
  mark(id?: string) {
    let changed = false;
    for (const item of this.state.items)
      if (!item.read && (!id || item.id === id)) {
        item.read = true;
        changed = true;
      }
    if (changed) this.save();
    return changed;
  }
  viewed(view: NotificationView) {
    if (!view.scope) return false;
    let changed = false;
    const key = view.scope + ":" + view.channelId;
    if (view.channelId && this.state.unread[key]?.count) {
      this.state.unread[key].count = 0;
      changed = true;
    }
    for (const item of this.state.items) {
      if (!item.read && this.isViewing(item, view)) {
        item.read = true;
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }
  private isViewing(item: NotificationView, view: NotificationView) {
    return (
      !!view.scope &&
      item.scope === view.scope &&
      ((!!item.channelId && item.channelId === view.channelId) ||
        (!!item.peer && item.peer === view.peer) ||
        (!!item.friends && !!view.friends))
    );
  }
  private add(
    item: Omit<AppNotification, "read" | "time">,
    profile: Profile,
    view: NotificationView,
    focused: boolean,
    emit: (item: AppNotification, alert: boolean) => void,
  ) {
    if (
      !profile.notifications?.types[item.kind] ||
      this.state.items.some((n) => n.id === item.id) ||
      (focused && this.isViewing(item, view))
    )
      return;
    const notification = { ...item, read: false, time: Date.now() };
    this.state.items = [notification, ...this.state.items].slice(0, 500);
    const prefs = profile.notifications;
    const silenced =
      profile.presence === "busy" ||
      prefs.dndUntil > Date.now() ||
      prefs.mutedChannels.includes(item.scope + ":" + item.channelId) ||
      prefs.mutedServers.includes(item.scope + ":" + item.serverId);
    emit(notification, !silenced);
  }
  room(
    scope: string,
    room: RoomState,
    profile: Profile,
    view: NotificationView,
    focused: boolean,
    emit: (item: AppNotification, alert: boolean) => void,
  ) {
    const first = !this.state.scopes.includes(scope);
    if (first) this.state.scopes = [...this.state.scopes, scope].slice(-100);
    const authors = new Map(room.messages.map((m) => [m.id, m.author]));
    const byChannel = new Map<string, Message[]>();
    for (const message of room.messages) {
      const group = byChannel.get(message.channelId) ?? [];
      group.push(message);
      byChannel.set(message.channelId, group);
    }
    const liveChannels = new Set(room.channels.map((c) => scope + ":" + c.id));
    for (const key of Object.keys(this.state.unread))
      if (key.startsWith(scope + ":") && !liveChannels.has(key))
        delete this.state.unread[key];
    for (const channel of room.channels) {
      const key = scope + ":" + channel.id;
      const cursor = this.state.cursors[key];
      const messages = (byChannel.get(channel.id) ?? []).sort(
        (a, b) => a.time - b.time || a.id.localeCompare(b.id),
      );
      for (const m of messages) {
        if (
          cursor &&
          (m.time < cursor.time ||
            (m.time === cursor.time && m.id <= cursor.id))
        )
          continue;
        if (!first && m.author !== profile.id) {
          const target = {
            scope,
            channelId: channel.id,
            serverId: channel.serverId,
            messageId: m.id,
          };
          const read = focused && this.isViewing(target, view);
          if (!read) {
            const counter = this.state.unread[key] ?? {
              server: scope + ":" + channel.serverId,
              count: 0,
            };
            counter.count++;
            this.state.unread[key] = counter;
          }
          const mention = m.text.includes(`@{${profile.id}}`);
          const reply =
            !!m.replyTo &&
            (m.replyAuthor ?? authors.get(m.replyTo)) === profile.id;
          const kind =
            mention && profile.notifications?.types.mention
              ? "mention"
              : reply
                ? "reply"
                : undefined;
          if (kind)
            this.add(
              {
                ...target,
                id: scope + ":message:" + m.id,
                kind,
                title:
                  kind === "mention"
                    ? `${m.name} mencionou você`
                    : `${m.name} respondeu a você`,
                body: "#" + channel.name + " · " + m.text.slice(0, 400),
              },
              profile,
              view,
              focused,
              emit,
            );
        }
      }
      const last = messages.at(-1);
      if (
        last &&
        (!cursor ||
          last.time > cursor.time ||
          (last.time === cursor.time && last.id > cursor.id))
      )
        this.state.cursors[key] = { time: last.time, id: last.id };
    }
    const currentFriends: Record<string, string> = {};
    for (const f of room.friendships ?? []) {
      const peer = f.requester === profile.id ? f.recipient : f.requester;
      if (f.requester !== profile.id && f.recipient !== profile.id) continue;
      const key = scope + ":" + peer;
      currentFriends[key] = f.status;
      const previous = this.state.friendships[key];
      if (
        (f.status === "pending" &&
          f.recipient === profile.id &&
          previous !== "pending") ||
        (f.status === "accepted" &&
          f.requester === profile.id &&
          previous === "pending")
      ) {
        const kind =
          f.status === "pending" ? "friend-request" : "friend-accepted";
        const name =
          room.profiles?.[peer]?.name ??
          room.participants.find((p) => p.profile.id === peer)?.profile.name ??
          "Um amigo";
        this.add(
          {
            scope,
            serverId: room.servers[0]?.id,
            friends: true,
            id: randomUUID(),
            kind,
            title:
              kind === "friend-request"
                ? "Solicitação de amizade"
                : "Amizade aceita",
            body:
              kind === "friend-request"
                ? `${name} quer ser seu amigo.`
                : `${name} aceitou sua solicitação.`,
          },
          profile,
          view,
          focused,
          emit,
        );
      }
    }
    for (const key of Object.keys(this.state.friendships))
      if (key.startsWith(scope + ":")) delete this.state.friendships[key];
    Object.assign(this.state.friendships, currentFriends);
    if (focused) this.viewed(view);
    this.save();
  }
  direct(
    scope: string,
    messages: DirectMessage[],
    profile: Profile,
    view: NotificationView,
    focused: boolean,
    emit: (item: AppNotification, alert: boolean) => void,
  ) {
    for (const m of messages)
      this.add(
        {
          scope,
          peer: m.author,
          messageId: m.id,
          id: scope + ":direct:" + m.id,
          kind: "direct",
          title: `Mensagem de ${m.name}`,
          body: m.text.slice(0, 400) || "Imagem recebida",
        },
        profile,
        view,
        focused,
        emit,
      );
    this.save();
  }
  private save() {
    const serialized = JSON.stringify(this.state);
    if (serialized === this.serialized) return;
    writeAtomicFileSync(this.path, serialized);
    this.serialized = serialized;
  }
}
