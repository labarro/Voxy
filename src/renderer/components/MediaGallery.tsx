import { useEffect, useRef, useState } from "react";
import type { Participant, Profile } from "../../shared/types";
import type { VoiceView } from "../../services/webrtc/engine";
import { Player } from "./Player";
export function MediaGallery({
  participants,
  selfId,
  media,
  profile,
  deafened,
  focus,
  onFocus,
  onViewing,
  onVolume,
  background = false,
}: {
  participants: Participant[];
  selfId: string;
  media: VoiceView;
  profile: Profile;
  deafened: boolean;
  focus: string | null;
  onFocus: (key: string | null) => void;
  onViewing: (screens: string[], cameras: string[]) => void;
  onVolume: (id: string, value: number) => void;
  background?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [visible, setVisible] = useState(!document.hidden);
  const callbacks = useRef({ onViewing, onFocus });
  callbacks.current = { onViewing, onFocus };
  const sources = participants.flatMap((p) => [
    ...(p.sharing
      ? [{ key: "screen:" + p.id, kind: "screen" as const, p }]
      : []),
    ...(p.camera
      ? [{ key: "camera:" + p.id, kind: "camera" as const, p }]
      : []),
  ]);
  const expanded = focus && sources.some((s) => s.key === focus) ? focus : null;
  const shown = sources.filter(
    (s) =>
      visible &&
      !background &&
      (expanded ? s.key === expanded : !hidden.has(s.key)),
  );
  const screens = shown
    .filter((s) => s.kind === "screen" && s.p.id !== selfId)
    .map((s) => s.p.id)
    .sort()
    .join(",");
  const cameras = shown
    .filter((s) => s.kind === "camera" && s.p.id !== selfId)
    .map((s) => s.p.id)
    .sort()
    .join(",");
  useEffect(() => {
    callbacks.current.onViewing(
      screens ? screens.split(",") : [],
      cameras ? cameras.split(",") : [],
    );
  }, [screens, cameras]);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => {
      document.removeEventListener("visibilitychange", change);
      callbacks.current.onViewing([], []);
    };
  }, []);
  if (!sources.length) return null;
  return (
    <section className="media-gallery" aria-label="Transmissões e câmeras">
      <div className="gallery-toolbar">
        <strong>{sources.length} fontes ao vivo</strong>
        {expanded && (
          <button onClick={() => onFocus(null)}>Voltar à grade</button>
        )}
        {hidden.size > 0 && (
          <button onClick={() => setHidden(new Set())}>Mostrar todas</button>
        )}
      </div>
      <div
        className={"media-grid " + (expanded ? "expanded" : "")}
        data-count={shown.length}
      >
        {shown.map(({ p, kind, key }) => (
          <Player
            key={key}
            stream={
              kind === "camera"
                ? p.id === selfId
                  ? media.localCamera
                  : media.cameraStreams?.get(p.id)
                : p.id === selfId
                  ? media.local
                  : media.streams.get(p.id)
            }
            name={p.profile.name}
            kind={kind}
            local={p.id === selfId}
            deafened={deafened}
            output={profile.output}
            volume={profile.streamVolumes?.[p.profile.id] ?? 1}
            onVolume={(v) => onVolume(p.id, v)}
            expand={() => onFocus(expanded ? null : key)}
            close={() => {
              setHidden((v) => new Set([...v, key]));
              if (expanded) onFocus(null);
            }}
          />
        ))}
      </div>
      {(!visible || background) && (
        <p className="hint">
          Vídeos pausados enquanto o aplicativo está minimizado.
        </p>
      )}
    </section>
  );
}
