import { useEffect, useRef, useState } from "react";
import type {
  Command,
  Participant,
  Profile,
  RoomPose,
  RoomPreset,
} from "../../shared/types";
import type { VoiceEngine, VoiceView } from "../../services/webrtc/engine";
import { defaultRoomSettings, spatialVoice } from "../../shared/room3d";
import { spawnPose } from "../../shared/room3d";
import { SocialScene } from "./scene";

export default function RoomView({
  preset,
  selfId,
  people,
  profile,
  media,
  engine,
  command,
  fallback,
  focus,
  paused,
  onSource,
  sourceId,
}: {
  preset: RoomPreset;
  selfId: string;
  people: Participant[];
  profile: Profile;
  media: VoiceView;
  engine: VoiceEngine;
  command: (c: Command) => Promise<unknown>;
  fallback: (message: string) => void;
  focus: (id: string) => void;
  paused: boolean;
  onSource: (id: string | null) => void;
  sourceId?: string;
}) {
  const mount = useRef<HTMLDivElement>(null),
    scene = useRef<SocialScene | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [occupancy, setOccupancy] = useState(1);
  const settings = profile.room3d ?? defaultRoomSettings;
  // The host resolves a single source for every viewer in the channel.
  const sources = people
    .filter((p) => p.sharing)
    .sort((a, b) => a.profile.id.localeCompare(b.profile.id));
  const source = sources.find((p) => p.id === sourceId) ?? sources[0];
  useEffect(() => {
    onSource(source?.id ?? null);
    return () => onSource(null);
  }, [source?.id, onSource]);
  const stream = source
    ? source.id === selfId
      ? media.local
      : media.streams.get(source.id)
    : undefined;
  const current = useRef({
    people,
    settings,
    stream,
    media,
    command,
    fallback,
    paused,
  });
  current.current = {
    people,
    settings,
    stream,
    media,
    command,
    fallback,
    paused,
  };
  useEffect(() => {
    const data = () => ({
      people: current.current.people,
      settings: current.current.settings,
      stream: current.current.stream,
      speaking: current.current.media.speaking,
      paused: current.current.paused,
    });
    let active = true;
    let listener = spawnPose(),
      cameraYaw = 0;
    const applyAudio = () => {
      const c = current.current,
        mix = new Map<string, { gain: number; pan: number }>();
      if (c.settings.proximity)
        for (const p of c.people)
          if (p.id !== selfId && p.roomPose) {
            const value = spatialVoice(
              listener,
              p.roomPose,
              c.settings.range,
              cameraYaw,
            );
            mix.set(p.id, {
              gain: value.gain * c.settings.volume,
              pan: value.pan,
            });
          }
      engine.setSpatialMix(mix);
    };
    try {
      const view = new SocialScene(
        mount.current!,
        preset,
        selfId,
        data(),
        async (pose) => {
          try {
            await current.current.command({ type: "room.pose", pose });
            setNotice("");
          } catch (e) {
            if (active)
              setNotice(
                e instanceof Error ? e.message : "Movimento indisponível.",
              );
            throw e;
          }
        },
        (pose: RoomPose, yaw: number) => {
          listener = { ...pose };
          cameraYaw = yaw;
        },
        (message) => {
          if (active) current.current.fallback(message);
        },
      );
      scene.current = view;
      const timer = setInterval(() => {
        view.update(data());
        applyAudio();
        setOccupancy(
          current.current.people.filter((p) => p.roomPose || p.id === selfId)
            .length,
        );
      }, 100);
      return () => {
        active = false;
        clearInterval(timer);
        scene.current = undefined;
        view.dispose();
        engine.setSpatialMix(new Map());
        void current.current
          .command({ type: "room.pose", pose: null })
          .catch(() => {});
      };
    } catch {
      current.current.fallback(
        "Não foi possível iniciar o 3D. Verifique a aceleração gráfica ou use o modo tradicional.",
      );
    }
    return () => {
      active = false;
      engine.setSpatialMix(new Map());
    };
  }, [preset, selfId, engine]);
  return (
    <section
      className="room3d"
      aria-label={preset === "lounge" ? "Lounge 3D" : "Cinema 3D"}
    >
      <div className="room3d-canvas" ref={mount} />
      <div className="room3d-top">
        <span>
          {preset === "lounge" ? "Lounge" : "Cinema"} · {occupancy} no ambiente
        </span>
        <button onClick={() => scene.current?.interact()}>
          Sentar / levantar (E)
        </button>
      </div>
      <div className="room3d-help">
        Clique na sala · WASD / setas: andar · Arrastar: câmera · Roda: zoom
      </div>
      <div className="room3d-tv">
        {source ? (
          <>
            <label>
              TV{" "}
              <select
                aria-label="Transmissão na TV"
                value={source.id}
                onChange={(e) => {
                  void command({
                    type: "room.tv",
                    participantId: e.target.value,
                  }).catch((error) =>
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : "Não foi possível trocar a TV.",
                    ),
                  );
                }}
              >
                {sources.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.profile.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => focus(source.id)}>Ampliar TV</button>
            {!stream && <small>Aguardando transmissão…</small>}
          </>
        ) : (
          <span>Compartilhe sua tela para assistir na TV.</span>
        )}
      </div>
      {notice && (
        <p className="room3d-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
