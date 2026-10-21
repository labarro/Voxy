import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
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
      aria-label={"Áudio de " + name}
      onContextMenu={(e) => e.preventDefault()}
    >
      <strong>{name}</strong>
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
      {direct && (
        <button type="button" onClick={direct}>
          Mensagem privada
        </button>
      )}
      <button type="button" className="menu-close" onClick={close}>
        Fechar
      </button>
    </div>,
    document.body,
  );
}
