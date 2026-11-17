// Dev-time extraction of Lucide icons (ISC) into local SVG assets for the native app.
// The desktop embeds these files with include_bytes!; nothing is fetched at runtime.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules/lucide-react/dist/esm/icons");
const out = join(root, "native/crates/voxy-desktop/assets/icons");
const names = process.argv.slice(2);
mkdirSync(out, { recursive: true });
for (const name of names) {
  const js = readFileSync(join(source, `${name}.js`), "utf8");
  const body = js.slice(js.indexOf("[", js.indexOf("createLucideIcon(")), js.lastIndexOf("]") + 1);
  const nodes = Function(`return ${body}`)();
  const inner = nodes
    .map(([tag, attrs]) =>
      `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  writeFileSync(join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>\n`);
}
console.log(`${names.length} ícones em ${out}`);
