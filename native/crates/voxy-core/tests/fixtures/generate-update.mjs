// Development oracle only: no production signing keys or releases are accessed.
// Run: node --import tsx native/crates/voxy-core/tests/fixtures/generate-update.mjs
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { verifyReleaseEnvelope, releaseBase } from "../../../../../src/main/updateTrust.ts";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const artifact = "synthetic-installer-fixture-not-executable";
const manifest = "synthetic-manifest-fixture";
const hash = (value) => createHash("sha512").update(value).digest("base64");
const trust = {
  schema: 1, repository: "example/voxy-fixture", endpoint: "https://example.invalid/updates/",
  publicKeys: [publicKey.export({ type: "spki", format: "pem" }).toString()],
  authenticodePublisher: null,
};
const version = "2.0.1";
const post = { version, date: "2026-11-17", title: "Synthetic oracle", items: ["fixture"], features: [], improvements: [], fixes: [] };
const release = {
  schema: 1, channel: "stable", version, date: post.date, repository: trust.repository,
  files: ["", ".blockmap"].map((suffix) => ({ name: `Voxy-Setup-${version}-x64.exe${suffix}`, sha512: hash(artifact), size: Buffer.byteLength(artifact) })),
  manifestSha512: hash(manifest), releases: [post],
};
const envelope = (value) => {
  const payload = Buffer.from(JSON.stringify(value));
  return JSON.stringify({ payload: payload.toString("base64"), signature: sign(null, payload, privateKey).toString("base64") });
};
const valid = envelope(release);
const verified = verifyReleaseEnvelope(valid, trust);
const tampered = JSON.stringify({ ...JSON.parse(valid), signature: Buffer.alloc(64).toString("base64") });
const traversal = envelope({ ...release, files: [{ ...release.files[0], name: "../Voxy-Setup-2.0.1-x64.exe" }, release.files[1]] });
for (const invalid of [tampered, traversal]) {
  let rejected = false;
  try { verifyReleaseEnvelope(invalid, trust); } catch { rejected = true; }
  if (!rejected) throw Error("Legacy oracle accepted an invalid fixture");
}
writeFileSync(new URL("update-node.json", import.meta.url), JSON.stringify({
  origin: "Node crypto + legacy verifyReleaseEnvelope; ephemeral key discarded", trust, valid, tampered, traversal,
  artifact, manifest, verifiedVersion: verified.version, artifactUrl: releaseBase(trust, version) + release.files[0].name,
}, null, 2) + "\n");
console.log("Created verified Node/legacy update oracle fixture (no executable or private key)");
