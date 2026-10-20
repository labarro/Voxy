import { Mic, MicOff, HeadphoneOff, VolumeX } from "lucide-react";

export function ParticipantStatus({
  muted,
  deafened,
  showMicrophone = false,
  locallyMuted = false,
}: {
  muted: boolean;
  deafened: boolean;
  showMicrophone?: boolean;
  locallyMuted?: boolean;
}) {
  if (!muted && !deafened && !showMicrophone && !locallyMuted) return null;
  return (
    <span className="participant-status">
      {(muted || showMicrophone) && (
        <span
          role="img"
          aria-label={muted ? "Microfone mutado" : "Microfone ativo"}
          title={muted ? "Microfone mutado" : "Microfone ativo"}
        >
          {muted ? (
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
