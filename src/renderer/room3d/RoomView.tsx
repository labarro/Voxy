import { useEffect, useRef, useState } from "react";
import {
  Maximize,
  Minimize,
  ArrowLeft,
  Users,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Settings,
  PersonStanding,
  MonitorUp,
  Video,
  PhoneOff,
  RotateCcw,
  Move3D,
  HelpCircle,
  Tv,
  X,
  ChevronDown,
} from "lucide-react";
import type {
  Command,
  Participant,
  Profile,
  RoomPose,
  RoomPreset,
} from "../../shared/types";
import type { VoiceEngine, VoiceView } from "../../services/webrtc/engine";
import {
  defaultRoomSettings,
  spatialVoice,
  spawnPose,
} from "../../shared/room3d";
import { SocialScene, type SceneState } from "./scene";
import { Player } from "../components/Player";
import { Avatar } from "../components/Avatar";

import type { PoolState } from "../../shared/pool";
import { PoolPanel } from "./PoolPanel";
type Actions = {
  muted?: boolean;
  deafened?: boolean;
  onMute?: () => void;
  onDeafen?: () => void;
  onSettings?: () => void;
  onCustomize?: () => void;
  onTraditional?: () => void;
  onLeave?: () => void;
  onShare?: () => void;
  onCamera?: () => void;
  onVolume?: (id: string, value: number) => void;
  onParticipant?: (id: string, x: number, y: number) => void;
};
const initialScene: SceneState = {
  ready: false,
  progress: 0,
  mode: "follow",
  interaction: { label: "Aproxime-se de um assento", available: false },
  fps: 0,
  drawCalls: 0,
  triangles: 0,
};
export default function RoomView({
  preset,
  pool,
  selfId,
  people,
  profile,
  media,
  engine,
  command,
  fallback,
  paused,
  onSource,
  sourceId,
  muted = false,
  deafened = false,
  onMute,
  onDeafen,
  onSettings,
  onCustomize,
  onTraditional,
  onLeave,
  onShare,
  onCamera,
  onVolume,
  onParticipant,
}: {
  preset: RoomPreset;
  pool?: PoolState;
  selfId: string;
  people: Participant[];
  profile: Profile;
  media: VoiceView;
  engine: VoiceEngine;
  command: (command: Command) => Promise<unknown>;
  fallback: (message: string) => void;
  focus?: (id: string) => void;
  paused: boolean;
  onSource: (id: string | null) => void;
  sourceId?: string;
} & Actions) {
  const mount = useRef<HTMLDivElement>(null),
    root = useRef<HTMLElement>(null),
    scene = useRef<SocialScene | undefined>(undefined);
  const [poolOpen, setPoolOpen] = useState(false);
  const [emote, setEmote] = useState("none");
  const [notice, setNotice] = useState(""),
    [occupancy, setOccupancy] = useState(1),
    [state, setState] = useState(initialScene),
    [fullscreen, setFullscreen] = useState(false),
    [expanded, setExpanded] = useState(false),
    [menu, setMenu] = useState<"people" | "camera" | "help" | null>(null),
    [hud, setHud] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const settings = profile.room3d ?? defaultRoomSettings,
    sources = people
      .filter((p) => p.sharing)
      .sort((a, b) => a.profile.id.localeCompare(b.profile.id)),
    source = sources.find((p) => p.id === sourceId) ?? sources[0];
  const stream = source
    ? source.id === selfId
      ? media.local
      : media.streams.get(source.id)
    : undefined;
  const current = useRef({
    people,
    pool,
    settings,
    stream,
    media,
    command,
    fallback,
    paused,
  });
  current.current = {
    people,
    pool,
    settings,
    stream,
    media,
    command,
    fallback,
    paused,
  };
  useEffect(() => {
    onSource(source?.id ?? null);
    return () => onSource(null);
  }, [source?.id, onSource]);
  useEffect(() => {
    const data = () => ({
      people: current.current.people,
      pool: current.current.pool,
      settings: current.current.settings,
      stream: current.current.stream,
      speaking: current.current.media.speaking,
      paused: current.current.paused,
    });
    let active = true,
      listener = spawnPose(),
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
            if (active) setNotice("");
          } catch (error) {
            if (active)
              setNotice(
                error instanceof Error
                  ? error.message
                  : "Movimento indisponível.",
              );
            throw error;
          }
        },
        (pose: RoomPose, yaw: number) => {
          listener = { ...pose };
          cameraYaw = yaw;
        },
        (message) => {
          if (active) current.current.fallback(message);
        },
        (value) => {
          if (active) setState(value);
        },
        () => setPoolOpen(true),
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
        "Não foi possível iniciar o 3D. A chamada continua no modo tradicional.",
      );
    }
    return () => {
      active = false;
      engine.setSpatialMix(new Map());
    };
  }, [preset, selfId, engine]);
  useEffect(() => {
    const change = () =>
      setFullscreen(
        document.fullscreenElement === root.current ||
          !!(
            document.fullscreenElement &&
            root.current?.contains(document.fullscreenElement)
          ),
      );
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    scene.current?.setExpanded(expanded);
  }, [expanded]);
  useEffect(() => {
    if (!source) {
      setExpanded(false);
      scene.current?.returnFromTV();
    }
  }, [source?.id]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  function showHud() {
    setHud(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHud(false), 4500);
  }
  async function toggleFullscreen() {
    try {
      if (
        document.fullscreenElement &&
        root.current?.contains(document.fullscreenElement)
      )
        await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setNotice(
        "Não foi possível abrir a tela cheia. A sala e a chamada continuam disponíveis.",
      );
    }
  }
  function returnToRoom() {
    setExpanded(false);
    scene.current?.returnFromTV();
    showHud();
    mount.current?.querySelector("canvas")?.focus();
  }
  async function openAppPanel(action?: () => void) {
    if (document.fullscreenElement)
      await document.exitFullscreen().catch(() => {});
    action?.();
  }
  const mode =
    state.mode === "watch"
      ? "Assistindo na TV"
      : state.mode === "free"
        ? "Explorar ambiente"
        : "Acompanhar personagem";
  return (
    <section
      ref={root}
      className={
        "room3d room-social " +
        (state.ready ? "is-ready " : "") +
        (!hud ? "hud-quiet " : "") +
        (expanded ? "room-presenting " : "")
      }
      aria-label={preset === "lounge" ? "Lounge 3D" : "Cinema 3D"}
      aria-busy={!state.ready}
      data-camera-mode={state.mode}
      onPointerMove={showHud}
      onFocusCapture={showHud}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (
            document.fullscreenElement &&
            root.current?.contains(document.fullscreenElement)
          )
            void document.exitFullscreen().catch(() => {});
          if (expanded) {
            event.stopPropagation();
            returnToRoom();
          } else if (menu) setMenu(null);
          else if (state.mode === "watch") returnToRoom();
        }
        if (
          event.code === "KeyF" &&
          event.target instanceof HTMLCanvasElement &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault();
          void toggleFullscreen();
        }
      }}
    >
      <div className="room3d-canvas" ref={mount} />
      <div className="room-social-actions">
        <label>
          Interação{" "}
          <select
            aria-label="Interação social"
            value={emote}
            onChange={(e) => {
              setEmote(e.target.value);
              scene.current?.emote(
                e.target.value as NonNullable<RoomPose["emote"]>,
              );
            }}
          >
            <option value="none">Parar ação</option>
            <option value="wave">Acenar</option>
            <option value="laugh">Rir</option>
            <option value="dance">Dançar</option>
            <option value="celebrate">Comemorar</option>
            <option value="greet">Cumprimentar</option>
            <option value="smoke">Cigarro virtual</option>
          </select>
        </label>
        {preset === "lounge" && (
          <button onClick={() => setPoolOpen((v) => !v)}>Sinuca</button>
        )}
      </div>
      {poolOpen && (
        <PoolPanel
          game={pool}
          people={people}
          self={selfId}
          command={command}
          close={() => setPoolOpen(false)}
        />
      )}
      {!state.ready && (
        <div className="room-loading" role="status">
          <div className="room-loading-symbol">
            <PersonStanding size={42} />
          </div>
          <h2>
            {preset === "lounge"
              ? "Um lugar para ficar perto."
              : "Sua próxima sessão."}
          </h2>
          <p>
            Preparando {preset === "lounge" ? "o lounge" : "o cinema"} e seus
            personagens…
          </p>
          <progress
            aria-label="Carregamento da sala"
            max="1"
            value={state.progress}
          />
          <span>{Math.round(state.progress * 100)}%</span>
          {onTraditional && (
            <button onClick={onTraditional}>
              Continuar na chamada tradicional
            </button>
          )}
        </div>
      )}
      <header className="room-hud-top">
        <div className="room-identity">
          <span className="room-presence-dot" />
          <div>
            <strong>{preset === "lounge" ? "Lounge" : "Cinema"}</strong>
            <span>
              {occupancy} no ambiente ·{" "}
              {settings.proximity ? "voz por proximidade" : "voz do canal"}
            </span>
          </div>
        </div>
        <div className="room-hud-actions">
          <button
            aria-label="Participantes da sala"
            aria-expanded={menu === "people"}
            title="Participantes"
            onClick={() => setMenu((v) => (v === "people" ? null : "people"))}
          >
            <Users size={18} />
            <span>{people.length}</span>
          </button>
          <button
            aria-label="Opções da câmera"
            aria-expanded={menu === "camera"}
            title={mode}
            onClick={() => setMenu((v) => (v === "camera" ? null : "camera"))}
          >
            <Move3D size={18} />
            <ChevronDown size={12} />
          </button>
          <button
            aria-label={
              fullscreen ? "Sair da tela cheia da sala" : "Tela cheia da sala"
            }
            title={fullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia (F)"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          {onTraditional && (
            <button className="room-return" onClick={onTraditional}>
              <ArrowLeft size={16} />
              <span>Voltar ao canal</span>
            </button>
          )}
        </div>
      </header>
      {menu && (
        <aside
          className="room-hud-menu"
          aria-label={
            menu === "people"
              ? "Participantes"
              : menu === "camera"
                ? "Câmera"
                : "Controles"
          }
        >
          <header>
            <strong>
              {menu === "people"
                ? "Por aqui"
                : menu === "camera"
                  ? "Sua câmera"
                  : "Como se movimentar"}
            </strong>
            <button
              aria-label="Fechar menu da sala"
              onClick={() => setMenu(null)}
            >
              <X size={16} />
            </button>
          </header>
          {menu === "people" ? (
            <div className="room-people">
              {people.map((person) => (
                <button
                  key={person.id}
                  className={media.speaking.has(person.id) ? "is-speaking" : ""}
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    if (document.fullscreenElement)
                      void document
                        .exitFullscreen()
                        .then(() =>
                          onParticipant?.(
                            person.profile.id,
                            box.left,
                            box.bottom,
                          ),
                        );
                    else
                      onParticipant?.(person.profile.id, box.left, box.bottom);
                    setMenu(null);
                  }}
                >
                  <Avatar
                    avatar={person.profile.avatar}
                    className="room-person-avatar"
                  />
                  <span>
                    <strong>
                      {person.profile.name}
                      {person.id === selfId ? " (você)" : ""}
                    </strong>
                    <small>
                      {person.roomPose ? "No ambiente" : "No canal tradicional"}
                      {person.camera ? " · webcam ativa" : ""}
                    </small>
                  </span>
                  {person.muted ? <MicOff size={15} /> : <Mic size={15} />}
                </button>
              ))}
            </div>
          ) : menu === "camera" ? (
            <>
              <button
                aria-pressed={state.mode === "follow"}
                onClick={() => {
                  scene.current?.setCameraMode("follow");
                  setMenu(null);
                }}
              >
                Acompanhar personagem <kbd>C</kbd>
              </button>
              <button
                aria-pressed={state.mode === "free"}
                onClick={() => {
                  scene.current?.setCameraMode("free");
                  setMenu(null);
                }}
              >
                Explorar ambiente <kbd>C</kbd>
              </button>
              <button
                onClick={() => {
                  scene.current?.resetCamera();
                  setMenu(null);
                }}
              >
                Reposicionar câmera <kbd>R</kbd>
              </button>
              <small>
                Arraste para girar. Use a roda para aproximar. No modo livre,
                arraste com o botão direito para deslocar.
              </small>
            </>
          ) : (
            <div className="room-help-list">
              <p>
                <kbd>W A S D</kbd> ou setas para andar
              </p>
              <p>Arrastar para girar · Roda para zoom</p>
              <p>
                <kbd>E</kbd> Sentar ou levantar
              </p>
              <p>
                <kbd>C</kbd> Trocar câmera · <kbd>R</kbd> Reposicionar
              </p>
              <p>
                <kbd>F</kbd> Tela cheia · <kbd>Esc</kbd> Voltar
              </p>
            </div>
          )}
        </aside>
      )}
      {state.ready && !expanded && (
        <>
          <div className="room-context">
            {state.mode === "watch" ? (
              <button onClick={returnToRoom}>
                <ArrowLeft size={15} />
                Voltar à sala <kbd>Esc</kbd>
              </button>
            ) : state.interaction.available ? (
              <button
                aria-label="Sentar / levantar (E)"
                onClick={() => scene.current?.interact()}
              >
                <kbd>E</kbd>
                {state.interaction.label}
              </button>
            ) : (
              <span>
                <kbd>W A S D</kbd> Explore e encontre um lugar
              </span>
            )}
          </div>
          <div className="room-tv-card">
            {source ? (
              <>
                <div>
                  <span className="room-live-dot" />
                  Ao vivo · {source.profile.name}
                </div>
                <div>
                  {state.mode !== "watch" && (
                    <button
                      onClick={() => {
                        scene.current?.setCameraMode("watch");
                        mount.current?.querySelector("canvas")?.focus();
                      }}
                    >
                      <Tv size={17} />
                      Assistir na TV
                    </button>
                  )}
                  <button
                    aria-label="Ampliar TV"
                    title="Ampliar transmissão"
                    onClick={() => {
                      setExpanded(true);
                      showHud();
                    }}
                  >
                    <Maximize size={17} />
                    {state.mode === "watch" ? "Ampliar transmissão" : null}
                  </button>
                  {sources.length > 1 && (
                    <select
                      aria-label="Transmissão na TV"
                      value={source.id}
                      onChange={(event) =>
                        void command({
                          type: "room.tv",
                          participantId: event.target.value,
                        }).catch((error) => setNotice(error.message))
                      }
                    >
                      {sources.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.profile.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {!stream && <small>Aguardando transmissão…</small>}
              </>
            ) : (
              <>
                <Tv size={22} />
                <div>
                  <strong>Uma tela para compartilhar.</strong>
                  <span>Sua transmissão aparece aqui.</span>
                </div>
                {onShare && (
                  <button onClick={() => void openAppPanel(onShare)}>
                    Compartilhar
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {expanded && source && (
        <div className="room-tv-expanded">
          <header>
            <button onClick={returnToRoom}>
              <ArrowLeft size={16} />
              Voltar à sala <kbd>Esc</kbd>
            </button>
            <strong>{source.profile.name} · Ao vivo</strong>
          </header>
          <Player
            stream={stream}
            name={source.profile.name}
            local={source.id === selfId}
            deafened={deafened}
            output={profile.output}
            volume={profile.streamVolumes?.[source.profile.id] ?? 1}
            onVolume={(value) => onVolume?.(source.id, value)}
            close={returnToRoom}
          />
        </div>
      )}
      {!expanded && state.ready && (
        <footer className="room-dock">
          <div className="room-dock-voice">
            {onMute && (
              <button
                className={muted || deafened ? "is-muted" : ""}
                aria-label={muted ? "Ativar microfone" : "Mutar microfone"}
                aria-pressed={muted || deafened}
                disabled={deafened}
                title={
                  profile.pttEnabled
                    ? "Microfone · Push-to-Talk ativo"
                    : "Microfone"
                }
                onClick={onMute}
              >
                {muted || deafened ? <MicOff size={19} /> : <Mic size={19} />}
              </button>
            )}
            {onDeafen && (
              <button
                aria-label={deafened ? "Desativar Deafen" : "Silenciar áudio"}
                aria-pressed={deafened}
                className={deafened ? "is-muted" : ""}
                onClick={onDeafen}
              >
                {deafened ? (
                  <HeadphoneOff size={19} />
                ) : (
                  <Headphones size={19} />
                )}
              </button>
            )}
            <span>
              {deafened
                ? "Deafen ativo"
                : muted
                  ? "Microfone mutado"
                  : profile.pttEnabled
                    ? "Push-to-Talk"
                    : "Voz conectada"}
            </span>
          </div>
          <div className="room-dock-tools">
            {onShare && (
              <button
                aria-label={
                  media.sharing ? "Parar transmissão" : "Compartilhar tela"
                }
                title={
                  media.sharing ? "Parar transmissão" : "Compartilhar tela"
                }
                className={media.sharing ? "is-active" : ""}
                onClick={() => void openAppPanel(onShare)}
              >
                <MonitorUp size={19} />
              </button>
            )}
            {onCamera && (
              <button
                aria-label={
                  media.cameraActive ? "Desligar câmera" : "Ativar câmera"
                }
                title="Webcam"
                className={media.cameraActive ? "is-active" : ""}
                onClick={() => void openAppPanel(onCamera)}
              >
                <Video size={19} />
              </button>
            )}
            {onCustomize && (
              <button
                aria-label="Personalizar personagem"
                title="Seu personagem"
                onClick={() => void openAppPanel(onCustomize)}
              >
                <PersonStanding size={19} />
              </button>
            )}
            {onSettings && (
              <button
                aria-label="Configurações da sala"
                title="Configurações"
                onClick={() => void openAppPanel(onSettings)}
              >
                <Settings size={18} />
              </button>
            )}
            <button
              aria-label="Controles da sala"
              aria-expanded={menu === "help"}
              title="Controles"
              onClick={() => setMenu((v) => (v === "help" ? null : "help"))}
            >
              <HelpCircle size={18} />
            </button>
            {onLeave && (
              <button
                className="room-disconnect"
                aria-label="Sair do canal de voz"
                title="Sair do canal de voz"
                onClick={onLeave}
              >
                <PhoneOff size={19} />
              </button>
            )}
          </div>
        </footer>
      )}
      {notice && (
        <p className="room3d-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
