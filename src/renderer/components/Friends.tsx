import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Inbox as InboxIcon,
  MessageCircle,
  MoreVertical,
  Phone,
  Search,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type {
  Command,
  Inbox,
  RoomState,
  Profile,
  Participant,
} from "../../shared/types";
import { Avatar } from "./Avatar";
import { friendEntries, type FriendEntry } from "../friends";
import { Presence } from "./Presence";
import type { DirectTarget } from "../directThreads";

type Tab = "all" | "online" | "pending" | "add";
function presenceLabel(friend: FriendEntry, online: boolean) {
  if (friend.person)
    return friend.person.profile.presence === "away"
      ? "Ausente"
      : friend.person.profile.presence === "busy"
        ? "Ocupado"
        : "Online";
  if (!online) return "Presença indisponível — você está desconectado";
  return friend.links.some((l) => l.live)
    ? "Não está neste servidor agora"
    : "Presença indisponível — amizade em outro servidor";
}

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
  const [tab, setTab] = useState<Tab>("all");
  const [id, setId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const friends = useMemo(
    () => friendEntries(room, inbox, profile.id, online),
    [room, inbox, profile.id, online],
  );
  const accepted = friends.filter((f) => f.status === "accepted");
  const present = accepted.filter((f) => f.person);
  const pending = friends.filter((f) => f.status !== "accepted");
  const incoming = pending.filter((f) => f.status === "incoming");
  const activeServer = inbox.rooms.find(
    (r) => r.scope === inbox.activeScope,
  )?.name;
  async function run(c: Command, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await command(c);
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const needle = query.trim().toLocaleLowerCase("pt-BR");
  const visible = (tab === "online" ? present : tab === "pending" ? pending : accepted)
    .filter((f) => !needle || f.name.toLocaleLowerCase("pt-BR").includes(needle));
  const tabs: { key: Tab; label: string; count?: number; alert?: boolean }[] = [
    { key: "all", label: "Todos", count: accepted.length },
    { key: "online", label: "Online", count: present.length },
    {
      key: "pending",
      label: "Pendentes",
      count: pending.length,
      alert: incoming.length > 0,
    },
    { key: "add", label: "Adicionar amigo" },
  ];
  return (
    <section className="friends-view friends-v2">
      <header className="friends-head">
        <div className="friends-title">
          <span className="friends-title-icon" aria-hidden="true">
            <Users size={18} />
          </span>
          <h1>Amigos</h1>
        </div>
        <nav className="friends-tabs" role="tablist" aria-label="Amigos">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={
                (tab === t.key ? "active " : "") +
                (t.key === "add" ? "add-tab" : "")
              }
              onClick={() => {
                setTab(t.key);
                setMenu(null);
                setError("");
                setNotice("");
              }}
            >
              {t.key === "add" && <UserPlus size={15} aria-hidden="true" />}
              {t.label}
              {!!t.count && (
                <span className={"friends-count " + (t.alert ? "alert" : "")}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>
      <p className="friends-scope" role="status">
        {online && activeServer ? (
          <>
            <span className="scope-dot live" aria-hidden="true" />
            <span>
              Presença e chamadas confirmadas pelo servidor{" "}
              <b>{activeServer}</b>. Amizades de outros servidores aparecem sem
              presença.
            </span>
          </>
        ) : (
          <>
            <span className="scope-dot" aria-hidden="true" />
            <span>
              Desconectado: amizades e conversas salvas continuam disponíveis;
              presença, pedidos e chamadas voltam ao entrar em um servidor.
            </span>
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="modal-error friends-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="friends-notice">
          <Check size={15} aria-hidden="true" /> {notice}
        </p>
      )}
      {tab === "add" ? (
        <AddFriend
          selfId={profile.id}
          id={id}
          setId={setId}
          online={online}
          server={activeServer}
          busy={busy}
          onSubmit={async () => {
            if (
              await run(
                { type: "friend.request", memberId: id.trim() },
                "Solicitação enviada. Ela aparece em Pendentes.",
              )
            )
              setId("");
          }}
          onCopy={() =>
            void window.voxy
              .copy(profile.id)
              .then(() => setNotice("Seu ID foi copiado."))
              .catch((e) => setError(e.message))
          }
        />
      ) : (
        <>
          <label className="friends-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                tab === "pending" ? "Buscar solicitações" : "Buscar amigos"
              }
              aria-label="Buscar amigos"
              type="search"
            />
            {query && (
              <button
                type="button"
                className="friends-search-clear"
                aria-label="Limpar busca"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
          {visible.length > 0 && (
            <h2 className="friends-section-title">
              {tab === "online"
                ? "Online agora"
                : tab === "pending"
                  ? "Solicitações"
                  : "Todos os amigos"}{" "}
              — {visible.length}
            </h2>
          )}
          {visible.length ? (
            <ul className="friends-list" aria-label="Lista de amigos">
              {visible.map((friend) => (
                <FriendRow
                  key={friend.id}
                  friend={friend}
                  online={online}
                  busy={busy}
                  menuOpen={menu === friend.id}
                  setMenu={(v) => setMenu(v ? friend.id : null)}
                  open={open}
                  inspect={inspect}
                  run={run}
                  copy={() =>
                    void window.voxy
                      .copy(friend.id)
                      .then(() => setNotice("ID de " + friend.name + " copiado."))
                      .catch((e) => setError(e.message))
                  }
                />
              ))}
            </ul>
          ) : (
            <EmptyFriends
              tab={tab}
              searching={!!needle}
              hasFriends={accepted.length > 0}
              online={online}
              onAdd={() => setTab("add")}
            />
          )}
        </>
      )}
    </section>
  );
}

function FriendRow({
  friend,
  online,
  busy,
  menuOpen,
  setMenu,
  open,
  inspect,
  run,
  copy,
}: {
  friend: FriendEntry;
  online: boolean;
  busy: boolean;
  menuOpen: boolean;
  setMenu: (open: boolean) => void;
  open: (t: DirectTarget) => void;
  inspect: (id: string, x: number, y: number) => void;
  run: (c: Command, done?: string) => Promise<boolean>;
  copy: () => void;
}) {
  const live = friend.links.find((l) => l.live && l.status === friend.status);
  const home = live ?? friend.links[0];
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menuOpen, setMenu]);
  const presence = presenceLabel(friend, online);
  const servers = [...new Set(friend.links.map((l) => l.server))].join(", ");
  return (
    <li
      className={
        "friend-item " +
        (friend.person ? "is-present " : "") +
        (menuOpen ? "menu-open" : "")
      }
      onContextMenu={(e) => {
        if (friend.person) {
          e.preventDefault();
          inspect(friend.id, e.clientX, e.clientY);
        }
      }}
    >
      <span className="friend-avatar">
        <Avatar avatar={friend.avatar} />
        {friend.person ? (
          <Presence value={friend.person.profile.presence ?? "online"} />
        ) : (
          // Not reported by the connected host: never claim "offline".
          <span
            className="presence unknown"
            title="Presença não confirmada"
            aria-label="Presença não confirmada"
            role="img"
          />
        )}
      </span>
      <div className="friend-text">
        <strong style={{ color: friend.color || undefined }}>{friend.name}</strong>
        <span className="friend-sub">
          {friend.status === "incoming"
            ? "Quer ser seu amigo · " + servers
            : friend.status === "outgoing"
              ? "Solicitação enviada · " + servers
              : friend.activity
                ? presence + " · " + friend.activity
                : presence}
        </span>
      </div>
      <div className="friend-actions">
        {friend.status === "accepted" ? (
          <>
            <button
              className="friend-action"
              aria-label={"Mensagem para " + friend.name}
              data-tooltip="Mensagem"
              title="Mensagem"
              onClick={() => open({ scope: home.scope, peer: friend.id })}
            >
              <MessageCircle size={18} />
            </button>
            {/* Calls are routed by the connected host, so the button only
                exists when the friend is present there. */}
            {friend.person && live && (
              <button
                className="friend-action"
                aria-label={"Ligar para " + friend.name}
                data-tooltip="Chamada privada"
                title="Chamada privada"
                disabled={busy}
                onClick={() =>
                  void run(
                    { type: "call.invite", memberId: friend.id },
                    "Chamando " + friend.name + "…",
                  )
                }
              >
                <Phone size={18} />
              </button>
            )}
          </>
        ) : friend.status === "incoming" ? (
          live ? (
            <>
              <button
                className="friend-action accept"
                aria-label={"Aceitar " + friend.name}
                title="Aceitar"
                disabled={busy}
                onClick={() =>
                  void run(
                    { type: "friend.respond", memberId: friend.id, accept: true },
                    "Agora vocês são amigos.",
                  )
                }
              >
                <Check size={18} />
              </button>
              <button
                className="friend-action decline"
                aria-label={"Recusar " + friend.name}
                title="Recusar"
                disabled={busy}
                onClick={() =>
                  void run({
                    type: "friend.respond",
                    memberId: friend.id,
                    accept: false,
                  })
                }
              >
                <X size={18} />
              </button>
            </>
          ) : (
            <span className="friend-hint">
              Entre em {home.server} para responder
            </span>
          )
        ) : null}
        <div className="friend-menu-wrap" ref={menuRef}>
          <button
            className="friend-action"
            aria-label={"Mais opções para " + friend.name}
            title="Mais opções"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenu(!menuOpen)}
          >
            <MoreVertical size={18} />
          </button>
          {menuOpen && (
            <div className="friend-menu" role="menu">
              {friend.person && (
                <button
                  role="menuitem"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu(false);
                    inspect(friend.id, r.left, r.bottom);
                  }}
                >
                  <UserRound size={15} /> Ver perfil
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  copy();
                }}
              >
                <Copy size={15} /> Copiar ID
              </button>
              {friend.status !== "incoming" &&
                (live ? (
                  <button
                    role="menuitem"
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      setMenu(false);
                      void run(
                        { type: "friend.remove", memberId: friend.id },
                        friend.status === "accepted"
                          ? "Amizade removida."
                          : "Solicitação cancelada.",
                      );
                    }}
                  >
                    <UserMinus size={15} />
                    {friend.status === "accepted"
                      ? "Remover amizade"
                      : "Cancelar solicitação"}
                  </button>
                ) : (
                  <span className="friend-menu-note" role="note">
                    Para{" "}
                    {friend.status === "accepted"
                      ? "remover a amizade"
                      : "cancelar"}
                    , entre em {home.server}.
                  </span>
                ))}
              <span className="friend-menu-note">Servidores: {servers}</span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function AddFriend({
  selfId,
  id,
  setId,
  online,
  server,
  busy,
  onSubmit,
  onCopy,
}: {
  selfId: string;
  id: string;
  setId: (v: string) => void;
  online: boolean;
  server?: string;
  busy: boolean;
  onSubmit: () => void;
  onCopy: () => void;
}) {
  const valid = /^[a-fA-F0-9-]{36}$/.test(id.trim());
  return (
    <div className="friends-add">
      <section className="friends-card">
        <h2>Adicionar amigo</h2>
        <p>
          Cole o ID Voxy de quem você quer adicionar. A solicitação passa pelo
          servidor em que vocês dois entram
          {server ? (
            <>
              {" "}
              — agora, <b>{server}</b>
            </>
          ) : null}
          .
        </p>
        <form
          className="friends-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            aria-label="ID do amigo"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="primary"
            disabled={!online || busy || !valid || id.trim() === selfId}
          >
            Enviar solicitação
          </button>
        </form>
        {!online && (
          <small className="friends-add-hint">
            Entre em um servidor para enviar solicitações.
          </small>
        )}
        {online && id.trim() && !valid && (
          <small className="friends-add-hint">
            O ID tem 36 caracteres, no formato mostrado acima.
          </small>
        )}
      </section>
      <section className="friends-card friends-id">
        <h2>Seu ID</h2>
        <p>Compartilhe com amigos para que eles adicionem você.</p>
        <div className="friends-id-row">
          <code>{selfId}</code>
          <button onClick={onCopy} className="friends-copy">
            <Copy size={15} aria-hidden="true" /> Copiar
          </button>
        </div>
      </section>
    </div>
  );
}

function EmptyFriends({
  tab,
  searching,
  hasFriends,
  online,
  onAdd,
}: {
  tab: Tab;
  searching: boolean;
  hasFriends: boolean;
  online: boolean;
  onAdd: () => void;
}) {
  const [icon, title, text] = searching
    ? [<Search key="s" />, "Ninguém encontrado", "Tente outro nome."]
    : tab === "pending"
      ? [
          <InboxIcon key="p" />,
          "Nenhuma solicitação pendente",
          "Pedidos recebidos e enviados aparecem aqui.",
        ]
      : tab === "online"
        ? [
            <Users key="o" />,
            hasFriends ? "Nenhum amigo presente agora" : "Sem amigos ainda",
            online
              ? "Só mostramos como online quem está no servidor conectado."
              : "Entre em um servidor para ver quem está por lá.",
          ]
        : [
            <UserPlus key="a" />,
            "Seu círculo começa aqui",
            "Adicione amigos pelo ID e converse ou ligue quando estiverem no mesmo servidor.",
          ];
  return (
    <div className="friends-empty">
      <span className="friends-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {!searching && tab !== "pending" && !hasFriends && (
        <button className="primary" onClick={onAdd}>
          <UserPlus size={16} aria-hidden="true" /> Adicionar amigo
        </button>
      )}
    </div>
  );
}
