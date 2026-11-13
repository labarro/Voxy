import { RoomSettings } from "../room3d/RoomSettings";
import type { Profile, RoomState } from "../../shared/types";
import { NotificationSettings } from "./NotificationSettings";
import { useRef, useState, useEffect } from "react";
import { Avatar } from "./Avatar";
import { PTT_KEYS, isPttKey, shortcutConflict } from "../../shared/preferences";
import { ShortcutPicker } from "./ShortcutPicker";
import { MicrophonePreview } from "./MicrophonePreview";
import {
  BannerPicker,
  ThemePicker,
  themeVariables,
  KuromiArtwork,
} from "./Personalization";
import { Updates } from "./Updates";
import {
  UserRound,
  Fingerprint,
  Palette,
  AudioLines,
  Video,
  Bell,
  Keyboard,
  Monitor,
  ShieldCheck,
  Box,
  Download,
  Activity,
  Undo2,
} from "lucide-react";
import { HubNavigation, type HubPage } from "./HubNavigation";
const settingsPages: HubPage[] = [
  {
    id: "Conta",
    group: "Você no Voxy",
    icon: Fingerprint,
    description: "Nome de exibição e presença na sua rede.",
  },
  {
    id: "Perfil",
    group: "Você no Voxy",
    icon: UserRound,
    description: "Foto, identificação e capa do seu perfil.",
    keywords: "avatar banner nickname",
  },
  {
    id: "Aparência",
    group: "Você no Voxy",
    icon: Palette,
    description: "Escolha as superfícies e a cor que acompanham você.",
    keywords: "tema cores",
  },
  {
    id: "Áudio e Voz",
    group: "Sua experiência",
    icon: AudioLines,
    description: "Dispositivos, sensibilidade e processamento do microfone.",
    keywords: "saída volume eco ruído",
  },
  {
    id: "Vídeo",
    group: "Sua experiência",
    icon: Video,
    description: "Escolha a webcam para suas próximas chamadas.",
    keywords: "câmera",
  },
  {
    id: "Notificações",
    group: "Sua experiência",
    icon: Bell,
    description: "Decida quando e como o Voxy chama sua atenção.",
    keywords: "sons menções não perturbe",
  },
  {
    id: "Atalhos",
    group: "Sua experiência",
    icon: Keyboard,
    description: "Seu microfone e seus controles a uma tecla de distância.",
    keywords: "ptt mute deafen",
  },
  {
    id: "Salas 3D",
    group: "Sua experiência",
    icon: Box,
    description: "Personagem, renderização e voz por proximidade.",
    keywords: "cabelo sinuca câmera fumaça",
  },
  {
    id: "Windows",
    group: "Aplicativo",
    icon: Monitor,
    description: "Inicialização e comportamento na bandeja.",
  },
  {
    id: "Privacidade",
    group: "Aplicativo",
    icon: ShieldCheck,
    description: "Entenda onde ficam seus dados e o que é compartilhado.",
  },
  {
    id: "Atualizações",
    group: "Aplicativo",
    icon: Download,
    description: "Versão instalada, atualização e backup.",
  },
  {
    id: "Avançado",
    group: "Aplicativo",
    icon: Activity,
    description: "Diagnóstico de conexão e suporte à rede privada.",
  },
];
const avatars = ["🪻", "🦊", "🐳", "🪐", "🐸", "🍄", "🌙", "🎧", "👴"];
export function ProfileForm({
  profile: original,
  devices,
  busy,
  onSave,
  inputLevel,
  presenceSupported = true,
  onMicrophoneTest,
  room,
  scope,
  initialCategory = "Conta",
  onCustomize,
  onDiagnostics,
}: {
  profile: Profile;
  devices: MediaDeviceInfo[];
  busy: boolean;
  onSave: (profile: Profile) => void;
  inputLevel?: number;
  presenceSupported?: boolean;
  onMicrophoneTest: (active: boolean) => void;
  room?: RoomState;
  scope?: string;
  initialCategory?: string;
  onCustomize?: () => void;
  onDiagnostics?: () => void;
}) {
  const [profile, setProfile] = useState(original);
  const dirty = JSON.stringify(profile) !== JSON.stringify(original);
  const content = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState(initialCategory);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [category]);
  const currentPage =
    settingsPages.find((p) => p.id === category) || settingsPages[0];
  const [audioPage, setAudioPage] = useState("Dispositivos");
  const [recording, setRecording] = useState(false);
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const conflict = shortcutConflict(profile);
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
      data-preview-theme={profile.theme || "voxy"}
      style={themeVariables(profile)}
      onSubmit={(e) => {
        e.preventDefault();
        if (
          recording ||
          shortcutRecording ||
          photoBusy ||
          bannerBusy ||
          conflict
        )
          return;
        onSave(profile);
      }}
    >
      <HubNavigation
        pages={settingsPages}
        active={category}
        change={(item) => {
          setCategory(item);
          setRecording(false);
        }}
        label="Categorias de configurações"
      />
      <div className="settings-content" ref={content}>
        <header className="hub-page-heading">
          <span className="hub-page-icon">
            <currentPage.icon size={22} />
          </span>
          <div>
            <h3>{category}</h3>
            <p>{currentPage.description}</p>
          </div>
        </header>
        <section hidden={category !== "Salas 3D"}>
          <RoomSettings
            profile={profile}
            change={setProfile}
            onCustomize={onCustomize}
          />
        </section>
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
        </section>
        <section hidden={category !== "Perfil"}>
          <div className="profile-preview">
            <Avatar avatar={profile.avatar} className="large-avatar" />
            <div>
              <h3>{profile.name}</h3>
              <p>Sua identidade nas conversas.</p>
            </div>
          </div>
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
        </section>
        <section hidden={category !== "Atalhos"}>
          <ShortcutPicker
            label="Mutar/desmutar microfone"
            value={profile.muteShortcut}
            change={(muteShortcut) => setProfile({ ...profile, muteShortcut })}
            onRecording={setShortcutRecording}
          />
          <ShortcutPicker
            label="Deafen"
            value={profile.deafenShortcut}
            change={(deafenShortcut) =>
              setProfile({ ...profile, deafenShortcut })
            }
            onRecording={setShortcutRecording}
          />
          <small>
            Atalhos globais no Windows, inclusive em segundo plano. Use teclas
            diferentes para mute, Deafen e PTT. Jogos elevados, anticheat e
            remapeadores podem limitar a leitura. Deafen silencia voz e
            transmissões recebidas e bloqueia o microfone; ao sair, restaura o
            mute anterior.
          </small>
          {conflict && (
            <p role="alert">
              Escolha teclas diferentes para PTT, mute e Deafen antes de salvar.
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
          <NotificationSettings
            profile={profile}
            change={setProfile}
            room={room}
            scope={scope}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={profile.shortcutSounds !== false}
              onChange={(e) =>
                setProfile({ ...profile, shortcutSounds: e.target.checked })
              }
            />
            Sons de mute e Deafen
          </label>
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
        <section hidden={category !== "Windows"}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!profile.launchAtLogin}
              onChange={(e) =>
                setProfile({ ...profile, launchAtLogin: e.target.checked })
              }
            />
            Iniciar com o Windows
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!profile.startMinimized}
              onChange={(e) =>
                setProfile({ ...profile, startMinimized: e.target.checked })
              }
            />
            Iniciar minimizado na bandeja
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!profile.closeToTray}
              onChange={(e) =>
                setProfile({ ...profile, closeToTray: e.target.checked })
              }
            />
            Botão fechar minimiza para a bandeja
          </label>
          <small>
            A inicialização automática é aplicada na versão instalada. As
            chamadas continuam quando a janela está na bandeja. Use Sair no menu
            da bandeja para encerrar o Voxy.
          </small>
          <button
            type="button"
            onClick={() =>
              void window.voxy
                .minimizeToTray()
                .catch((e) => setKeyError(e.message))
            }
          >
            Minimizar para a bandeja agora
          </button>
          {keyError && <p role="alert">{keyError}</p>}
        </section>
        <section hidden={category !== "Áudio e Voz"}>
          <div className="audio-page-tabs" aria-label="Seções de áudio">
            {["Dispositivos", "Processamento", "Sensibilidade"].map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={audioPage === item}
                onClick={() => setAudioPage(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="audio-page" hidden={audioPage !== "Dispositivos"}>
            {" "}
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
          </div>
          <div className="audio-page" hidden={audioPage !== "Processamento"}>
            {" "}
            <fieldset className="audio-processing">
              <legend>Processamento do microfone</legend>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={profile.noiseSuppression !== false}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      noiseSuppression: e.target.checked,
                    })
                  }
                />
                Supressão de ruído
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={profile.echoCancellation !== false}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      echoCancellation: e.target.checked,
                    })
                  }
                />
                Cancelamento de eco
              </label>
              <small>
                Processamento nativo do Chromium, conforme suporte do
                dispositivo. Ajuste automático de voz conforme suporte do
                dispositivo.
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
          </div>
          <div className="audio-page" hidden={audioPage !== "Sensibilidade"}>
            {" "}
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
                  setProfile({
                    ...profile,
                    inputVolume: Number(e.target.value),
                  })
                }
              />
              <small>
                100% preserva o nível original. Aumentar também aumenta ruídos;
                o ajuste automático usa o processamento nativo de voz.
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
          </div>
          {category === "Áudio e Voz" && (
            <MicrophonePreview profile={profile} onActive={onMicrophoneTest} />
          )}
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
          {profile.theme === "kuromi" && (
            <div className="kuromi-theme-story">
              <KuromiArtwork variant="gallery" />
              <div>
                <h4>Rosa com personalidade.</h4>
                <p>
                  Grafite ameixa, rosa luminoso e detalhes em lavanda. Sua
                  Kuromi acompanha os espaços sem atrapalhar a conversa.
                </p>
                <small>Ilustrações © SANRIO CO., LTD.</small>
                <button
                  type="button"
                  onClick={() =>
                    void window.voxy
                      .openExternal(
                        "https://www.sanrio.co.jp/characters/kuromi/",
                      )
                      .catch((e) => setKeyError(e.message))
                  }
                >
                  Conheça a Kuromi na Sanrio
                </button>
              </div>
            </div>
          )}
        </section>
        <section hidden={category !== "Atualizações"}>
          <Updates />
        </section>
        <section
          hidden={category !== "Privacidade"}
          className="privacy-information"
        >
          <article>
            <h4>Dados neste computador</h4>
            <p>
              Seu perfil e o histórico de DMs ficam no armazenamento local. O
              histórico dos canais fica no computador que hospeda a sala.
              Atualizações criam um backup antes de instalar.
            </p>
          </article>
          <article>
            <h4>Conexões entre amigos</h4>
            <p>
              Voz, câmera e tela usam conexões diretas entre participantes.
              Compartilhe convites apenas com quem você conhece; o convite dá
              acesso à sala na rede privada.
            </p>
          </article>
          <article>
            <h4>Você decide quando transmitir</h4>
            <p>
              Câmera e compartilhamento de tela começam por uma ação sua. Fechar
              as configurações não encerra sua chamada. Use os controles do
              canal para desligar cada fonte.
            </p>
          </article>
        </section>
        <section hidden={category !== "Avançado"}>
          <article>
            <h4>Conexão e mídia</h4>
            <p>
              Consulte o estado de cada conexão durante a chamada. Se a rede
              privada caiu, verifique o Radmin VPN e o firewall antes de entrar
              novamente.
            </p>
            <button type="button" className="secondary" onClick={onDiagnostics}>
              Abrir diagnóstico de conexão
            </button>
          </article>
        </section>
      </div>
      <footer className="hub-savebar">
        <div>
          <strong>{dirty ? "Alterações não salvas" : "Tudo em dia"}</strong>
          <small>
            Salvar aplica as preferências. Fechar descarta o rascunho.
          </small>
        </div>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => setProfile(original)}
        >
          <Undo2 size={16} />
          Desfazer alterações
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            photoBusy ||
            bannerBusy ||
            recording ||
            shortcutRecording ||
            conflict
          }
        >
          Salvar perfil e dispositivos
        </button>
      </footer>
    </form>
  );
}
