import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
const base = "src/renderer/public/assets/room3d";
async function scan(directory, prefix = "") {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...(await scan(join(directory, entry.name), path + "/")));
    else if (entry.name !== "manifest.json") {
      const bytes = await readFile(join(directory, entry.name));
      files.push({
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return files;
}
const manifest = {
  license: "CC0-1.0",
  author: "Kenney",
  sources: [
    {
      name: "Furniture Kit",
      version: "2.0",
      url: "https://kenney.nl/assets/furniture-kit",
      licenseFile: "furniture/LICENSE.txt",
    },
    {
      name: "Mini Characters",
      version: "2.0",
      url: "https://kenney.nl/assets/mini-characters",
      licenseFile: "characters/LICENSE.txt",
    },
  ],
  files: await scan(base),
};
await writeFile(
  join(base, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `${manifest.files.length} licensed files, ${manifest.files.reduce((total, file) => total + file.bytes, 0)} bytes`,
);
