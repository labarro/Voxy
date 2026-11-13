import {
  AudioLines,
  Megaphone,
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
      <button
        className={"brand " + (page === "home" ? "active" : "")}
        title="Home"
        aria-label="Home"
        aria-current={page === "home" ? "page" : undefined}
        onClick={() => navigate("home")}
      >
        <AudioLines size={28} />
        <span className="rail-caption">Início</span>
      </button>
      <button
        className={"rail-action " + (page === "dm" ? "selected" : "")}
        title="Mensagens privadas"
        aria-label="Mensagens privadas"
        aria-current={page === "dm" ? "page" : undefined}
        onClick={() => navigate("dm")}
      >
        <MessageCircle />
        <span className="rail-caption">Conversas</span>
        {unread > 0 && (
          <span
            className="unread-badge rail-unread"
            aria-label={unread + " mensagens não lidas"}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <button
        className={"rail-action " + (page === "news" ? "selected" : "")}
        title="Novidades do Voxy"
        aria-label="Novidades do Voxy"
        aria-current={page === "news" ? "page" : undefined}
        onClick={() => navigate("news")}
      >
        <Megaphone />
        <span className="rail-caption">Novidades</span>
      </button>
      <button
        className={"rail-action " + (page === "friends" ? "selected" : "")}
        title="Amigos"
        aria-label="Amigos"
        aria-current={page === "friends" ? "page" : undefined}
        onClick={() => navigate("friends")}
      >
        <Users />
        <span className="rail-caption">Amigos</span>
        {(room.friendships || []).some((f) => f.status === "pending") && (
          <i className="status-dot" />
        )}
      </button>
      <div className="rail-divider" />
      <button
        className={
          "rail-action " + (page === "notifications" ? "selected" : "")
        }
        title="Notificações"
        aria-label="Notificações"
        aria-current={page === "notifications" ? "page" : undefined}
        onClick={() => navigate("notifications")}
      >
        <Bell />
        <span className="rail-caption">Avisos</span>
        {notifications > 0 && (
          <span className="unread-badge rail-unread">
            {notifications > 99 ? "99+" : notifications}
          </span>
        )}
      </button>
      <div className="rail-server-list">
        {room.servers.map((s) => (
          <button
            key={s.id}
            className={
              "server-icon " +
              (page === "room" && s.id === serverId ? "selected" : "")
            }
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
      <button
        className="rail-action"
        title={online ? "Criar servidor" : "Hospedar sala"}
        onClick={create}
        disabled={online && !canCreate}
      >
        <Plus />
      </button>
      <button className="rail-action" title="Entrar em sala" onClick={join}>
        <LogIn />
      </button>
      <span className="rail-label">Voxy</span>
    </nav>
  );
}
