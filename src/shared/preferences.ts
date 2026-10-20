export const PTT_KEYS = {
  Space: { label: "Espaço", vk: 32 },
  KeyV: { label: "V", vk: 86 },
  KeyB: { label: "B", vk: 66 },
  ControlRight: { label: "Ctrl direito", vk: 163 },
  AltRight: { label: "Alt direito", vk: 165 },
  F8: { label: "F8", vk: 119 },
  F9: { label: "F9", vk: 120 },
} as const;
export type PttKey = keyof typeof PTT_KEYS;
export function microphoneMuted(
  manual: boolean,
  ptt: boolean,
  pressed: boolean,
) {
  return manual || (ptt && !pressed);
}
