import type { Profile } from "../../shared/types";
import { useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { PTT_KEYS, isPttKey } from "../../shared/preferences";
import { MicrophonePreview } from "./MicrophonePreview";
import { BannerPicker, ThemePicker } from "./Personalization";
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
  onMicrophoneTest,
}: {
  profile: Profile;
  setProfile: (profile: Profile) => void;
  devices: MediaDeviceInfo[];
  busy: boolean;
  onSave: () => void;
  inputLevel?: number;
  presenceSupported?: boolean;
  onMicrophoneTest: (active: boolean) => void;
}) {
  const [category, setCategory] = useState("Conta");
  const [recording, setRecording] = useState(false);
  const [keyError, setKeyError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
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
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (recording || photoBusy || bannerBusy) return;
        onSave();
      }}
    >
      <nav className="settings-nav" aria-label="Categorias de configurações">
        {[
          "Conta",
          "Áudio e Voz",
          "Vídeo",
          "Aparência",
          "Atalhos",
          "Notificações",
        ].map((item) => (
          <button
            type="button"
            key={item}
            aria-current={category === item ? "page" : undefined}
            onClick={() => {
              setCategory(item);
              setRecording(false);
            }}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <h3>{category}</h3>
        <section hidden={category !== "Conta"}>
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
                PNG, JPEG ou WebP de até 5 MB. Recorte central quadrado de 128
                px. Selecione um emoji para remover a foto. Salve para aplicar.
              </small>
            </div>
          </div>
          {photoError && (
            <p className="modal-error" role="alert">
              {photoError}
            </p>
          )}
          <label>
            Cor do nickname
            <input
              aria-label="Cor do nickname"
              type="color"
              value={profile.nicknameColor || "#edf0f8"}
              onChange={(e) =>
                setProfile({ ...profile, nicknameColor: e.target.value })
              }
            />
            <small>
              A cor do primeiro cargo do servidor tem prioridade sobre esta cor.
            </small>
          </label>
          <button
            type="button"
            onClick={() => setProfile({ ...profile, nicknameColor: "" })}
          >
            Usar cor padrão do nome
          </button>
          <BannerPicker
            onBusy={setBannerBusy}
            value={profile.banner || ""}
            change={(banner) => setProfile({ ...profile, banner })}
          />
          <Updates />
        </section>
        <section hidden={category !== "Atalhos"}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!profile.pttEnabled}
              onChange={(e) =>
                setProfile({ ...profile, pttEnabled: e.target.checked })
              }
            />{" "}
            Push to Talk: falar enquanto segura uma tecla ou botão lateral
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
                onPointerDown={(e) => {
                  if (!recording || (e.button !== 3 && e.button !== 4)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setProfile({
                    ...profile,
                    pttKey: e.button === 3 ? "Mouse4" : "Mouse5",
                  });
                  setRecording(false);
                  setKeyError("");
                }}
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
                  ? "Pressione uma tecla ou Mouse 4/5…"
                  : (PTT_KEYS[profile.pttKey ?? "KeyV"]?.label ?? "V") +
                    " — alterar tecla"}
              </button>
              <select
                aria-label="Atalho do Push-to-Talk"
                value={profile.pttKey ?? "KeyV"}
                onChange={(e) => {
                  setProfile({ ...profile, pttKey: e.target.value });
                  setRecording(false);
                }}
              >
                {Object.entries(PTT_KEYS).map(([code, key]) => (
                  <option key={code} value={code}>
                    {key.label}
                  </option>
                ))}
              </select>
              {keyError && <small role="alert">{keyError}</small>}
              <small>
                Funciona também com outros programas em foco. O mute manual
                continua tendo prioridade. Mouse 4/5 são lidos globalmente pelo
                Windows. Jogos elevados, anticheat e remapeadores podem impedir
                a leitura; escolha outra tecla nesses casos.
              </small>
            </label>
          )}
        </section>
        <section hidden={category !== "Notificações"}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={profile.pttSounds !== false}
              onChange={(e) =>
                setProfile({ ...profile, pttSounds: e.target.checked })
              }
            />
            Confirmações sonoras do Push-to-Talk
          </label>
          <small>
            Dois sons locais: ao pressionar e ao soltar. Não são enviados pela
            conexão de voz.
          </small>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={profile.callSounds !== false}
              onChange={(e) =>
                setProfile({ ...profile, callSounds: e.target.checked })
              }
            />{" "}
            Sons de entrada e saída da chamada e início/fim de transmissão
          </label>
        </section>
        <section hidden={category !== "Áudio e Voz"}>
          <fieldset className="audio-processing">
            <legend>Processamento do microfone</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={profile.noiseSuppression !== false}
                onChange={(e) =>
                  setProfile({ ...profile, noiseSuppression: e.target.checked })
                }
              />
              Supressão de ruído
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={profile.echoCancellation !== false}
                onChange={(e) =>
                  setProfile({ ...profile, echoCancellation: e.target.checked })
                }
              />
              Cancelamento de eco
            </label>
            <small>
              Processamento nativo do Chromium, conforme suporte do dispositivo.
              Ajuste automático de voz conforme suporte do dispositivo.
            </small>
          </fieldset>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={profile.autoGainControl !== false}
              onChange={(e) =>
                setProfile({ ...profile, autoGainControl: e.target.checked })
              }
            />
            Normalizar volume da voz automaticamente (recomendado)
          </label>
          {category === "Áudio e Voz" && (
            <MicrophonePreview profile={profile} onActive={onMicrophoneTest} />
          )}
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
              ajuste automático usa o processamento nativo de voz.
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
                setProfile({
                  ...profile,
                  voiceThreshold: Number(e.target.value),
                })
              }
            />
            <small>
              Mais perto de −10 exige voz mais forte; −70 capta sons mais
              baixos. O filtro também se aplica ao Push-to-Talk. Aplicado ao
              salvar.
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
              onChange={(e) =>
                setProfile({ ...profile, input: e.target.value })
              }
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
              onChange={(e) =>
                setProfile({ ...profile, output: e.target.value })
              }
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
            Os nomes dos dispositivos aparecem após permitir o microfone.
            Mudanças são aplicadas ao salvar.
          </p>
        </section>
        <section hidden={category !== "Vídeo"}>
          <label>
            Câmera
            <select
              value={profile.cameraDevice || ""}
              onChange={(e) =>
                setProfile({ ...profile, cameraDevice: e.target.value })
              }
            >
              <option value="">Padrão do sistema</option>
              {devices
                .filter((d) => d.kind === "videoinput")
                .map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || "Câmera " + (i + 1)}
                  </option>
                ))}
            </select>
          </label>
          <p className="hint">
            Selecione a câmera usada ao iniciar uma chamada de vídeo.
          </p>
        </section>
        <section hidden={category !== "Aparência"}>
          <ThemePicker profile={profile} change={setProfile} />
        </section>
        <button
          className="primary"
          disabled={busy || photoBusy || bannerBusy || recording}
        >
          Salvar perfil e dispositivos
        </button>
      </div>
    </form>
  );
}
