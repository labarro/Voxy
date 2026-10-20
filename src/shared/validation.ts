import { z } from "zod";
import { isPttKey } from "./preferences";
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
export const profileSchema = z.object({
  id: z.uuid(),
  name,
  avatar: avatarSchema,
  input: z.string().max(300),
  output: z.string().max(300),
  pttEnabled: z.boolean().default(false),
  pttKey: z.string().max(40).refine(isPttKey).default("KeyV"),
  inputVolume: z.number().min(0).max(2).default(1),
  voiceDetection: z.boolean().default(false),
  voiceThreshold: z.number().min(-70).max(-10).default(-45),
  callSounds: z.boolean().default(true),
  volumes: z.record(z.uuid(), z.number().min(0).max(1)).default({}),
  streamVolumes: z.record(z.uuid(), z.number().min(0).max(1)).default({}),
  mutedParticipants: z.record(z.uuid(), z.boolean()).default({}),
});
export const publicProfileSchema = profileSchema.pick({
  id: true,
  name: true,
  avatar: true,
});
export const imageSchema = z
  .string()
  .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("server.create"), name }),
  z.object({ type: z.literal("server.rename"), id, name }),
  z.object({ type: z.literal("server.delete"), id }),
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
  }),
  z.object({
    type: z.literal("profile"),
    name,
    avatar: avatarSchema,
  }),
]);
export const signalSchema = z
  .object({
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
  .refine((v) => !!v.description !== !!v.candidate);
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
