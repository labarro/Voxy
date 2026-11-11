import type { Profile } from "../../shared/types";
import { defaultAvatar, defaultRoomSettings } from "../../shared/room3d";
export function RoomSettings({
  profile,
  change,
}: {
  profile: Profile;
  change: (p: Profile) => void;
}) {
  const a = profile.avatar3d ?? defaultAvatar,
    s = profile.room3d ?? defaultRoomSettings;
  const avatar = (value: Partial<typeof a>) =>
    change({ ...profile, avatar3d: { ...a, ...value } });
  const settings = (value: Partial<typeof s>) =>
    change({ ...profile, room3d: { ...s, ...value } });
  return (
    <div className="room-settings">
      <h4>Seu personagem</h4>
      <label>
        Cabelo
        <select
          aria-label="Cabelo"
          value={a.hair}
          onChange={(e) => avatar({ hair: e.target.value as typeof a.hair })}
        >
          <option value="short">Curto</option>
          <option value="long">Longo</option>
          <option value="crest">Topete</option>
        </select>
      </label>
      <label>
        Cor do cabelo
        <input
          type="color"
          value={a.hairColor}
          onChange={(e) => avatar({ hairColor: e.target.value })}
        />
      </label>
      <label>
        Tom de pele
        <input
          type="color"
          value={a.skin}
          onChange={(e) => avatar({ skin: e.target.value })}
        />
      </label>
      <label>
        Roupa
        <select
          aria-label="Roupa"
          value={a.outfit}
          onChange={(e) =>
            avatar({ outfit: e.target.value as typeof a.outfit })
          }
        >
          <option value="sweater">Suéter</option>
          <option value="jacket">Jaqueta</option>
        </select>
      </label>
      <label>
        Cor da roupa
        <input
          type="color"
          value={a.color}
          onChange={(e) => avatar({ color: e.target.value })}
        />
      </label>
      <label>
        Acessório
        <select
          aria-label="Acessório"
          value={a.accessory}
          onChange={(e) =>
            avatar({ accessory: e.target.value as typeof a.accessory })
          }
        >
          <option value="none">Nenhum</option>
          <option value="glasses">Óculos</option>
          <option value="headphones">Fones</option>
        </select>
      </label>
      <h4>Salas 3D</h4>
      <label>
        Ao entrar em canal compatível
        <select
          value={s.entry}
          onChange={(e) =>
            settings({ entry: e.target.value as typeof s.entry })
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
          value={s.quality}
          onChange={(e) =>
            settings({ quality: e.target.value as typeof s.quality })
          }
        >
          <option value="low">Baixo · 24 FPS</option>
          <option value="medium">Médio · 40 FPS</option>
          <option value="high">Alto · 60 FPS</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={s.proximity}
          onChange={(e) => settings({ proximity: e.target.checked })}
        />
        Voz por proximidade
      </label>
      <label>
        Volume da voz por proximidade
        <input
          type="range"
          min="0"
          max="1"
          step=".05"
          value={s.volume}
          onChange={(e) => settings({ volume: +e.target.value })}
        />
      </label>
      <label>
        Alcance: {s.range} metros
        <input
          type="range"
          min="3"
          max="20"
          step="1"
          value={s.range}
          onChange={(e) => settings({ range: +e.target.value })}
        />
      </label>
      <label>
        Sensibilidade da câmera
        <input
          type="range"
          min=".2"
          max="3"
          step=".1"
          value={s.sensitivity}
          onChange={(e) => settings({ sensitivity: +e.target.value })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={s.names}
          onChange={(e) => settings({ names: e.target.checked })}
        />
        Mostrar nomes sobre personagens
      </label>
      <small>
        Quem usa a visualização tradicional continua audível normalmente. Mute,
        Deafen, PTT e volumes individuais mantêm prioridade. As alterações são
        aplicadas ao salvar.
      </small>
    </div>
  );
}
