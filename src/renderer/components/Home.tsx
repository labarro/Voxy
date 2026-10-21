import { useState } from "react";
import {
  AudioLines,
  Radio,
  LogIn,
  RefreshCw,
  Trash2,
  History,
} from "lucide-react";
import type { RoomAvailability } from "../../shared/types";
import type { SavedRoomsView } from "../hooks/useSavedRooms";
const labels: Record<RoomAvailability["status"], string> = {
  available: "Disponível",
  unavailable: "Fora de alcance",
  invalid: "Convite expirado",
  missing: "Servidor removido",
  full: "Sala cheia",
};
export function Home({
  busy,
  host,
  join,
  reconnect,
  saved,
}: {
  saved: SavedRoomsView;
  busy: boolean;
  host: () => void;
  join: () => void;
  reconnect: (id: string) => void;
}) {
  const { rooms, states, checking, error, refresh, remove } = saved;
  const [actionError, setError] = useState("");
  return (
    <div className="home-view">
      <section className="welcome">
        <div className="welcome-art">
          <AudioLines size={70} />
          <span className="orbit one" />
          <span className="orbit two" />
        </div>
        <h1>
          Seu grupo.
          <br />
          Sua frequência.
        </h1>
        <p>
          Voz, câmera e tela para estar junto.
          <br />
          Uma sala no seu computador, um convite para os amigos.
        </p>
        <div className="welcome-actions">
          <button className="primary" disabled={busy} onClick={host}>
            <Radio size={18} /> Hospedar sala
          </button>
          <button className="secondary" disabled={busy} onClick={join}>
            <LogIn size={18} /> Entrar em sala
          </button>
        </div>
        <small>
          Conecte os computadores ao Radmin VPN para entrar em uma sala.
        </small>
      </section>
      <section className="recent-section">
        <header>
          <div>
            <h2>
              <History size={20} /> Seus últimos servidores
            </h2>
            <p>Seu histórico continua aqui, mesmo com o Radmin desconectado.</p>
          </div>
          <button
            disabled={checking}
            title="Verificar disponibilidade"
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
            {checking ? "Verificando…" : "Atualizar"}
          </button>
        </header>
        {(error || actionError) && (
          <p role="alert" className="modal-error">
            {error || actionError}
          </p>
        )}
        {!rooms.length && (
          <p className="recent-empty">
            Conecte-se a uma sala para salvá-la aqui. Os próximos acessos ficam
            a um clique.
          </p>
        )}
        <div className="recent-list">
          {rooms.map((room) => {
            const status = states.find((s) => s.id === room.id)?.status;
            return (
              <article className="recent-room" key={room.id}>
                <span className="recent-icon">
                  {room.icon ? (
                    <img src={room.icon} alt="Imagem do servidor" />
                  ) : (
                    room.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                <div>
                  <h3>{room.name}</h3>
                  <span>
                    {room.address}:{room.port}
                  </span>
                  <small>
                    Último acesso{" "}
                    {new Date(room.lastAccess).toLocaleString("pt-BR")}
                  </small>
                  <p className={"availability " + (status ?? "unknown")}>
                    {status ? labels[status] : "Ainda não verificado"}
                  </p>
                </div>
                <div className="recent-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    aria-label={"Reconectar a " + room.name}
                    onClick={() => reconnect(room.id)}
                  >
                    {room.hosted ? "Hospedar novamente" : "Reconectar"}
                  </button>
                  <button
                    title={"Remover " + room.name + " dos recentes"}
                    disabled={busy}
                    onClick={() => {
                      void remove(room.id).catch((e) => setError(e.message));
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {!!rooms.length && (
          <p className="hint">
            Fora de alcance pode significar host fechado, VPN desconectada ou
            firewall. Você pode tentar reconectar mesmo assim.
          </p>
        )}
      </section>
    </div>
  );
}
