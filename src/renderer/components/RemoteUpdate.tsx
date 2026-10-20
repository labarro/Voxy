import { useEffect, useState } from "react";
import type { RemoteUpdateState } from "../../shared/types";
import { Download, RefreshCw, RotateCw } from "lucide-react";
const labels: Record<RemoteUpdateState["phase"], string> = {
  disabled: "Atualizações remotas indisponíveis",
  idle: "Verificação automática ao iniciar",
  checking: "Verificando atualizações…",
  available: "Nova versão disponível",
  downloading: "Baixando atualização…",
  ready: "Atualização pronta para instalar",
  installing: "Reiniciando para atualizar…",
  error: "Não foi possível atualizar",
  "up-to-date": "Você está na versão mais recente",
};
export function RemoteUpdate({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<RemoteUpdateState>({ phase: "idle" }),
    [error, setError] = useState("");
  useEffect(() => {
    void window.voxy
      .remoteUpdateState()
      .then(setState)
      .catch((e) => setError(e.message));
    return window.voxy.onEvent((event) => {
      if (event.type === "remote-update") setState(event.state);
    });
  }, []);
  async function act(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (
    compact &&
    !["available", "downloading", "ready", "installing"].includes(state.phase)
  )
    return null;
  return (
    <section
      className={compact ? "remote-update-banner" : "remote-update-panel"}
      aria-live="polite"
    >
      <div>
        <strong>
          {labels[state.phase]}
          {state.version ? " · Voxy " + state.version : ""}
        </strong>
        {state.phase === "downloading" && (
          <>
            <progress max="100" value={state.percent ?? 0} />
            <small>
              {Math.round(state.percent ?? 0)}%
              {state.bytesPerSecond
                ? " · " + Math.round(state.bytesPerSecond / 1024) + " KB/s"
                : ""}
            </small>
          </>
        )}
        {(state.message || error) && (
          <p className="hint" role={error ? "alert" : undefined}>
            {error || state.message}
          </p>
        )}
        {state.phase === "ready" && !compact && (
          <p className="hint">
            Reiniciar encerra a chamada e, se você hospeda, a sala. Um backup
            será criado antes de instalar.
          </p>
        )}
      </div>
      <div className="remote-update-actions">
        {state.phase === "ready" ? (
          <button
            className="primary"
            onClick={() => void act(() => window.voxy.installRemoteUpdate())}
          >
            <RotateCw size={16} />
            Reiniciar e atualizar
          </button>
        ) : state.phase === "available" ||
          (state.phase === "error" && state.version) ? (
          <button
            className="secondary"
            onClick={() => void act(() => window.voxy.downloadRemoteUpdate())}
          >
            <Download size={16} />
            Baixar atualização
          </button>
        ) : !["disabled", "checking", "downloading", "installing"].includes(
            state.phase,
          ) && !compact ? (
          <button
            className="secondary"
            onClick={() => void act(() => window.voxy.checkRemoteUpdate())}
          >
            <RefreshCw size={16} />
            Verificar atualizações
          </button>
        ) : null}
        {!compact && state.phase === "error" && (
          <button
            onClick={() => void act(() => window.voxy.checkRemoteUpdate())}
          >
            Verificar novamente
          </button>
        )}
      </div>
    </section>
  );
}
