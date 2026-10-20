import { createContext, useContext } from "react";
export const AvatarImages = createContext<Record<string, string>>({});
export function Avatar({
  avatar,
  className = "avatar",
}: {
  avatar: string;
  className?: string;
}) {
  const images = useContext(AvatarImages);
  const value = images[avatar] ?? avatar;
  const image = /^data:image\/(png|jpeg|webp);base64,/.test(value);
  return (
    <span className={"profile-avatar " + className}>
      {image ? (
        <img src={value} alt="Foto de perfil" />
      ) : (
        <span>{value.startsWith("avatar:") ? "👤" : value}</span>
      )}
    </span>
  );
}
