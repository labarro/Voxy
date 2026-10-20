import { useState } from "react";
import type { Community } from "../../shared/types";
import { Avatar } from "./Avatar";
import { preparePhoto } from "../photos";
export function ServerImage({
  server,
  allowed,
  busy,
  save,
}: {
  server: Community;
  allowed: boolean;
  busy: boolean;
  save: (image: string | null) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  return (
    <section className="server-image-form">
      <Avatar avatar={server.icon ?? "🏠"} className="large-avatar" />
      <div>
        <h3>Imagem do servidor</h3>
        <p className="hint">
          {allowed
            ? "PNG, JPEG ou WebP de até 5 MB. Recorte central de 128 px."
            : "Somente o criador pode alterar esta imagem."}
        </p>
        <label className="photo-file-label">
          Adicionar ou alterar imagem
          <input
            aria-label="Arquivo de imagem do servidor"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!allowed || busy || loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setLoading(true);
              setError("");
              void preparePhoto(file)
                .then(save)
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          />
        </label>
        {server.icon && (
          <button
            disabled={!allowed || busy || loading}
            onClick={() => {
              void save(null).catch((e) => setError(e.message));
            }}
          >
            Remover imagem do servidor
          </button>
        )}
        {loading && <p className="hint">Preparando imagem…</p>}
        {error && (
          <p role="alert" className="modal-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
