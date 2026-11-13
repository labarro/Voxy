import { useState } from "react";
import {
  AudioLines,
  Radio,
  LogIn,
  RefreshCw,
  Trash2,
  History,
  ArrowUpRight,
  Link,
  ShieldCheck,
} from "lucide-react";
import type { RoomAvailability } from "../../shared/types";
import type { SavedRoomsView } from "../hooks/useSavedRooms";
import { KuromiMark, KuromiArtwork } from "./Personalization";
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
  theme,
}: {
  saved: SavedRoomsView;
  busy: boolean;
  host: () => void;
  join: () => void;
  reconnect: (id: string) => void;
  theme?: string;
}) {
  const { rooms, states, checking, error, refresh, remove } = saved;
  const [actionError, setError] = useState("");
  return (
    <div className="home-view">
      <section className="launcher-intro">
        <div className="launcher-copy">
          <span className="launcher-signal">
            {theme === "kuromi" ? <KuromiMark /> : <AudioLines size={18} />} Um
            espaço para o seu grupo
          </span>
          <h1>
            Seu grupo.
            <br />
            Sua frequência.
          </h1>
          <p>
            Tem conversa que merece continuar.
            <br />
            Encontre seus amigos na voz, compartilhe a tela
            <br className="wide-break" /> ou passe um tempo na sala 3D.
          </p>
          <svg
            className="frequency-art"
            viewBox="0 0 480 80"
            role="img"
            aria-label="Ondas de uma conversa"
          >
            <path
              d="M0 40H35L42 28 49 52 56 40H79L87 12 95 68 103 26 111 54 119 40H151L159 31 167 49 175 40H209L217 6 225 74 233 19 241 61 249 30 257 50 265 40H302L310 23 318 57 326 34 334 46 342 40H375L383 16 391 64 399 29 407 51 415 40H480"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="225" cy="40" r="4" fill="var(--signal-warm)" />
          </svg>
        </div>
        <div className="launcher-actions">
          {theme === "kuromi" && (
            <div className="kuromi-feature">
              <KuromiArtwork />
              <div>
                <span className="kuromi-feature-title">Do seu jeito.</span>
                <p>
                  Um pouco de atitude.
                  <br />
                  Um lugar para os seus.
                </p>
                <small>Arte © SANRIO</small>
              </div>
              <span className="kuromi-sparkle one" aria-hidden="true">
                ✦
              </span>
              <span className="kuromi-sparkle two" aria-hidden="true">
                ✧
              </span>
            </div>
          )}
          <button className="launcher-action" disabled={busy} onClick={join}>
            <span className="launcher-action-icon">
              <LogIn size={23} />
            </span>
            <span>
              <strong>Entrar em sala</strong>
              <small>Já tem um convite? Seu lugar está aqui.</small>
            </span>
            <ArrowUpRight size={20} />
          </button>
          <button className="launcher-action" disabled={busy} onClick={host}>
            <span className="launcher-action-icon warm">
              <Radio size={23} />
            </span>
            <span>
              <strong>Hospedar sala</strong>
              <small>Abra um espaço e chame seus amigos.</small>
            </span>
            <PlusMark />
          </button>
          <p className="launcher-network">
            <ShieldCheck size={16} /> Na mesma rede Radmin VPN, entre amigos.
          </p>
        </div>
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
          <div className="recent-empty">
            <span className="empty-link">
              <Link size={24} />
            </span>
            <div>
              <h3>A próxima conversa começa aqui</h3>
              <p>
                Entre com um convite ou hospede sua sala.
                <br />
                Seus servidores ficam salvos para voltar depois.
              </p>
            </div>
            <button className="secondary" onClick={join} disabled={busy}>
              Usar um convite
            </button>
          </div>
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
function PlusMark() {
  return (
    <span className="launcher-plus" aria-hidden="true">
      +
    </span>
  );
}
