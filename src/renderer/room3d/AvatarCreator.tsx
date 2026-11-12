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
import { avatar3dSchema } from "../../shared/validation";
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
function OptionArt({
  kind,
  color,
  family = "",
}: {
  kind: string;
  color: string;
  family?: string;
}) {
  const hairs: Record<string, string> = {
    short: "M28 29Q22 8 49 9 77 7 73 29L61 22 39 25Z",
    long: "M25 65V27Q24 4 50 8 76 4 76 27V65L64 57 64 27 43 20 33 30 34 59Z",
    crest: "M28 30 30 12 42 15 54 2 70 9 73 29 57 22Z",
    bob: "M25 48V24Q25 4 52 8 78 10 76 31L74 52 63 54 65 29 37 21 35 53Z",
    curly:
      "M26 34Q15 24 25 17 23 6 35 9 43-1 51 8 62 0 69 13 84 14 75 29L65 27 54 24 40 28Z",
    buzz: "M29 24Q50 1 71 24L67 21Q50 10 33 24Z",
    afro: "M23 34Q9 26 20 15 19 2 34 5 47-6 59 3 76-1 80 12 94 21 77 38L69 24 33 24Z",
    ponytail:
      "M27 29Q24 6 52 9 77 8 75 24Q96 26 87 63L76 54 78 30 66 24 35 24Z",
    braids: "M24 26Q26 6 51 8 76 8 76 27L76 62 66 62 65 25 36 24 34 62 24 62Z",
    wavy: "M25 26Q26 5 52 8 77 8 76 29L80 38 75 49 79 61 66 62 64 28 36 24 34 39 37 48 33 62 22 61 26 48 22 39Z",
    bun: "M29 29Q24 8 42 11 34-5 54 0 67-2 64 11 79 13 72 29L62 23 38 23Z",
  };
  const top = [
    "sweater",
    "jacket",
    "hoodie",
    "tee",
    "shirt",
    "coat",
    "suit",
    "varsity",
  ].includes(kind);
  const lower = ["trousers", "shorts", "skirt"].includes(kind),
    shoe = ["sneakers", "boots", "formal"].includes(kind);
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
      {top ? (
        <>
          <path
            d={
              kind === "tee"
                ? "M32 20 13 36 25 50 32 44 32 76 68 76 68 44 75 50 87 36 68 20 59 25 41 25Z"
                : ["coat", "suit"].includes(kind)
                  ? "M31 16 14 40 24 64 33 54 28 80 72 80 67 54 76 64 86 40 69 16 58 23 42 23Z"
                  : "M31 20 14 42 22 68 32 62 32 76 68 76 68 62 78 68 86 42 69 20 59 26 41 26Z"
            }
            fill={color}
          />
          {kind === "hoodie" && (
            <path
              d="M33 25Q50 4 67 25M44 28V42M56 28V42M36 60H64"
              stroke="#e5d9c4"
              fill="none"
              strokeWidth="3"
            />
          )}
          {["jacket", "shirt", "coat", "suit", "varsity"].includes(kind) && (
            <path
              d="M50 27V77M34 54H43M57 54H66"
              stroke="#e5d9c4"
              strokeWidth="3"
            />
          )}
          {["shirt", "coat", "suit"].includes(kind) && (
            <path d="M35 20 45 40 50 27 55 40 65 20" fill="#e5d9c4" />
          )}
          {kind === "tee" && (
            <rect x="40" y="38" width="20" height="12" rx="2" fill="#e5d9c4" />
          )}
          {kind === "varsity" && (
            <path
              d="M31 20 14 42 22 68 32 62ZM69 20 86 42 78 68 68 62Z"
              fill="#e5d9c4"
            />
          )}
        </>
      ) : lower ? (
        <path
          d={
            kind === "skirt"
              ? "M35 15H65L80 74H20Z"
              : kind === "shorts"
                ? "M28 18H72L74 57H54L50 40 46 57H26Z"
                : "M28 12H72L68 76H53L50 37 47 76H32Z"
          }
          fill={color}
        />
      ) : shoe ? (
        <>
          <path
            d={
              kind === "boots"
                ? "M27 18H59V55L78 64V76H25Z"
                : "M23 46 47 37 57 57 78 65V76H23Z"
            }
            fill={color}
          />
          <path d="M23 76H79" stroke="#e5d9c4" strokeWidth="5" />
          {kind === "sneakers" && (
            <path
              d="M43 48 54 46M48 54 60 51"
              stroke="#e5d9c4"
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
                : kind === "athletic"
                  ? "M24 56 40 52 60 52 76 56 68 77H32Z"
                  : kind === "slim"
                    ? "M37 77V60Q50 49 63 60V77Z"
                    : "M30 77Q30 53 50 53 70 53 70 77Z"
            }
            fill="#829889"
          />
          {kind === "square" && family === "Formato" ? (
            <rect x="28" y="14" width="44" height="47" rx="10" fill="#d5aa89" />
          ) : (
            <ellipse
              cx="50"
              cy="37"
              rx={kind === "oval" ? 18 : 21}
              ry={kind === "oval" ? 27 : 24}
              fill="#d5aa89"
            />
          )}
          {hairs[kind] && family === "Cabelo" && (
            <path d={hairs[kind]} fill={color} />
          )}
          {kind === "braids" && (
            <path
              d="M24 35H34M24 45H34M24 55H34M66 35H76M66 45H76M66 55H76"
              stroke="#c39a68"
              strokeWidth="3"
            />
          )}
          {["glasses", "sunglasses"].includes(kind) && (
            <g
              stroke="#423d44"
              fill={kind === "sunglasses" ? "#423d44" : "none"}
              strokeWidth="3"
            >
              <circle cx="40" cy="35" r="8" />
              <circle cx="60" cy="35" r="8" />
              <path d="M48 35H52" />
            </g>
          )}
          {["headphones", "headset"].includes(kind) && (
            <g stroke={color} fill="none" strokeWidth="6">
              <path d="M26 37V27Q50 0 74 27V45M25 30V48M75 30V48" />
              {kind === "headset" && (
                <path d="M74 45 65 51H57" strokeWidth="3" />
              )}
            </g>
          )}
          {["beanie", "cap", "hat"].includes(kind) && (
            <>
              <path d="M27 28Q26 5 51 8 74 7 73 28Z" fill={color} />
              {kind === "cap" && (
                <path d="M50 28H84" stroke={color} strokeWidth="7" />
              )}
              {kind === "hat" && (
                <path d="M16 28H84" stroke={color} strokeWidth="7" />
              )}
            </>
          )}
          {kind === "earrings" && (
            <g stroke="#d7b879" fill="none" strokeWidth="3">
              <circle cx="28" cy="46" r="5" />
              <circle cx="72" cy="46" r="5" />
            </g>
          )}
          {kind === "necklace" && (
            <path
              d="M36 57Q50 83 64 57M50 68V75"
              stroke="#d7b879"
              fill="none"
              strokeWidth="3"
            />
          )}
          {kind === "bracelet" && (
            <ellipse
              cx="28"
              cy="70"
              rx="7"
              ry="4"
              stroke="#d7b879"
              strokeWidth="4"
              fill="none"
            />
          )}
          {kind === "backpack" && (
            <g fill={color} stroke="#dfcba9" strokeWidth="2">
              <rect x="30" y="51" width="40" height="29" rx="8" />
              <path d="M38 51V42Q50 32 62 42V51" fill="none" />
              <rect x="37" y="65" width="26" height="12" rx="3" />
            </g>
          )}
          {(family === "Expressão" || family === "Olhos") && (
            <g stroke="#694d43" fill="none" strokeWidth="3">
              <path
                d={
                  kind === "calm" || kind === "sleepy"
                    ? "M35 33H42M58 33H65"
                    : kind === "almond"
                      ? "M34 35Q40 27 46 35M54 35Q60 27 66 35"
                      : "M37 32V36M63 32V36"
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
          {family === "Sobrancelhas" && (
            <path
              d={
                kind === "arched"
                  ? "M33 30 40 26 46 29M54 29 60 26 67 30"
                  : "M33 29H46M54 29H67"
              }
              stroke="#694d43"
              strokeWidth={kind === "bold" ? 5 : 2.5}
              fill="none"
            />
          )}
          {family === "Nariz" && (
            <ellipse
              cx="50"
              cy="41"
              rx={kind === "wide" ? 9 : kind === "round" ? 6 : 3}
              ry={kind === "round" ? 7 : 4}
              fill="#b07b5d"
            />
          )}
          {family === "Barba" && kind !== "none" && (
            <path
              d={
                kind === "mustache"
                  ? "M37 43Q50 36 63 43L59 48 50 44 41 48Z"
                  : kind === "stubble"
                    ? "M32 46Q50 67 68 46L63 58Q50 69 37 58Z"
                    : "M30 41 37 49 50 51 63 49 70 41 66 62 50 70 34 62Z"
              }
              fill="#694d43"
            />
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
  const [history, setHistory] = useState<Avatar3D[]>([]);
  const [presets, setPresets] = useState<Avatar3D[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("voxy-avatar-presets-v1") ?? "[]")
        .slice(0, 6)
        .flatMap((a: unknown) => {
          const parsed = avatar3dSchema.safeParse(a);
          return parsed.success && parsed.data ? [parsed.data] : [];
        });
    } catch {
      return [];
    }
  });
  const edit = (value: Partial<Avatar3D>) => {
    setHistory((h) => [...h.slice(-29), draft]);
    setDraft((current) => ({ ...current, ...value }));
  };
  const restore = (appearance: Avatar3D) => {
    setHistory((h) => [...h.slice(-29), draft]);
    setDraft({ ...defaultAvatar, ...appearance });
  };
  const remember = (next: Avatar3D[]) => {
    setPresets(next);
    try {
      localStorage.setItem("voxy-avatar-presets-v1", JSON.stringify(next));
    } catch {
      setError("Não há espaço para salvar visuais neste computador.");
    }
  };
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
            family={label}
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
                    { id: "slim", name: "Esbelto" },
                    { id: "athletic", name: "Atlético" },
                  ],
                  draft.body ?? "classic",
                  (id) => edit({ body: id as Avatar3D["body"] }),
                )}
                <label className="creator-slider">
                  Altura{" "}
                  <input
                    aria-label="Altura do personagem"
                    type="range"
                    min=".9"
                    max="1.1"
                    step=".01"
                    value={draft.height ?? 1}
                    onChange={(e) => edit({ height: +e.target.value })}
                  />
                </label>
                {options(
                  "Postura",
                  [
                    { id: "relaxed", name: "Relaxado" },
                    { id: "lively", name: "Animado" },
                    { id: "confident", name: "Confiante" },
                  ],
                  draft.idle ?? "relaxed",
                  (id) => edit({ idle: id as Avatar3D["idle"] }),
                )}
                <Swatches
                  label="Tom de pele"
                  colors={skinColors}
                  value={draft.skin}
                  change={(skin) => edit({ skin })}
                />
              </>
            )}
            {category === "Rosto" && (
              <>
                {options(
                  "Expressão",
                  [
                    { id: "friendly", name: "Sorriso" },
                    { id: "calm", name: "Tranquilo" },
                    { id: "bright", name: "Radiante" },
                  ],
                  draft.face ?? "friendly",
                  (id) => edit({ face: id as Avatar3D["face"] }),
                )}
                {options(
                  "Formato",
                  [
                    { id: "round", name: "Redondo" },
                    { id: "oval", name: "Oval" },
                    { id: "square", name: "Quadrado" },
                  ],
                  draft.headShape ?? "round",
                  (id) => edit({ headShape: id as Avatar3D["headShape"] }),
                )}
                {options(
                  "Olhos",
                  [
                    { id: "round", name: "Redondos" },
                    { id: "almond", name: "Amendoados" },
                    { id: "sleepy", name: "Serenos" },
                  ],
                  draft.eyes ?? "round",
                  (id) => edit({ eyes: id as Avatar3D["eyes"] }),
                )}
                {options(
                  "Sobrancelhas",
                  [
                    { id: "soft", name: "Suaves" },
                    { id: "bold", name: "Marcadas" },
                    { id: "arched", name: "Arqueadas" },
                  ],
                  draft.brows ?? "soft",
                  (id) => edit({ brows: id as Avatar3D["brows"] }),
                )}
                {options(
                  "Nariz",
                  [
                    { id: "small", name: "Pequeno" },
                    { id: "round", name: "Redondo" },
                    { id: "wide", name: "Largo" },
                  ],
                  draft.nose ?? "small",
                  (id) => edit({ nose: id as Avatar3D["nose"] }),
                )}
                {options(
                  "Barba",
                  [
                    { id: "none", name: "Sem barba" },
                    { id: "stubble", name: "Curta" },
                    { id: "beard", name: "Cheia" },
                    { id: "mustache", name: "Bigode" },
                  ],
                  draft.facialHair ?? "none",
                  (id) => edit({ facialHair: id as Avatar3D["facialHair"] }),
                )}
              </>
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
                    { id: "curly", name: "Coques cacheados" },
                    { id: "buzz", name: "Raspado" },
                    { id: "bald", name: "Sem cabelo" },
                    { id: "afro", name: "Afro" },
                    { id: "ponytail", name: "Rabo de cavalo" },
                    { id: "braids", name: "Tranças" },
                    { id: "wavy", name: "Ondulado" },
                    { id: "bun", name: "Preso" },
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
                <Swatches
                  label="Mechas"
                  colors={hairColors}
                  value={draft.hairSecondary ?? draft.hairColor}
                  change={(hairSecondary) => edit({ hairSecondary })}
                />
                <button
                  type="button"
                  onClick={() => edit({ hairSecondary: undefined })}
                >
                  Remover mechas
                </button>
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
                    { id: "shirt", name: "Camisa" },
                    { id: "coat", name: "Casaco" },
                    { id: "suit", name: "Social" },
                    { id: "varsity", name: "College" },
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
                {options(
                  "Parte inferior",
                  [
                    { id: "trousers", name: "Calça" },
                    { id: "shorts", name: "Shorts" },
                    { id: "skirt", name: "Saia" },
                  ],
                  draft.bottom ?? "trousers",
                  (id) => edit({ bottom: id as Avatar3D["bottom"] }),
                )}
                <Swatches
                  label="Cor da parte inferior"
                  colors={clothingColors}
                  value={draft.bottomColor ?? "#30394c"}
                  change={(bottomColor) => edit({ bottomColor })}
                />
                {options(
                  "Calçados",
                  [
                    { id: "sneakers", name: "Tênis" },
                    { id: "boots", name: "Botas" },
                    { id: "formal", name: "Sapatos" },
                  ],
                  draft.shoes ?? "sneakers",
                  (id) => edit({ shoes: id as Avatar3D["shoes"] }),
                )}
                <Swatches
                  label="Cor do calçado"
                  colors={clothingColors}
                  value={draft.shoeColor ?? "#e5ded2"}
                  change={(shoeColor) => edit({ shoeColor })}
                />
              </>
            )}
            {category === "Acessórios" && (
              <>
                <p>
                  Combine peças. Chapéus, óculos e fones substituem peças do
                  mesmo grupo.
                </p>
                <div className="creator-options">
                  {(
                    [
                      { id: "glasses", name: "Óculos" },
                      { id: "sunglasses", name: "Óculos escuros" },
                      { id: "headphones", name: "Fones" },
                      { id: "headset", name: "Headset gamer" },
                      { id: "beanie", name: "Gorro" },
                      { id: "cap", name: "Boné" },
                      { id: "hat", name: "Chapéu" },
                      { id: "earrings", name: "Argolas" },
                      { id: "necklace", name: "Colar" },
                      { id: "bracelet", name: "Pulseira" },
                      { id: "backpack", name: "Mochila" },
                    ] as const
                  ).map((item) => {
                    const active = (draft.accessories ?? [accessory]).includes(
                      item.id as any,
                    );
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-label={"Acessório " + item.name}
                        aria-pressed={active}
                        onClick={() => {
                          const group = ["glasses", "sunglasses"].includes(
                            item.id,
                          )
                            ? ["glasses", "sunglasses"]
                            : ["headphones", "headset"].includes(item.id)
                              ? ["headphones", "headset"]
                              : ["beanie", "cap", "hat"].includes(item.id)
                                ? ["beanie", "cap", "hat"]
                                : [item.id];
                          const next = (
                            draft.accessories ?? [accessory]
                          ).filter((x) => x !== "none" && !group.includes(x));
                          edit({
                            accessories: (active
                              ? next
                              : [...next, item.id]) as Avatar3D["accessories"],
                            accessoryStyle:
                              item.id === "headphones" ? "headphones" : "none",
                            accessory:
                              item.id === "headphones" ? "headphones" : "none",
                          });
                        }}
                      >
                        <OptionArt
                          kind={item.id}
                          family="Acessório"
                          color={draft.color}
                        />
                        <span>{item.name}</span>
                        {active && (
                          <Check className="creator-chosen" size={14} />
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    edit({
                      accessories: [],
                      accessory: "none",
                      accessoryStyle: "none",
                    })
                  }
                >
                  Remover acessórios
                </button>
              </>
            )}
            {category === "Cores" && (
              <>
                <label className="creator-slider">
                  Altura{" "}
                  <input
                    aria-label="Altura do personagem"
                    type="range"
                    min=".9"
                    max="1.1"
                    step=".01"
                    value={draft.height ?? 1}
                    onChange={(e) => edit({ height: +e.target.value })}
                  />
                </label>
                {options(
                  "Postura",
                  [
                    { id: "relaxed", name: "Relaxado" },
                    { id: "lively", name: "Animado" },
                    { id: "confident", name: "Confiante" },
                  ],
                  draft.idle ?? "relaxed",
                  (id) => edit({ idle: id as Avatar3D["idle"] }),
                )}
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
                  label="Mechas"
                  colors={hairColors}
                  value={draft.hairSecondary ?? draft.hairColor}
                  change={(hairSecondary) => edit({ hairSecondary })}
                />
                <button
                  type="button"
                  onClick={() => edit({ hairSecondary: undefined })}
                >
                  Remover mechas
                </button>
                <Swatches
                  label="Cor da roupa"
                  colors={clothingColors}
                  value={draft.color}
                  change={(color) => edit({ color })}
                />
                {options(
                  "Parte inferior",
                  [
                    { id: "trousers", name: "Calça" },
                    { id: "shorts", name: "Shorts" },
                    { id: "skirt", name: "Saia" },
                  ],
                  draft.bottom ?? "trousers",
                  (id) => edit({ bottom: id as Avatar3D["bottom"] }),
                )}
                <Swatches
                  label="Cor da parte inferior"
                  colors={clothingColors}
                  value={draft.bottomColor ?? "#30394c"}
                  change={(bottomColor) => edit({ bottomColor })}
                />
                {options(
                  "Calçados",
                  [
                    { id: "sneakers", name: "Tênis" },
                    { id: "boots", name: "Botas" },
                    { id: "formal", name: "Sapatos" },
                  ],
                  draft.shoes ?? "sneakers",
                  (id) => edit({ shoes: id as Avatar3D["shoes"] }),
                )}
                <Swatches
                  label="Cor do calçado"
                  colors={clothingColors}
                  value={draft.shoeColor ?? "#e5ded2"}
                  change={(shoeColor) => edit({ shoeColor })}
                />
              </>
            )}
          </div>
        </section>
      </div>
      {presets.length > 0 && (
        <div className="creator-presets" aria-label="Visuais salvos">
          {presets.map((a, i) => (
            <div key={i}>
              <button
                type="button"
                onClick={() => restore(a)}
                style={{ borderColor: a.color }}
              >
                Visual {i + 1}
              </button>
              <button
                type="button"
                aria-label={`Excluir visual ${i + 1}`}
                onClick={() => remember(presets.filter((_, n) => n !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
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
            edit({
              ...defaultAvatar,
              headShape: undefined,
              eyes: undefined,
              brows: undefined,
              nose: undefined,
              facialHair: undefined,
              height: undefined,
              hairStyle: undefined,
              outfitStyle: undefined,
              accessoryStyle: undefined,
              accessories: undefined,
              bottom: undefined,
              bottomColor: undefined,
              shoes: undefined,
              shoeColor: undefined,
              body: undefined,
              face: undefined,
              hairSecondary: undefined,
              idle: undefined,
            });
            setPose("idle");
            setReset((v) => v + 1);
          }}
        >
          <RotateCcw size={15} />
          Restaurar padrão
        </button>
        <button
          type="button"
          disabled={!history.length || busy}
          onClick={() => {
            setDraft(history[history.length - 1]);
            setHistory((h) => h.slice(0, -1));
          }}
        >
          Desfazer
        </button>
        <button
          type="button"
          disabled={presets.length >= 6}
          onClick={() => remember([...presets, draft])}
        >
          Salvar visual ({presets.length}/6)
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
