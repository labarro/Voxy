import { useEffect, useRef, useState } from "react";
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
      if (cache.size > 40) cache.delete(cache.keys().next().value!);
    }
    promise
      .then((value) => {
        if (alive) setUrl(value);
      })
      .catch(() => {
        cache.delete(cacheKey);
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
export function Chat({
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
}: {
  readOnly?: boolean;
  directScope?: string;
  channelId: string;
  name: string;
  messages: Message[];
  busy: boolean;
  onSend: (text: string, image?: string) => Promise<void>;
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
  const [text, setText] = useState(""),
    [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);
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
      <div className="message-list">
        <div className="chat-intro">
          <div className="intro-icon">
            {directScope ? <MessageCircle size={32} /> : <Hash size={32} />}
          </div>
          <h1>
            {directScope ? "Sua conversa com " + name : "Este é o #" + name}
          </h1>
          <p>O começo da conversa de vocês.</p>
        </div>
        {messages.map((m) => (
          <article className="message" key={m.id}>
            <Avatar avatar={m.avatar} />
            <div>
              <div>
                <strong>{m.name}</strong>
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
              {m.text && <p>{m.text}</p>}
              {m.imageId && <MessageImage id={m.imageId} scope={directScope} />}
            </div>
          </article>
        ))}
        <div ref={end} />
      </div>
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
            await onSend(text.trim(), image || undefined);
            setText("");
            setImage("");
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
          onChange={(e) => setText(e.target.value)}
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
