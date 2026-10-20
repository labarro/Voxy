import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { signReleaseAssets } from "./release-assets.mjs";
const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require("electron-builder");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const notes = JSON.parse(readFileSync("src/shared/releases.json", "utf8"));
const trust = JSON.parse(readFileSync("src/shared/update-trust.json", "utf8"));
const signing = !!(process.env.CSC_LINK || process.env.WIN_CSC_LINK);
if (signing && !trust.authenticodePublisher)
  throw Error(
    "Configure authenticodePublisher com o CN do certificado antes de assinar.",
  );
if (!notes[version]?.items?.length)
  throw Error(
    "Adicione as novidades da versão em src/shared/releases.json antes de distribuir.",
  );
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(notes[version]?.date ?? "") ||
  !["features", "improvements", "fixes"].every((field) =>
    Array.isArray(notes[version]?.[field]),
  )
)
  throw Error(
    "Preencha data e categorias da versão no canal oficial antes de distribuir.",
  );
const base = resolve("release", version);
// Windows can retain locks on a previous ASAR. Never rewrite that staging tree.
const directory = join(base, "build-" + Date.now());
const artifacts = await build({
  targets: Platform.WINDOWS.createTarget(
    process.argv.includes("--dir") ? "dir" : "nsis",
    Arch.x64,
  ),
  publish: "never",
  config: {
    directories: { output: directory },
    forceCodeSigning: !!trust.authenticodePublisher,
    win: {
      signExecutable: signing,
      signtoolOptions: { publisherName: trust.authenticodePublisher ?? "Voxy" },
    },
  },
});
mkdirSync(base, { recursive: true });
for (const file of artifacts)
  if (file.endsWith(".exe") || file.endsWith(".blockmap"))
    copyFileSync(file, join(base, basename(file)));
if (!process.argv.includes("--dir")) {
  copyFileSync(join(directory, "latest.yml"), join(base, "latest.yml"));
  const name = `Voxy-Setup-${version}-x64.exe`;
  const bytes = readFileSync(join(base, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  writeFileSync(join(base, "SHA256SUMS.txt"), sha256 + "  " + name + "\n");
  writeFileSync(
    join(base, "update.json"),
    JSON.stringify(
      { version, installer: name, sha256, size: bytes.length },
      null,
      2,
    ),
  );
  signReleaseAssets(base, version);
}
writeFileSync(
  join(base, "latest-build.json"),
  JSON.stringify({ version, directory }, null, 2),
);
console.log("Build completo: " + directory);
if (!process.argv.includes("--dir"))
  console.log("Instalador: " + join(base, `Voxy-Setup-${version}-x64.exe`));
