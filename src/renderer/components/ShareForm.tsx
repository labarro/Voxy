import type { Source } from "../../shared/types";
import { qualities, type Quality } from "../../services/webrtc/engine";
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
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onShare();
      }}
    >
      <p>Escolha o que seus amigos vão ver.</p>
      <div className="source-grid">
        {sources.map((s) => (
          <button
            type="button"
            className={"source " + (s.id === source ? "chosen" : "")}
            key={s.id}
            onClick={() => setSource(s.id)}
          >
            <img src={s.thumbnail} alt="" />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      {!sources.length && (
        <p>Nenhuma fonte disponível. Abra uma janela e tente novamente.</p>
      )}
      <label>
        Qualidade
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as Quality)}
        >
          {Object.entries(qualities).map(([id, q]) => (
            <option key={id} value={id}>
              {q.height}p / {q.fps} FPS · até {q.bitrate / 1000000} Mbps por
              amigo
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={systemAudio}
          onChange={(e) => setSystemAudio(e.target.checked)}
        />{" "}
        Incluir áudio do sistema (Windows)
      </label>
      <small>
        Captura o áudio de todo o sistema, inclusive vozes reproduzidas. Use
        fones; desative se houver eco. FPS e resolução dependem do hardware.
      </small>
      <button className="primary" disabled={busy || !source}>
        {busy ? "Iniciando captura…" : "Iniciar transmissão"}
      </button>
    </form>
  );
}
