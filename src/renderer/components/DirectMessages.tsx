import { useEffect, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import type { Inbox, Participant, Command } from "../../shared/types";
import { Avatar } from "./Avatar";
import { Presence } from "./Presence";
import { Chat } from "./Chat";
import {
  conversation,
  findConversation,
  type DirectTarget,
} from "../directThreads";
function userPresence(
  id: string,
  scope: string,
  inbox: Inbox,
  participants: Participant[],
) {
  return scope === inbox.activeScope
    ? (participants.find((p) => p.profile.id === id)?.profile.presence ??
        (participants.some((p) => p.profile.id === id) ? "online" : "offline"))
    : "offline";
}
export function DirectList({
  inbox,
  participants,
  owner,
  selected,
  open,
  legacyHost = false,
}: {
  inbox: Inbox;
  participants: Participant[];
  owner: string;
  selected: DirectTarget | null;
  open: (target: DirectTarget) => void;
  legacyHost?: boolean;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="direct-list">
      <label className="direct-search">
        <Search size={16} />
        <input
          aria-label="Buscar conversas"
          placeholder="Buscar uma pessoa"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {legacyHost && (
        <p className="sidebar-hint">
          O host desta sala precisa atualizar para oferecer mensagens privadas.
          Seu histórico salvo continua disponível.
        </p>
      )}
      {!inbox.rooms.length && !legacyHost && (
        <p className="sidebar-hint">
          Conecte-se a uma sala para encontrar seus amigos. As conversas ficam
          salvas aqui.
        </p>
      )}
      {inbox.rooms.map((room) => {
        const contacts = room.contacts
          .filter((c) =>
            c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
          .map((contact) => ({
            contact,
            ...conversation(room, contact.id, owner),
          }))
          .sort(
            (a, b) =>
              (b.last?.sequence ?? 0) - (a.last?.sequence ?? 0) ||
              a.contact.name.localeCompare(b.contact.name),
          );
        if (!contacts.length) return null;
        return (
          <section key={room.scope}>
            <h3 className="direct-room-name">
              {room.name}
              <small>
                {room.scope === inbox.activeScope
                  ? "Conectado"
                  : "Histórico local"}
              </small>
            </h3>
            {contacts.map(({ contact, last, unread }) => (
              <button
                key={contact.id}
                className={
                  "direct-person " +
                  (selected?.scope === room.scope &&
                  selected.peer === contact.id
                    ? "active"
                    : "")
                }
                aria-label={"Conversa com " + contact.name}
                aria-current={
                  selected?.scope === room.scope && selected.peer === contact.id
                    ? "page"
                    : undefined
                }
                onClick={() => open({ scope: room.scope, peer: contact.id })}
              >
                <span className="avatar-with-presence">
                  <Avatar avatar={contact.avatar} />
                  <Presence
                    value={userPresence(
                      contact.id,
                      room.scope,
                      inbox,
                      participants,
                    )}
                  />
                </span>
                <span className="direct-person-copy">
                  <strong>{contact.name}</strong>
                  <small>
                    {last?.text ||
                      (last?.imageId
                        ? "Imagem"
                        : contact.directEnabled
                          ? "Iniciar conversa"
                          : "Aguardando atualização")}
                  </small>
                </span>
                {unread > 0 && (
                  <span
                    className="unread-badge"
                    aria-label={unread + " mensagens não lidas"}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
            ))}
          </section>
        );
      })}
      {query &&
        !inbox.rooms.some((r) =>
          r.contacts.some((c) =>
            c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          ),
        ) && <p className="sidebar-hint">Nenhuma pessoa encontrada.</p>}
    </div>
  );
}
export function DirectConversation({
  inbox,
  target,
  owner,
  online,
  supported,
  participants,
  command,
}: {
  inbox: Inbox;
  target: DirectTarget | null;
  owner: string;
  online: boolean;
  supported: boolean;
  participants: Participant[];
  command: (command: Command) => Promise<void>;
}) {
  const { room, contact } = findConversation(inbox, target),
    [error, setError] = useState("");
  const current =
    room && contact ? conversation(room, contact.id, owner) : undefined;
  const through = current?.last?.sequence ?? 0,
    read = room && contact ? (room.read[contact.id] ?? 0) : 0;
  useEffect(() => {
    setError("");
    const mark = () => {
      if (
        room &&
        contact &&
        through > read &&
        document.hasFocus() &&
        document.visibilityState === "visible"
      )
        void window.voxy
          .markDirectRead(room.scope, contact.id, through)
          .catch((e) => setError(e.message));
    };
    mark();
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [room?.scope, contact?.id, through, read]);
  if (!room || !contact || !current)
    return (
      <div className="direct-welcome">
        <MessageCircle size={54} />
        <h1>Uma conversa só de vocês.</h1>
        <p>
          Escolha uma pessoa na lista para abrir o histórico ou começar uma
          conversa privada.
        </p>
      </div>
    );
  const canSend =
    online &&
    inbox.activeScope === room.scope &&
    supported &&
    contact.directEnabled;
  const presence = userPresence(contact.id, room.scope, inbox, participants);
  return (
    <section
      className="direct-conversation"
      aria-label={"Conversa privada com " + contact.name}
    >
      <div className="direct-context">
        <Presence value={presence} label />
        <span>{room.name}</span>
        <small>
          {!online || inbox.activeScope !== room.scope
            ? "Histórico salvo. Reconecte à sala pela barra de servidores para enviar."
            : !supported
              ? "O host precisa atualizar para oferecer mensagens privadas."
              : !contact.directEnabled
                ? "Essa pessoa precisa atualizar o Voxy e conectar uma vez."
                : presence === "offline"
                  ? "As mensagens serão entregues quando essa pessoa reconectar."
                  : "Mensagens visíveis somente aos dois participantes e ao host."}
        </small>
      </div>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <Chat
        key={room.scope + contact.id}
        channelId={contact.id}
        name={contact.name}
        messages={current.messages.map((m) => ({
          ...m,
          channelId: contact.id,
        }))}
        authorId={owner}
        busy={false}
        readOnly={!canSend}
        directScope={room.scope}
        onSend={(text, image) =>
          command({
            type: "direct.message",
            scope: room.scope,
            recipient: contact.id,
            text,
            image,
          })
        }
        onEdit={(id, text) =>
          command({ type: "direct.edit", scope: room.scope, id, text })
        }
        onDelete={(id) =>
          command({ type: "direct.delete", scope: room.scope, id })
        }
      />
    </section>
  );
}
