import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const post = z.object({
  version,
  date: z.iso.date(),
  title: z.string().max(200),
  items: z.array(z.string().max(2000)).max(100),
  features: z.array(z.string().max(2000)).max(100),
  improvements: z.array(z.string().max(2000)).max(100),
  fixes: z.array(z.string().max(2000)).max(100),
});
export const signedReleaseSchema = z.object({
  schema: z.literal(1),
  channel: z.literal("stable"),
  version,
  date: z.iso.date(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  files: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^Voxy-Setup-\d+\.\d+\.\d+-x64\.exe(?:\.blockmap)?$/),
        sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
        size: z
          .number()
          .int()
          .min(1)
          .max(512 * 1024 * 1024),
      }),
    )
    .min(2)
    .max(2),
  manifestSha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  releases: z.array(post).max(100),
});
export type SignedRelease = z.infer<typeof signedReleaseSchema>;
export type TrustConfig = {
  schema: number;
  repository: string;
  endpoint: string;
  publicKeys: string[];
  authenticodePublisher: string | null;
};
export function verifyReleaseEnvelope(
  text: string,
  trust: TrustConfig,
): SignedRelease {
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw Error("Metadados de atualização excedem o limite.");
  const envelope = z
    .object({
      payload: z.string().max(1400000),
      signature: z.string().max(200),
    })
    .parse(JSON.parse(text));
  const payload = Buffer.from(envelope.payload, "base64"),
    signature = Buffer.from(envelope.signature, "base64");
  if (
    payload.toString("base64") !== envelope.payload ||
    signature.length !== 64 ||
    !trust.publicKeys.some((pem) => {
      try {
        const key = createPublicKey(pem);
        return (
          key.asymmetricKeyType === "ed25519" &&
          verify(null, payload, key, signature)
        );
      } catch {
        return false;
      }
    })
  )
    throw Error(
      "Assinatura da atualização inválida. Nenhum pacote será instalado.",
    );
  const release = signedReleaseSchema.parse(
    JSON.parse(payload.toString("utf8")),
  );
  if (release.repository !== trust.repository)
    throw Error("A atualização pertence a outro aplicativo.");
  const name = `Voxy-Setup-${release.version}-x64.exe`;
  if (
    new Set(release.files.map((f) => f.name)).size !== 2 ||
    !release.files.some((f) => f.name === name) ||
    !release.files.some((f) => f.name === name + ".blockmap") ||
    !release.releases.some((p) => p.version === release.version)
  )
    throw Error("Manifesto de atualização inconsistente.");
  return release;
}
export async function hash512(path: string) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("base64");
}
export function releaseBase(trust: TrustConfig, version: string) {
  return `https://github.com/${trust.repository}/releases/download/v${version}/`;
}
