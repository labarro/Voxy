import { useRef, useState } from "react";
import type { Profile } from "../../shared/types";
export function accentInk(color: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#141019"
    : "#ffffff";
}

export const themes = {
  voxy: {
    name: "Voxy",
    base: "#232b3b",
    surface: "#1b2130",
    deep: "#131722",
    accent: "#a69bff",
  },
  ocean: {
    name: "Oceano",
    base: "#142c3c",
    surface: "#102432",
    deep: "#0b1b27",
    accent: "#65c9ef",
  },
  forest: {
    name: "Bosque",
    base: "#21332e",
    surface: "#192a25",
    deep: "#12211d",
    accent: "#8bd9b1",
  },
  kuromi: {
    name: "Kuromi",
    base: "#292033",
    surface: "#201827",
    deep: "#141019",
    accent: "#ca9cf5",
  },
};
export function KuromiMark() {
  return (
    <svg className="kuromi-mark" viewBox="0 0 100 90" aria-hidden="true">
      <path
        d="M20 42 8 8 37 24Q50 16 63 24L92 8 80 42Q93 73 73 81H27Q7 73 20 42Z"
        fill="#141019"
        stroke="#c99cf1"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="5" fill="#e9a3cd" />
      <circle cx="92" cy="8" r="5" fill="#e9a3cd" />
      <path
        d="M24 51Q33 39 50 55Q67 39 76 51Q84 78 50 80Q16 78 24 51Z"
        fill="#f5eaf9"
      />
      <path
        d="M36 60 43 64M64 60 57 64"
        fill="none"
        stroke="#231629"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse cx="50" cy="69" rx="3" ry="2" fill="#ef9ec7" />
      <ellipse cx="30" cy="68" rx="5" ry="3" fill="#efa9ce" />
      <ellipse cx="70" cy="68" rx="5" ry="3" fill="#efa9ce" />
      <path
        d="M40 33Q40 24 50 24Q60 24 60 33Q60 38 55 39V44H45V39Q40 38 40 33Z"
        fill="#eba0cc"
      />
      <circle cx="46" cy="33" r="2.5" fill="#211426" />
      <circle cx="54" cy="33" r="2.5" fill="#211426" />
    </svg>
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
            aria-pressed={(profile.theme || "voxy") === id}
            onClick={() =>
              change({ ...profile, theme: id as Profile["theme"] })
            }
          >
            <span
              className="theme-swatch"
              style={{ background: theme.base, borderColor: theme.accent }}
            >
              <span style={{ background: theme.accent }} />
              {id === "kuromi" && (
                <span className="kuromi-motif">
                  <KuromiMark />
                </span>
              )}
            </span>
            {theme.name}
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
