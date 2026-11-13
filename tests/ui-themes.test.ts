import { test } from "node:test";
import assert from "node:assert/strict";
import {
  themes,
  themeVariables,
  accentInk,
} from "../src/renderer/components/Personalization";
function luminance(hex: string) {
  const v = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
test("all four themes maintain legible primary, secondary and muted text on every core surface", () => {
  for (const theme of Object.keys(themes) as (keyof typeof themes)[]) {
    const vars = themeVariables({ theme }) as Record<string, string>;
    for (const text of [
      "--text-primary",
      "--text-secondary",
      "--text-muted",
      "--accent-readable",
    ]) {
      for (const bg of ["--base", "--surface", "--deep"]) {
        assert(
          contrast(vars[text], vars[bg]) >= 4.5,
          `${theme} ${text} / ${bg}`,
        );
      }
    }
    assert(contrast(vars["--accent"], vars["--accent-ink"]) >= 4.5);
    assert.deepEqual(
      Object.keys(vars),
      Object.keys(themeVariables({ theme: "voxy" })),
      "switching themes must replace every palette role",
    );
  }
});
test("custom accent keeps its original fill while readable labels and ink meet contrast", () => {
  for (const theme of Object.keys(themes) as (keyof typeof themes)[]) {
    for (const accentColor of [
      "#000000",
      "#ffffff",
      "#777777",
      "#880088",
      "#10cc60",
    ]) {
      const vars = themeVariables({ theme, accentColor }) as Record<
        string,
        string
      >;
      assert.equal(vars["--accent"], accentColor);
      assert(contrast(vars["--accent-readable"], vars["--base"]) >= 4.5);
      assert(contrast(accentColor, accentInk(accentColor)) >= 4.5);
    }
  }
});
