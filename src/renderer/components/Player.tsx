import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, X, Volume2, VolumeX, Focus } from "lucide-react";
export function Player({
  stream,
  name,
  local,
  deafened,
  output,
  close,
  volume = 1,
  onVolume = () => {},
  kind = "screen",
  expand,
}: {
  stream?: MediaStream;
  name: string;
  local: boolean;
  deafened: boolean;
  output: string;
  close: () => void;
  volume?: number;
  onVolume?: (value: number) => void;
  kind?: "screen" | "camera";
  expand?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function showHud() {
    setHudVisible(true);
    clearTimeout(hideTimer.current);
    if (document.fullscreenElement === container.current)
      hideTimer.current = setTimeout(() => setHudVisible(false), 2500);
  }
  useEffect(() => {
    showHud();
    return () => clearTimeout(hideTimer.current);
  }, [fullscreen]);
  const restoreVolume = useRef(1);
  if (volume > 0) restoreVolume.current = volume;
  useEffect(() => {
    const change = () =>
      setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const [ready, setReady] = useState(false),
    [fit, setFit] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    setReady(false);
    setError("");
    const el = video.current!;
    el.srcObject = stream ?? null;
    if (stream)
      void el.play().catch(() => setError("Clique no player para reproduzir."));
    const timer = setTimeout(() => {
      if (el.readyState < 2)
        setError("Sem quadros de vídeo. Confira o diagnóstico de conexão.");
    }, 15000);
    return () => {
      clearTimeout(timer);
      el.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    const el = video.current as HTMLVideoElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (!output && !el?.sinkId) return;
    if (el?.setSinkId)
      void el
        .setSinkId(output)
        .catch(() => setError("Não foi possível usar a saída selecionada."));
  }, [output]);
  return (
    <section
      data-kind={kind}
      aria-label={(kind === "camera" ? "Câmera de " : "Tela de ") + name}
      className={
        "player " +
        (fullscreen ? "is-fullscreen " : "") +
        (fullscreen && !hudVisible ? "hud-hidden" : "")
      }
      ref={container}
      onPointerMove={showHud}
      onPointerDown={showHud}
      onKeyDown={showHud}
    >
      <div className="player-head">
        <span>
          <i className="live-dot" /> {kind === "camera" ? "Câmera" : "Tela"} de{" "}
          {name}
          {local ? " (sua prévia)" : ""}
        </span>
        <div>
          {expand && (
            <button title="Ampliar ou voltar à grade" onClick={expand}>
              <Focus size={18} />
            </button>
          )}
          <button
            title={fit ? "Preencher player" : "Ajustar à janela"}
            onClick={() => setFit(!fit)}
          >
            <Minimize size={18} />
          </button>
          <button
            title="Tela cheia"
            onClick={() => {
              if (document.fullscreenElement) {
                void document.exitFullscreen();
                return;
              }
              void container.current
                ?.requestFullscreen()
                .catch(() => setError("Tela cheia indisponível."));
            }}
          >
            <Maximize size={18} />
          </button>
          <button title="Fechar visualização" onClick={close}>
            <X size={18} />
          </button>
        </div>
      </div>
      {!local && kind === "screen" && (
        <div className="stream-audio">
          <button
            title={
              volume === 0
                ? "Ativar áudio da transmissão"
                : "Silenciar transmissão"
            }
            onClick={() => onVolume(volume === 0 ? restoreVolume.current : 0)}
          >
            {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <label>
            Áudio da transmissão
            <input
              aria-label="Volume da transmissão"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
            />
          </label>
          <span>{Math.round(volume * 100)}%</span>
        </div>
      )}
      <div className="video-wrap">
        <video
          ref={video}
          autoPlay
          playsInline
          muted={kind === "camera" || local || deafened}
          style={{ objectFit: fit ? "contain" : "cover" }}
          onLoadedData={() => {
            setReady(true);
            setError("");
          }}
          onClick={() => {
            expand?.();
            void video.current?.play().then(() => setError(""));
          }}
        />
        {!ready && (
          <p className="loading">Aguardando quadros da transmissão…</p>
        )}
        {error && <p className="player-error">{error}</p>}
      </div>
    </section>
  );
}
