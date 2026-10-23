import { useState } from "react";
import type { Command, RoomState, ServerRole } from "../../shared/types";
export function RoleBadges({ roles }: { roles: ServerRole[] }) {
  return (
    <span className="role-badges">
      {roles.map((r) => (
        <span key={r.id} className="role-badge">
          <i style={{ background: r.color }} />
          {r.name}
        </span>
      ))}
    </span>
  );
}
export function Roles({
  room,
  serverId,
  command,
}: {
  room: RoomState;
  serverId: string;
  command: (c: Command) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#a69bff");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(c: Command) {
    setBusy(true);
    setError("");
    try {
      await command(c);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="role-manager">
      <h3>Cargos do servidor</h3>
      <p className="hint">
        O primeiro cargo criado tem prioridade na cor do nome. Somente o criador
        gerencia cargos.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run({ type: "role.save", serverId, id: editing, name, color })
          ) {
            setEditing(undefined);
            setName("");
          }
        }}
      >
        <label>
          Nome do cargo
          <input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Cor de identificação
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || !name.trim()}>
          {editing ? "Salvar cargo" : "Criar cargo"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setName("");
            }}
          >
            Cancelar edição
          </button>
        )}
      </form>
      {(room.roles || [])
        .filter((r) => r.serverId === serverId)
        .map((r) => (
          <div key={r.id} className="role-editor">
            <RoleBadges roles={[r]} />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(r.id);
                setName(r.name);
                setColor(r.color);
              }}
            >
              Editar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run({ type: "role.delete", serverId, id: r.id })
              }
            >
              Excluir
            </button>
            <details>
              <summary>Membros com este cargo</summary>
              {Object.values(room.profiles || {}).map((p) => (
                <label key={p.id} className="checkbox">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={(room.memberRoles || []).some(
                      (m) => m.roleId === r.id && m.memberId === p.id,
                    )}
                    onChange={(e) =>
                      void run({
                        type: "role.assign",
                        serverId,
                        roleId: r.id,
                        memberId: p.id,
                        assigned: e.target.checked,
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
            </details>
          </div>
        ))}
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
