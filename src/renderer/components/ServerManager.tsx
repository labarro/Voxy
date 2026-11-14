import { useState } from "react";
import {
  Building2,
  Image,
  Shield,
  Hash,
  AudioLines,
  Box,
  Link,
  Plus,
  Copy,
  Check,
} from "lucide-react";
import type { Command, RoomState } from "../../shared/types";
import { HubNavigation, type HubPage } from "./HubNavigation";
import { ManageRow } from "./ManageRow";
import { Roles } from "./Roles";
import { ServerImage } from "./ServerImage";
const pages: HubPage[] = [
  {
    id: "Geral",
    group: "Seu servidor",
    icon: Building2,
    description: "Identidade do espaço e ações de administração.",
  },
  {
    id: "Imagem",
    group: "Seu servidor",
    icon: Image,
    description: "Uma imagem para reconhecer o servidor na navegação.",
  },
  {
    id: "Cargos",
    group: "Seu servidor",
    icon: Shield,
    description: "Identifique os membros e organize os cargos do grupo.",
    keywords: "membros cor",
  },
  {
    id: "Canais de texto",
    group: "Conversas e encontros",
    icon: Hash,
    description: "Organize os assuntos e seus históricos.",
  },
  {
    id: "Salas de voz",
    group: "Conversas e encontros",
    icon: AudioLines,
    description: "Espaços para conversar, compartilhar e assistir.",
  },
  {
    id: "Ambientes 3D",
    group: "Conversas e encontros",
    icon: Box,
    description: "Escolha o ambiente de cada sala de voz.",
    keywords: "lounge cinema tradicional",
  },
  {
    id: "Convites",
    group: "Acesso",
    icon: Link,
    description: "Traga seus amigos para a mesma sala na rede privada.",
  },
];
export function ServerManager({
  room,
  serverId,
  ownerId,
  isHost,
  busy,
  command,
  invite,
  close,
}: {
  room: RoomState;
  serverId: string;
  ownerId: string;
  isHost: boolean;
  busy: boolean;
  command: (c: Command) => Promise<void>;
  invite?: string;
  close: () => void;
}) {
  const [page, setPage] = useState("Geral"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false),
    [channelName, setChannelName] = useState("");
  const server = room.servers.find((s) => s.id === serverId);
  if (!server) return <p>Este servidor foi removido.</p>;
  const owner = server.ownerId === ownerId,
    disabled = busy || pending;
  const current = pages.find((p) => p.id === page)!;
  async function send(c: Command) {
    setPending(true);
    setError("");
    try {
      await command(c);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setPending(false);
    }
  }
  // Child editors await this promise and report errors locally. Click handlers catch explicitly.
  const safe = (c: Command) => send(c).catch(() => {});
  const channels = room.channels.filter((c) => c.serverId === serverId);
  return (
    <div className="management-hub">
      <HubNavigation
        pages={pages}
        active={page}
        change={(p) => {
          setPage(p);
          setError("");
          setCreating(false);
        }}
        label="Administração do servidor"
      />
      <div className="management-content" key={page}>
        <header className="hub-page-heading">
          <span className="hub-page-icon">
            <current.icon size={22} />
          </span>
          <div>
            <h3>{page}</h3>
            <p>{current.description}</p>
          </div>
        </header>
        <div className="hub-context">
          <strong>{server.name}</strong>
          <span>
            {isHost ? "Hospedado por você" : "Conectado como participante"}
          </span>
        </div>
        {page === "Geral" && (
          <>
            <section className="admin-section">
              <h4>Nome do servidor</h4>
              <p>
                O nome aparece para todos os participantes. Excluir o servidor
                também remove seus canais e históricos.
              </p>
              <ManageRow
                name={server.name}
                disabled={!isHost || disabled}
                rename={(name) =>
                  send({ type: "server.rename", id: server.id, name })
                }
                remove={async () => {
                  await send({ type: "server.delete", id: server.id });
                  close();
                }}
              />
            </section>
            <section className="admin-section">
              <h4>Quem pode administrar?</h4>
              <p>
                O host gerencia nomes e canais. O criador do servidor controla a
                imagem e os cargos. Cargos identificam membros e não concedem
                permissões administrativas.
              </p>
            </section>
          </>
        )}
        {page === "Imagem" && (
          <ServerImage
            server={server}
            allowed={owner}
            busy={disabled}
            save={(image) =>
              send({ type: "server.icon", id: server.id, image })
            }
          />
        )}
        {page === "Cargos" &&
          (owner ? (
            <Roles room={room} serverId={serverId} command={send} />
          ) : (
            <p>Somente o criador do servidor pode editar cargos.</p>
          ))}
        {(page === "Canais de texto" || page === "Salas de voz") && (
          <section className="admin-section">
            <div className="admin-toolbar">
              <p>
                {isHost
                  ? "Renomeie os espaços ou crie um novo. A exclusão exige confirmação."
                  : "Somente o host pode editar os canais."}
              </p>
              <button
                className="secondary"
                disabled={!isHost || disabled}
                onClick={() => {
                  setChannelName("");
                  setCreating(true);
                }}
              >
                <Plus size={16} />
                Criar canal
              </button>
            </div>
            {creating && (
              <form
                className="admin-create"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (disabled || !channelName.trim()) return;
                  try {
                    await send({
                      type: "channel.create",
                      serverId,
                      name: channelName.trim(),
                      kind: page === "Canais de texto" ? "text" : "voice",
                    });
                    setCreating(false);
                    setChannelName("");
                  } catch {
                    /* The hub shows the host's error and preserves the draft. */
                  }
                }}
              >
                <label>
                  Nome do novo canal
                  <input
                    autoFocus
                    required
                    maxLength={60}
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                  />
                </label>
                <div>
                  <button
                    className="primary"
                    disabled={disabled || !channelName.trim()}
                  >
                    Adicionar canal
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setCreating(false)}
                  >
                    Cancelar criação
                  </button>
                </div>
              </form>
            )}
            {channels
              .filter(
                (c) =>
                  c.kind === (page === "Canais de texto" ? "text" : "voice"),
              )
              .map((c) => (
                <div className="admin-channel" key={c.id}>
                  <span className="admin-channel-kind">
                    {c.kind === "text" ? (
                      <Hash size={18} />
                    ) : (
                      <AudioLines size={18} />
                    )}
                  </span>
                  <ManageRow
                    name={c.name}
                    disabled={!isHost || disabled}
                    rename={(name) =>
                      send({ type: "channel.rename", id: c.id, name })
                    }
                    remove={() => send({ type: "channel.delete", id: c.id })}
                  />
                </div>
              ))}
            {!channels.some(
              (c) => c.kind === (page === "Canais de texto" ? "text" : "voice"),
            ) && (
              <p className="hub-empty">
                Nenhum canal aqui. Crie o primeiro para começar.
              </p>
            )}
          </section>
        )}
        {page === "Ambientes 3D" && (
          <section className="admin-section">
            {!room.features?.rooms3d ? (
              <p>Atualize o host para configurar ambientes 3D.</p>
            ) : (
              channels
                .filter((c) => c.kind === "voice")
                .map((c) => (
                  <label className="environment-row" key={c.id}>
                    <span>
                      <strong>{c.name}</strong>
                      <small>Tradicional, Lounge, Cinema ou Rooftop</small>
                    </span>
                    <select
                      aria-label={"Ambiente de " + c.name}
                      value={c.roomPreset ?? ""}
                      disabled={!isHost || disabled}
                      onChange={(e) =>
                        void safe({
                          type: "channel.room",
                          id: c.id,
                          preset: (e.target.value || null) as
                            "lounge" | "cinema" | "rooftop" | null,
                        })
                      }
                    >
                      <option value="">Tradicional</option>
                      <option value="lounge">Lounge 3D</option>
                      <option value="cinema">Cinema 3D</option>
                      <option value="rooftop">Rooftop noturno 3D</option>
                    </select>
                  </label>
                ))
            )}
            {!channels.some((c) => c.kind === "voice") && (
              <p className="hub-empty">
                Crie uma sala de voz antes de escolher um ambiente.
              </p>
            )}
          </section>
        )}
        {page === "Convites" && (
          <section className="invite-panel">
            <Link size={30} />
            <h4>Um convite para estar junto</h4>
            <p>
              Todos precisam estar na mesma rede privada. O computador do host
              deve permanecer ligado. Envie o convite apenas aos seus amigos.
            </p>
            {invite ? (
              <button
                className="primary"
                onClick={() =>
                  void window.voxy
                    .copy(invite)
                    .then(() => setCopied(true))
                    .catch((e) => setError(e.message))
                }
              >
                {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
                {copied ? "Convite copiado" : "Copiar convite da sala"}
              </button>
            ) : (
              <p>Peça o convite ao host da sala.</p>
            )}
          </section>
        )}
        {error && (
          <p role="alert" className="modal-error">
            {error}
          </p>
        )}
      </div>
      <footer className="hub-savebar">
        <small>
          As ações de administração são aplicadas ao servidor imediatamente.
        </small>
        <button className="secondary" onClick={close}>
          Concluir
        </button>
      </footer>
    </div>
  );
}
