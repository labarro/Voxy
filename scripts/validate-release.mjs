import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.voxyMigration?.nativeReady === false)
  throw Error("A migração nativa está em desenvolvimento. Publicação estável bloqueada até homologação e autorização explícita.");
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${pkg.version}`)
  throw Error("A tag precisa corresponder à versão do package.json.");
execFileSync(
  "git",
  [
    "merge-base",
    "--is-ancestor",
    process.env.GITHUB_SHA ?? "HEAD",
    "origin/main",
  ],
  { stdio: "pipe" },
);
if (!process.env.VOXY_UPDATE_SIGNING_PRIVATE_KEY)
  throw Error(
    "Configure VOXY_UPDATE_SIGNING_PRIVATE_KEY no ambiente release do GitHub.",
  );
const trust = JSON.parse(readFileSync("src/shared/update-trust.json", "utf8"));
if (!trust.publicKeys.length)
  throw Error("Nenhuma chave pública confiável no aplicativo.");
console.log("Tag, branch de origem e configuração de assinatura conferidas.");
