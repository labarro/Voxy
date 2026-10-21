// Transparent below 85% of full scale. Unlike a compressor, this has no
// automatic makeup gain: quiet input/background noise is never boosted.
const curve = new Float32Array(8193);
for (let i = 0; i < curve.length; i++) {
  const x = (i / (curve.length - 1)) * 2 - 1;
  const amplitude = Math.abs(x);
  curve[i] =
    Math.sign(x) *
    (amplitude <= 0.85
      ? amplitude
      : 0.85 + 0.14 * Math.tanh((amplitude - 0.85) / 0.14));
}
export function peakLimiter(context: AudioContext) {
  const node = context.createWaveShaper();
  node.curve = curve;
  node.oversample = "2x";
  return node;
}
