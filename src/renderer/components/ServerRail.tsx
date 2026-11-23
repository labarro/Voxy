import type React from "react";
import {
  House,
  Sparkles,
  MessageCircle,
  Plus,
  LogIn,
  Users,
  Bell,
} from "lucide-react";
import type { RoomState } from "../../shared/types";
import type { SavedRoomsView } from "../hooks/useSavedRooms";
import { Avatar } from "./Avatar";
const labels = {
  available: "Disponível",
  unavailable: "Fora de alcance",
  invalid: "Convite expirado",
  missing: "Servidor removido",
  full: "Sala cheia",
};
export type AppPage =
  "home" | "room" | "news" | "dm" | "friends" | "notifications";
/**
 * Every navigation entry of the rail (Home, DMs, friends, notifications,
 * create, join, news) uses this one button so size, centering, hover, the
 * selection pill and tooltip placement cannot drift between entries.
 */
function RailButton({
  label,
  icon,
  active = false,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  tone?: "create";
  disabled?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      className={
        "rail-button " + (active ? "selected " : "") + (tone ? "tone-" + tone : "")
      }
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="rail-glyph" aria-hidden="true">
        {icon}
      </span>
      {children}
    </button>
  );
}
/** Stable hue per server so initials tiles are recognizable at a glance. */
function hue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return String(h);
}
export function ServerRail({
  room,
  page,
  serverId,
  saved,
  busy,
  online,
  canCreate,
  unread,
  notifications = 0,
  unreadServers = {},
  navigate,
  select,
  reconnect,
  create,
  join,
}: {
  room: RoomState;
  page: AppPage;
  serverId: string;
  saved: SavedRoomsView;
  busy: boolean;
  online: boolean;
  canCreate: boolean;
  unread: number;
  notifications?: number;
  unreadServers?: Record<string, number>;
  navigate: (page: AppPage) => void;
  select: (id: string) => void;
  reconnect: (id: string) => void;
  create: () => void;
  join: () => void;
}) {
  const offline = saved.rooms.filter(
    (r) => !room.servers.some((s) => s.id === r.serverId),
  );
  return (
    <nav className="server-rail" aria-label="Servidores">
      <RailButton
        label="Home"
        icon={<House size={20} />}
        active={page === "home"}
        onClick={() => navigate("home")}
      />
      <RailButton
        label="Mensagens privadas"
        icon={<MessageCircle size={20} />}
        active={page === "dm"}
        onClick={() => navigate("dm")}
      >
        {unread > 0 && (
          <span
            className="unread-badge rail-unread"
            aria-label={unread + " mensagens não lidas"}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </RailButton>
      <RailButton
        label="Amigos"
        icon={<Users size={20} />}
        active={page === "friends"}
        onClick={() => navigate("friends")}
      >
        {(room.friendships || []).some((f) => f.status === "pending") && (
          <i className="status-dot" />
        )}
      </RailButton>
      <RailButton
        label="Notificações"
        icon={<Bell size={20} />}
        active={page === "notifications"}
        onClick={() => navigate("notifications")}
      >
        {notifications > 0 && (
          <span className="unread-badge rail-unread">
            {notifications > 99 ? "99+" : notifications}
          </span>
        )}
      </RailButton>
      <div className="rail-divider" />
      <div className="rail-server-list">
        {room.servers.map((s) => (
          <button
            key={s.id}
            className={
              "server-icon " +
              (page === "room" && s.id === serverId ? "selected" : "")
            }
            style={{ "--server-hue": hue(s.id) } as React.CSSProperties}
            title={s.name}
            aria-label={s.name}
            aria-current={
              page === "room" && s.id === serverId ? "page" : undefined
            }
            onClick={() => select(s.id)}
          >
            {s.icon ? (
              <Avatar avatar={s.icon} className="server-photo" />
            ) : (
              s.name.slice(0, 2).toUpperCase()
            )}
            <i className="server-availability available" title="Conectado" />
            {!!unreadServers[s.id] && (
              <span
                className="unread-badge rail-unread"
                aria-label={unreadServers[s.id] + " mensagens não lidas"}
              >
                {unreadServers[s.id] > 99 ? "99+" : unreadServers[s.id]}
              </span>
            )}
          </button>
        ))}
        {offline.length > 0 && room.servers.length > 0 && (
          <div className="rail-divider" />
        )}
        {offline.map((r) => {
          const status = saved.states.find((s) => s.id === r.id)?.status;
          return (
            <button
              key={r.id}
              className={"server-icon saved-server " + (status ?? "unknown")}
              title={
                r.name +
                " · " +
                (status ? labels[status] : "Verificando disponibilidade") +
                " · Clique para reconectar"
              }
              aria-label={"Reconectar a " + r.name}
              disabled={busy}
              onClick={() => reconnect(r.id)}
            >
              {!!unreadServers[r.serverId] && (
                <span className="unread-badge rail-unread">
                  {unreadServers[r.serverId] > 99
                    ? "99+"
                    : unreadServers[r.serverId]}
                </span>
              )}
              {r.icon ? (
                <Avatar avatar={r.icon} className="server-photo" />
              ) : (
                r.name.slice(0, 2).toUpperCase()
              )}
              <i
                className={"server-availability " + (status ?? "unknown")}
                aria-label={status ? labels[status] : "Ainda não verificado"}
              />
            </button>
          );
        })}
      </div>
      <RailButton
        label={online ? "Criar servidor" : "Hospedar sala"}
        icon={<Plus size={20} />}
        tone="create"
        onClick={create}
        disabled={online && !canCreate}
      />
      <RailButton
        label="Entrar em sala"
        icon={<LogIn size={20} />}
        tone="create"
        onClick={join}
      />
      <div className="rail-spacer" />
      <RailButton
        label="Novidades do Voxy"
        icon={<Sparkles size={20} />}
        active={page === "news"}
        onClick={() => navigate("news")}
      />
    </nav>
  );
}
