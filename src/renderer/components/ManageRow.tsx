import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
export function ManageRow({
  name,
  disabled,
  rename,
  remove,
}: {
  name: string;
  disabled: boolean;
  rename: (name: string) => Promise<unknown>;
  remove: () => Promise<unknown>;
}) {
  const [value, setValue] = useState(name),
    [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setValue(name);
  }, [name]);
  async function apply(action: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await action();
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  disabled = disabled || pending;
  return (
    <div className="manage-row">
      <input
        aria-label={"Nome de " + name}
        value={value}
        maxLength={60}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        title="Salvar novo nome"
        disabled={disabled || !value.trim() || value === name}
        onClick={() => void apply(() => rename(value))}
      >
        <Pencil size={17} />
      </button>
      {confirm ? (
        <>
          <button
            className="danger"
            disabled={disabled}
            onClick={() => void apply(remove)}
          >
            Confirmar exclusão
          </button>
          <button disabled={disabled} onClick={() => setConfirm(false)}>
            Cancelar
          </button>
        </>
      ) : (
        <button
          title={"Excluir " + name}
          disabled={disabled}
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={17} />
        </button>
      )}
      {error && (
        <p role="alert" className="modal-error">
          {error}
        </p>
      )}
    </div>
  );
}
