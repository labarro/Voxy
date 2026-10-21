import { MAX_PARTICIPANTS } from "../shared/constants";
import { PTT_KEYS } from "../shared/preferences";
import { Avatar, AvatarImages } from "./components/Avatar";
import { ParticipantStatus } from "./components/ParticipantStatus";
import { Chat } from "./components/Chat";
import { ProfileForm } from "./components/ProfileForm";
import { ShareForm } from "./components/ShareForm";
import { ManageRow } from "./components/ManageRow";
import { Home } from "./components/Home";
import { ServerRail, type AppPage } from "./components/ServerRail";
import { Presence, presenceLabels } from "./components/Presence";
import { DirectList, DirectConversation } from "./components/DirectMessages";
import { useSavedRooms } from "./hooks/useSavedRooms";
import { useInbox } from "./hooks/useInbox";
import {
  findConversation,
  conversation,
  unreadTotal,
  type DirectTarget,
} from "./directThreads";
import { ReleaseChannel } from "./components/ReleaseChannel";
import { ServerImage } from "./components/ServerImage";
import { CameraTile } from "./components/CameraTile";
import { RemoteUpdate } from "./components/RemoteUpdate";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AudioLines,
  Plus,
  Hash,
  Volume2,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Settings,
  MonitorUp,
  PhoneOff,
  LogIn,
  Radio,
  Copy,
  MoreHorizontal,
  Send,
  Users,
  Trash2,
  Pencil,
  Network,
  LogOut,
  Video,
  VideoOff,
  Megaphone,
  MessageCircle,
  X,
} from "lucide-react";
import type {
  RoomState,
  Profile,
  HostInfo,
  Command,
  Source,
  Channel,
  ReleaseNotes,
} from "../shared/types";
import {
  VoiceEngine,
  qualities,
  type VoiceView,
  type Quality,
} from "../services/webrtc/engine";
import { Modal } from "./components/Modal";
import { Player } from "./components/Player";
const empty: RoomState = {
  servers: [],
  channels: [],
  participants: [],
  messages: [],
};

type Dialog =
  | "host"
  | "join"
  | "profile"
  | "share"
  | "server"
  | "channel"
  | "manage"
  | "diagnostics"
  | "camera"
  | null;
export function App() {
  const [page, setPage] = useState<AppPage>("home");
  const saved = useSavedRooms();
  const { inbox, notice, clearNotice, error: inboxError } = useInbox();
  const [directTarget, setDirectTarget] = useState<DirectTarget | null>(null);
  const [watchCamera, setWatchCamera] = useState<string | null>(null);
  const [cameraDevice, setCameraDevice] = useState("");
  const pendingServer = useRef<string | null>(null);
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [profile, setProfile] = useState<Profile>(),
    [room, setRoom] = useState<RoomState>(empty),
    [selfId, setSelfId] = useState(""),
    [status, setStatus] = useState("disconnected");
  const [serverId, setServerId] = useState(""),
    [channelId, setChannelId] = useState(""),
    [dialog, setDialog] = useState<Dialog>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [kind, setKind] = useState<"text" | "voice">("voice"),
    [invite, setInvite] = useState(""),
    [hostInfo, setHostInfo] = useState<HostInfo>(),
    [addresses, setAddresses] = useState<string[]>([]),
    [address, setAddress] = useState("127.0.0.1"),
    [port, setPort] = useState(43120);
  const [muted, setMuted] = useState(false),
    [deafened, setDeafened] = useState(false),
    [text, setText] = useState(""),
    [watch, setWatch] = useState<string | null>(null),
    [sources, setSources] = useState<Source[]>([]),
    [source, setSource] = useState(""),
    [quality, setQuality] = useState<Quality>("720p30"),
    [systemAudio, setSystemAudio] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [participantAudio, setParticipantAudio] = useState<string | null>(null);
  const [media, setMedia] = useState<VoiceView>({
    streams: new Map(),
    speaking: new Set(),
    diagnostics: [],
    sharing: false,
    error: "",
  });
  const latest = useRef({ room, selfId, status, muted, deafened });
  latest.current = { room, selfId, status, muted, deafened };
  const effectiveMuted = useRef(false);
  const joining = useRef(false),
    messagesEnd = useRef<HTMLDivElement>(null);
  const [engine] = useState(
    () =>
      new VoiceEngine(
        (s) => window.voxy.signal(s),
        setMedia,
        (sharing) => {
          const l = latest.current;
          if (
            l.status === "connected" &&
            l.room.participants.some((p) => p.id === l.selfId && p.channelId)
          )
            void window.voxy
              .command({
                type: "status",
                muted: effectiveMuted.current,
                deafened: l.deafened,
                sharing,
              })
              .catch((e) => setError(e.message));
        },
        (muted) => {
          effectiveMuted.current = muted;
          const l = latest.current;
          const me = l.room.participants.find((p) => p.id === l.selfId);
          if (l.status === "connected" && me?.channelId)
            void window.voxy
              .command({
                type: "status",
                muted,
                deafened: l.deafened,
                sharing: me.sharing,
              })
              .catch((e) => setError(e.message));
        },
        (camera) => {
          const l = latest.current,
            me = l.room.participants.find((p) => p.id === l.selfId);
          if (l.status === "connected" && me?.channelId)
            void window.voxy
              .command({
                type: "status",
                muted: effectiveMuted.current,
                deafened: l.deafened,
                sharing: me.sharing,
                camera,
              })
              .catch((e) => setError(e.message));
        },
      ),
  );
  useEffect(() => {
    void Promise.all([window.voxy.profile(), window.voxy.releaseNotes()])
      .then(([p, notes]) => {
        engine.configurePreferences(p);
        setProfile(p);
        setNotes(notes);
      })
      .catch((e) => setError(e.message));
    const off = window.voxy.onEvent((event) => {
      if (event.type === "open-direct") {
        setDirectTarget({ scope: event.scope, peer: event.peer });
        setPage("dm");
        clearNotice();
      }
      if (event.type === "connection") {
        latest.current.status = event.status;
        setStatus(event.status);
        if (event.status === "connected") setPage("room");
        if (event.selfId) {
          latest.current.selfId = event.selfId;
          setSelfId(event.selfId);
        } else {
          engine.leave();
          setRoom(empty);
          latest.current.room = empty;
          setWatch(null);
          setWatchCamera(null);
          setPage((current) => (current === "room" ? "home" : current));
        }
      }
      if (event.type === "state") {
        latest.current.room = event.state;
        setRoom(event.state);
        if (
          pendingServer.current &&
          event.state.servers.some((s) => s.id === pendingServer.current)
        ) {
          setServerId(pendingServer.current);
          pendingServer.current = null;
        }
        if (!joining.current)
          engine.sync(event.state.participants, latest.current.selfId);
      }
      if (event.type === "signal") engine.signal(event.signal);
      if (event.type === "ptt") {
        engine.setPttPressed(event.pressed);
        if (event.error) setError(event.error);
      }
    });
    const changed = () => {
      void navigator.mediaDevices.enumerateDevices().then(setDevices);
    };
    navigator.mediaDevices.addEventListener("devicechange", changed);
    return () => {
      off();
      engine.leave();
      navigator.mediaDevices.removeEventListener("devicechange", changed);
    };
  }, [engine]);
  useEffect(() => {
    if (!room.servers.some((s) => s.id === serverId))
      setServerId(room.servers[0]?.id ?? "");
  }, [room.servers, serverId]);
  useEffect(() => {
    if (
      !room.channels.some((c) => c.id === channelId && c.serverId === serverId)
    )
      setChannelId(
        room.channels.find((c) => c.serverId === serverId && c.kind === "text")
          ?.id ??
          room.channels.find((c) => c.serverId === serverId)?.id ??
          "",
      );
  }, [room.channels, channelId, serverId]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [room.messages.length, channelId]);
  const me = room.participants.find((p) => p.id === selfId),
    server = room.servers.find((s) => s.id === serverId),
    channel = room.channels.find((c) => c.id === channelId),
    voice = room.channels.find((c) => c.id === me?.channelId);
  const peers = room.participants.filter(
      (p) => p.channelId && p.channelId === me?.channelId,
    ),
    streams = peers.filter((p) => p.sharing),
    watched = peers.find((p) => p.id === watch && p.sharing);
  const cameras = room.participants.filter(
    (p) => p.channelId === channelId && p.camera,
  );
  const selectedCamera = cameras.find((p) => p.id === watchCamera);
  const online = status === "connected";
  useEffect(
    () =>
      engine.setWatching(
        page === "room" &&
          !selectedCamera &&
          watched &&
          me?.channelId === channelId
          ? watched.id
          : null,
      ),
    [engine, watched?.id, channelId, me?.channelId, page, selectedCamera?.id],
  );
  async function run(fn: () => Promise<unknown>, close = false) {
    setError("");
    setBusy(true);
    try {
      await fn();
      if (close) setDialog(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function command(c: Command) {
    return window.voxy.command(c);
  }
  async function open(d: Dialog) {
    setError("");
    setName("");
    setDialog(d);
    if (d === "host")
      await run(async () => {
        const list = await window.voxy.addresses();
        setAddresses(list);
        setAddress(list[0] ?? "127.0.0.1");
        setName("Nosso cantinho");
      });
    if (d === "share")
      await run(async () => {
        const list = await window.voxy.sources();
        setSources(list);
        setSource(list[0]?.id ?? "");
      });
    if (d === "camera") setCameraDevice(profile?.cameraDevice ?? "");
    if (d === "profile" || d === "camera")
      await run(async () =>
        setDevices(await navigator.mediaDevices.enumerateDevices()),
      );
  }
  async function joinVoice(c: Channel) {
    setPage("room");
    if (busy || joining.current) return;
    setChannelId(c.id);
    if (me?.channelId === c.id) return;
    await run(async () => {
      joining.current = true;
      try {
        if (me?.channelId) {
          engine.leave();
          await command({ type: "voice", channelId: null });
        }
        await engine.join(selfId, profile?.input ?? "");
        await engine.setOutput(profile?.output ?? "");
        await command({ type: "voice", channelId: c.id });
        await command({
          type: "status",
          muted: engine.isMuted(),
          deafened,
          sharing: false,
        });
      } catch (e) {
        engine.leave();
        throw e;
      } finally {
        joining.current = false;
        engine.sync(latest.current.room.participants, selfId);
      }
    });
  }
  async function leaveVoice() {
    engine.leave();
    setWatch(null);
    setWatchCamera(null);
    await command({ type: "voice", channelId: null });
  }
  async function toggleMute() {
    const v = !muted;
    latest.current.muted = v;
    setMuted(v);
    engine.setMuted(v);
  }
  async function toggleDeafen() {
    const v = !deafened;
    latest.current.deafened = v;
    setDeafened(v);
    engine.setDeafened(v);
    if (voice)
      await command({
        type: "status",
        muted: engine.isMuted(),
        deafened: v,
        sharing: media.sharing,
      });
  }
  async function savePreferences(p: Profile) {
    const saved = await window.voxy.saveProfile(p);
    setProfile(saved);
    engine.configurePreferences(saved);
    await engine.setOutput(saved.output);
    await engine.setInput(saved.input);
  }
  function saveParticipantVolume(
    socketId: string,
    value: number,
    stream = false,
  ) {
    const person = latest.current.room.participants.find(
      (p) => p.id === socketId,
    );
    if (!person) return;
    const key = stream ? "streamVolumes" : "volumes";
    engine.volume(socketId, value, stream);
    setProfile((p) =>
      p ? { ...p, [key]: { ...p[key], [person.profile.id]: value } } : p,
    );
    void window.voxy
      .setVolume(person.profile.id, value, stream)
      .catch((e) => setError(e.message));
  }
  function submit(e: FormEvent, fn: () => Promise<unknown>) {
    e.preventDefault();
    void run(fn, true);
  }
  async function muteParticipant(socketId: string, value: boolean) {
    const person = latest.current.room.participants.find(
      (p) => p.id === socketId,
    );
    if (!person) return;
    await window.voxy.setParticipantMuted(person.profile.id, value);
    engine.muteParticipant(socketId, value, person.profile.id);
    setProfile((p) =>
      p
        ? {
            ...p,
            mutedParticipants: {
              ...p.mutedParticipants,
              [person.profile.id]: value,
            },
          }
        : p,
    );
  }
  const selectedParticipant = room.participants.find(
    (p) => p.id === participantAudio && p.id !== selfId,
  );
  async function reconnectSaved(id: string) {
    const result = await window.voxy.reconnectRoom(id);
    setHostInfo(result.hostInfo);
    if (latest.current.room.servers.some((s) => s.id === result.serverId))
      setServerId(result.serverId);
    else pendingServer.current = result.serverId;
    setPage("room");
  }
  function openDirect(target: DirectTarget) {
    setDirectTarget(target);
    setPage("dm");
    clearNotice();
  }
  useEffect(() => {
    if (!notice) return;
    if (profile?.presence === "busy") {
      clearNotice();
      return;
    }
    const entry = inbox.rooms.find((r) => r.scope === notice.scope);
    if (
      entry &&
      profile &&
      !conversation(entry, notice.peer, profile.id).unread
    ) {
      clearNotice();
      return;
    }
    const timer = setTimeout(clearNotice, 10000);
    return () => clearTimeout(timer);
  }, [notice, inbox, profile?.id, profile?.presence]);
  if (!profile)
    return <main className="boot">Abrindo Voxy…{error && <p>{error}</p>}</main>;
  return (
    <AvatarImages.Provider value={room.avatars ?? {}}>
      <div className="app-shell">
        {notes && (
          <Modal
            title={"Novidades · Voxy " + notes.version}
            close={() =>
              void run(async () => {
                await window.voxy.markReleaseNotes(notes.version);
                setNotes(null);
              })
            }
          >
            <h3>{notes.title}</h3>
            <ul className="release-list">
              {notes.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await window.voxy.markReleaseNotes(notes.version);
                  setNotes(null);
                })
              }
            >
              Entendi, vamos lá
            </button>
            {error && (
              <p role="alert" className="modal-error">
                {error}
              </p>
            )}
          </Modal>
        )}
        <ServerRail
          room={room}
          page={page}
          serverId={serverId}
          saved={saved}
          busy={busy}
          online={online}
          canCreate={!!me?.host}
          unread={unreadTotal(inbox, profile.id)}
          navigate={setPage}
          select={(id) => {
            setServerId(id);
            setPage("room");
            void window.voxy.visitServer(id).catch((e) => setError(e.message));
          }}
          reconnect={(id) => void run(() => reconnectSaved(id))}
          create={() => void open(online ? "server" : "host")}
          join={() => void open("join")}
        />
        <aside className="channel-panel">
          <header className="server-header">
            {page !== "dm" && server?.icon && (
              <Avatar avatar={server.icon} className="mini-avatar" />
            )}
            <div>
              <small>
                {page === "dm" ? "Só entre vocês" : "Sua sala privada"}
              </small>
              <h2>
                {page === "dm"
                  ? "Mensagens privadas"
                  : (server?.name ?? "Seu espaço")}
              </h2>
            </div>
            {server && page !== "dm" && (
              <button
                title="Gerenciar servidor e canais"
                onClick={() => void open("manage")}
              >
                <MoreHorizontal />
              </button>
            )}
          </header>
          <div className="channel-scroll">
            {page === "dm" ? (
              <DirectList
                legacyHost={online && !room.features?.directMessages}
                inbox={inbox}
                participants={room.participants}
                owner={profile.id}
                selected={directTarget}
                open={openDirect}
              />
            ) : online ? (
              <>
                <div className="room-badge">
                  <i className="status-dot" /> {room.participants.length}/
                  {MAX_PARTICIPANTS} amigos conectados
                </div>
                {(["text", "voice"] as const).map((type) => (
                  <section className="channel-group" key={type}>
                    <div className="category">
                      <span>
                        {type === "text" ? "Conversas" : "Salas de voz"}
                      </span>
                      {me?.host && (
                        <button
                          title={
                            "Criar canal de " +
                            (type === "voice" ? "voz" : "texto")
                          }
                          onClick={() => {
                            setKind(type);
                            void open("channel");
                          }}
                        >
                          <Plus size={16} />
                        </button>
                      )}
                    </div>
                    {room.channels
                      .filter((c) => c.serverId === serverId && c.kind === type)
                      .map((c) => (
                        <div key={c.id}>
                          <button
                            className={
                              "channel " +
                              (page === "room" && c.id === channelId
                                ? "active"
                                : "") +
                              (c.id === me?.channelId
                                ? " connected-channel"
                                : "")
                            }
                            aria-current={
                              page === "room" && c.id === channelId
                                ? "page"
                                : undefined
                            }
                            onClick={() => {
                              setPage("room");
                              c.kind === "voice"
                                ? void joinVoice(c)
                                : setChannelId(c.id);
                            }}
                          >
                            {type === "text" ? (
                              <Hash size={20} />
                            ) : (
                              <Volume2 size={20} />
                            )}
                            <span>{c.name}</span>
                          </button>
                          {type === "voice" &&
                            room.participants
                              .filter((p) => p.channelId === c.id)
                              .map((p) => (
                                <div
                                  className="channel-person"
                                  key={p.id}
                                  onContextMenu={(e) => {
                                    if (p.id !== selfId) {
                                      e.preventDefault();
                                      setParticipantAudio(p.id);
                                    }
                                  }}
                                >
                                  <Avatar
                                    avatar={p.profile.avatar}
                                    className={
                                      "mini-avatar " +
                                      (media.speaking.has(p.id)
                                        ? "speaking"
                                        : "")
                                    }
                                  />
                                  <span>{p.profile.name}</span>
                                  <Presence value={p.profile.presence} />
                                  {p.sharing && (
                                    <span className="live-label sidebar-live">
                                      AO VIVO
                                    </span>
                                  )}
                                  {p.camera && (
                                    <span title="Câmera ligada">
                                      <Video size={13} />
                                    </span>
                                  )}
                                  <ParticipantStatus
                                    muted={p.muted}
                                    deafened={p.deafened}
                                    locallyMuted={
                                      !!profile.mutedParticipants?.[
                                        p.profile.id
                                      ]
                                    }
                                  />
                                </div>
                              ))}
                        </div>
                      ))}
                  </section>
                ))}
                <section className="member-section">
                  <h3>
                    Participantes <span>{room.participants.length}</span>
                  </h3>
                  {room.participants.map((p) => (
                    <button
                      key={p.id}
                      className="member-row"
                      title={
                        p.id === selfId
                          ? "Seu perfil"
                          : "Conversar em privado com " + p.profile.name
                      }
                      onClick={() =>
                        p.id === selfId
                          ? void open("profile")
                          : inbox.activeScope &&
                            openDirect({
                              scope: inbox.activeScope,
                              peer: p.profile.id,
                            })
                      }
                    >
                      <span className="avatar-with-presence">
                        <Avatar
                          avatar={p.profile.avatar}
                          className="mini-avatar"
                        />
                        <Presence value={p.profile.presence} />
                      </span>
                      <span>
                        {p.profile.name}
                        {p.id === selfId ? " (você)" : ""}
                      </span>
                      <Presence value={p.profile.presence} label />
                    </button>
                  ))}
                </section>
              </>
            ) : (
              <div className="sidebar-empty">
                <Radio size={32} />
                <h3>Perto, mesmo de longe.</h3>
                <p>Hospede uma sala e traga seus amigos pela rede privada.</p>
                <button className="primary" onClick={() => void open("host")}>
                  Hospedar sala
                </button>
                <button onClick={() => void open("join")}>
                  Entrar com convite
                </button>
              </div>
            )}
          </div>
          {voice && (
            <div className="voice-status">
              <div>
                <i className="status-dot" />
                <strong>
                  {peers.length < 2
                    ? "No canal de voz"
                    : media.diagnostics.length === peers.length - 1 &&
                        media.diagnostics.every(
                          (d) => d.connection === "connected",
                        )
                      ? "Voz conectada"
                      : "Conectando áudio…"}
                </strong>
                <small>{voice.name}</small>
                {profile.pttEnabled && (
                  <small className={media.micOpen ? "ptt-open" : ""}>
                    {media.micOpen
                      ? "Falando"
                      : "Segure " +
                        PTT_KEYS[profile.pttKey ?? "KeyV"].label +
                        " para falar"}{" "}
                    · PTT
                  </small>
                )}
              </div>
              <button
                title="Sair do canal de voz"
                onClick={() => void run(leaveVoice)}
              >
                <PhoneOff size={19} />
              </button>
            </div>
          )}
          <footer className="profile-bar">
            <button
              className="profile-identity"
              onClick={() => void open("profile")}
              title="Editar perfil"
            >
              <span className="avatar-with-presence">
                <Avatar avatar={profile.avatar} />
                <Presence value={online ? profile.presence : "offline"} />
              </span>
              <span>
                <strong>{profile.name}</strong>
                <small>
                  {online
                    ? presenceLabels[profile.presence ?? "online"] +
                      " · Conectado"
                    : status === "reconnecting"
                      ? "Reconectando…"
                      : "Desconectado"}
                </small>
              </span>
            </button>
            <button
              className={muted ? "danger-text" : ""}
              title={muted ? "Ativar microfone" : "Mutar microfone"}
              onClick={() => void run(toggleMute)}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              title={deafened ? "Ouvir áudio" : "Silenciar áudio"}
              onClick={() => void run(toggleDeafen)}
            >
              {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
            </button>
            <button title="Configurações" onClick={() => void open("profile")}>
              <Settings size={18} />
            </button>
          </footer>
        </aside>
        <main className="workspace">
          <RemoteUpdate compact />
          <header className="workspace-header">
            <div>
              {page === "dm" ? (
                <MessageCircle />
              ) : page === "news" ? (
                <Megaphone />
              ) : page === "home" ? (
                <AudioLines />
              ) : channel?.kind === "voice" ? (
                <Volume2 />
              ) : (
                <Hash />
              )}
              <strong>
                {page === "dm"
                  ? (findConversation(inbox, directTarget).contact?.name ??
                    "Mensagens privadas")
                  : page === "news"
                    ? "Novidades do Voxy"
                    : page === "home"
                      ? "Home"
                      : (channel?.name ?? "Bem-vindo ao Voxy")}
              </strong>
              <span className="header-description">
                {page === "dm"
                  ? "Conversa privada"
                  : page === "news"
                    ? "Versões e novidades"
                    : page === "home"
                      ? "Seu ponto de encontro"
                      : channel?.kind === "voice"
                        ? "Converse. Mostre. Fique por perto."
                        : "Um lugar só para vocês."}
              </span>
            </div>
            <div>
              <button
                title="Diagnóstico de conexão"
                onClick={() => void open("diagnostics")}
              >
                <Network size={19} />
              </button>
              {online && (
                <button
                  title="Desconectar da sala"
                  onClick={() =>
                    void run(async () => {
                      engine.leave();
                      await window.voxy.disconnect();
                      setHostInfo(undefined);
                    })
                  }
                >
                  <LogOut size={19} />
                </button>
              )}
            </div>
          </header>
          {notice &&
            profile.presence !== "busy" &&
            !(
              page === "dm" &&
              directTarget?.scope === notice.scope &&
              directTarget.peer === notice.peer
            ) && (
              <div className="direct-notice" role="status">
                <MessageCircle size={18} />
                <span>
                  Nova mensagem de <strong>{notice.name}</strong>
                </span>
                <button
                  onClick={() =>
                    openDirect({ scope: notice.scope, peer: notice.peer })
                  }
                >
                  Abrir conversa
                </button>
                <button title="Fechar notificação" onClick={clearNotice}>
                  <X size={16} />
                </button>
              </div>
            )}
          {(error || media.error) && (
            <div className="error-banner" role="alert">
              <span>{error || media.error}</span>
              {media.error.includes("Retomar") && (
                <button onClick={() => engine.resumeAudio()}>
                  Retomar áudio
                </button>
              )}
              <button
                onClick={() => {
                  setError("");
                  engine.resumeAudio();
                }}
              >
                Fechar aviso
              </button>
            </div>
          )}
          {page === "dm" ? (
            <>
              <DirectConversation
                inbox={inbox}
                target={directTarget}
                owner={profile.id}
                online={online}
                supported={!!room.features?.directMessages}
                participants={room.participants}
                command={command}
              />
              {inboxError && (
                <p className="chat-error" role="alert">
                  {inboxError}
                </p>
              )}
            </>
          ) : page === "news" ? (
            <ReleaseChannel />
          ) : page === "home" || !online ? (
            <Home
              saved={saved}
              busy={busy}
              host={() => void open("host")}
              join={() => void open("join")}
              reconnect={(id) => void run(() => reconnectSaved(id))}
            />
          ) : channel?.kind === "text" ? (
            <Chat
              key={channelId}
              channelId={channelId}
              name={channel.name}
              messages={room.messages.filter((m) => m.channelId === channelId)}
              busy={busy}
              authorId={profile.id}
              onEdit={(id, text) => command({ type: "message.edit", id, text })}
              onDelete={(id) => command({ type: "message.delete", id })}
              onSend={(text, image) =>
                command({ type: "message", channelId, text, image })
              }
            />
          ) : channel?.kind === "voice" ? (
            <section className="call-view">
              <div className="call-heading">
                <div>
                  <span className="eyebrow">Sala de voz</span>
                  <h1>{channel.name}</h1>
                </div>
                <span className="people-count">
                  <Users size={16} />
                  {
                    room.participants.filter((p) => p.channelId === channelId)
                      .length
                  }{" "}
                  por aqui
                </span>
              </div>
              {selectedCamera && me?.channelId === channelId ? (
                <Player
                  stream={
                    selectedCamera.id === selfId
                      ? media.localCamera
                      : media.cameraStreams?.get(selectedCamera.id)
                  }
                  name={selectedCamera.profile.name}
                  kind="camera"
                  local={selectedCamera.id === selfId}
                  deafened={deafened}
                  output={profile.output}
                  close={() => setWatchCamera(null)}
                />
              ) : watched && me?.channelId === channelId ? (
                <Player
                  stream={
                    watched.id === selfId
                      ? media.local
                      : media.streams.get(watched.id)
                  }
                  name={watched.profile.name}
                  local={watched.id === selfId}
                  deafened={deafened}
                  output={profile.output}
                  volume={profile.streamVolumes?.[watched.profile.id] ?? 1}
                  onVolume={(v) => saveParticipantVolume(watched.id, v, true)}
                  close={() => setWatch(null)}
                />
              ) : (
                <div className="participant-grid">
                  {room.participants
                    .filter((p) => p.channelId === channelId)
                    .map((p) => (
                      <article
                        onContextMenu={(e) => {
                          if (p.id !== selfId) {
                            e.preventDefault();
                            setParticipantAudio(p.id);
                          }
                        }}
                        key={p.id}
                        className={
                          "participant-card " +
                          (media.speaking.has(p.id) ? "talking" : "")
                        }
                      >
                        <Avatar
                          className="large-avatar"
                          avatar={p.profile.avatar}
                        />
                        <div className="participant-name">
                          <span>
                            {p.profile.name}
                            {p.id === selfId ? " (você)" : ""}
                          </span>
                          <Presence value={p.profile.presence} label />
                          <ParticipantStatus
                            muted={p.muted}
                            deafened={p.deafened}
                            showMicrophone
                            locallyMuted={
                              !!profile.mutedParticipants?.[p.profile.id]
                            }
                          />
                        </div>
                        {p.sharing && (
                          <button
                            className="watch-button"
                            onClick={() => setWatch(p.id)}
                          >
                            <MonitorUp size={16} /> Assistir à tela
                          </button>
                        )}
                        {p.id !== selfId && p.channelId === me?.channelId && (
                          <button
                            className="local-mute-button"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                muteParticipant(
                                  p.id,
                                  !profile.mutedParticipants?.[p.profile.id],
                                ),
                              )
                            }
                          >
                            {profile.mutedParticipants?.[p.profile.id]
                              ? "Ouvir voz novamente"
                              : "Mutar voz para mim"}
                          </button>
                        )}
                        {p.id !== selfId && p.channelId === me?.channelId && (
                          <label className="volume-control">
                            Volume{" "}
                            <input
                              aria-label={"Volume de " + p.profile.name}
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={profile.volumes?.[p.profile.id] ?? 1}
                              onChange={(e) =>
                                saveParticipantVolume(
                                  p.id,
                                  Number(e.target.value),
                                )
                              }
                            />
                          </label>
                        )}
                      </article>
                    ))}
                  {!room.participants.some(
                    (p) => p.channelId === channelId,
                  ) && (
                    <div className="call-empty">
                      <Headphones size={54} />
                      <h2>Uma conversa começa com você.</h2>
                      <p>Entre para falar e compartilhar sua tela.</p>
                    </div>
                  )}
                </div>
              )}
              {me?.channelId === channelId && cameras.length > 0 && (
                <div className="camera-grid">
                  {cameras.map((p) => (
                    <CameraTile
                      key={p.id}
                      stream={
                        p.id === selfId
                          ? media.localCamera
                          : media.cameraStreams?.get(p.id)
                      }
                      name={p.profile.name}
                      local={p.id === selfId}
                      open={() => setWatchCamera(p.id)}
                    />
                  ))}
                </div>
              )}
              {me?.channelId === channelId && streams.length > 0 && (
                <div className="stream-list">
                  {streams.map((p) => (
                    <button
                      key={p.id}
                      className={watch === p.id ? "active" : ""}
                      onClick={() => {
                        setWatchCamera(null);
                        setWatch(p.id);
                      }}
                    >
                      <MonitorUp size={16} />
                      {p.profile.name}
                      <span className="live-label">Ao vivo</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="call-controls">
                {me?.channelId === channelId ? (
                  <>
                    <button
                      className={
                        "control " + (media.cameraActive ? "camera-on" : "")
                      }
                      title={
                        media.cameraActive ? "Desligar câmera" : "Ativar câmera"
                      }
                      disabled={busy}
                      onClick={() =>
                        media.cameraActive
                          ? void run(() => engine.stopCamera())
                          : void open("camera")
                      }
                    >
                      {media.cameraActive ? <VideoOff /> : <Video />}
                    </button>
                    {media.cameraActive && (
                      <button
                        title="Trocar câmera"
                        disabled={busy}
                        onClick={() => void open("camera")}
                      >
                        <Settings size={16} />
                      </button>
                    )}
                    <button
                      className={"control " + (muted ? "muted" : "")}
                      title={muted ? "Ativar microfone" : "Mutar microfone"}
                      onClick={() => void run(toggleMute)}
                    >
                      {muted ? <MicOff /> : <Mic />}
                    </button>
                    <button
                      className="control"
                      title={deafened ? "Ouvir áudio" : "Silenciar áudio"}
                      onClick={() => void run(toggleDeafen)}
                    >
                      {deafened ? <HeadphoneOff /> : <Headphones />}
                    </button>
                    <button
                      className={
                        "share-control " + (media.sharing ? "sharing" : "")
                      }
                      disabled={busy}
                      onClick={() =>
                        media.sharing
                          ? void run(() => engine.stopShare())
                          : void open("share")
                      }
                    >
                      <MonitorUp size={21} />
                      {media.sharing
                        ? "Parar transmissão"
                        : "Compartilhar tela"}
                    </button>
                    {media.sharing && (
                      <select
                        aria-label="Qualidade da transmissão"
                        value={quality}
                        onChange={(e) => {
                          const q = e.target.value as Quality;
                          setQuality(q);
                          void run(() => engine.setQuality(q));
                        }}
                      >
                        {Object.entries(qualities).map(([id, q]) => (
                          <option key={id} value={id}>
                            {q.height}p / {q.fps} FPS
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="control hangup"
                      title="Sair do canal de voz"
                      onClick={() => void run(leaveVoice)}
                    >
                      <PhoneOff />
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void joinVoice(channel)}
                  >
                    <Headphones size={20} />
                    {busy ? "Conectando…" : "Entrar na conversa"}
                  </button>
                )}
              </div>
            </section>
          ) : (
            <div className="welcome">
              <h1>Seu servidor está pronto.</h1>
              <p>Crie um canal para começar.</p>
              {me?.host && (
                <button
                  className="primary"
                  onClick={() => void open("channel")}
                >
                  Criar canal
                </button>
              )}
            </div>
          )}
          {online && hostInfo && (
            <div className="invite-strip">
              <Radio size={14} />
              <span>
                Você está hospedando em {hostInfo.address}:{hostInfo.port}
              </span>
              <button
                onClick={() =>
                  void run(() => window.voxy.copy(hostInfo.invite))
                }
              >
                <Copy size={14} /> Copiar convite
              </button>
            </div>
          )}
        </main>
        {selectedParticipant && (
          <Modal
            title={"Áudio de " + selectedParticipant.profile.name}
            close={() => setParticipantAudio(null)}
          >
            <p>
              Esta opção muda somente o que você ouve. O áudio das transmissões
              tem controle próprio no player.
            </p>
            <button
              className="secondary"
              disabled={!inbox.activeScope}
              onClick={() => {
                if (inbox.activeScope)
                  openDirect({
                    scope: inbox.activeScope,
                    peer: selectedParticipant.profile.id,
                  });
                setParticipantAudio(null);
              }}
            >
              <MessageCircle size={17} />
              Mensagem privada
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await muteParticipant(
                    selectedParticipant.id,
                    !profile.mutedParticipants?.[
                      selectedParticipant.profile.id
                    ],
                  );
                  setParticipantAudio(null);
                })
              }
            >
              {profile.mutedParticipants?.[selectedParticipant.profile.id]
                ? "Ouvir voz novamente"
                : "Mutar voz para mim"}
            </button>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </Modal>
        )}
        {dialog && (
          <Modal
            title={
              {
                host: "Hospedar sua sala",
                join: "Entrar em uma sala",
                profile: "Seu perfil e áudio",
                share: "Compartilhar sua tela",
                server: "Criar servidor",
                channel: "Criar canal",
                manage: "Gerenciar este espaço",
                diagnostics: "Diagnóstico de conexão",
                camera: "Compartilhar webcam",
              }[dialog]
            }
            close={() => {
              if (!busy) setDialog(null);
            }}
          >
            {dialog === "host" && (
              <form
                onSubmit={(e) =>
                  submit(e, async () => {
                    const info = await window.voxy.host({
                      address,
                      port,
                      name,
                    });
                    setHostInfo(info);
                  })
                }
              >
                <p>
                  O computador precisa permanecer ligado. Seus amigos usam o
                  convite e a mesma rede Radmin VPN.
                </p>
                <label>
                  Nome do primeiro servidor
                  <input
                    required
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Endereço de escuta
                  <select
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  >
                    {addresses.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <small>
                  {address === "127.0.0.1"
                    ? "Loopback: apenas este computador. Escolha o IP do Radmin VPN para seus amigos conectarem."
                    : "Prefira o IP 26.x do Radmin VPN. Configure o firewall somente para os amigos."}
                </small>
                <label>
                  Porta
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                  />
                </label>
                <button className="primary" disabled={busy || !name.trim()}>
                  {busy ? "Iniciando…" : "Criar sala / Hospedar servidor"}
                </button>
              </form>
            )}
            {dialog === "join" && (
              <form
                onSubmit={(e) =>
                  submit(e, async () => {
                    engine.leave();
                    await window.voxy.saveProfile(profile);
                    await window.voxy.connect(invite.trim());
                    setHostInfo(undefined);
                  })
                }
              >
                <p>
                  Peça o convite ao host. Os dois computadores devem estar
                  conectados ao Radmin VPN.
                </p>
                <label>
                  Seu nome
                  <input
                    value={profile.name}
                    maxLength={60}
                    required
                    onChange={(e) =>
                      setProfile({ ...profile, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Convite
                  <input
                    value={invite}
                    required
                    maxLength={400}
                    placeholder="voxy://26.x.x.x:43120/segredo"
                    onChange={(e) => setInvite(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? "Conectando…" : "Conectar à sala"}
                </button>
              </form>
            )}
            {dialog === "profile" && (
              <ProfileForm
                presenceSupported={!online || !!room.features?.presence}
                profile={profile}
                setProfile={setProfile}
                devices={devices}
                inputLevel={media.micLevelDb}
                busy={busy}
                onSave={() => void run(() => savePreferences(profile), true)}
              />
            )}
            {dialog === "camera" && (
              <form
                onSubmit={(e) =>
                  submit(e, async () => {
                    await engine.startCamera(cameraDevice);
                    const saved = await window.voxy.saveProfile({
                      ...profile,
                      cameraDevice,
                    });
                    setProfile(saved);
                    engine.configurePreferences(saved);
                    setDevices(await navigator.mediaDevices.enumerateDevices());
                  })
                }
              >
                <p>
                  Sua câmera será transmitida para quem estiver no mesmo canal.
                  Voz e compartilhamento de tela continuam funcionando.
                </p>
                <label>
                  Câmera
                  <select
                    value={cameraDevice}
                    onChange={(e) => setCameraDevice(e.target.value)}
                  >
                    <option value="">Padrão do sistema</option>
                    {devices
                      .filter((d) => d.kind === "videoinput")
                      .map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId}>
                          {d.label || "Câmera " + (i + 1)}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? "Abrindo câmera…" : "Ligar câmera selecionada"}
                </button>
              </form>
            )}
            {dialog === "share" && (
              <ShareForm
                sources={sources}
                source={source}
                setSource={setSource}
                quality={quality}
                setQuality={setQuality}
                systemAudio={systemAudio}
                setSystemAudio={setSystemAudio}
                busy={busy}
                onShare={() =>
                  void run(async () => {
                    await engine.share(source, systemAudio, quality);
                    setWatch(selfId);
                  }, true)
                }
              />
            )}
            {(dialog === "server" || dialog === "channel") && (
              <form
                onSubmit={(e) =>
                  submit(e, () =>
                    dialog === "server"
                      ? command({ type: "server.create", name })
                      : command({
                          type: "channel.create",
                          serverId,
                          name,
                          kind,
                        }),
                  )
                }
              >
                <label>
                  Nome
                  <input
                    required
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </label>
                {dialog === "channel" && (
                  <label>
                    Tipo
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as "text" | "voice")
                      }
                    >
                      <option value="voice">Voz</option>
                      <option value="text">Texto</option>
                    </select>
                  </label>
                )}
                <button className="primary" disabled={busy || !name.trim()}>
                  Criar {dialog === "server" ? "servidor" : "canal"}
                </button>
              </form>
            )}
            {dialog === "manage" && (
              <div className="manage-list">
                {server && (
                  <ServerImage
                    server={server}
                    allowed={server.ownerId === profile.id}
                    busy={busy}
                    save={(image) =>
                      command({ type: "server.icon", id: server.id, image })
                    }
                  />
                )}
                <p>
                  {me?.host
                    ? "Renomeie ou exclua os espaços da sala. Excluir também remove seu histórico."
                    : "Somente o host pode editar estes espaços."}
                </p>
                {server && (
                  <ManageRow
                    name={server.name}
                    disabled={!me?.host || busy}
                    rename={(name) =>
                      run(() =>
                        command({ type: "server.rename", id: server.id, name }),
                      )
                    }
                    remove={() =>
                      run(
                        () => command({ type: "server.delete", id: server.id }),
                        true,
                      )
                    }
                  />
                )}
                <hr />
                {room.channels
                  .filter((c) => c.serverId === serverId)
                  .map((c) => (
                    <ManageRow
                      key={c.id}
                      name={c.name}
                      disabled={!me?.host || busy}
                      rename={(name) =>
                        run(() =>
                          command({ type: "channel.rename", id: c.id, name }),
                        )
                      }
                      remove={() =>
                        run(() => command({ type: "channel.delete", id: c.id }))
                      }
                    />
                  ))}
              </div>
            )}
            {dialog === "diagnostics" && (
              <div className="diagnostics">
                <p>
                  Sinalização: <strong>{status}</strong>. Mídia direta, sem
                  STUN/TURN público.
                </p>
                {media.diagnostics.map((d) => (
                  <article key={d.id}>
                    <h3>
                      {
                        room.participants.find((p) => p.id === d.id)?.profile
                          .name
                      }
                    </h3>
                    <dl>
                      {Object.entries(d)
                        .filter(([key]) => key !== "id")
                        .map(([key, v]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>
                              {v ?? "—"}
                              {key === "rtt"
                                ? " ms"
                                : key === "kbps"
                                  ? " kbps"
                                  : ""}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </article>
                ))}
                {!media.diagnostics.length && (
                  <p>
                    Entre no mesmo canal de voz que um amigo para medir a mídia.
                  </p>
                )}
                <p className="hint">
                  ICE failed: verifique Radmin VPN, ACL e firewall UDP. Sem
                  conexão direta, este MVP não oferece relay. Reconectar a
                  sinalização exige entrar novamente no canal de voz.
                </p>
              </div>
            )}
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </Modal>
        )}
      </div>
    </AvatarImages.Provider>
  );
}
