const key = (label: string, vk: number) => ({ label, vk });
export const PTT_KEYS: Record<string, { label: string; vk: number }> = {
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      "Key" + String.fromCharCode(65 + i),
      key(String.fromCharCode(65 + i), 65 + i),
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => ["Digit" + i, key(String(i), 48 + i)]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      "Numpad" + i,
      key("Num " + i, 96 + i),
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [
      "F" + (i + 1),
      key("F" + (i + 1), 112 + i),
    ]),
  ),
  Backspace: key("Backspace", 8),
  Tab: key("Tab", 9),
  Enter: key("Enter", 13),
  Escape: key("Esc", 27),
  CapsLock: key("Caps Lock", 20),
  ShiftLeft: key("Shift esquerdo", 160),
  ShiftRight: key("Shift direito", 161),
  ControlLeft: key("Ctrl esquerdo", 162),
  AltLeft: key("Alt esquerdo", 164),
  MetaLeft: key("Windows esquerdo", 91),
  MetaRight: key("Windows direito", 92),
  ArrowLeft: key("Seta esquerda", 37),
  ArrowUp: key("Seta acima", 38),
  ArrowRight: key("Seta direita", 39),
  ArrowDown: key("Seta abaixo", 40),
  Home: key("Home", 36),
  End: key("End", 35),
  PageUp: key("Page Up", 33),
  PageDown: key("Page Down", 34),
  Insert: key("Insert", 45),
  Delete: key("Delete", 46),
  Pause: key("Pause", 19),
  PrintScreen: key("Print Screen", 44),
  NumLock: key("Num Lock", 144),
  ScrollLock: key("Scroll Lock", 145),
  ContextMenu: key("Menu", 93),
  NumpadMultiply: key("Num *", 106),
  NumpadAdd: key("Num +", 107),
  NumpadSubtract: key("Num -", 109),
  NumpadDecimal: key("Num .", 110),
  NumpadDivide: key("Num /", 111),
  NumpadEnter: key("Num Enter", 13),
  Semicolon: key(";", 186),
  Equal: key("=", 187),
  Comma: key(",", 188),
  Minus: key("-", 189),
  Period: key(".", 190),
  Slash: key("/", 191),
  Backquote: key("`", 192),
  BracketLeft: key("[", 219),
  Backslash: key("\\", 220),
  BracketRight: key("]", 221),
  Quote: key("'", 222),
  IntlBackslash: key("\\ (internacional)", 226),
  Space: { label: "Espaço", vk: 32 },
  KeyV: { label: "V", vk: 86 },
  KeyB: { label: "B", vk: 66 },
  ControlRight: { label: "Ctrl direito", vk: 163 },
  AltRight: { label: "Alt direito", vk: 165 },
  F8: { label: "F8", vk: 119 },
  F9: { label: "F9", vk: 120 },
} as const;
export type PttKey = keyof typeof PTT_KEYS;
export function isPttKey(code: string) {
  return Object.hasOwn(PTT_KEYS, code);
}
export function microphoneMuted(
  manual: boolean,
  ptt: boolean,
  pressed: boolean,
) {
  return manual || (ptt && !pressed);
}
