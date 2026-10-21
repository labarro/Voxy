import {
  AudioLines,
  Megaphone,
  MessageCircle,
  Plus,
  LogIn,
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
export type AppPage = "home" | "room" | "news" | "dm";
export function ServerRail({
  room,
  page,
  serverId,
  saved,
  busy,
  online,
  canCreate,
  unread,
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
      </button>
      <button
        className={"rail-action " + (page === "dm" ? "selected" : "")}
        title="Mensagens privadas"
        aria-label="Mensagens privadas"
        aria-current={page === "dm" ? "page" : undefined}
        onClick={() => navigate("dm")}
      >
        <MessageCircle />
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
        aria-current={page === "news" ? "page" : undefined}
        onClick={() => navigate("news")}
      >
        <Megaphone />
      </button>
      <div className="rail-divider" />
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
