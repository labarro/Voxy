import { useRef, useState, type CSSProperties } from "react";
import type { Profile } from "../../shared/types";
import { BannerImage } from "./ProfileBanner";
import { prepareProfileGif, readGif } from "../profileGif";
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

// Voxy 1.5 "Nocturne glass": the palette designed for the native 2.0 betas
// (native/crates/voxy-desktop/src/design.rs), carried to Electron. Surfaces step
// from the window floor (base) up to floating layers (elevated). Communication
// colors (speaking, danger, warning, live) are fixed across themes in CSS.
type Palette = {
  name: string;
  description: string;
  base: string;
  rail: string;
  sidebar: string;
  canvas: string;
  panel: string;
  elevated: string;
  accent: string;
  onAccent: string;
  secondary: string;
  ink: string;
  soft: string;
  muted: string;
  faint: string;
  line: string;
  /** Legacy roles kept for the 3D rooms, games and older components. */
  surface: string;
  deep: string;
  warm: string;
  good: string;
};
const ink = {
  ink: "#eceef3",
  soft: "#c4c8d3",
  muted: "#a3a8b6",
  faint: "#6c7180",
  line: "#ffffff13",
};
export const themes: Record<"voxy" | "ocean" | "forest" | "kuromi", Palette> =
  {
    voxy: {
      name: "Voxy",
      description: "Noturno com lilás",
      base: "#0a0c11",
      rail: "#0b0d12",
      sidebar: "#10131a",
      canvas: "#13161e",
      panel: "#1a1e28",
      elevated: "#222734",
      accent: "#9b8cff",
      onAccent: "#06051a",
      secondary: "#6fd6c9",
      ...ink,
      surface: "#10131a",
      deep: "#0a0c11",
      warm: "#f5b94a",
      good: "#3ddc84",
    },
    ocean: {
      name: "Oceano",
      description: "Azul profundo e ciano",
      base: "#07121a",
      rail: "#08131b",
      sidebar: "#0c1a23",
      canvas: "#0f1f29",
      panel: "#152a36",
      elevated: "#1c3443",
      accent: "#5fc8e6",
      onAccent: "#020c14",
      secondary: "#7aa7ff",
      ...ink,
      muted: "#a2b1bb",
      surface: "#0c1a23",
      deep: "#07121a",
      warm: "#f5b94a",
      good: "#3ddc84",
    },
    forest: {
      name: "Bosque",
      description: "Verde folha e madeira",
      base: "#0b110d",
      rail: "#0c120e",
      sidebar: "#111912",
      canvas: "#141d16",
      panel: "#1b261d",
      elevated: "#243127",
      accent: "#a3cf7e",
      onAccent: "#081205",
      secondary: "#d8c08a",
      ...ink,
      muted: "#a7b0a5",
      surface: "#111912",
      deep: "#0b110d",
      warm: "#d8c08a",
      good: "#3ddc84",
    },
    kuromi: {
      name: "Kuromi",
      description: "Rosa luminoso, ameixa e lavanda",
      base: "#110c15",
      rail: "#120d16",
      sidebar: "#19121e",
      canvas: "#1d1523",
      panel: "#271c2f",
      elevated: "#31243b",
      accent: "#f39bcb",
      onAccent: "#1c0814",
      secondary: "#b89cf2",
      ink: "#f3eaf5",
      soft: "#d6c8dc",
      muted: "#b9a8c4",
      faint: "#7c6c88",
      line: "#f0d6ee17",
      surface: "#19121e",
      deep: "#110c15",
      warm: "#b89cf2",
      good: "#3ddc84",
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
    "--vx-base": t.base,
    "--vx-rail": t.rail,
    "--vx-sidebar": t.sidebar,
    "--vx-canvas": t.canvas,
    "--vx-panel": t.panel,
    "--vx-elevated": t.elevated,
    "--vx-secondary": t.secondary,
    "--vx-faint": t.faint,
    // Legacy role names, now mapped onto the Nocturne surfaces.
    "--base": t.canvas,
    "--surface": t.sidebar,
    "--deep": t.base,
    "--accent": accent,
    "--accent-readable": readableAccent(accent, t.panel),
    "--accent-ink": profile.accentColor ? accentInk(accent) : t.onAccent,
    "--signal-warm": t.warm,
    "--signal-good": t.good,
    "--text-primary": t.ink,
    "--text-secondary": t.soft,
    "--text-muted": t.muted,
    "--line": t.line,
    "--line-strong": id === "kuromi" ? "#f0d6ee26" : "#ffffff22",
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
              style={
                {
                  "--sw-top": theme.elevated,
                  "--sw-bg": theme.panel,
                  "--sw-accent": theme.accent,
                } as CSSProperties
              }
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
      if (file.type === "image/gif") {
        // Animated GIFs stay animated (kept or re-encoded as GIF); a
        // single-frame GIF continues through the still pipeline below.
        const { info } = await readGif(file);
        if (info.frames > 1) {
          const { gif } = await prepareProfileGif(file, "banner");
          changeRef.current(gif);
          return;
        }
      } else if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw Error("Escolha PNG, JPEG, WebP ou GIF de até 5 MB.");
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
          <BannerImage src={value} alt="Prévia da sua capa" />
        ) : (
          <span>Seu espaço, seu estilo.</span>
        )}
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
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
        Recorte central de 960 × 360 px. PNG, JPEG, WebP ou GIF animado
        (até 1 MB após o ajuste). Salve as configurações para compartilhar.
      </small>
      {error && (
        <p role="alert" className="modal-error">
          {error}
        </p>
      )}
    </div>
  );
}
