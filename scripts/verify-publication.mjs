import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const trust = JSON.parse(readFileSync("src/shared/update-trust.json", "utf8"));
const notes = JSON.parse(readFileSync("src/shared/releases.json", "utf8"));
const base = `https://api.github.com/repos/${trust.repository}`;
async function get(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Voxy-publication-verification" },
  });
  if (!response.ok)
    throw Error(`HTTP ${response.status} while checking public release`);
  return Buffer.from(await response.arrayBuffer());
}
const release = JSON.parse(await get(`${base}/releases/tags/v${version}`));
assert(!release.draft && !release.prerelease && release.published_at);
const ref = JSON.parse(await get(`${base}/git/ref/tags/v${version}`));
const commit = execFileSync("git", ["rev-list", "-n", "1", `v${version}`], {
  encoding: "utf8",
}).trim();
assert.equal(ref.object.type, "commit");
assert.equal(ref.object.sha, commit);
const runs = JSON.parse(
  await get(`${base}/actions/workflows/release.yml/runs?per_page=10`),
);
const run = runs.workflow_runs.find(
  (r) => r.head_sha === commit && r.head_branch === `v${version}`,
);
assert(
  run?.status === "completed" && run.conclusion === "success",
  "release workflow must complete successfully",
);
const directory = `release/${version}/verified-publication`;
mkdirSync(directory, { recursive: true });
const assets = [],
  bytesByName = new Map();
for (const name of [
  `Voxy-Setup-${version}-x64.exe`,
  `Voxy-Setup-${version}-x64.exe.blockmap`,
  "latest.yml",
  "voxy-release.json",
  "SHA256SUMS.txt",
]) {
  const asset = release.assets.find((a) => a.name === name);
  assert(asset, `Missing public asset: ${name}`);
  const bytes = await get(asset.browser_download_url);
  assert.equal(bytes.length, asset.size);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (asset.digest) assert.equal(asset.digest, `sha256:${sha256}`);
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  assets.push({
    name,
    bytes: bytes.length,
    sha256,
    githubDigest: asset.digest,
    sha512,
  });
  bytesByName.set(name, bytes);
  writeFileSync(`${directory}/${name}`, bytes);
}
const envelope = JSON.parse(bytesByName.get("voxy-release.json"));
const payload = Buffer.from(envelope.payload, "base64");
assert(
  trust.publicKeys.some((key) =>
    verify(null, payload, key, Buffer.from(envelope.signature, "base64")),
  ),
);
const catalog = JSON.parse(payload);
assert.equal(catalog.version, version);
assert.equal(
  catalog.manifestSha512,
  assets.find((a) => a.name === "latest.yml").sha512,
);
for (const file of catalog.files) {
  const asset = assets.find((a) => a.name === file.name);
  assert(asset && asset.sha512 === file.sha512 && asset.bytes === file.size);
}
assert.deepEqual(
  catalog.releases.find((r) => r.version === version),
  { version, ...notes[version] },
);
const installer = assets.find((a) => a.name.endsWith(".exe"));
assert(
  bytesByName
    .get("SHA256SUMS.txt")
    .toString("utf8")
    .toLowerCase()
    .includes(installer.sha256),
);
const endpointEnvelope = JSON.parse(
  await get(new URL("voxy-release.json", trust.endpoint)),
);
assert.equal(endpointEnvelope.payload, envelope.payload);
assert.equal(endpointEnvelope.signature, envelope.signature);
const endpointManifest = await get(new URL("latest.yml", trust.endpoint));
assert.equal(
  createHash("sha512").update(endpointManifest).digest("base64"),
  catalog.manifestSha512,
);
const evidence = {
  version,
  checkedAt: new Date().toISOString(),
  release: release.html_url,
  publishedAt: release.published_at,
  tagCommit: commit,
  workflow: run.html_url,
  signature: "Ed25519 verified against bundled trusted key",
  manifest: "SHA-512 matched signed catalog",
  notes: "current catalog entry matches source",
  endpoint: { url: trust.endpoint, version, manifest: "matched" },
  assets,
  nsisInstallation: "not run on personal installation",
};
writeFileSync(
  `evidence/publication-${version}.json`,
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    version,
    workflow: run.html_url,
    release: release.html_url,
    verifiedAssets: assets.length,
    endpoint: "verified",
  }),
);
