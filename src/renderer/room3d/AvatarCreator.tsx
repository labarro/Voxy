import { useState } from "react";
import {
  RotateCcw,
  Check,
  ArrowLeft,
  PersonStanding,
  Smile,
  Scissors,
  Shirt,
  Headphones,
  Palette,
} from "lucide-react";
import type { Avatar3D } from "../../shared/types";
import { defaultAvatar } from "../../shared/room3d";
import { AvatarPreview } from "./AvatarPreview";

const skinColors = [
  "#f4d1b5",
  "#e4b38e",
  "#cd9771",
  "#af7756",
  "#8c5b43",
  "#644232",
  "#422f29",
];
const hairColors = [
  "#292735",
  "#503830",
  "#80563d",
  "#b88754",
  "#d8bb83",
  "#a6a3ad",
  "#8e648a",
  "#517168",
];
const clothingColors = [
  "#8e7caf",
  "#667f77",
  "#b67665",
  "#dfb77b",
  "#67859b",
  "#d3c8b6",
  "#b47591",
  "#3e4a62",
  "#8c9181",
];
const categories = [
  { name: "Corpo", icon: PersonStanding },
  { name: "Rosto", icon: Smile },
  { name: "Cabelo", icon: Scissors },
  { name: "Roupas", icon: Shirt },
  { name: "Acessórios", icon: Headphones },
  { name: "Cores", icon: Palette },
];
function OptionArt({ kind, color }: { kind: string; color: string }) {
  return (
    <svg viewBox="0 0 100 90" aria-hidden="true">
      <ellipse
        cx="50"
        cy="82"
        rx="27"
        ry="4"
        fill="currentColor"
        opacity=".08"
      />
      {["sweater", "jacket", "hoodie", "tee"].includes(kind) ? (
        <>
          <path
            d={
              kind === "tee"
                ? "M32 20 13 36 25 50 32 44 32 76 68 76 68 44 75 50 87 36 68 20 59 25 41 25Z"
                : "M31 20 14 42 22 68 32 62 32 76 68 76 68 62 78 68 86 42 69 20 59 26 41 26Z"
            }
            fill={color}
          />
          {kind === "jacket" && (
            <path
              d="M50 27V76M34 54H43M57 54H66"
              stroke="#e5d9c4"
              strokeWidth="3"
            />
          )}
          {kind === "hoodie" && (
            <path
              d="M33 25Q50 4 67 25M44 28V42M56 28V42"
              stroke="#e5d9c4"
              fill="none"
              strokeWidth="3"
            />
          )}
        </>
      ) : (
        <>
          <path
            d={
              kind === "soft"
                ? "M23 77Q23 51 50 51 77 51 77 77Z"
                : "M30 77Q30 53 50 53 70 53 70 77Z"
            }
            fill="#829889"
          />
          <ellipse cx="50" cy="37" rx="21" ry="24" fill="#d5aa89" />
          {["short", "long", "crest", "bob", "curly"].includes(kind) && (
            <path
              d={
                kind === "long"
                  ? "M25 62V27Q24 4 50 8 76 4 76 27V65L64 57 64 27 43 20 33 30 34 59Z"
                  : kind === "bob"
                    ? "M25 48V24Q25 4 52 8 78 10 76 31L74 52 63 54 65 29 37 21 35 53Z"
                    : kind === "crest"
                      ? "M28 31Q19 4 42 13 50-2 62 9 82 3 73 29L60 21 46 23Z"
                      : kind === "curly"
                        ? "M26 34Q15 24 25 17 23 6 35 9 43-1 51 8 62 0 69 13 84 14 75 29L65 27 54 24 40 28Z"
                        : "M28 30Q22 8 49 9 77 7 73 30L61 23 39 25Z"
              }
              fill={color}
            />
          )}
          {kind === "glasses" && (
            <g stroke="#423d44" fill="none" strokeWidth="3">
              <circle cx="40" cy="35" r="8" />
              <circle cx="60" cy="35" r="8" />
              <path d="M48 35H52" />
            </g>
          )}
          {kind === "headphones" && (
            <g stroke={color} fill="none" strokeWidth="7">
              <path d="M26 37V27Q50 0 74 27V37" />
              <path d="M25 30V48M75 30V48" />
            </g>
          )}
          {kind === "beanie" && (
            <path d="M27 28Q26 5 51 8 74 7 73 28Z" fill={color} />
          )}
          {kind === "earrings" && (
            <g stroke="#d7b879" fill="none" strokeWidth="3">
              <circle cx="28" cy="46" r="5" />
              <circle cx="72" cy="46" r="5" />
            </g>
          )}
          {["friendly", "calm", "bright"].includes(kind) && (
            <g stroke="#694d43" fill="none" strokeWidth="2.4">
              <path
                d={
                  kind === "calm" ? "M35 33H42M58 33H65" : "M37 32V35M63 32V35"
                }
              />
              <path
                d={
                  kind === "bright"
                    ? "M39 43Q50 58 61 43Z"
                    : kind === "calm"
                      ? "M45 47H55"
                      : "M42 45Q50 53 58 45"
                }
              />
            </g>
          )}
        </>
      )}
    </svg>
  );
}
function Swatches({
  label,
  colors,
  value,
  change,
}: {
  label: string;
  colors: string[];
  value: string;
  change: (value: string) => void;
}) {
  return (
    <fieldset className="creator-palette">
      <legend>{label}</legend>
      <div>
        {colors.map((color) => (
          <button
            type="button"
            key={color}
            aria-label={`${label} ${color}`}
            aria-pressed={value.toLowerCase() === color}
            style={{ backgroundColor: color }}
            onClick={() => change(color)}
          >
            {value.toLowerCase() === color && <Check size={15} />}
          </button>
        ))}
        <label className="creator-custom-color" title="Escolher outra cor">
          <Palette size={16} />
          <input
            aria-label={`${label} personalizada`}
            type="color"
            value={value}
            onChange={(event) => change(event.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}
export default function AvatarCreator({
  value,
  name,
  onApply,
  onCancel,
}: {
  value?: Avatar3D;
  name: string;
  onApply: (avatar: Avatar3D) => Promise<unknown> | void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Avatar3D>(() => ({
      ...defaultAvatar,
      ...value,
    })),
    [category, setCategory] = useState("Cabelo"),
    [pose, setPose] = useState<"idle" | "walk" | "sit">("idle"),
    [reset, setReset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const edit = (value: Partial<Avatar3D>) =>
    setDraft((current) => ({ ...current, ...value }));
  const hair = draft.hairStyle ?? draft.hair,
    outfit = draft.outfitStyle ?? draft.outfit,
    accessory = draft.accessoryStyle ?? draft.accessory;
  const options = (
    label: string,
    items: { id: string; name: string }[],
    selected: string,
    change: (id: string) => void,
  ) => (
    <div className="creator-options" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-label={`${label} ${item.name}`}
          aria-pressed={item.id === selected}
          onClick={() => change(item.id)}
        >
          <OptionArt
            kind={item.id}
            color={label === "Cabelo" ? draft.hairColor : draft.color}
          />
          <span>{item.name}</span>
          {selected === item.id && (
            <Check className="creator-chosen" size={14} />
          )}
        </button>
      ))}
    </div>
  );
  return (
    <div className="avatar-creator">
      <div className="creator-intro">
        <div>
          <h2>Do seu jeito.</h2>
          <p>Um personagem para encontrar a sua turma.</p>
        </div>
        <span>Preview ao vivo</span>
      </div>
      <div className="creator-workspace">
        <section className="creator-preview" aria-label="Prévia do personagem">
          <div className="creator-name">
            <strong>{name}</strong>
            <span>Seu personagem no Voxy</span>
          </div>
          <AvatarPreview appearance={draft} pose={pose} reset={reset} />
          <div className="creator-preview-tools">
            <span>Arraste para girar</span>
            <button
              type="button"
              aria-label="Reposicionar preview"
              onClick={() => setReset((v) => v + 1)}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="creator-poses" aria-label="Testar animação">
            {[
              { id: "idle", name: "Parado" },
              { id: "walk", name: "Andando" },
              { id: "sit", name: "Sentado" },
            ].map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={pose === item.id}
                onClick={() => setPose(item.id as typeof pose)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </section>
        <section className="creator-controls">
          <nav role="tablist" aria-label="Personalização">
            {categories.map(({ name, icon: Icon }) => (
              <button
                type="button"
                role="tab"
                id={"creator-" + name}
                aria-selected={category === name}
                aria-controls="creator-panel"
                key={name}
                onClick={() => setCategory(name)}
              >
                <Icon size={18} />
                <span>{name}</span>
              </button>
            ))}
          </nav>
          <div
            className="creator-panel"
            role="tabpanel"
            id="creator-panel"
            aria-labelledby={"creator-" + category}
          >
            <h3>{category}</h3>
            {category === "Corpo" && (
              <>
                {options(
                  "Corpo",
                  [
                    { id: "classic", name: "Clássico" },
                    { id: "soft", name: "Arredondado" },
                  ],
                  draft.body ?? "classic",
                  (id) => edit({ body: id as Avatar3D["body"] }),
                )}
                <Swatches
                  label="Tom de pele"
                  colors={skinColors}
                  value={draft.skin}
                  change={(skin) => edit({ skin })}
                />
              </>
            )}
            {category === "Rosto" &&
              options(
                "Expressão",
                [
                  { id: "friendly", name: "Sorriso" },
                  { id: "calm", name: "Tranquilo" },
                  { id: "bright", name: "Radiante" },
                ],
                draft.face ?? "friendly",
                (id) => edit({ face: id as Avatar3D["face"] }),
              )}
            {category === "Cabelo" && (
              <>
                {options(
                  "Cabelo",
                  [
                    { id: "short", name: "Curto" },
                    { id: "crest", name: "Topete" },
                    { id: "long", name: "Longo" },
                    { id: "bob", name: "Chanel" },
                    { id: "curly", name: "Coques" },
                  ],
                  hair,
                  (id) =>
                    edit({
                      hairStyle: id as Avatar3D["hairStyle"],
                      hair:
                        id === "long"
                          ? "long"
                          : id === "crest"
                            ? "crest"
                            : "short",
                    }),
                )}
                <Swatches
                  label="Cor do cabelo"
                  colors={hairColors}
                  value={draft.hairColor}
                  change={(hairColor) => edit({ hairColor })}
                />
              </>
            )}
            {category === "Roupas" && (
              <>
                {options(
                  "Roupa",
                  [
                    { id: "sweater", name: "Suéter" },
                    { id: "jacket", name: "Jaqueta" },
                    { id: "hoodie", name: "Moletom" },
                    { id: "tee", name: "Camiseta" },
                  ],
                  outfit,
                  (id) =>
                    edit({
                      outfitStyle: id as Avatar3D["outfitStyle"],
                      outfit: id === "jacket" ? "jacket" : "sweater",
                    }),
                )}
                <Swatches
                  label="Cor da roupa"
                  colors={clothingColors}
                  value={draft.color}
                  change={(color) => edit({ color })}
                />
              </>
            )}
            {category === "Acessórios" &&
              options(
                "Acessório",
                [
                  { id: "none", name: "Nenhum" },
                  { id: "glasses", name: "Óculos" },
                  { id: "headphones", name: "Fones" },
                  { id: "beanie", name: "Gorro" },
                  { id: "earrings", name: "Argolas" },
                ],
                accessory,
                (id) =>
                  edit({
                    accessoryStyle: id as Avatar3D["accessoryStyle"],
                    accessory:
                      id === "glasses"
                        ? "glasses"
                        : id === "headphones"
                          ? "headphones"
                          : "none",
                  }),
              )}
            {category === "Cores" && (
              <>
                <Swatches
                  label="Tom de pele"
                  colors={skinColors}
                  value={draft.skin}
                  change={(skin) => edit({ skin })}
                />
                <Swatches
                  label="Cor do cabelo"
                  colors={hairColors}
                  value={draft.hairColor}
                  change={(hairColor) => edit({ hairColor })}
                />
                <Swatches
                  label="Cor da roupa"
                  colors={clothingColors}
                  value={draft.color}
                  change={(color) => edit({ color })}
                />
              </>
            )}
          </div>
        </section>
      </div>
      {error && (
        <p role="alert" className="creator-error">
          {error}
        </p>
      )}
      <footer className="creator-footer">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft({ ...defaultAvatar });
            setPose("idle");
            setReset((v) => v + 1);
          }}
        >
          <RotateCcw size={15} />
          Restaurar padrão
        </button>
        <div>
          <button type="button" disabled={busy} onClick={onCancel}>
            <ArrowLeft size={15} />
            Cancelar
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void Promise.resolve()
                .then(() => onApply(draft))
                .catch((error) =>
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Não foi possível salvar o personagem.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <Check size={16} />
            {busy ? "Aplicando…" : "Aplicar personagem"}
          </button>
        </div>
      </footer>
    </div>
  );
}
