import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Participant, ServerRole } from "../../shared/types";
import { Avatar } from "./Avatar";
import { Presence } from "./Presence";
import { RoleBadges } from "./Roles";

export function ParticipantMenu({
  x,
  y,
  name,
  muted,
  volume,
  close,
  toggleMute,
  changeVolume,
  direct,
  profile,
  roles = [],
  color,
  audioAvailable = true,
  addFriend,
  call,
  offline = false,
}: {
  x: number;
  y: number;
  name: string;
  muted: boolean;
  volume: number;
  close: () => void;
  toggleMute: () => void;
  changeVolume: (value: number) => void;
  direct?: () => void;
  profile?: Participant["profile"];
  roles?: ServerRole[];
  color?: string;
  audioAvailable?: boolean;
  addFriend?: () => void;
  call?: () => void;
  offline?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [banner, setBanner] = useState("");
  const [bannerError, setBannerError] = useState(false);
  useEffect(() => {
    let alive = true;
    setBannerError(false);
    const value = profile?.banner || "";
    if (!value.startsWith("avatar:")) {
      setBanner(value);
      return;
    }
    setBanner("");
    void window.voxy
      .profileImage(value)
      .then((image) => {
        if (alive) setBanner(image);
      })
      .catch(() => {
        if (alive) setBannerError(true);
      });
    return () => {
      alive = false;
    };
  }, [profile?.banner]);
  useLayoutEffect(() => {
    const el = root.current!;
    const r = el.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, innerHeight - r.height - 8)),
    });
    const previous = document.activeElement as HTMLElement | null;
    el.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!el.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const scrolled = (event: Event) => {
      if (!el.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      if (el.contains(document.activeElement)) previous?.focus();
    };
  }, [x, y]);
  return createPortal(
    <div
      ref={root}
      style={position}
      className="participant-menu"
      role="dialog"
      aria-label={"Perfil de " + name}
      onContextMenu={(e) => e.preventDefault()}
    >
      {profile && (
        <>
          <div className="profile-banner">
            {banner ? (
              <img src={banner} alt={"Capa de " + name} />
            ) : (
              <span aria-hidden="true">✦</span>
            )}
          </div>
          <Avatar avatar={profile.avatar} className="mini-profile-avatar" />
        </>
      )}
      <strong style={{ color }}>{name}</strong>
      {bannerError && (
        <small>Capa indisponível. Abra o perfil novamente para tentar.</small>
      )}
      {profile && (
        <Presence value={offline ? "offline" : profile.presence} label />
      )}
      <RoleBadges roles={roles} />
      {audioAvailable && (
        <>
          <button type="button" onClick={toggleMute} aria-pressed={muted}>
            {muted ? "Ouvir voz novamente" : "Mutar voz para mim"}
          </button>
          <label>
            Volume individual <output>{Math.round(volume * 100)}%</output>
            <input
              aria-label={"Volume de " + name}
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
            />
          </label>
          <small>Somente a voz, para você.</small>
        </>
      )}
      {direct && (
        <button type="button" onClick={direct}>
          Mensagem privada
        </button>
      )}
      {addFriend && <button onClick={addFriend}>Adicionar amigo</button>}
      {call && <button onClick={call}>Ligar</button>}
      <button type="button" className="menu-close" onClick={close}>
        Fechar
      </button>
    </div>,
    document.body,
  );
}
