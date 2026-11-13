import { useRef, useState, type CSSProperties } from "react";
import type { Profile } from "../../shared/types";
function luminance(color: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function accentInk(color: string) {
  if (contrast(color, "#141019") >= 4.5) return "#141019";
  return contrast(color, "#ffffff") >= 4.5 ? "#ffffff" : "#000000";
}
function readableAccent(color: string, base: string) {
  for (let step = 0; step <= 20; step++) {
    const mix = step / 20;
    const candidate =
      "#" +
      [1, 3, 5]
        .map((i) =>
          Math.round(
            parseInt(color.slice(i, i + 2), 16) * (1 - mix) + 255 * mix,
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (contrast(candidate, base) >= 4.5) return candidate;
  }
  return "#ffffff";
}

export const themes = {
  voxy: {
    name: "Voxy",
    base: "#222c33",
    surface: "#1b252d",
    deep: "#141e26",
    accent: "#8dc7df",
    warm: "#d9b17c",
    good: "#8ccbb1",
    muted: "#96a9b4",
    description: "Ardósia e azul mineral",
  },
  ocean: {
    name: "Oceano",
    base: "#20313d",
    surface: "#192934",
    deep: "#12202c",
    accent: "#8ccfe7",
    warm: "#d3c39d",
    good: "#8acfc6",
    muted: "#97adb9",
    description: "Azul profundo e névoa",
  },
  forest: {
    name: "Bosque",
    base: "#28352f",
    surface: "#202c26",
    deep: "#17231e",
    accent: "#accdb4",
    warm: "#d6bd8c",
    good: "#99cbb4",
    muted: "#a1b1a4",
    description: "Verde folha e madeira",
  },
  kuromi: {
    name: "Kuromi",
    base: "#2b2631",
    surface: "#221e29",
    deep: "#18151f",
    accent: "#ffa4d7",
    warm: "#d2b2ff",
    good: "#acd2c5",
    muted: "#b6a8c2",
    description: "Rosa luminoso, ameixa e lavanda",
  },
};
// The shell and the settings preview consume the same complete semantic palette.
export function themeVariables(
  profile: Pick<Profile, "theme" | "accentColor">,
): CSSProperties {
  const id = profile.theme || "voxy",
    t = themes[id],
    accent = profile.accentColor || t.accent;
  return {
    "--base": t.base,
    "--surface": t.surface,
    "--deep": t.deep,
    "--accent": accent,
    "--accent-readable": readableAccent(accent, t.base),
    "--accent-ink": accentInk(accent),
    "--signal-warm": t.warm,
    "--signal-good": t.good,
    "--text-muted": t.muted,
    "--text-primary": id === "kuromi" ? "#f3eaf5" : "#e9eff1",
    "--text-secondary": id === "kuromi" ? "#cbbdd2" : "#b1bfc8",
    "--line": id === "kuromi" ? "#e6cfe516" : "#c6dce013",
    "--line-strong": id === "kuromi" ? "#e6cfe52c" : "#c6dce027",
  } as CSSProperties;
}
export function KuromiMark() {
  return (
    <img
      className="kuromi-mark"
      src="./assets/themes/kuromi/portrait.png"
      alt=""
      aria-hidden="true"
    />
  );
}
export function KuromiArtwork({
  variant = "portrait",
  className = "",
}: {
  variant?: "portrait" | "gallery";
  className?: string;
}) {
  return (
    <img
      className={"kuromi-artwork " + className}
      src={`./assets/themes/kuromi/${variant}.png`}
      alt="Kuromi — ilustração da Sanrio"
      decoding="async"
    />
  );
}
export function ThemePicker({
  profile,
  change,
}: {
  profile: Profile;
  change: (p: Profile) => void;
}) {
  return (
    <>
      <p className="hint">Escolha um tema pronto e a sua cor principal.</p>
      <div className="theme-options">
        {Object.entries(themes).map(([id, theme]) => (
          <button
            type="button"
            key={id}
            aria-label={theme.name}
            aria-pressed={(profile.theme || "voxy") === id}
            onClick={() =>
              change({ ...profile, theme: id as Profile["theme"] })
            }
          >
            <span
              className="theme-swatch"
              style={{ background: theme.base, borderColor: theme.deep }}
            >
              <span style={{ background: theme.accent }} />
              {id === "kuromi" && (
                <span className="kuromi-motif">
                  <KuromiMark />
                </span>
              )}
            </span>
            {theme.name}
            <small>{theme.description}</small>
          </button>
        ))}
      </div>
      <label>
        Cor principal
        <input
          aria-label="Cor principal"
          type="color"
          value={profile.accentColor || themes[profile.theme || "voxy"].accent}
          onChange={(e) => change({ ...profile, accentColor: e.target.value })}
        />
      </label>
      <button
        type="button"
        onClick={() => change({ ...profile, accentColor: "" })}
      >
        Restaurar cor do tema
      </button>
    </>
  );
}
export function BannerPicker({
  value,
  change,
  onBusy,
}: {
  value: string;
  change: (value: string) => void;
  onBusy?: (value: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const changeRef = useRef(change);
  changeRef.current = change;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function choose(file?: File) {
    if (!file) return;
    setBusy(true);
    onBusy?.(true);
    setError("");
    let bitmap: ImageBitmap | undefined;
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw Error("Escolha PNG, JPEG ou WebP de até 5 MB.");
      bitmap = await createImageBitmap(file);
      if (
        bitmap.width > 8192 ||
        bitmap.height > 8192 ||
        bitmap.width * bitmap.height > 24000000
      )
        throw Error("A imagem deve ter até 8192 px / 24 megapixels.");
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 360;
      const scale = Math.max(960 / bitmap.width, 360 / bitmap.height);
      canvas
        .getContext("2d")!
        .drawImage(
          bitmap,
          (960 - bitmap.width * scale) / 2,
          (360 - bitmap.height * scale) / 2,
          bitmap.width * scale,
          bitmap.height * scale,
        );
      let data = canvas.toDataURL("image/webp", 0.82);
      if (data.length > 174760) data = canvas.toDataURL("image/webp", 0.55);
      if (data.length > 174760)
        throw Error(
          "Escolha uma imagem mais simples para a capa (até 128 KB após redução).",
        );
      changeRef.current(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      bitmap?.close();
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <div className="banner-picker">
      <h3>Capa do perfil</h3>
      <div className="profile-banner">
        {value ? (
          <img src={value} alt="Prévia da sua capa" />
        ) : (
          <span>Seu espaço, seu estilo.</span>
        )}
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Arquivo de capa do perfil"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy
            ? "Preparando capa…"
            : value
              ? "Alterar capa"
              : "Adicionar capa"}
        </button>
        {value && (
          <button type="button" disabled={busy} onClick={() => change("")}>
            Remover capa
          </button>
        )}
      </div>
      <small>
        Recorte central de 960 × 360 px. Salve as configurações para
        compartilhar.
      </small>
      {error && (
        <p role="alert" className="modal-error">
          {error}
        </p>
      )}
    </div>
  );
}
