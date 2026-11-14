import { z } from "zod";
import {
  isPttKey,
  shortcutConflict,
  DEFAULT_NOTIFICATIONS,
} from "./preferences";
import { MAX_IMAGE_BYTES } from "./constants";
import { validateImage } from "./image";
const id = z.string().min(1).max(100),
  name = z.string().trim().min(1).max(60);
export const avatarSchema = z
  .string()
  .max(44000)
  .refine((value) => {
    if (!value.startsWith("data:")) return value.length <= 12;
    try {
      const info = validateImage(value);
      return info.width <= 128 && info.height <= 128 && info.bytes <= 32768;
    } catch {
      return false;
    }
  }, "Escolha um emoji ou uma foto de até 128 px / 32 KB.");
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const bannerSchema = z
  .string()
  .max(180000)
  .refine((value) => {
    if (!value) return true;
    try {
      const image = validateImage(value);
      return (
        image.width <= 960 && image.height <= 360 && image.bytes <= 128 * 1024
      );
    } catch {
      return false;
    }
  }, "Escolha uma capa de até 960 × 360 px / 128 KB.");
export const avatar3dSchema = z.object({
  hair: z.enum(["short", "long", "crest"]),
  hairStyle: z
    .enum([
      "short",
      "long",
      "crest",
      "bob",
      "curly",
      "buzz",
      "afro",
      "ponytail",
      "braids",
      "wavy",
      "bun",
      "bald",
    ])
    .optional(),
  hairColor: colorSchema,
  skin: colorSchema,
  outfit: z.enum(["sweater", "jacket"]),
  outfitStyle: z
    .enum([
      "sweater",
      "jacket",
      "hoodie",
      "tee",
      "shirt",
      "coat",
      "suit",
      "varsity",
    ])
    .optional(),
  color: colorSchema,
  accessory: z.enum(["none", "glasses", "headphones"]),
  accessoryStyle: z
    .enum(["none", "glasses", "headphones", "beanie", "earrings"])
    .optional(),
  body: z.enum(["classic", "soft", "slim", "athletic"]).optional(),
  headShape: z.enum(["round", "oval", "square"]).optional(),
  eyes: z.enum(["round", "almond", "sleepy"]).optional(),
  brows: z.enum(["soft", "bold", "arched"]).optional(),
  nose: z.enum(["small", "round", "wide"]).optional(),
  facialHair: z.enum(["none", "stubble", "beard", "mustache"]).optional(),
  height: z.number().finite().min(0.9).max(1.1).optional(),
  hairSecondary: colorSchema.optional(),
  bottom: z.enum(["trousers", "shorts", "skirt"]).optional(),
  bottomColor: colorSchema.optional(),
  shoes: z.enum(["sneakers", "boots", "formal"]).optional(),
  shoeColor: colorSchema.optional(),
  accessories: z
    .array(
      z.enum([
        "glasses",
        "sunglasses",
        "headphones",
        "headset",
        "beanie",
        "cap",
        "hat",
        "earrings",
        "necklace",
        "bracelet",
        "backpack",
      ]),
    )
    .max(11)
    .refine((a) => new Set(a).size === a.length)
    .optional(),
  idle: z.enum(["relaxed", "lively", "confident"]).optional(),
  face: z.enum(["friendly", "calm", "bright"]).optional(),
});
const profileObjectSchema = z.object({
  avatar3d: avatar3dSchema.optional(),
  room3d: z
    .object({
      entry: z.enum(["always", "ask", "traditional"]),
      quality: z.enum(["low", "medium", "high"]),
      proximity: z.boolean(),
      volume: z.number().min(0).max(1),
      range: z.number().min(3).max(20),
      sensitivity: z.number().min(0.2).max(3),
      names: z.boolean(),
      cameraMode: z.enum(["follow", "free"]).optional(),
      smokeEffects: z.boolean().optional(),
      gameSounds: z.boolean().optional(),
      emoteKey: z.enum(["KeyG", "KeyB", "KeyH", "KeyN"]).optional(),
    })
    .optional(),
  id: z.uuid(),
  name,
  avatar: avatarSchema,
  presence: z.enum(["online", "away", "busy"]).default("online"),
  input: z.string().max(300),
  output: z.string().max(300),
  cameraDevice: z.string().max(300).default(""),
  pttEnabled: z.boolean().default(false),
  pttKey: z.string().max(40).refine(isPttKey).default("KeyV"),
  muteShortcut: z
    .object({
      key: z
        .string()
        .max(40)
        .refine(isPttKey)
        .refine((k) => !/^(Control|Alt|Shift|Meta)/.test(k)),
      ctrl: z.boolean(),
      alt: z.boolean(),
      shift: z.boolean(),
    })
    .nullable()
    .default(null),
  deafenShortcut: z
    .object({
      key: z
        .string()
        .max(40)
        .refine(isPttKey)
        .refine((k) => !/^(Control|Alt|Shift|Meta)/.test(k)),
      ctrl: z.boolean(),
      alt: z.boolean(),
      shift: z.boolean(),
    })
    .nullable()
    .default(null),
  shortcutSounds: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  startMinimized: z.boolean().default(false),
  closeToTray: z.boolean().default(false),
  notifications: z
    .object({
      native: z.boolean().default(true),
      sounds: z.boolean().default(true),
      types: z
        .object({
          mention: z.boolean().default(true),
          reply: z.boolean().default(true),
          direct: z.boolean().default(true),
          "friend-request": z.boolean().default(true),
          "friend-accepted": z.boolean().default(true),
        })
        .default({
          mention: true,
          reply: true,
          direct: true,
          "friend-request": true,
          "friend-accepted": true,
        }),
      mutedServers: z.array(z.string().max(210)).max(1000).default([]),
      mutedChannels: z.array(z.string().max(210)).max(1000).default([]),
      dndUntil: z.number().nonnegative().finite().default(0),
    })
    .default(DEFAULT_NOTIFICATIONS),
  inputVolume: z.number().min(0).max(2).default(1),
  noiseSuppression: z.boolean().default(true),
  echoCancellation: z.boolean().default(true),
  voiceDetection: z.boolean().default(false),
  voiceThreshold: z.number().min(-70).max(-10).default(-45),
  callSounds: z.boolean().default(true),
  pttSounds: z.boolean().default(true),
  autoGainControl: z.boolean().default(true),
  theme: z.enum(["voxy", "ocean", "forest", "kuromi"]).default("voxy"),
  accentColor: z.union([colorSchema, z.literal("")]).default(""),
  nicknameColor: z.union([colorSchema, z.literal("")]).default(""),
  banner: bannerSchema.default(""),
  volumes: z.record(z.uuid(), z.number().min(0).max(2)).default({}),
  streamVolumes: z.record(z.uuid(), z.number().min(0).max(1)).default({}),
  mutedParticipants: z.record(z.uuid(), z.boolean()).default({}),
});
export const profileSchema = profileObjectSchema.refine(
  (p) => !shortcutConflict(p),
  "Escolha teclas diferentes para PTT, mute e Deafen.",
);
export const publicProfileSchema = profileObjectSchema
  .pick({
    id: true,
    name: true,
    avatar: true,
    presence: true,
    nicknameColor: true,
    banner: true,
    avatar3d: true,
  })
  .extend({ mediaSubscriptions: z.boolean().default(false) });
export const imageSchema = z
  .string()
  .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("game.join"),
    game: z.enum(["truco", "chess"]),
    seat: z.number().int().min(0).max(3).optional(),
  }),
  z.discriminatedUnion("game", [
    z.object({
      type: z.literal("game.act"),
      game: z.literal("chess"),
      revision: z.number().int().nonnegative(),
      action: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("move"),
          from: z.string().regex(/^[a-h][1-8]$/),
          to: z.string().regex(/^[a-h][1-8]$/),
          promotion: z.enum(["q", "r", "b", "n"]).optional(),
        }),
        z.object({
          type: z.literal("claim"),
          move: z
            .object({
              from: z.string().regex(/^[a-h][1-8]$/),
              to: z.string().regex(/^[a-h][1-8]$/),
              promotion: z.enum(["q", "r", "b", "n"]).optional(),
            })
            .optional(),
        }),
        z.object({ type: z.literal("resign") }),
        z.object({ type: z.literal("offer") }),
        z.object({ type: z.literal("accept") }),
        z.object({ type: z.literal("decline") }),
        z.object({ type: z.literal("restart") }),
      ]),
    }),
    z.object({
      type: z.literal("game.act"),
      game: z.literal("truco"),
      revision: z.number().int().nonnegative(),
      action: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("play"),
          index: z.number().int().min(0).max(2),
          covered: z.boolean().optional(),
        }),
        z.object({ type: z.literal("raise") }),
        z.object({ type: z.literal("accept") }),
        z.object({ type: z.literal("fold") }),
        z.object({ type: z.literal("eleven"), accept: z.boolean() }),
        z.object({ type: z.literal("restart") }),
      ]),
    }),
  ]),
  z.object({ type: z.literal("game.leave"), game: z.enum(["truco", "chess"]) }),
  z.object({ type: z.literal("pool.join") }),
  z.object({ type: z.literal("pool.leave") }),
  z.object({
    type: z.literal("pool.aim"),
    angle: z
      .number()
      .finite()
      .min(-Math.PI * 2)
      .max(Math.PI * 2),
    power: z.number().finite().min(0.05).max(1),
  }),
  z.object({
    type: z.literal("pool.place"),
    x: z.number().finite().min(-1.25).max(1.25),
    z: z.number().finite().min(-2.3).max(2.3),
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("pool.restart") }),
  z.object({
    type: z.literal("pool.shoot"),
    angle: z
      .number()
      .finite()
      .min(-Math.PI * 2)
      .max(Math.PI * 2),
    power: z.number().finite().min(0.05).max(1),
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("room.tv"), participantId: id }),
  z.object({
    type: z.literal("channel.room"),
    id,
    preset: z.enum(["lounge", "cinema", "rooftop"]).nullable(),
  }),
  z.object({
    type: z.literal("room.pose"),
    pose: z
      .object({
        x: z.number().finite().min(-13).max(13),
        z: z.number().finite().min(-11).max(13),
        yaw: z.number().finite().min(-100).max(100),
        seat: z.string().max(40).nullable(),
        moving: z.boolean(),
        emote: z
          .enum([
            "wave",
            "clap",
            "point",
            "sitfloor",
            "pose",
            "surprise",
            "laugh",
            "dance",
            "celebrate",
            "greet",
            "smoke",
            "none",
          ])
          .optional(),
        emoteAt: z.number().finite().nonnegative().optional(),
      })
      .nullable(),
  }),
  z.object({ type: z.literal("friend.request"), memberId: z.uuid() }),
  z.object({
    type: z.literal("friend.respond"),
    memberId: z.uuid(),
    accept: z.boolean(),
  }),
  z.object({ type: z.literal("friend.remove"), memberId: z.uuid() }),
  z.object({ type: z.literal("call.invite"), memberId: z.uuid() }),
  z.object({
    type: z.literal("call.respond"),
    id: z.uuid(),
    accept: z.boolean(),
  }),
  z.object({ type: z.literal("call.end"), id: z.uuid() }),
  z.object({
    type: z.literal("message.react"),
    id: z.uuid(),
    emoji: z.enum(["👍", "❤️", "😂", "🎉", "👀", "😮", "😢", "🔥"]),
  }),
  z.object({
    type: z.literal("direct.react"),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.uuid(),
    emoji: z.enum(["👍", "❤️", "😂", "🎉", "👀", "😮", "😢", "🔥"]),
  }),
  z.object({
    type: z.literal("role.save"),
    serverId: id,
    id: id.optional(),
    name,
    color: colorSchema,
  }),
  z.object({ type: z.literal("role.delete"), serverId: id, id }),
  z.object({
    type: z.literal("role.assign"),
    serverId: id,
    roleId: id,
    memberId: z.uuid(),
    assigned: z.boolean(),
  }),
  z
    .object({
      type: z.literal("direct.message"),
      scope: z.string().regex(/^[a-f0-9]{64}$/),
      recipient: z.uuid(),
      text: z.string().trim().max(4000),
      image: imageSchema.optional(),
      replyTo: z.uuid().optional(),
    })
    .refine((v) => !!v.text || !!v.image),
  z.object({
    type: z.literal("direct.edit"),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.uuid(),
    text: z.string().trim().max(4000),
  }),
  z.object({
    type: z.literal("direct.delete"),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.uuid(),
  }),
  z.object({ type: z.literal("server.create"), name }),
  z.object({ type: z.literal("server.rename"), id, name }),
  z.object({ type: z.literal("server.delete"), id }),
  z.object({
    type: z.literal("server.icon"),
    id,
    image: avatarSchema.refine((v) => v.startsWith("data:image/")).nullable(),
  }),
  z.object({
    type: z.literal("channel.create"),
    serverId: id,
    name,
    kind: z.enum(["voice", "text"]),
  }),
  z.object({ type: z.literal("channel.rename"), id, name }),
  z.object({ type: z.literal("channel.delete"), id }),
  z
    .object({
      type: z.literal("message"),
      channelId: id,
      text: z.string().trim().max(4000),
      image: imageSchema.optional(),
      replyTo: z.uuid().optional(),
    })
    .refine((v) => v.text.length > 0 || !!v.image),
  z.object({ type: z.literal("voice"), channelId: id.nullable() }),
  z.object({
    type: z.literal("message.edit"),
    id,
    text: z.string().trim().max(4000),
  }),
  z.object({ type: z.literal("message.delete"), id }),
  z.object({
    type: z.literal("status"),
    muted: z.boolean(),
    deafened: z.boolean(),
    sharing: z.boolean(),
    camera: z.boolean().optional(),
    microphoneState: z.enum(["muted", "ptt-waiting", "active"]).optional(),
  }),
  z.object({
    type: z.literal("profile"),
    avatar3d: profileObjectSchema.shape.avatar3d,
    name,
    avatar: avatarSchema,
    presence: z.enum(["online", "away", "busy"]).optional(),
    nicknameColor: z.union([colorSchema, z.literal("")]).optional(),
    banner: bannerSchema.optional(),
  }),
]);
export const signalSchema = z
  .object({
    subscription: z
      .object({ screen: z.boolean(), camera: z.boolean() })
      .optional(),
    to: id,
    description: z
      .object({ type: z.enum(["offer", "answer"]), sdp: z.string().max(64000) })
      .optional(),
    candidate: z
      .object({
        candidate: z.string().max(4000).optional(),
        sdpMid: z.string().max(100).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(32).nullable().optional(),
        usernameFragment: z.string().max(300).nullable().optional(),
      })
      .optional(),
  })
  .refine(
    (v) =>
      [v.description, v.candidate, v.subscription].filter(Boolean).length === 1,
  );
export const historySchema = z
  .object({
    channelId: id.optional(),
    scope: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    peer: z.uuid().optional(),
    before: z.number().nonnegative().optional(),
    beforeId: z.uuid().optional(),
    search: z.string().max(100).optional(),
    messageId: z.uuid().optional(),
  })
  .refine((v) => !!v.channelId !== !!(v.scope && v.peer));
export function privateIPv4(value: string) {
  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((x) => !Number.isInteger(x) || x < 0 || x > 255) ||
    octets.join(".") !== value
  )
    return false;
  const [a, b] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
export function parseInvite(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "voxy:" ||
    !roomIPv4(u.hostname) ||
    !/^\d+$/.test(u.port) ||
    Number(u.port) < 1024 ||
    Number(u.port) > 65535 ||
    !/^\/[a-f0-9]{64}$/.test(u.pathname) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error("Convite inválido. Use voxy://IP-privado:porta/segredo.");
  return {
    address: u.hostname,
    port: Number(u.port),
    token: u.pathname.slice(1),
  };
}

// Radmin uses 26/8 for its virtual network; this is not an RFC1918 range.
// Host interface selection additionally requires the Radmin adapter for 26/8.
export function radminIPv4(value: string) {
  return /^26\./.test(value) && privateIPv4("10" + value.slice(2));
}
export function roomIPv4(value: string) {
  return privateIPv4(value) || radminIPv4(value);
}
