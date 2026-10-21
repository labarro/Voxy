import { useState } from "react";
import { messageParts } from "../../shared/links";
export function MessageText({ text }: { text: string }) {
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
            part.text
          ),
        )}
      </p>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
