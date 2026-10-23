import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MediaGallery } from "../src/renderer/components/MediaGallery";
import type { Participant } from "../src/shared/types";
const sources = new Map<string, MediaStream>();
const timers: ReturnType<typeof setInterval>[] = [];
for (const [id, color] of [
  ["a", "#855acd"],
  ["b", "#2b9b88"],
  ["camera", "#d36f9e"],
]) {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 360;
  const draw = () => {
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "white";
    ctx.font = "24px sans-serif";
    ctx.fillText(id + " · " + Date.now(), 20, 40);
  };
  draw();
  timers.push(setInterval(draw, 100));
  sources.set(id, c.captureStream(10));
}
const participants: Participant[] = [
  {
    id: "a",
    profile: { id: "a", name: "Ana", avatar: "A" },
    channelId: "voice",
    muted: false,
    deafened: false,
    sharing: true,
    camera: true,
    host: true,
  },
  {
    id: "b",
    profile: { id: "b", name: "Bruno", avatar: "B" },
    channelId: "voice",
    muted: false,
    deafened: false,
    sharing: true,
    camera: false,
    host: false,
  },
];
function Fixture() {
  const [focus, setFocus] = useState<string | null>(null),
    [background, setBackground] = useState(false);
  (window as any).setGalleryBackground = setBackground;
  return (
    <div className="call-view" style={{ height: "100vh", overflow: "auto" }}>
      <MediaGallery
        background={background}
        participants={participants}
        selfId="local"
        profile={{
          id: "local",
          name: "Local",
          avatar: "L",
          input: "",
          output: "",
        }}
        media={{
          streams: new Map([
            ["a", sources.get("a")!],
            ["b", sources.get("b")!],
          ]),
          cameraStreams: new Map([["a", sources.get("camera")!]]),
          speaking: new Set(),
          diagnostics: [],
          sharing: false,
          error: "",
        }}
        deafened={false}
        focus={focus}
        onFocus={setFocus}
        onViewing={(screens, cameras) => {
          (window as any).viewing = { screens, cameras };
        }}
        onVolume={(id, value) => {
          (window as any).volume = { id, value };
        }}
      />
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);
(window as any).stopGallery = () => {
  root.unmount();
  for (const timer of timers) clearInterval(timer);
  for (const stream of sources.values())
    stream.getTracks().forEach((t) => t.stop());
  return [...sources.values()].every((s) =>
    s.getTracks().every((t) => t.readyState === "ended"),
  );
};
