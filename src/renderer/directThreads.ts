import type { Inbox, DirectRoom } from "../shared/types";
export type DirectTarget = { scope: string; peer: string };
export function conversation(room: DirectRoom, peer: string, owner: string) {
  const messages = room.messages.filter(
    (m) => m.author === peer || m.recipient === peer,
  );
  const unread = messages.filter(
    (m) =>
      m.recipient === owner &&
      m.author === peer &&
      m.sequence > (room.read[peer] ?? 0),
  ).length;
  return { messages, unread, last: messages.at(-1) };
}
export function unreadTotal(inbox: Inbox, owner: string) {
  return inbox.rooms.reduce(
    (total, room) =>
      total +
      room.messages.filter(
        (m) => m.recipient === owner && m.sequence > (room.read[m.author] ?? 0),
      ).length,
    0,
  );
}
export function findConversation(inbox: Inbox, target: DirectTarget | null) {
  const room = inbox.rooms.find((r) => r.scope === target?.scope),
    contact = room?.contacts.find((c) => c.id === target?.peer);
  return { room, contact };
}
