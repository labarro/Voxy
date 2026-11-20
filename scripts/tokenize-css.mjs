// One-off migration helper (1.5 Visual Update): rewrites hardcoded colors in the
// legacy stylesheets to Nocturne design tokens, by role (luminance/saturation).
// Kuromi-specific rules keep their own literal palette. Run: node scripts/tokenize-css.mjs <files>
import { readFileSync, writeFileSync } from "node:fs";
const hex = (h) => {
  h = h.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
};
function token(value) {
  const { r, g, b, a } = hex(value);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const pct = (x) => Math.round(x * 100);
  if (a < 1) {
    if (l > 0.9) return null; // white veils: neutral, theme-agnostic
    if (l < 0.1) return null; // black scrims/shadows
    if (s > 0.35 && (h > 230 && h < 290)) return `color-mix(in srgb, var(--accent) ${pct(a)}%, transparent)`;
    if (s > 0.35 && (h < 20 || h > 330)) return `color-mix(in srgb, var(--vx-danger) ${pct(a)}%, transparent)`;
    return null;
  }
  if (s > 0.45 && h > 140 && h < 175 && l > 0.45) return "var(--vx-speaking)";
  if (s > 0.45 && (h < 15 || h > 340) && l > 0.4) return l > 0.75 ? "var(--vx-danger-ink)" : "var(--vx-danger)";
  if (s > 0.3 && (h < 15 || h > 330) && l <= 0.4) return "var(--vx-danger-surface)";
  if (s > 0.5 && h > 30 && h < 55 && l > 0.35 && l < 0.75) return "var(--vx-warning)";
  if (s > 0.4 && h > 235 && h < 285 && l > 0.6) return "var(--accent-readable)";
  if (l > 0.85) return "var(--text-primary)";
  if (l > 0.7) return "var(--text-secondary)";
  if (l > 0.42) return "var(--text-muted)";
  if (l > 0.3) return "var(--vx-faint)";
  if (l > 0.2) return "var(--vx-elevated)";
  if (l > 0.14) return "var(--vx-panel)";
  if (l > 0.09) return "var(--vx-canvas)";
  return "var(--vx-base)";
}
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").split("\n");
  let selector = "", changed = 0;
  const out = lines.map((line) => {
    const t = line.trim();
    if (t.endsWith("{") && !t.startsWith("@")) selector = t;
    else if (/^[^:]+,$/.test(t)) selector = t; // multi-line selector lists
    if (t.endsWith("{") || /^[^:]+,$/.test(t) || t.startsWith("--")) return line;
    if (/kuromi/i.test(selector) || /kuromi/i.test(line)) return line;
    return line.replace(/#[0-9a-fA-F]{3,8}\b/g, (m) => {
      if (![3, 4, 6, 8].includes(m.length - 1)) return m;
      const v = token(m);
      if (v) changed++;
      return v ?? m;
    });
  });
  writeFileSync(file, out.join("\n"));
  console.log(file, changed, "colors tokenized");
}
