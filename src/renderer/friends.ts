import type { Inbox, Participant, RoomState } from "../shared/types";

export type FriendLink = {
  scope: string;
  server: string;
  live: boolean;
  status: "accepted" | "incoming" | "outgoing";
};
export type FriendEntry = {
  id: string;
  name: string;
  avatar: string;
  color?: string;
  /** Every host (scope) where this friendship or request exists. */
  links: FriendLink[];
  status: FriendLink["status"];
  /** Present in the connected host right now: the only confirmed presence. */
  person?: Participant;
  activity?: string;
};

/**
 * Friendships live on each host. The same person can be a friend in several
 * hosts, so entries are merged by identity instead of grouped by server.
 * Presence is only claimed for people the connected host reports as present.
 */
export function friendEntries(
  room: RoomState,
  inbox: Inbox,
  self: string,
  online: boolean,
): FriendEntry[] {
  const entries = new Map<string, FriendEntry>();
  const rank = { accepted: 0, incoming: 1, outgoing: 2 };
  for (const entry of inbox.rooms) {
    const live = online && entry.scope === inbox.activeScope;
    const links = live
      ? (room.friendships ?? entry.friendships ?? [])
      : (entry.friendships ?? []);
    for (const link of links) {
      if (link.requester !== self && link.recipient !== self) continue;
      const other = link.requester === self ? link.recipient : link.requester;
      const status: FriendLink["status"] =
        link.status === "accepted"
          ? "accepted"
          : link.recipient === self
            ? "incoming"
            : "outgoing";
      const contact = entry.contacts.find((c) => c.id === other);
      const identity = live ? room.profiles?.[other] : undefined;
      const current = entries.get(other) ?? {
        id: other,
        name: "",
        avatar: "",
        links: [],
        status,
      };
      current.name ||= identity?.name || contact?.name || "";
      current.avatar ||= identity?.avatar || contact?.avatar || "";
      current.color ||= identity?.nicknameColor || undefined;
      if (live && identity) {
        current.name = identity.name;
        current.avatar = identity.avatar;
      }
      current.links.push({ scope: entry.scope, server: entry.name, live, status });
      if (rank[status] < rank[current.status]) current.status = status;
      entries.set(other, current);
    }
  }
  for (const friend of entries.values()) {
    friend.name ||= "Amigo " + friend.id.slice(0, 8);
    friend.avatar ||= "👤";
    // Live links first: actions go to the host that can run them now.
    friend.links.sort((a, b) => Number(b.live) - Number(a.live));
    if (online) {
      friend.person = room.participants.find((p) => p.profile.id === friend.id);
      const channel = friend.person?.channelId
        ? room.channels.find((c) => c.id === friend.person!.channelId)
        : undefined;
      friend.activity = friend.person?.sharing
        ? "Transmitindo a tela"
        : channel
          ? channel.privateMembers
            ? "Em uma chamada privada"
            : "Em voz · " + channel.name
          : undefined;
    }
  }
  return [...entries.values()].sort(
    (a, b) =>
      Number(!!b.person) - Number(!!a.person) ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

