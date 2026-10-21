import type { Profile } from "../../shared/types";
import { useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { PTT_KEYS, isPttKey } from "../../shared/preferences";
import { Updates } from "./Updates";
const avatars = ["🪻", "🦊", "🐳", "🪐", "🐸", "🍄", "🌙", "🎧", "👴"];
export function ProfileForm({
  profile,
  setProfile,
  devices,
  busy,
  onSave,
  inputLevel,
  presenceSupported = true,
}: {
  profile: Profile;
  setProfile: (profile: Profile) => void;
  devices: MediaDeviceInfo[];
  busy: boolean;
  onSave: () => void;
  inputLevel?: number;
  presenceSupported?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [keyError, setKeyError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  async function choosePhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
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
        throw Error("A foto deve ter até 8192 px / 24 megapixels.");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const size = Math.min(bitmap.width, bitmap.height);
      canvas
        .getContext("2d")!
        .drawImage(
          bitmap,
          (bitmap.width - size) / 2,
          (bitmap.height - size) / 2,
          size,
          size,
          0,
          0,
          128,
          128,
        );
      const avatar = canvas.toDataURL("image/webp", 0.8);
      if (avatar.length > 43720)
        throw Error(
          "Não foi possível reduzir a foto para 32 KB. Escolha uma imagem mais simples.",
        );
      setProfile({ ...profile, avatar });
    } catch (e) {
      setPhotoError((e as Error).message || "Não foi possível abrir a foto.");
    } finally {
      bitmap?.close();
      setPhotoBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (recording || photoBusy) return;
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
      <label>
        Status
        <select
          aria-label="Seu status"
          value={profile.presence ?? "online"}
          onChange={(e) =>
            setProfile({
              ...profile,
              presence: e.target.value as Profile["presence"],
            })
          }
        >
          <option value="online">Online</option>
          <option value="away">Ausente</option>
          <option value="busy">Ocupado</option>
        </select>
        {!presenceSupported && (
          <small className="hint">
            Seu status fica salvo neste computador. Atualize o host para
            compartilhá-lo com os participantes.
          </small>
        )}
        <small className="hint">
          Ocupado mantém os indicadores de mensagens não lidas e silencia os
          avisos de novas DMs.
        </small>
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
      <div className="profile-photo-picker">
        <Avatar avatar={profile.avatar} className="large-avatar" />
        <div>
          <input
            ref={photoInput}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            aria-label="Arquivo de foto de perfil"
            onChange={(e) => {
              void choosePhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={photoBusy || busy}
            onClick={() => photoInput.current?.click()}
          >
            {photoBusy ? "Preparando foto…" : "Escolher foto do computador"}
          </button>
          <small>
            PNG, JPEG ou WebP de até 5 MB. Recorte central quadrado de 128 px.
            Selecione um emoji para remover a foto. Salve para aplicar.
          </small>
        </div>
      </div>
      {photoError && (
        <p className="modal-error" role="alert">
          {photoError}
        </p>
      )}
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
          <button
            type="button"
            className={recording ? "chosen" : ""}
            aria-label="Configurar tecla para falar"
            onClick={() => {
              setRecording((v) => !v);
              setKeyError("");
            }}
            onBlur={() => setRecording(false)}
            onKeyDown={(e) => {
              if (!recording) return;
              e.preventDefault();
              e.stopPropagation();
              if (!isPttKey(e.code)) {
                setKeyError(
                  "Esta tecla não é identificada pelo Windows. Tente outra.",
                );
                return;
              }
              setProfile({ ...profile, pttKey: e.code });
              setRecording(false);
              setKeyError("");
            }}
          >
            {recording
              ? "Pressione a tecla desejada…"
              : (PTT_KEYS[profile.pttKey ?? "KeyV"]?.label ?? "V") +
                " — alterar tecla"}
          </button>
          {keyError && <small role="alert">{keyError}</small>}
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
        Sons de entrada e saída da chamada e início de transmissão
      </label>
      <label>
        Volume de entrada: {Math.round((profile.inputVolume ?? 1) * 100)}%
        <input
          aria-label="Volume de entrada"
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={profile.inputVolume ?? 1}
          onChange={(e) =>
            setProfile({ ...profile, inputVolume: Number(e.target.value) })
          }
        />
        <small>
          100% preserva o nível original. Aumentar também aumenta ruídos; o
          ganho automático está desativado.
        </small>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={!!profile.voiceDetection}
          onChange={(e) =>
            setProfile({ ...profile, voiceDetection: e.target.checked })
          }
        />
        Ativar detecção de voz (filtro por sensibilidade)
      </label>
      <label>
        Limite de ativação: {profile.voiceThreshold ?? -45} dBFS
        <input
          aria-label="Limite de ativação"
          type="range"
          min="-70"
          max="-10"
          step="1"
          disabled={!profile.voiceDetection}
          value={profile.voiceThreshold ?? -45}
          onChange={(e) =>
            setProfile({ ...profile, voiceThreshold: Number(e.target.value) })
          }
        />
        <small>
          Mais perto de −10 exige voz mais forte; −70 capta sons mais baixos. O
          filtro também se aplica ao Push-to-Talk. Aplicado ao salvar.
        </small>
      </label>
      <label>
        Nível captado{" "}
        {inputLevel === undefined
          ? "(entre na chamada para medir)"
          : Math.round(inputLevel) + " dBFS"}
        <meter
          aria-label="Nível do microfone"
          min="-100"
          max="0"
          value={inputLevel ?? -100}
        />
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
      <button className="primary" disabled={busy || photoBusy || recording}>
        Salvar perfil e dispositivos
      </button>
      <Updates />
    </form>
  );
}
