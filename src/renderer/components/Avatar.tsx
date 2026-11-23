import { createContext, useContext, useRef } from "react";
import { useMotionSource } from "../motionImages";
export const AvatarImages = createContext<Record<string, string>>({});
/**
 * Animated avatars, keyed by the static avatar value (data URL or
 * "avatar:<sha256>") that every call site already passes, so no call site
 * needs to know about GIFs. `enabled` is off in low-resource mode.
 */
export const AvatarMotion = createContext<{
  map: Record<string, string>;
  enabled: boolean;
}>({ map: {}, enabled: true });
export function Avatar({
  avatar,
  className = "avatar",
  motion,
}: {
  avatar: string;
  className?: string;
  /** Explicit GIF (e.g. an unsaved preview); defaults to the context. */
  motion?: string;
}) {
  const images = useContext(AvatarImages);
  const animated = useContext(AvatarMotion);
  const element = useRef<HTMLSpanElement>(null);
  const value = images[avatar] ?? avatar;
  const image = /^data:image\/(png|jpeg|webp|gif);base64,/.test(value);
  const moving = useMotionSource(
    motion ?? animated.map[avatar],
    element,
    image && (motion !== undefined || animated.enabled),
  );
  return (
    <span
      ref={element}
      className={"profile-avatar " + className}
      data-animated={moving ? "true" : undefined}
    >
      {image ? (
        <img
          src={moving ?? value}
          alt="Foto de perfil"
          decoding="async"
          draggable={false}
          onError={(e) => {
            // A GIF that fails to render falls back to the still avatar.
            if (moving && e.currentTarget.src !== value)
              e.currentTarget.src = value;
          }}
        />
      ) : (
        <span>{value.startsWith("avatar:") ? "👤" : value}</span>
      )}
    </span>
  );
}
