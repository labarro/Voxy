import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Notifications } from "../src/main/notifications";
import { profileSchema } from "../src/shared/validation";
import type { AppNotification, Message, RoomState } from "../src/shared/types";

test("notificações persistem, deduplicam snapshots e distinguem leitura, DND e silêncios", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-notifications-"));
  try {
    const p = profileSchema.parse({
      id: randomUUID(),
      name: "Ana",
      avatar: "x",
      input: "",
      output: "",
    });
    const peer = randomUUID(),
      channel = randomUUID(),
      server = randomUUID(),
      scope = "a".repeat(64);
    const room: RoomState = {
      servers: [{ id: server, name: "Sala" }],
      channels: [
        { id: channel, serverId: server, name: "geral", kind: "text" },
      ],
      participants: [],
      messages: [],
    };
    const path = join(dir, "notifications.json");
    let store = new Notifications(path, p.id);
    const events: { item: AppNotification; alert: boolean }[] = [];
    const emit = (item: AppNotification, alert: boolean) =>
      events.push({ item, alert });
    store.room(scope, room, p, {}, false, emit);
    const message = (text: string, extra: Partial<Message> = {}): Message => ({
      id: randomUUID(),
      channelId: channel,
      author: peer,
      name: "Bruno",
      avatar: "x",
      time: Date.now() + room.messages.length,
      text,
      ...extra,
    });
    room.messages.push(message(`Oi @{${p.id}}`));
    store.room(scope, room, p, {}, false, emit);
    store.room(scope, room, p, {}, false, emit);
    assert.equal(events.length, 1);
    assert.equal(events[0].item.kind, "mention");
    assert(events[0].alert);
    assert.equal(store.view().unreadChannels[scope + ":" + channel], 1);
    store = new Notifications(path, p.id);
    store.room(scope, room, p, {}, false, emit);
    assert.equal(events.length, 1, "Reiniciar não repete notificação");
    room.messages.push(
      message("Resposta antiga", { replyTo: randomUUID(), replyAuthor: p.id }),
    );
    store.room(scope, room, p, {}, false, emit);
    assert.equal(events.at(-1)!.item.kind, "reply");
    p.notifications.dndUntil = Date.now() + 60000;
    room.messages.push(message(`DND @{${p.id}}`));
    store.room(scope, room, p, {}, false, emit);
    assert.equal(events.at(-1)!.alert, false);
    p.notifications.dndUntil = 0;
    p.notifications.mutedChannels = [scope + ":" + channel];
    room.messages.push(message(`Silêncio @{${p.id}}`));
    store.room(scope, room, p, {}, false, emit);
    assert.equal(events.at(-1)!.alert, false);
    assert(store.viewed({ scope, channelId: channel }));
    assert.equal(store.view().unreadChannels[scope + ":" + channel], 0);
    assert(store.view().items.every((n) => n.read));
    room.messages.push(message(`Conversa visível @{${p.id}}`));
    const count = events.length;
    store.room(scope, room, p, { scope, channelId: channel }, true, emit);
    assert.equal(events.length, count);
    assert.equal(new Notifications(path, p.id).view().items.length, 4);
    assert.equal(new Notifications(path, randomUUID()).view().items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("amizades, DMs e tipos desativados usam uma central e respeitam leitura individual/todas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxy-notifications-"));
  try {
    const p = profileSchema.parse({
        id: randomUUID(),
        name: "A",
        avatar: "x",
        input: "",
        output: "",
      }),
      peer = randomUUID(),
      scope = "b".repeat(64);
    const store = new Notifications(join(dir, "notifications.json"), p.id);
    const room: RoomState = {
      servers: [],
      channels: [],
      participants: [],
      messages: [],
      friendships: [{ requester: peer, recipient: p.id, status: "pending" }],
    };
    const events: AppNotification[] = [];
    const emit = (item: AppNotification) => events.push(item);
    store.room(scope, room, p, {}, false, emit);
    store.room(scope, room, p, {}, false, emit);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "friend-request");
    room.friendships = [
      { requester: p.id, recipient: peer, status: "pending" },
    ];
    store.room(scope, room, p, {}, false, emit);
    room.friendships[0].status = "accepted";
    store.room(scope, room, p, {}, false, emit);
    assert.equal(events.at(-1)!.kind, "friend-accepted");
    const direct = {
      id: randomUUID(),
      author: peer,
      recipient: p.id,
      name: "B",
      avatar: "x",
      text: "DM",
      time: Date.now(),
      sequence: 1,
    };
    store.direct(scope, [direct, direct], p, {}, false, emit);
    assert.equal(events.filter((n) => n.kind === "direct").length, 1);
    store.mark(events[0].id);
    assert(store.view().items.find((n) => n.id === events[0].id)?.read);
    assert(store.view().items.some((n) => !n.read));
    store.mark();
    assert(store.view().items.every((n) => n.read));
    p.notifications.types.direct = false;
    store.direct(scope, [{ ...direct, id: randomUUID() }], p, {}, false, emit);
    assert.equal(events.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
