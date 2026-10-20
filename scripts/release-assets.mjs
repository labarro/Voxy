import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  createHash,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { protectKey } from "./update-key-store.mjs";
export function signReleaseAssets(base, version) {
  const config = JSON.parse(
      readFileSync("src/shared/update-trust.json", "utf8"),
    ),
    catalog = JSON.parse(readFileSync("src/shared/releases.json", "utf8"));
  const encoded = process.env.VOXY_UPDATE_SIGNING_PRIVATE_KEY;
  const privateBytes = encoded
    ? Buffer.from(encoded.replaceAll("\\n", "\n"))
    : protectKey(readFileSync(".local/update-signing-key.dpapi"), true);
  const privateKey = createPrivateKey(privateBytes);
  privateBytes.fill(0);
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw Error("Use uma chave de atualização Ed25519.");
  const proof = Buffer.from("Voxy release signing key check"),
    signature = sign(null, proof, privateKey);
  if (
    !config.publicKeys.some((pem) =>
      verify(null, proof, createPublicKey(pem), signature),
    )
  )
    throw Error(
      "A chave privada do CI não corresponde às chaves públicas do aplicativo.",
    );
  const hash = (bytes) => createHash("sha512").update(bytes).digest("base64");
  const names = [
    `Voxy-Setup-${version}-x64.exe`,
    `Voxy-Setup-${version}-x64.exe.blockmap`,
  ];
  const files = names.map((name) => {
    const bytes = readFileSync(join(base, name));
    return { name, sha512: hash(bytes), size: bytes.length };
  });
  const payload = Buffer.from(
    JSON.stringify({
      schema: 1,
      channel: "stable",
      version,
      date: catalog[version].date,
      repository: config.repository,
      files,
      manifestSha512: hash(readFileSync(join(base, "latest.yml"))),
      releases: Object.entries(catalog)
        .map(([version, entry]) => ({ version, ...entry }))
        .sort((a, b) =>
          b.version.localeCompare(a.version, undefined, { numeric: true }),
        ),
    }),
  );
  writeFileSync(
    join(base, "voxy-release.json"),
    JSON.stringify(
      {
        payload: payload.toString("base64"),
        signature: sign(null, payload, privateKey).toString("base64"),
      },
      null,
      2,
    ) + "\n",
  );
  const post = catalog[version];
  const notes =
    `# Voxy ${version}\n\n${post.title}\n\n${post.date}\n\n` +
    [
      ["features", "Novas funcionalidades"],
      ["improvements", "Melhorias"],
      ["fixes", "Correções"],
    ]
      .map(
        ([key, title]) =>
          `## ${title}\n\n` +
          (post[key].map((text) => `- ${text}`).join("\n") ||
            "Nenhuma alteração listada nesta categoria."),
      )
      .join("\n\n");
  writeFileSync(join(base, "release-notes.md"), notes + "\n");
}
