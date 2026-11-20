import type { Source } from "../../shared/types";
import { useEffect, useState } from "react";
import { AppWindow, Check, Monitor, Volume2 } from "lucide-react";
import { qualities, type Quality } from "../../services/webrtc/engine";

/** "Partida - Jogo" → app "Jogo", title "Partida". Presentation only. */
export function describeSource(s: Source) {
  if (s.id.startsWith("screen:")) {
    const index = Number(s.id.split(":")[1]);
    return {
      kind: "screen" as const,
      app: /^(entire screen|screen \d+|tela)/i.test(s.name)
        ? "Tela " + (Number.isFinite(index) ? index + 1 : "")
        : s.name,
      title: s.display ?? "Monitor",
    };
  }
  const parts = s.name.split(/\s[-—–|]\s/);
  return parts.length > 1
    ? {
        kind: "window" as const,
        app: parts[parts.length - 1].trim(),
        title: parts.slice(0, -1).join(" - ").trim(),
      }
    : { kind: "window" as const, app: s.name, title: "Janela" };
}

export function ShareForm({
  sources,
  source,
  setSource,
  quality,
  setQuality,
  systemAudio,
  setSystemAudio,
  busy,
  onShare,
  onCancel,
}: {
  sources: Source[];
  source: string;
  setSource: (id: string) => void;
  quality: Quality;
  setQuality: (quality: Quality) => void;
  systemAudio: boolean;
  setSystemAudio: (value: boolean) => void;
  busy: boolean;
  onShare: () => void;
  onCancel?: () => void;
}) {
  const [audioAvailable, setAudioAvailable] = useState(false);
  const windows = sources.filter((s) => !s.id.startsWith("screen:"));
  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  const [tab, setTab] = useState<"window" | "screen">(() =>
    source.startsWith("screen:") || !windows.length ? "screen" : "window",
  );
  useEffect(() => {
    let disposed = false;
    void window.voxy
      .captureAudioAvailable()
      .then((available) => {
        if (!disposed) {
          setAudioAvailable(available);
          if (!available) setSystemAudio(false);
        }
      })
      .catch(() => {
        if (!disposed) setSystemAudio(false);
      });
    return () => {
      disposed = true;
    };
  }, [setSystemAudio]);
  const list = tab === "screen" ? screens : windows;
  return (
    <form
      className="share-form"
      onSubmit={(e) => {
        e.preventDefault();
        onShare();
      }}
    >
      <div className="share-tabs" role="tablist" aria-label="Tipo de fonte">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "window"}
          onClick={() => setTab("window")}
        >
          <AppWindow size={16} /> Aplicativos <span>{windows.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "screen"}
          onClick={() => setTab("screen")}
        >
          <Monitor size={16} /> Telas <span>{screens.length}</span>
        </button>
      </div>
      <div className="source-grid" role="listbox" aria-label="Fontes de captura">
        {list.map((s) => {
          const d = describeSource(s);
          const chosen = s.id === source;
          return (
            <button
              type="button"
              role="option"
              aria-selected={chosen}
              className={"source " + (chosen ? "chosen" : "")}
              key={s.id}
              title={s.name}
              onClick={() => setSource(s.id)}
              onDoubleClick={() => !busy && onShare()}
            >
              <span className="source-thumb">
                <img src={s.thumbnail} alt="" draggable={false} />
                {chosen && (
                  <span className="source-check" aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="source-copy">
                <span className="source-app">
                  {d.kind === "screen" ? (
                    <Monitor size={14} aria-hidden="true" />
                  ) : (
                    <AppWindow size={14} aria-hidden="true" />
                  )}
                  <strong>{d.app}</strong>
                </span>
                <span className="source-title">{d.title}</span>
              </span>
            </button>
          );
        })}
        {!list.length && (
          <p className="source-empty">
            {tab === "screen"
              ? "Nenhuma tela disponível."
              : "Nenhuma janela aberta para compartilhar. Abra o aplicativo e tente novamente."}
          </p>
        )}
      </div>
      <div className="share-options">
        <fieldset className="share-quality">
          <legend>Qualidade</legend>
          <div className="segmented" role="radiogroup" aria-label="Qualidade">
            {Object.entries(qualities).map(([id, q]) => (
              <button
                type="button"
                role="radio"
                aria-checked={quality === id}
                key={id}
                title={`até ${q.bitrate / 1000000} Mbps por amigo`}
                onClick={() => setQuality(id as Quality)}
              >
                <strong>{q.height}p</strong>
                <small>{q.fps} FPS</small>
              </button>
            ))}
          </div>
          <small>
            {qualities[quality].width} × {qualities[quality].height} ·{" "}
            {qualities[quality].fps} FPS · até{" "}
            {qualities[quality].bitrate / 1000000} Mbps por amigo. FPS e
            resolução dependem do hardware.
          </small>
        </fieldset>
        <label className={"share-audio switch-row " + (audioAvailable ? "" : "disabled")}>
          <span className="switch-copy">
            <strong>
              <Volume2 size={15} aria-hidden="true" /> Incluir áudio do
              computador sem o Voxy
            </strong>
            <small>
              {audioAvailable
                ? "Jogos, navegadores e outros sons; exclui o áudio do Voxy e a chamada. Escolher uma janela limita somente o vídeo."
                : "Áudio seguro indisponível neste sistema (requer Windows 11, build 20348+). Compartilhe somente o vídeo."}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={systemAudio}
            disabled={!audioAvailable}
            onChange={(e) => setSystemAudio(e.target.checked)}
          />
        </label>
      </div>
      <footer className="dialog-actions">
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="primary" disabled={busy || !source}>
          {busy ? "Iniciando captura…" : "Iniciar transmissão"}
        </button>
      </footer>
    </form>
  );
}
