import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const [beforeFile, afterFile, output = "evidence/stability-1.4.1"] =
  process.argv.slice(2);
const before = JSON.parse(readFileSync(beforeFile, "utf8")),
  after = JSON.parse(readFileSync(afterFile, "utf8"));
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/before.json`, JSON.stringify(before, null, 2));
writeFileSync(`${output}/after.json`, JSON.stringify(after, null, 2));
const median = (values) => {
  const v = values.filter((x) => x !== null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const summarize = (row) =>
  Object.fromEntries(
    ["ramMiB", "privateMiB", "cpu", "gpuEngineSum"].map((key) => [
      key,
      median(row.samples.slice(1).map((s) => s[key])),
    ]),
  );
const summary = before.results.map((b) => {
  const a = after.results.find((a) => a.scenario === b.scenario);
  return {
    scenario: b.scenario,
    before: summarize(b),
    after: summarize(a),
    canvasAfter: a.renderer.webgl,
  };
});
writeFileSync(`${output}/comparison.json`, JSON.stringify(summary, null, 2));
for (const r of summary)
  console.log(
    `| ${r.scenario} | ${r.before.ramMiB.toFixed(1)} → ${r.after.ramMiB.toFixed(1)} | ${r.before.cpu.toFixed(3)} → ${r.after.cpu.toFixed(3)} | ${r.before.gpuEngineSum} → ${r.after.gpuEngineSum} |`,
  );
