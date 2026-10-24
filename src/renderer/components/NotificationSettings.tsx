import type {
  NotificationPreferences,
  Profile,
  RoomState,
} from "../../shared/types";
import { DEFAULT_NOTIFICATIONS } from "../../shared/preferences";
// Defaults are shared with profile migration; no second preference store.
const defaults = DEFAULT_NOTIFICATIONS;
export function NotificationSettings({
  profile,
  change,
  room,
  scope,
}: {
  profile: Profile;
  change: (p: Profile) => void;
  room?: RoomState;
  scope?: string;
}) {
  const prefs = profile.notifications ?? defaults;
  const update = (patch: Partial<NotificationPreferences>) =>
    change({ ...profile, notifications: { ...prefs, ...patch } });
  const names = {
    mention: "Menções com @",
    reply: "Respostas às minhas mensagens",
    direct: "Mensagens privadas",
    "friend-request": "Solicitações de amizade",
    "friend-accepted": "Amizades aceitas",
  };
  return (
    <fieldset>
      <legend>Notificações e Não Perturbe</legend>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={prefs.native}
          onChange={(e) => update({ native: e.target.checked })}
        />
        Notificações do Windows em segundo plano
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={prefs.sounds}
          onChange={(e) => update({ sounds: e.target.checked })}
        />
        Sons de notificações
      </label>
      {Object.entries(names).map(([kind, label]) => (
        <label className="checkbox" key={kind}>
          <input
            type="checkbox"
            checked={prefs.types[kind as keyof typeof names]}
            onChange={(e) =>
              update({ types: { ...prefs.types, [kind]: e.target.checked } })
            }
          />
          {label}
        </label>
      ))}
      <label>
        Não Perturbe
        <select
          aria-label="Não Perturbe"
          value={prefs.dndUntil > Date.now() ? "active" : "off"}
          onChange={(e) =>
            update({
              dndUntil:
                e.target.value === "off"
                  ? 0
                  : Date.now() + Number(e.target.value) * 60000,
            })
          }
        >
          <option value="off">Desativado</option>
          {prefs.dndUntil > Date.now() && (
            <option value="active" disabled>
              Ativo até {new Date(prefs.dndUntil).toLocaleString()}
            </option>
          )}
          <option value="30">Por 30 minutos</option>
          <option value="60">Por 1 hora</option>
          <option value="480">Por 8 horas</option>
          <option value="1440">Por 24 horas</option>
        </select>
      </label>
      <small>
        Não Perturbe e o status Ocupado silenciam alertas e sons; o histórico e
        as não lidas continuam disponíveis. Aplicado ao salvar.
      </small>
      {scope && room && (
        <>
          <h4>Silenciar nesta sala</h4>
          {room.servers.map((server) => {
            const key = scope + ":" + server.id;
            return (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={prefs.mutedServers.includes(key)}
                  onChange={(e) =>
                    update({
                      mutedServers: e.target.checked
                        ? [...prefs.mutedServers, key]
                        : prefs.mutedServers.filter((k) => k !== key),
                    })
                  }
                />
                Servidor: {server.name}
              </label>
            );
          })}
          {room.channels.map((channel) => {
            const key = scope + ":" + channel.id;
            return (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={prefs.mutedChannels.includes(key)}
                  onChange={(e) =>
                    update({
                      mutedChannels: e.target.checked
                        ? [...prefs.mutedChannels, key]
                        : prefs.mutedChannels.filter((k) => k !== key),
                    })
                  }
                />
                Canal: {channel.name}
              </label>
            );
          })}
        </>
      )}
    </fieldset>
  );
}
