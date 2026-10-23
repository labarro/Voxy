import { Mic, MicOff, HeadphoneOff, VolumeX, Keyboard } from "lucide-react";

export function ParticipantStatus({
  muted,
  deafened,
  showMicrophone = false,
  locallyMuted = false,
  microphoneState,
  speaking = false,
}: {
  muted: boolean;
  deafened: boolean;
  showMicrophone?: boolean;
  locallyMuted?: boolean;
  microphoneState?: "muted" | "ptt-waiting" | "active";
  speaking?: boolean;
}) {
  const waiting = microphoneState === "ptt-waiting";
  const silenced = microphoneState ? microphoneState === "muted" : muted;
  const label = waiting
    ? "Push-to-Talk aguardando ativação"
    : silenced
      ? "Microfone mutado"
      : speaking
        ? "Falando"
        : "Microfone ativo";
  if (
    !muted &&
    !deafened &&
    !showMicrophone &&
    !locallyMuted &&
    !waiting &&
    !speaking
  )
    return null;
  return (
    <span className="participant-status">
      {(muted || showMicrophone || waiting || speaking) && (
        <span
          className={
            waiting ? "ptt-waiting" : speaking && !silenced ? "ptt-open" : ""
          }
          role="img"
          aria-label={label}
          title={label}
        >
          {waiting ? (
            <Keyboard size={15} aria-hidden="true" />
          ) : silenced ? (
            <MicOff size={15} aria-hidden="true" />
          ) : (
            <Mic size={15} aria-hidden="true" />
          )}
        </span>
      )}
      {deafened && (
        <span
          role="img"
          aria-label="Áudio silenciado"
          title="Áudio silenciado: este participante não está ouvindo a chamada"
        >
          <HeadphoneOff size={15} aria-hidden="true" />
        </span>
      )}
      {locallyMuted && (
        <span
          className="local-muted"
          role="img"
          aria-label="Voz mutada só para você"
          title="Voz mutada só para você"
        >
          <VolumeX size={15} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
