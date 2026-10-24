import { useState } from "react";
import type { NotificationState } from "../../shared/types";
export function NotificationCenter({ state }: { state: NotificationState }) {
  const [error, setError] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const unread = state.items.filter((n) => !n.read).length;
  async function action(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section
      className="notification-center"
      aria-label="Central de notificações"
    >
      <div className="notification-toolbar">
        <div>
          <h1>Notificações</h1>
          <p>{unread} não lidas · histórico local</p>
        </div>
        <button
          disabled={!unread}
          onClick={() => void action(() => window.voxy.readNotification())}
        >
          Marcar todas como lidas
        </button>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={onlyUnread}
          onChange={(e) => setOnlyUnread(e.target.checked)}
        />
        Somente não lidas
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="notification-list">
        {state.items
          .filter((n) => !onlyUnread || !n.read)
          .map((n) => (
            <article
              key={n.id}
              className={n.read ? "notification read" : "notification unread"}
            >
              <button
                className="notification-target"
                onClick={() =>
                  void action(() => window.voxy.openNotification(n.id))
                }
              >
                <strong>{n.title}</strong>
                <span>{n.body.replace(/@\{[a-f0-9-]{36}\}/gi, "@você")}</span>
                <small>
                  {new Date(n.time).toLocaleString()} ·{" "}
                  {n.read ? "Lida" : "Não lida"}
                </small>
              </button>
              {!n.read && (
                <button
                  onClick={() =>
                    void action(() => window.voxy.readNotification(n.id))
                  }
                >
                  Marcar como lida
                </button>
              )}
            </article>
          ))}
      </div>
      {!state.items.length && (
        <p className="hint">
          Menções, respostas, mensagens privadas e amizades aparecerão aqui.
        </p>
      )}
    </section>
  );
}
