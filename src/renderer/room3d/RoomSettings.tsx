import { lazy, Suspense, useState } from "react";
import { PersonStanding, ArrowRight } from "lucide-react";
import type { Profile } from "../../shared/types";
import { defaultRoomSettings } from "../../shared/room3d";
import { Modal } from "../components/Modal";
import { EMOTE_KEYS, emoteKey } from "../../shared/emotes";
const AvatarCreator = lazy(() => import("./AvatarCreator"));
export function RoomSettings({
  profile,
  change,
  onCustomize,
}: {
  profile: Profile;
  change: (profile: Profile) => void;
  onCustomize?: () => void;
}) {
  const settings = profile.room3d ?? defaultRoomSettings,
    [editor, setEditor] = useState(false);
  const update = (value: Partial<typeof settings>) =>
    change({ ...profile, room3d: { ...settings, ...value } });
  return (
    <div className="room-settings">
      <button
        type="button"
        className="character-launcher"
        onClick={() => (onCustomize ? onCustomize() : setEditor(true))}
      >
        <span className="character-launcher-art">
          <PersonStanding size={54} />
        </span>
        <span>
          <strong>Seu personagem, do seu jeito.</strong>
          <small>Cabelo, roupas, acessórios e um preview 3D ao vivo.</small>
          <span className="character-launcher-action">
            Personalizar personagem <ArrowRight size={16} />
          </span>
        </span>
      </button>
      <h4>Experiência da sala</h4>
      <label>
        Atalho do menu radial
        <select
          aria-label="Atalho do menu radial"
          value={settings.emoteKey ?? "KeyG"}
          onChange={(e) =>
            update({ emoteKey: e.target.value as typeof settings.emoteKey })
          }
        >
          {EMOTE_KEYS.map((key) => (
            <option key={key} value={key}>
              {key.slice(3)}
            </option>
          ))}
        </select>
      </label>
      <small>
        Tecla em uso: {emoteKey(profile)?.slice(3) ?? "use o botão Emotes"}. O
        menu reserva uma tecla livre dos atalhos de voz.
      </small>
      <label>
        Ao entrar em canal compatível
        <select
          aria-label="Ao entrar em canal compatível"
          value={settings.entry}
          onChange={(event) =>
            update({ entry: event.target.value as typeof settings.entry })
          }
        >
          <option value="always">Abrir sempre em 3D</option>
          <option value="ask">Perguntar</option>
          <option value="traditional">
            Abrir no modo tradicional (3D opcional)
          </option>
        </select>
      </label>
      <label>
        Qualidade gráfica
        <select
          aria-label="Qualidade gráfica"
          value={settings.quality}
          onChange={(event) =>
            update({ quality: event.target.value as typeof settings.quality })
          }
        >
          <option value="low">
            Baixo · até 24 FPS · sem sombras dinâmicas
          </option>
          <option value="medium">Médio · até 40 FPS · sombras suaves</option>
          <option value="high">Alto · até 60 FPS · maior resolução</option>
        </select>
      </label>
      <label>
        Câmera inicial
        <select
          aria-label="Câmera inicial"
          value={settings.cameraMode ?? "follow"}
          onChange={(event) =>
            update({ cameraMode: event.target.value as "follow" | "free" })
          }
        >
          <option value="follow">Acompanhar personagem</option>
          <option value="free">Explorar ambiente</option>
        </select>
      </label>
      <label>
        Sensibilidade da câmera
        <input
          aria-label="Sensibilidade da câmera"
          type="range"
          min=".2"
          max="3"
          step=".1"
          value={settings.sensitivity}
          onChange={(event) => update({ sensitivity: +event.target.value })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.names}
          onChange={(event) => update({ names: event.target.checked })}
        />
        Mostrar nomes sobre personagens
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.smokeEffects !== false}
          onChange={(e) => update({ smokeEffects: e.target.checked })}
        />
        Mostrar cigarro virtual e fumaça
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.gameSounds !== false}
          onChange={(e) => update({ gameSounds: e.target.checked })}
        />
        Sons dos jogos na sala
      </label>
      <h4>Voz por proximidade</h4>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.proximity}
          onChange={(event) => update({ proximity: event.target.checked })}
        />
        Ativar voz por proximidade
      </label>
      <label>
        Volume da voz por proximidade
        <input
          aria-label="Volume da voz por proximidade"
          type="range"
          min="0"
          max="1"
          step=".05"
          value={settings.volume}
          onChange={(event) => update({ volume: +event.target.value })}
        />
      </label>
      <label>
        Alcance: {settings.range} metros
        <input
          aria-label="Alcance da voz por proximidade"
          type="range"
          min="3"
          max="20"
          step="1"
          value={settings.range}
          onChange={(event) => update({ range: +event.target.value })}
        />
      </label>
      <small>
        Mute, Deafen, PTT e volumes individuais mantêm prioridade. As
        preferências da sala são aplicadas ao salvar.
      </small>
      {editor && (
        <Modal title="Seu personagem" close={() => setEditor(false)}>
          <Suspense
            fallback={<p role="status">Abrindo criador de personagens…</p>}
          >
            <AvatarCreator
              value={profile.avatar3d}
              name={profile.name}
              onCancel={() => setEditor(false)}
              onApply={(avatar) => {
                change({ ...profile, avatar3d: avatar });
                setEditor(false);
              }}
            />
          </Suspense>
        </Modal>
      )}
    </div>
  );
}
