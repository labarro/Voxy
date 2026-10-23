import { useState } from "react";
import { messageParts } from "../../shared/links";
import type { Participant } from "../../shared/types";
export function MessageText({
  text,
  profiles,
  onProfile,
}: {
  text: string;
  profiles?: Record<string, Participant["profile"]>;
  onProfile?: (id: string, x: number, y: number) => void;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <p>
        {messageParts(text).map((part, i) =>
          part.href ? (
            <a
              key={i}
              href={part.href}
              title={part.href}
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                setError("");
                void window.voxy
                  .openExternal(part.href!)
                  .catch(() => setError("Não foi possível abrir o navegador."));
              }}
            >
              {part.text}
            </a>
          ) : (
            part.text.split(/(@\{[a-f0-9-]{36}\})/gi).map((value, j) =>
              /^@\{[a-f0-9-]{36}\}$/i.test(value) ? (
                <button
                  type="button"
                  className="mention"
                  key={i + ":" + j}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    onProfile?.(value.slice(2, -1), r.left, r.bottom);
                  }}
                >
                  @{profiles?.[value.slice(2, -1)]?.name || value.slice(2, -1)}
                </button>
              ) : (
                value
              ),
            )
          ),
        )}
      </p>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
