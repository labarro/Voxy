import { useState } from "react";
import {
  Radio,
  LogIn,
  RefreshCw,
  Trash2,
  Plus,
  ShieldCheck,
  Volume2,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Hash,
  ArrowUpRight,
} from "lucide-react";
import type {
  Participant,
  RoomAvailability,
  RoomState,
} from "../../shared/types";
import type { SavedRoomsView } from "../hooks/useSavedRooms";
import { KuromiMark, KuromiArtwork } from "./Personalization";
import { Avatar } from "./Avatar";

const labels: Record<RoomAvailability["status"], string> = {
  available: "Disponível",
  unavailable: "Fora de alcance",
  invalid: "Convite expirado",
  missing: "Servidor removido",
  full: "Sala cheia",
};
function greeting(name: string) {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Boa noite" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return `${part}, ${name}`;
}
function Faces({
  people,
  speaking,
}: {
  people: Participant[];
  speaking: Set<string>;
}) {
  const shown = people.slice(0, 6);
  return (
    <span className="home-faces">
      {shown.map((p) => (
        <span
          key={p.id}
          className={"home-face " + (speaking.has(p.id) ? "is-speaking" : "")}
          title={p.profile.name}
        >
          <Avatar avatar={p.profile.avatar} className="face-avatar" />
        </span>
      ))}
      {people.length > shown.length && (
        <span className="home-face more">+{people.length - shown.length}</span>
      )}
    </span>
  );
}

/**
 * Home (Voxy 1.5): the native 2.0 organization — greeting, the call you are
 * in, calls happening now, your servers (connected and saved) and the latest
 * messages — built only from data the Electron app already has.
 */
export function Home({
  name,
  busy,
  host,
  join,
  create,
  canCreate,
  reconnect,
  saved,
  theme,
  room,
  online,
  selfId,
  serverId,
  speaking,
  muted,
  deafened,
  onMute,
  onDeafen,
  openCall,
  openChannel,
  selectServer,
  credit,
}: {
  name: string;
  saved: SavedRoomsView;
  busy: boolean;
  host: () => void;
  join: () => void;
  create: () => void;
  canCreate: boolean;
  reconnect: (id: string) => void;
  theme?: string;
  room: RoomState;
  online: boolean;
  selfId: string;
  serverId: string;
  speaking: Set<string>;
  muted: boolean;
  deafened: boolean;
  onMute: () => void;
  onDeafen: () => void;
  openCall: () => void;
  openChannel: (serverId: string, channelId: string) => void;
  selectServer: (id: string) => void;
  credit: () => void;
}) {
  const { rooms, states, checking, error, refresh, remove } = saved;
  const [actionError, setError] = useState("");
  const me = room.participants.find((p) => p.id === selfId);
  const voice = room.channels.find((c) => c.id === me?.channelId);
  const voiceServer = room.servers.find((s) => s.id === voice?.serverId);
  const calls = room.channels
    .filter((c) => c.kind === "voice")
    .map((c) => ({
      channel: c,
      server: room.servers.find((s) => s.id === c.serverId),
      people: room.participants.filter((p) => p.channelId === c.id),
    }))
    .filter((c) => c.people.length > 0);
  const offlineSaved = rooms.filter(
    (r) => !room.servers.some((s) => s.id === r.serverId),
  );
  const textChannels = new Map(
    room.channels.filter((c) => c.kind === "text").map((c) => [c.id, c]),
  );
  const recent = room.messages
    .filter((m) => textChannels.has(m.channelId) && m.text)
    .slice(-4)
    .reverse();
  const subtitle = voice
    ? `Em chamada em ${voiceServer?.name ?? voice.name}`
    : online
      ? `${room.participants.length} ${room.participants.length === 1 ? "pessoa conectada" : "pessoas conectadas"} agora`
      : rooms.length
        ? `${rooms.length} ${rooms.length === 1 ? "servidor salvo" : "servidores salvos"}`
        : "Comece hospedando uma sala ou usando um convite";
  return (
    <div className="home-view">
      <header className="home-header">
        <div>
          <h1>{greeting(name)}</h1>
          <p>{subtitle}</p>
        </div>
        {theme === "kuromi" && (
          <div className="kuromi-feature home-kuromi">
            <KuromiArtwork />
            <div>
              <span className="kuromi-feature-title">Do seu jeito.</span>
              <p>Um pouco de atitude. Um lugar para os seus.</p>
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
        {online && (
          <div className="home-header-actions">
            <button className="secondary" disabled={busy} onClick={join}>
              <LogIn size={16} /> Entrar por convite
            </button>
            <button
              className="primary"
              disabled={busy || !canCreate}
              title={canCreate ? undefined : "Somente o host cria servidores"}
              onClick={create}
            >
              <Plus size={16} /> Criar servidor
            </button>
          </div>
        )}
      </header>

      {voice && me ? (
        <section className="home-live" aria-label="Chamada atual">
          <div className="home-live-copy">
            <span className="home-live-tag">
              <i className="status-dot" /> Em chamada agora
            </span>
            <h2>{voice.name}</h2>
            <p>{voiceServer?.name}</p>
            <Faces
              people={room.participants.filter((p) => p.channelId === voice.id)}
              speaking={speaking}
            />
          </div>
          <div className="home-live-actions">
            <button
              className={"icon-tile " + (muted || deafened ? "is-alert" : "")}
              disabled={deafened}
              aria-pressed={muted || deafened}
              title={muted ? "Ativar microfone" : "Mutar microfone"}
              aria-label={muted ? "Ativar microfone" : "Mutar microfone"}
              onClick={onMute}
            >
              {muted || deafened ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              className={"icon-tile " + (deafened ? "is-alert" : "")}
              aria-pressed={deafened}
              title={deafened ? "Desativar Deafen" : "Silenciar áudio"}
              aria-label={deafened ? "Desativar Deafen" : "Silenciar áudio"}
              onClick={onDeafen}
            >
              {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
            </button>
            <button className="primary" onClick={openCall}>
              <Volume2 size={16} /> Abrir chamada
            </button>
          </div>
        </section>
      ) : (
        !online && (
          <section
            className={"home-start " + (theme === "kuromi" ? "kuromi" : "")}
          >
            <div className="launcher-copy">
              <span className="launcher-signal">
                {theme === "kuromi" ? (
                  <KuromiMark />
                ) : (
                  <img src="./assets/brand/voxy.svg" alt="" aria-hidden="true" />
                )}
                Um espaço para o seu grupo
              </span>
              <h2>
                Seu grupo.
                <br />
                Sua frequência.
              </h2>
              <p>
                Encontre seus amigos na voz, compartilhe a tela ou passe um
                tempo na sala 3D.
              </p>
            </div>
            <div className="launcher-actions">
              <button
                className="launcher-action"
                disabled={busy}
                aria-label="Entrar em sala"
                aria-describedby="launcher-join-hint"
                onClick={join}
              >
                <span className="launcher-action-icon">
                  <LogIn size={20} />
                </span>
                <span>
                  <strong>Entrar em sala</strong>
                  <small id="launcher-join-hint">
                    Já tem um convite? Seu lugar está aqui.
                  </small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button
                className="launcher-action"
                disabled={busy}
                aria-label="Hospedar sala"
                aria-describedby="launcher-host-hint"
                onClick={host}
              >
                <span className="launcher-action-icon accent">
                  <Radio size={20} />
                </span>
                <span>
                  <strong>Hospedar sala</strong>
                  <small id="launcher-host-hint">
                    Abra um espaço e chame seus amigos.
                  </small>
                </span>
                <Plus size={18} />
              </button>
              <p className="launcher-network">
                <ShieldCheck size={15} /> Na mesma rede Radmin VPN, entre
                amigos.
              </p>
            </div>
          </section>
        )
      )}

      {calls.length > 0 && (
        <section className="home-section">
          <header className="home-section-head">
            <h2>Chamadas agora</h2>
          </header>
          <div className="home-list">
            {calls.map(({ channel, server, people }) => (
              <article className="home-call-row" key={channel.id}>
                <span className="home-row-icon live">
                  <Volume2 size={18} />
                </span>
                <div className="home-row-copy">
                  <strong>{channel.name}</strong>
                  <small>
                    {server?.name ? server.name + " · " : ""}
                    {people.length === 1 ? "1 pessoa" : people.length + " pessoas"}
                  </small>
                </div>
                <Faces people={people} speaking={speaking} />
                <button
                  className="secondary"
                  onClick={() => openChannel(channel.serverId, channel.id)}
                >
                  <Volume2 size={15} /> Abrir
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="home-section recent-section">
        <header className="home-section-head">
          <h2>Servidores</h2>
          <button
            className="ghost"
            disabled={checking}
            title="Verificar disponibilidade dos servidores salvos"
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} />
            {checking ? "Verificando…" : "Atualizar"}
          </button>
        </header>
        {(error || actionError) && (
          <p role="alert" className="modal-error">
            {error || actionError}
          </p>
        )}
        {!rooms.length && !room.servers.length ? (
          <div className="recent-empty">
            <span className="empty-badge">
              <Radio size={22} />
            </span>
            <div>
              <h3>A próxima conversa começa aqui</h3>
              <p>
                Entre com um convite ou hospede sua sala. Seus servidores ficam
                salvos para voltar depois.
              </p>
            </div>
            <button className="secondary" onClick={join} disabled={busy}>
              Usar um convite
            </button>
          </div>
        ) : (
          <div className="server-cards">
            {room.servers.map((s) => (
              <button
                key={s.id}
                className={
                  "server-card online " + (s.id === serverId ? "current" : "")
                }
                onClick={() => selectServer(s.id)}
              >
                <span className="recent-icon">
                  {s.icon ? (
                    <Avatar avatar={s.icon} className="server-photo" />
                  ) : (
                    s.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                <span className="server-card-copy">
                  <strong>{s.name}</strong>
                  <small className="availability available">
                    Conectado · {room.participants.length} online
                  </small>
                </span>
              </button>
            ))}
            {offlineSaved.map((r) => {
              const status = states.find((s) => s.id === r.id)?.status;
              return (
                <article className="server-card recent-room" key={r.id}>
                  <span className="recent-icon">
                    {r.icon ? (
                      <img src={r.icon} alt="Imagem do servidor" />
                    ) : (
                      r.name.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="server-card-copy">
                    <strong>{r.name}</strong>
                    <small className={"availability " + (status ?? "unknown")}>
                      {status ? labels[status] : "Ainda não verificado"}
                    </small>
                    <small className="server-card-meta">
                      {r.address}:{r.port} · último acesso{" "}
                      {new Date(r.lastAccess).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </span>
                  <span className="recent-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      aria-label={"Reconectar a " + r.name}
                      onClick={() => reconnect(r.id)}
                    >
                      {r.hosted ? "Hospedar novamente" : "Reconectar"}
                    </button>
                    <button
                      className="icon-button"
                      title={"Remover " + r.name + " dos recentes"}
                      disabled={busy}
                      onClick={() => {
                        void remove(r.id).catch((e) => setError(e.message));
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        )}
        {offlineSaved.length > 0 && (
          <p className="hint">
            Fora de alcance pode significar host fechado, VPN desconectada ou
            firewall. Você pode tentar reconectar mesmo assim.
          </p>
        )}
      </section>

      {recent.length > 0 && (
        <section className="home-section">
          <header className="home-section-head">
            <h2>Mensagens recentes</h2>
          </header>
          <div className="home-messages">
            {recent.map((m) => {
              const c = textChannels.get(m.channelId)!;
              return (
                <button
                  key={m.id}
                  className="home-message"
                  onClick={() => openChannel(c.serverId, c.id)}
                >
                  <Avatar
                    avatar={room.profiles?.[m.author]?.avatar ?? m.avatar}
                    className="face-avatar"
                  />
                  <span className="home-message-copy">
                    <span className="home-message-meta">
                      <strong>{room.profiles?.[m.author]?.name ?? m.name}</strong>
                      <span>
                        <Hash size={11} aria-hidden="true" />
                        {c.name}
                      </span>
                      <time>
                        {new Date(m.time).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </span>
                    <span className="home-message-text">
                      {m.text.replace(
                        /@{([a-f0-9-]{36})}/gi,
                        (_, id: string) =>
                          "@" + (room.profiles?.[id]?.name ?? "alguém"),
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <footer className="home-footer">
        <a
          href="https://devbarros.com/"
          className="creator-credit"
          onClick={(e) => {
            e.preventDefault();
            credit();
          }}
        >
          Criado por devbarros.com
        </a>
      </footer>
    </div>
  );
}
