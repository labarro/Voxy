import { useEffect, useRef, useState } from "react";
import {
  Hand,
  Smile,
  Music,
  PartyPopper,
  Handshake,
  Pointer,
  Armchair,
  Camera,
  Sparkles,
  Cigarette,
  Pause,
  HandMetal,
} from "lucide-react";
import type { RoomPose } from "../../shared/types";
type Emote = NonNullable<RoomPose["emote"]>;
export const SOCIAL_EMOTES = [
  { id: "wave", label: "Acenar", icon: Hand },
  { id: "laugh", label: "Rir", icon: Smile },
  { id: "dance", label: "Dançar", icon: Music },
  { id: "clap", label: "Aplaudir", icon: HandMetal },
  { id: "celebrate", label: "Comemorar", icon: PartyPopper },
  { id: "greet", label: "Cumprimentar", icon: Handshake },
  { id: "point", label: "Apontar", icon: Pointer },
  { id: "sitfloor", label: "Sentar no chão", icon: Armchair },
  { id: "pose", label: "Fazer pose", icon: Camera },
  { id: "surprise", label: "Surpresa", icon: Sparkles },
  { id: "smoke", label: "Cigarro virtual", icon: Cigarette },
  { id: "none", label: "Parar ação", icon: Pause },
] satisfies { id: Emote; label: string; icon: typeof Hand }[];
export function EmoteWheel({
  choose,
  preview,
  close,
}: {
  choose: (v: Emote) => void;
  preview: (v?: Emote) => void;
  close: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    [selected, setSelected] = useState<number>();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => {
      preview();
      before?.focus();
    };
  }, []);
  const select = (index: number | undefined) => {
    setSelected(index);
    preview(index === undefined ? undefined : SOCIAL_EMOTES[index].id);
  };
  return (
    <div
      className="emote-wheel-shade"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="emote-wheel"
        ref={root}
        role="menu"
        aria-label="Emotes e ações"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          } else if (
            ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)
          ) {
            e.preventDefault();
            select(
              ((selected ?? 0) +
                (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1) +
                12) %
                12,
            );
          } else if (e.key === "Enter" && selected !== undefined) {
            choose(SOCIAL_EMOTES[selected].id);
          }
        }}
      >
        <div className="emote-wheel-center">
          <strong>
            {selected === undefined
              ? "O que você quer fazer?"
              : SOCIAL_EMOTES[selected].label}
          </strong>
          <span>Esc para cancelar</span>
        </div>
        {SOCIAL_EMOTES.map((item, i) => {
          const angle = (i / 12) * Math.PI * 2 - Math.PI / 2,
            Icon = item.icon;
          return (
            <button
              key={item.id}
              role="menuitem"
              aria-label={item.label}
              className={selected === i ? "is-selected" : ""}
              style={{
                left: `calc(50% + ${Math.cos(angle) * 139}px)`,
                top: `calc(50% + ${Math.sin(angle) * 139}px)`,
              }}
              onPointerEnter={() => select(i)}
              onFocus={() => select(i)}
              onClick={() => choose(item.id)}
            >
              <Icon size={23} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
