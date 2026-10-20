import { useEffect, useState } from "react";
import type { UpdatePackage } from "../../shared/types";
import { RemoteUpdate } from "./RemoteUpdate";
export function Updates() {
  const [info, setInfo] = useState<{ version: string; packaged: boolean }>(),
    [update, setUpdate] = useState<UpdatePackage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void window.voxy
      .updateInfo()
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);
  async function choose() {
    setBusy(true);
    setError("");
    try {
      setUpdate(await window.voxy.chooseUpdate());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="updates">
      <h3>Atualizações {info && "· v" + info.version}</h3>
      <RemoteUpdate />
      <p className="hint">
        Recebeu uma versão nova? Selecione o instalador para atualizar por cima,
        preservando seus dados. Um backup será criado antes da atualização.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void choose()}
      >
        Selecionar novo instalador
      </button>
      {update && (
        <div className="update-review">
          <strong>Atualizar para {update.version}</strong>
          <p>
            {Math.round(update.size / 1024 / 1024)} MB ·{" "}
            {update.verified
              ? "SHA-256 conferido com o arquivo recebido"
              : "Sem arquivo SHA256SUMS de referência"}
          </p>
          <code>{update.sha256}</code>
          <p className="hint">
            Use somente arquivos enviados por quem mantém o Voxy. O checksum
            confere integridade, não a identidade de quem enviou. A chamada será
            encerrada ao atualizar.
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy || !info?.packaged}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await window.voxy.installUpdate(update.id);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Fazer backup e atualizar
          </button>
          {!info?.packaged && (
            <small>Instalação disponível no aplicativo empacotado.</small>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="modal-error">
          {error}
        </p>
      )}
    </section>
  );
}
