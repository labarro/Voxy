import { createRoot } from "react-dom/client";
import { useState } from "react";
import RoomView from "../src/renderer/room3d/RoomView";
import { RoomSettings } from "../src/renderer/room3d/RoomSettings";
import { MediaGallery } from "../src/renderer/components/MediaGallery";
import { VoicePlayback } from "../src/services/webrtc/voicePlayback";
import type { VoiceEngine } from "../src/services/webrtc/engine";
import type {
  Command,
  Participant,
  Profile,
  RoomPreset,
} from "../src/shared/types";
import {
  defaultAvatar,
  defaultRoomSettings,
  spawnPose,
} from "../src/shared/room3d";

const w = window as any;
const canvas = document.createElement("canvas");
canvas.width = 640;
canvas.height = 360;
const ctx = canvas.getContext("2d")!;
setInterval(() => {
  ctx.fillStyle = "#24ae86";
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = "white";
  ctx.font = "60px sans-serif";
  ctx.fillText("TV VOXY", 100, 200);
}, 80);
const stream = canvas.captureStream(12);
const people: Participant[] = [
  {
    id: "self",
    profile: {
      id: "self",
      name: "Luisa",
      avatar: "L",
      avatar3d: defaultAvatar,
    },
    channelId: "voice",
    host: true,
    muted: false,
    deafened: false,
    sharing: false,
  },
  {
    id: "friend",
    profile: {
      id: "friend",
      name: "Amigo",
      avatar: "A",
      avatar3d: { ...defaultAvatar, color: "#d88968" },
    },
    channelId: "voice",
    host: false,
    muted: false,
    deafened: false,
    sharing: true,
    camera: true,
    roomPose: { ...spawnPose(), x: 3, z: 0 },
  },
  {
    id: "other",
    profile: { id: "other", name: "Outra tela", avatar: "B" },
    channelId: "voice",
    host: false,
    muted: false,
    deafened: false,
    sharing: true,
  },
];
const engine = {
  setSpatialMix: (mix: Map<string, unknown>) => {
    w.mix = Object.fromEntries(mix);
  },
  setViewing: (screens: string[], cameras: string[]) => {
    w.viewing = { screens, cameras };
  },
} as unknown as VoiceEngine;
w.commands = [];
w.testVoiceSpatial = async () => {
  const audio = new AudioContext();
  await audio.resume();
  const osc = audio.createOscillator();
  const dest = audio.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const playback = new VoicePlayback(audio, dest.stream, 0.3),
    source = audio.createMediaStreamSource(playback.stream),
    split = audio.createChannelSplitter(2);
  source.connect(split);
  const left = audio.createAnalyser(),
    right = audio.createAnalyser();
  split.connect(left, 0);
  split.connect(right, 1);
  const read = async () => {
    await new Promise((r) => setTimeout(r, 700));
    return [left, right].map((an) => {
      const v = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(v);
      return Math.sqrt(v.reduce((s, n) => s + n * n, 0) / v.length);
    });
  };
  const normal = await read();
  playback.spatial(0, 0);
  const far = await read();
  playback.spatial(1, 1);
  const panned = await read();
  playback.spatial();
  const restored = await read();
  playback.close();
  osc.stop();
  source.disconnect();
  split.disconnect();
  await audio.close();
  return { normal, far, panned, restored };
};
function Fixture() {
  const [active, setActive] = useState(true),
    [preset, setPreset] = useState<RoomPreset>("lounge"),
    [tv, setTv] = useState<string | null>(null),
    [tvSelection, setTvSelection] = useState<string | undefined>(),
    [focus, setFocus] = useState<string | null>(null),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false);
  const [profile, setProfile] = useState<Profile>({
    id: "self",
    name: "Luisa",
    avatar: "L",
    input: "",
    output: "",
    avatar3d: defaultAvatar,
    room3d: defaultRoomSettings,
  });
  people[0].profile.avatar3d = profile.avatar3d;
  const media = {
    streams: new Map([
      ["friend", stream],
      ["other", stream],
    ]),
    cameraStreams: new Map([["friend", stream]]),
    speaking: new Set(["friend"]),
    diagnostics: [],
    sharing: false,
    error: "",
  };
  const command = async (c: Command) => {
    w.commands.push(c);
    if (c.type === "room.pose") people[0].roomPose = c.pose ?? undefined;
    if (c.type === "room.tv") setTvSelection(c.participantId);
  };
  w.pose = () => people[0].roomPose;
  w.profile = () => profile;
  return (
    <main style={{ padding: 16 }}>
      <button onClick={() => setActive((v) => !v)}>
        {active ? "Tradicional" : "Entrar 3D"}
      </button>
      <button
        onClick={() => setPreset((p) => (p === "lounge" ? "cinema" : "lounge"))}
      >
        Trocar ambiente
      </button>
      <button onClick={() => setSettings((v) => !v)}>Personalizar</button>
      <p role="status">{error}</p>
      {settings && <RoomSettings profile={profile} change={setProfile} />}
      {active && (
        <RoomView
          key={preset}
          preset={preset}
          selfId="self"
          people={people}
          profile={profile}
          media={media}
          engine={engine}
          command={command}
          onSource={setTv}
          sourceId={tvSelection}
          paused={settings}
          focus={(id) => setFocus("screen:" + id)}
          fallback={(message) => {
            setError(message);
            setActive(false);
          }}
        />
      )}
      <MediaGallery
        participants={people}
        selfId="self"
        profile={profile}
        media={media}
        deafened={false}
        focus={focus}
        onFocus={setFocus}
        onViewing={(s, c) => engine.setViewing(s, c)}
        onVolume={() => {}}
        television={active ? tv : undefined}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
