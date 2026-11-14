import type { Profile } from "./types";
export const EMOTE_KEYS = ["KeyG", "KeyB", "KeyH", "KeyN"] as const;
export function emoteKey(profile: Profile) {
  const reserved = [
    profile.pttEnabled ? (profile.pttKey ?? "KeyV") : undefined,
    profile.muteShortcut?.key,
    profile.deafenShortcut?.key,
  ];
  return [profile.room3d?.emoteKey ?? "KeyG", ...EMOTE_KEYS].find(
    (key) => !reserved.includes(key),
  );
}
