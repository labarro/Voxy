import type { Profile } from "../../shared/types";
import { PTT_KEYS, type PttKey } from "../../shared/preferences";
import { Updates } from "./Updates";
const avatars = ["🪻", "🦊", "🐳", "🪐", "🐸", "🍄", "🌙", "🎧", "👴"];
export function ProfileForm({
  profile,
  setProfile,
  devices,
  busy,
  onSave,
}: {
  profile: Profile;
  setProfile: (profile: Profile) => void;
  devices: MediaDeviceInfo[];
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <label>
        Nome de exibição
        <input
          value={profile.name}
          required
          maxLength={60}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
        />
      </label>
      <div className="avatar-picker">
        {avatars.map((a) => (
          <button
            type="button"
            key={a}
            className={profile.avatar === a ? "chosen" : ""}
            title={"Avatar " + a}
            aria-label={"Avatar " + a}
            onClick={() => setProfile({ ...profile, avatar: a })}
          >
            {a}
          </button>
        ))}
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={!!profile.pttEnabled}
          onChange={(e) =>
            setProfile({ ...profile, pttEnabled: e.target.checked })
          }
        />{" "}
        Push to Talk: falar enquanto segura uma tecla
      </label>
      {profile.pttEnabled && (
        <label>
          Tecla para falar
          <select
            value={profile.pttKey ?? "KeyV"}
            onChange={(e) =>
              setProfile({ ...profile, pttKey: e.target.value as PttKey })
            }
          >
            {Object.entries(PTT_KEYS).map(([code, key]) => (
              <option key={code} value={code}>
                {key.label}
              </option>
            ))}
          </select>
          <small>
            Funciona também com outros programas em foco. O mute manual continua
            tendo prioridade.
          </small>
        </label>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={profile.callSounds !== false}
          onChange={(e) =>
            setProfile({ ...profile, callSounds: e.target.checked })
          }
        />{" "}
        Sons de entrada e saída da chamada
      </label>
      <label>
        Microfone
        <select
          value={profile.input}
          onChange={(e) => setProfile({ ...profile, input: e.target.value })}
        >
          <option value="">Padrão do sistema</option>
          {devices
            .filter((d) => d.kind === "audioinput")
            .map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || "Microfone " + (i + 1)}
              </option>
            ))}
        </select>
      </label>
      <label>
        Saída de áudio
        <select
          value={profile.output}
          onChange={(e) => setProfile({ ...profile, output: e.target.value })}
        >
          <option value="">Padrão do sistema</option>
          {devices
            .filter((d) => d.kind === "audiooutput")
            .map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || "Saída " + (i + 1)}
              </option>
            ))}
        </select>
      </label>
      <p className="hint">
        Os nomes dos dispositivos aparecem após permitir o microfone. Mudanças
        são aplicadas ao salvar.
      </p>
      <button className="primary" disabled={busy}>
        Salvar perfil e dispositivos
      </button>
      <Updates />
    </form>
  );
}
