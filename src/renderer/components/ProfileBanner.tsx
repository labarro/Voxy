import { useContext } from "react";
import { AvatarMotion } from "./Avatar";
import { useMotionAllowed, useStillFrame } from "../motionImages";
/**
 * Profile cover. A GIF animates only when motion is allowed (no reduced
 * motion, window visible, not in low-resource mode); otherwise its first
 * frame is shown. The container clips and crops with object-fit: cover.
 */
export function BannerImage({ src, alt }: { src: string; alt: string }) {
  const { enabled } = useContext(AvatarMotion);
  const allowed = useMotionAllowed() && enabled;
  const gif = src.startsWith("data:image/gif") || src.startsWith("blob:");
  const still = useStillFrame(src, gif && !allowed);
  if (gif && !allowed && !still) return null;
  return (
    <img
      src={gif && !allowed ? still! : src}
      alt={alt}
      decoding="async"
      draggable={false}
      data-animated={gif && allowed ? "true" : undefined}
    />
  );
}
