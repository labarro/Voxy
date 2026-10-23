import { useState } from "react";
import type { Command, Inbox, RoomState, Profile } from "../../shared/types";
import { Avatar } from "./Avatar";
import { Presence } from "./Presence";
import type { DirectTarget } from "../directThreads";
export function Friends({
  room,
  inbox,
  profile,
  online,
  command,
  open,
  inspect,
}: {
  room: RoomState;
  inbox: Inbox;
  profile: Profile;
  online: boolean;
  command: (c: Command) => Promise<void>;
  open: (t: DirectTarget) => void;
  inspect: (id: string, x: number, y: number) => void;
}) {
  const [id, setId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(c: Command) {
    setBusy(true);
    setError("");
    try {
      await command(c);
      setId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="friends-view">
      <h1>Amigos</h1>
      <p className="hint">
        Seu círculo no Voxy. Conectem-se à mesma sala para trocar solicitações e
        fazer chamadas. Amizades ficam salvas no host e no seu histórico local.
      </p>
      <div className="your-id">
        <span>
          Seu ID: <code>{profile.id}</code>
        </span>
        <button
          onClick={() =>
            void window.voxy.copy(profile.id).catch((e) => setError(e.message))
          }
        >
          Copiar ID
        </button>
      </div>
      <form
        className="friend-add"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ type: "friend.request", memberId: id.trim() });
        }}
      >
        <label>
          Adicionar por ID
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="Cole o ID único de um amigo"
            required
            pattern="[a-fA-F0-9-]{36}"
          />
        </label>
        <button className="primary" disabled={!online || busy || !id.trim()}>
          Enviar solicitação
        </button>
      </form>
      <label>
        Buscar amigos
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome de um amigo"
        />
      </label>
      {error && (
        <p role="alert" className="modal-error">
          {error}
        </p>
      )}
      {inbox.rooms.map((entry) => {
        const live = online && entry.scope === inbox.activeScope;
        const links = live ? room.friendships || [] : entry.friendships || [];
        const filtered = links.filter((link) => {
          const other =
            link.requester === profile.id ? link.recipient : link.requester;
          return (
            room.profiles?.[other]?.name ||
            entry.contacts.find((c) => c.id === other)?.name ||
            other
          )
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase());
        });
        return (
          <section key={entry.scope}>
            <h3>
              {entry.name}
              <small>{live ? "Conectado" : "Histórico offline"}</small>
            </h3>
            {filtered.length ? (
              filtered.map((link) => {
                const other =
                  link.requester === profile.id
                    ? link.recipient
                    : link.requester;
                const contact = entry.contacts.find((c) => c.id === other);
                const person = live
                  ? room.participants.find((p) => p.profile.id === other)
                  : undefined;
                const identity = live ? room.profiles?.[other] : undefined;
                const name = identity?.name || contact?.name || other;
                return (
                  <article
                    className="friend-row"
                    key={other}
                    onContextMenu={(e) => {
                      if (live) {
                        e.preventDefault();
                        inspect(other, e.clientX, e.clientY);
                      }
                    }}
                  >
                    <Avatar
                      avatar={identity?.avatar || contact?.avatar || "👤"}
                    />
                    <div>
                      <strong
                        style={{ color: identity?.nicknameColor || undefined }}
                      >
                        {name}
                      </strong>
                      <Presence
                        value={person ? person.profile.presence : "offline"}
                        label
                      />
                      {link.status === "pending" && (
                        <small>
                          {link.recipient === profile.id
                            ? "Quer ser seu amigo"
                            : "Solicitação enviada"}
                        </small>
                      )}
                    </div>
                    {link.status === "accepted" ? (
                      <>
                        <button
                          onClick={() =>
                            open({ scope: entry.scope, peer: other })
                          }
                        >
                          Mensagem
                        </button>
                        <button
                          disabled={!person || !live || busy}
                          onClick={() =>
                            void run({ type: "call.invite", memberId: other })
                          }
                        >
                          Ligar
                        </button>
                        <button
                          disabled={!live || busy}
                          onClick={() =>
                            void run({ type: "friend.remove", memberId: other })
                          }
                        >
                          Remover
                        </button>
                      </>
                    ) : link.recipient === profile.id ? (
                      <>
                        <button
                          disabled={!live || busy}
                          onClick={() =>
                            void run({
                              type: "friend.respond",
                              memberId: other,
                              accept: true,
                            })
                          }
                        >
                          Aceitar
                        </button>
                        <button
                          disabled={!live || busy}
                          onClick={() =>
                            void run({
                              type: "friend.respond",
                              memberId: other,
                              accept: false,
                            })
                          }
                        >
                          Recusar
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={!live || busy}
                        onClick={() =>
                          void run({ type: "friend.remove", memberId: other })
                        }
                      >
                        Cancelar solicitação
                      </button>
                    )}
                  </article>
                );
              })
            ) : (
              <p className="hint">
                Nenhuma amizade nesta sala. Adicione alguém pelo ID.
              </p>
            )}
          </section>
        );
      })}
      {!inbox.rooms.length && (
        <p className="hint">
          Conecte-se a uma sala para encontrar seus amigos.
        </p>
      )}
    </section>
  );
}
