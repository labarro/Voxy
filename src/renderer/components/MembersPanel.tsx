import type { Participant, RoomState } from "../../shared/types";
import { memberRoles, nicknameColor } from "../../shared/identity";
import { Avatar } from "./Avatar";
import { Presence } from "./Presence";
import { RoleBadges } from "./Roles";

/**
 * Right-hand member list of a text channel (Voxy 1.5 layout, from the native
 * 2.0 design). Same behavior as the 1.4 sidebar list: click opens a private
 * conversation (or your profile), right click opens the mini profile menu.
 */
export function MembersPanel({
  room,
  serverId,
  selfId,
  speaking,
  onMenu,
  onOpen,
}: {
  room: RoomState;
  serverId: string;
  selfId: string;
  speaking: Set<string>;
  onMenu: (id: string, x: number, y: number) => void;
  onOpen: (p: Participant) => void;
}) {
  const inCall = room.participants.filter((p) => p.channelId);
  const others = room.participants.filter((p) => !p.channelId);
  const group = (title: string, people: Participant[]) =>
    people.length > 0 && (
      <section className="member-section">
        <h3>
          {title} <span>{people.length}</span>
        </h3>
        {people.map((p) => (
          <button
            key={p.id}
            className={"member-row " + (speaking.has(p.id) ? "is-speaking" : "")}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu(p.id, e.clientX, e.clientY);
            }}
            title={
              p.id === selfId
                ? "Seu perfil"
                : "Conversar em privado com " + p.profile.name
            }
            onClick={() => onOpen(p)}
          >
            <span className="avatar-with-presence">
              <Avatar avatar={p.profile.avatar} className="member-avatar" />
              <Presence value={p.profile.presence} />
            </span>
            <span className="member-copy">
              <span
                className="member-name"
                style={{ color: nicknameColor(room, serverId, p.profile) }}
              >
                {p.profile.name}
                {p.id === selfId ? " (você)" : ""}
              </span>
              <small>
                {p.channelId
                  ? (room.channels.find((c) => c.id === p.channelId)?.name ??
                    "Em chamada")
                  : (
                      {
                        online: "Online",
                        away: "Ausente",
                        busy: "Ocupado",
                      } as Record<string, string>
                    )[p.profile.presence ?? "online"]}
              </small>
            </span>
            <RoleBadges roles={memberRoles(room, serverId, p.profile.id)} />
          </button>
        ))}
      </section>
    );
  return (
    <aside className="members-panel" aria-label="Participantes">
      {group("Em chamada", inCall)}
      {group("Online", others)}
    </aside>
  );
}
