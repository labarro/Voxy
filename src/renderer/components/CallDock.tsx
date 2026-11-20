import {
  HeadphoneOff,
  Headphones,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Settings,
  SwitchCamera,
  Video,
  VideoOff,
} from "lucide-react";
import { qualities, type Quality } from "../../services/webrtc/engine";
import { ParticipantStatus } from "./ParticipantStatus";

/**
 * Floating call dock (native 2.0 layout): microphone and deafen | camera and
 * screen | settings | leave. Only presentation; every action is the same
 * handler the 1.4 call controls used.
 */
export function CallDock({
  busy,
  muted,
  deafened,
  microphoneState,
  speaking,
  cameraActive,
  sharing,
  quality,
  onMute,
  onDeafen,
  onCamera,
  onSwitchCamera,
  onShare,
  onQuality,
  onSettings,
  onLeave,
}: {
  busy: boolean;
  muted: boolean;
  deafened: boolean;
  microphoneState?: "muted" | "ptt-waiting" | "active";
  speaking: boolean;
  cameraActive: boolean;
  sharing: boolean;
  quality: Quality;
  onMute: () => void;
  onDeafen: () => void;
  onCamera: () => void;
  onSwitchCamera: () => void;
  onShare: () => void;
  onQuality: (quality: Quality) => void;
  onSettings: () => void;
  onLeave: () => void;
}) {
  const micLabel = muted ? "Ativar microfone" : "Mutar microfone";
  const deafLabel = deafened ? "Desativar Deafen" : "Silenciar áudio";
  const camLabel = cameraActive ? "Desligar câmera" : "Ativar câmera";
  const shareLabel = sharing ? "Parar transmissão" : "Compartilhar tela";
  return (
    <div className="call-controls call-dock" role="toolbar" aria-label="Controles da chamada">
      <div className="dock-group">
        <button
          className={"control " + (muted || deafened ? "muted is-alert" : "")}
          disabled={deafened}
          aria-pressed={muted || deafened}
          title={micLabel}
          aria-label={micLabel}
          onClick={onMute}
        >
          <ParticipantStatus
            muted={muted || deafened}
            deafened={false}
            showMicrophone
            microphoneState={microphoneState}
            speaking={speaking}
          />
        </button>
        <button
          className={"control " + (deafened ? "is-alert" : "")}
          title={deafLabel}
          aria-label={deafLabel}
          aria-pressed={deafened}
          onClick={onDeafen}
        >
          {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
        </button>
      </div>
      <div className="dock-group">
        <button
          className={"control " + (cameraActive ? "camera-on is-active" : "")}
          title={camLabel}
          aria-label={camLabel}
          aria-pressed={cameraActive}
          disabled={busy}
          onClick={onCamera}
        >
          {cameraActive ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
        {cameraActive && (
          <button
            className="control"
            title="Trocar câmera"
            aria-label="Trocar câmera"
            disabled={busy}
            onClick={onSwitchCamera}
          >
            <SwitchCamera size={20} />
          </button>
        )}
        <button
          className={
            "control share-control " + (sharing ? "sharing is-live" : "")
          }
          title={shareLabel}
          aria-label={shareLabel}
          aria-pressed={sharing}
          disabled={busy}
          onClick={onShare}
        >
          {sharing ? <MonitorX size={20} /> : <MonitorUp size={20} />}
        </button>
        {sharing && (
          <select
            className="dock-quality"
            aria-label="Qualidade da transmissão"
            value={quality}
            onChange={(e) => onQuality(e.target.value as Quality)}
          >
            {Object.entries(qualities).map(([id, q]) => (
              <option key={id} value={id}>
                {q.height}p · {q.fps} FPS
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="dock-group">
        <button
          className="control"
          title="Configurações de áudio e vídeo"
          aria-label="Configurações de áudio e vídeo"
          onClick={onSettings}
        >
          <Settings size={20} />
        </button>
      </div>
      <button
        className="control hangup"
        title="Sair do canal de voz"
        aria-label="Sair do canal de voz"
        onClick={onLeave}
      >
        <PhoneOff size={20} />
      </button>
    </div>
  );
}
