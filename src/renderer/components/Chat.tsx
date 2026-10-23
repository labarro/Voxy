import type { Participant } from "../../shared/types";
import { useChatHistory } from "../hooks/useChatHistory";
import { MessageText } from "./MessageText";
import { memo, useEffect, useRef, useState } from "react";
import {
  Hash,
  MessageCircle,
  ImagePlus,
  Send,
  X,
  Maximize,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Message } from "../../shared/types";
import { MAX_IMAGE_BYTES } from "../../shared/constants";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";
const cache = new Map<string, Promise<string>>();
const cacheSizes = new Map<string, number>();
function evictImage(key: string) {
  cache.delete(key);
  cacheSizes.delete(key);
}
function MessageImage({ id, scope }: { id: string; scope?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="image-container">
      {visible ? (
        <LoadedImage id={id} scope={scope} />
      ) : (
        <p className="hint">Imagem do chat</p>
      )}
    </div>
  );
}
function LoadedImage({ id, scope }: { id: string; scope?: string }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [large, setLarge] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    const cacheKey = (scope ?? "public") + ":" + id;
    let promise = cache.get(cacheKey);
    if (!promise) {
      promise = scope
        ? window.voxy.directImage(id, scope)
        : window.voxy.image(id);
      cache.set(cacheKey, promise);
      if (cache.size > 24) evictImage(cache.keys().next().value!);
      void promise
        .then((value) => {
          if (cache.get(cacheKey) !== promise) return;
          cacheSizes.set(cacheKey, value.length * 2);
          let bytes = [...cacheSizes.values()].reduce((a, b) => a + b, 0);
          while (bytes > 12 * 1024 * 1024 && cache.size) {
            const oldest = cache.keys().next().value!;
            bytes -= cacheSizes.get(oldest) || 0;
            evictImage(oldest);
          }
        })
        .catch(() => {});
    }
    promise
      .then((value) => {
        if (alive) setUrl(value);
      })
      .catch(() => {
        evictImage(cacheKey);
        if (alive) setError("Não foi possível carregar a imagem.");
      });
    return () => {
      alive = false;
    };
  }, [id, scope, retry]);
  if (error)
    return (
      <button type="button" onClick={() => setRetry((v) => v + 1)}>
        {error} Tentar novamente
      </button>
    );
  if (!url) return <p className="hint">Carregando imagem…</p>;
  return (
    <>
      <button
        type="button"
        className="chat-image"
        title="Ampliar imagem"
        aria-label="Ampliar imagem"
        onClick={() => setLarge(true)}
      >
        <img src={url} alt="Imagem enviada no chat" loading="lazy" />
        <Maximize size={16} />
      </button>
      {large && (
        <Modal title="Imagem do chat" close={() => setLarge(false)}>
          <img className="expanded-image" src={url} alt="Imagem ampliada" />
        </Modal>
      )}
    </>
  );
}
function ChatView({
  channelId,
  name,
  messages,
  busy,
  onSend,
  authorId,
  onEdit,
  onDelete,
  readOnly = false,
  directScope,
  nameColor,
  onProfile,
  profiles,
  onReact,
}: {
  nameColor?: (id: string) => string | undefined;
  onProfile?: (id: string, x: number, y: number) => void;
  profiles?: Record<string, Participant["profile"]>;
  onReact?: (id: string, emoji: string) => Promise<void>;
  readOnly?: boolean;
  directScope?: string;
  channelId: string;
  name: string;
  messages: Message[];
  busy: boolean;
  onSend: (text: string, image?: string, replyTo?: string) => Promise<void>;
  authorId: string;
  onEdit: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [action, setAction] = useState<{
    kind: "edit" | "delete";
    message: Message;
  } | null>(null);
  const [editText, setEditText] = useState("");
  const [actionError, setActionError] = useState("");
  const [changing, setChanging] = useState(false);
  const [reply, setReply] = useState<Message | null>(null);
  const [reacting, setReacting] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [hideMentions, setHideMentions] = useState(false);
  const composer = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(""),
    [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const history = useChatHistory(messages, channelId, directScope);
  const mention = text.match(/(?:^|\s)@([^@\s{}]{0,60})$/);
  const suggestions =
    mention && !hideMentions
      ? Object.values(profiles || {})
          .filter((p) =>
            p.name.toLocaleLowerCase().includes(mention[1].toLocaleLowerCase()),
          )
          .slice(0, 6)
      : [];
  function insertMention(id: string) {
    if (!mention) return;
    setText(
      text.slice(0, text.length - mention[1].length - 1) + "@{" + id + "} ",
    );
    setMentionIndex(0);
    composer.current?.focus();
  }
  async function react(id: string, emoji: string) {
    try {
      await onReact?.(id, emoji);
      setReacting(null);
      await history.refresh(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function choose(file?: File) {
    if (!file) return;
    setError("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > MAX_IMAGE_BYTES
    ) {
      setError("Escolha PNG, JPEG ou WebP com até 2 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const ok =
        bitmap.width <= 8192 &&
        bitmap.height <= 8192 &&
        bitmap.width * bitmap.height <= 24000000;
      bitmap.close();
      if (!ok) throw Error("Imagem maior que 8192 px / 24 megapixels.");
      const reader = new FileReader();
      const url = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setImage(url);
    } catch (e) {
      setError(
        e instanceof DOMException
          ? "Não foi possível abrir esta imagem. Escolha outro arquivo PNG, JPEG ou WebP."
          : (e as Error).message || "Imagem inválida.",
      );
    }
  }
  return (
    <>
      <form
        className="history-search"
        onSubmit={(e) => {
          e.preventDefault();
          void history.find();
        }}
      >
        <input
          aria-label="Buscar no histórico"
          placeholder="Buscar mensagens antigas"
          maxLength={100}
          value={history.search}
          onChange={(e) => history.setSearch(e.target.value)}
        />
        <button disabled={history.loading || !history.search.trim()}>
          Buscar
        </button>
      </form>
      {history.results.length > 0 && (
        <div className="history-results" aria-label="Resultados da busca">
          <button onClick={() => history.setSearch("")}>Limpar busca</button>
          {history.results.map((m) => (
            <button key={m.id} onClick={() => void history.locate(m.id)}>
              <strong>{m.name}</strong>
              <span>{m.text.slice(0, 150) || "Imagem"}</span>
              <time>{new Date(m.time).toLocaleDateString("pt-BR")}</time>
            </button>
          ))}
        </div>
      )}
      {history.error && (
        <p role="alert" className="chat-error">
          {history.error}
        </p>
      )}
      {history.searched && !history.loading && history.results.length === 0 && (
        <p className="chat-error">Nenhuma mensagem encontrada.</p>
      )}
      <div
        className="message-list"
        ref={history.list}
        onScroll={history.onScroll}
      >
        <button
          className="load-history"
          disabled={history.loading || history.exhausted || readOnly}
          onClick={() => void history.older()}
        >
          {history.loading
            ? "Carregando…"
            : history.exhausted
              ? "Início do histórico"
              : "Carregar mensagens anteriores"}
        </button>
        <div className="chat-intro">
          <div className="intro-icon">
            {directScope ? <MessageCircle size={32} /> : <Hash size={32} />}
          </div>
          <h1>
            {directScope ? "Sua conversa com " + name : "Este é o #" + name}
          </h1>
          <p>O começo da conversa de vocês.</p>
        </div>
        {history.timeline.map((m) => (
          <article
            className={
              "message " +
              (m.text.includes("@{" + authorId + "}") ? "mentioned " : "") +
              (history.highlight === m.id ? "located" : "")
            }
            id={"message-" + m.id}
            key={m.id}
          >
            <Avatar avatar={m.avatar} />
            <div>
              <div>
                <button
                  type="button"
                  className="message-author"
                  style={{ color: nameColor?.(m.author) }}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    onProfile?.(m.author, r.left, r.bottom);
                  }}
                  onContextMenu={(e) => {
                    if (onProfile) {
                      e.preventDefault();
                      onProfile(m.author, e.clientX, e.clientY);
                    }
                  }}
                >
                  <strong>{profiles?.[m.author]?.name || m.name}</strong>
                </button>
                <time>
                  {new Date(m.time).toLocaleString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </time>
                {!!m.editedAt && (
                  <small className="edited-tag">(editada)</small>
                )}
                <span className="social-message-actions">
                  <button
                    title="Responder mensagem"
                    aria-label="Responder mensagem"
                    disabled={readOnly}
                    onClick={() => {
                      setReply(m);
                      composer.current?.focus();
                    }}
                  >
                    Responder
                  </button>
                  {onReact && (
                    <button
                      title="Reagir à mensagem"
                      aria-label="Reagir à mensagem"
                      disabled={readOnly}
                      onClick={() =>
                        setReacting(reacting === m.id ? null : m.id)
                      }
                    >
                      ☺
                    </button>
                  )}
                </span>
                {m.author === authorId && (
                  <span className="message-actions">
                    <button
                      title="Editar mensagem"
                      disabled={busy || readOnly}
                      onClick={() => {
                        setAction({ kind: "edit", message: m });
                        setEditText(m.text);
                        setActionError("");
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      title="Excluir mensagem"
                      disabled={busy || readOnly}
                      onClick={() => {
                        setAction({ kind: "delete", message: m });
                        setActionError("");
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                )}
              </div>
              {m.replyTo && (
                <button
                  className="reply-reference"
                  onClick={() => void history.locate(m.replyTo!)}
                >
                  ↳{" "}
                  {history.byId.get(m.replyTo)?.text.slice(0, 90) ||
                    "Ver mensagem original"}
                </button>
              )}
              {m.text && (
                <MessageText
                  text={m.text}
                  profiles={profiles}
                  onProfile={onProfile}
                />
              )}
              {m.imageId && <MessageImage id={m.imageId} scope={directScope} />}
              <div className="reactions">
                {Object.entries(m.reactions || {}).map(([emoji, members]) => (
                  <button
                    key={emoji}
                    aria-label={"Reação " + emoji + ", " + members.length}
                    aria-pressed={members.includes(authorId)}
                    disabled={readOnly || !onReact}
                    onClick={() => void react(m.id, emoji)}
                  >
                    {emoji} {members.length}
                  </button>
                ))}
                {reacting === m.id && (
                  <div className="emoji-picker" aria-label="Escolher reação">
                    {["👍", "❤️", "😂", "🎉", "👀", "😮", "😢", "🔥"].map(
                      (emoji) => (
                        <button
                          key={emoji}
                          title={"Reagir " + emoji}
                          aria-label={"Reagir " + emoji}
                          onClick={() => void react(m.id, emoji)}
                        >
                          {emoji}
                        </button>
                      ),
                    )}
                    <button onClick={() => setReacting(null)}>Fechar</button>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {history.newMessages > 0 && (
        <button className="new-messages" onClick={history.latest}>
          {history.newMessages} novas mensagens · Ir para recentes
        </button>
      )}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {image && (
        <div className="attachment-preview">
          <img src={image} alt="Prévia da imagem" />
          <button title="Remover imagem" onClick={() => setImage("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {reply && (
        <div className="reply-composer">
          <span>
            Respondendo a <strong>{reply.name}</strong>:{" "}
            {reply.text.slice(0, 90) || "Imagem"}
          </span>
          <button title="Cancelar resposta" onClick={() => setReply(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {!!suggestions.length && (
        <div
          className="mention-suggestions"
          role="listbox"
          aria-label="Mencionar usuário"
        >
          {suggestions.map((p, i) => (
            <button
              type="button"
              role="option"
              aria-label={"@" + p.name}
              aria-selected={i === mentionIndex % suggestions.length}
              key={p.id}
              onClick={() => insertMention(p.id)}
            >
              <Avatar avatar={p.avatar} className="mini-avatar" />@{p.name}
            </button>
          ))}
        </div>
      )}
      <form
        className="composer"
        onPaste={(e) => {
          if (readOnly) return;
          const file = Array.from(e.clipboardData.files).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) {
            e.preventDefault();
            void choose(file);
          }
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (readOnly || sending || (!text.trim() && !image)) return;
          setSending(true);
          setError("");
          try {
            await onSend(text.trim(), image || undefined, reply?.id);
            setText("");
            setImage("");
            setReply(null);
            history.latest();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSending(false);
          }
        }}
      >
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label="Arquivo de imagem"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          title="Enviar imagem"
          disabled={sending || busy || readOnly}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={21} />
        </button>
        <input
          aria-label="Mensagem"
          ref={composer}
          placeholder={
            readOnly
              ? "Reconecte à sala para enviar"
              : directScope
                ? "Mensagem para " + name
                : "Conversar em #" + name
          }
          disabled={readOnly}
          value={text}
          maxLength={4000}
          onChange={(e) => {
            setText(e.target.value);
            setHideMentions(false);
            setMentionIndex(0);
          }}
          onKeyDown={(e) => {
            if (!suggestions.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setMentionIndex(
                (i) =>
                  (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) %
                  suggestions.length,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              insertMention(suggestions[mentionIndex % suggestions.length].id);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setHideMentions(true);
            }
          }}
        />
        <button
          title="Enviar mensagem"
          disabled={busy || readOnly || sending || (!text.trim() && !image)}
        >
          <Send size={21} />
        </button>
      </form>
      {action && (
        <Modal
          title={
            action.kind === "edit" ? "Editar mensagem" : "Excluir mensagem"
          }
          close={() => {
            if (!changing) setAction(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (changing) return;
              setChanging(true);
              setActionError("");
              try {
                if (action.kind === "edit")
                  await onEdit(action.message.id, editText.trim());
                else await onDelete(action.message.id);
                await history.refresh(action.message.id);
                setAction(null);
              } catch (e) {
                setActionError((e as Error).message);
              } finally {
                setChanging(false);
              }
            }}
          >
            {action.kind === "edit" ? (
              <label>
                Texto da mensagem
                <textarea
                  aria-label="Texto da mensagem"
                  autoFocus
                  maxLength={4000}
                  rows={4}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                />
              </label>
            ) : (
              <p>
                Excluir esta mensagem
                {action.message.imageId ? " e sua imagem" : ""}? Esta ação não
                pode ser desfeita.
              </p>
            )}
            {actionError && (
              <p className="modal-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="message-dialog-actions">
              <button
                type="button"
                disabled={changing}
                onClick={() => setAction(null)}
              >
                Cancelar
              </button>
              <button
                className="primary"
                disabled={
                  changing ||
                  (action.kind === "edit" &&
                    !editText.trim() &&
                    !action.message.imageId)
                }
              >
                {changing
                  ? "Salvando…"
                  : action.kind === "edit"
                    ? "Salvar mensagem"
                    : "Confirmar exclusão"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export const Chat = memo(
  ChatView,
  (a, b) =>
    a.channelId === b.channelId &&
    a.name === b.name &&
    a.busy === b.busy &&
    a.readOnly === b.readOnly &&
    a.authorId === b.authorId &&
    a.directScope === b.directScope &&
    a.profiles === b.profiles &&
    a.messages.length === b.messages.length &&
    a.messages.every(
      (m, i) =>
        m === b.messages[i] &&
        a.nameColor?.(m.author) === b.nameColor?.(m.author),
    ),
);
