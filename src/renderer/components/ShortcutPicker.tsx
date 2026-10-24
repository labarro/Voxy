import { useState } from "react";
import {
  isPttKey,
  shortcutLabel,
  type VoiceShortcut,
} from "../../shared/preferences";
export function ShortcutPicker({
  label,
  value,
  change,
  onRecording,
}: {
  label: string;
  value?: VoiceShortcut | null;
  change: (s: VoiceShortcut | null) => void;
  onRecording: (active: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  function record(active: boolean) {
    setRecording(active);
    onRecording(active);
    setError("");
  }
  function capture(
    key: string,
    e: {
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      metaKey: boolean;
    },
  ) {
    if (key === "Escape") {
      record(false);
      return;
    }
    if (/^(Control|Alt|Shift|Meta)/.test(key)) return;
    if (!isPttKey(key) || e.metaKey) {
      setError("Use uma tecla com Ctrl, Alt ou Shift, ou Mouse 4/5.");
      return;
    }
    change({ key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
    record(false);
  }
  return (
    <fieldset>
      <legend>{label}</legend>
      <button
        type="button"
        className={recording ? "chosen" : ""}
        aria-label={"Configurar " + label}
        onClick={() => record(!recording)}
        onBlur={() => record(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) capture(e.code, e);
        }}
        onPointerDown={(e) => {
          if (!recording || ![3, 4].includes(e.button)) return;
          e.preventDefault();
          e.stopPropagation();
          capture(e.button === 3 ? "Mouse4" : "Mouse5", e);
        }}
        onAuxClick={(e) => e.preventDefault()}
      >
        {recording
          ? "Pressione a combinação ou Mouse 4/5 (Esc cancela)…"
          : shortcutLabel(value) + " — alterar"}
      </button>
      <button
        type="button"
        disabled={!value}
        onClick={() => {
          change(null);
          record(false);
        }}
      >
        Remover atalho
      </button>
      {error && <small role="alert">{error}</small>}
    </fieldset>
  );
}
