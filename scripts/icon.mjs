// Original Voxy waveform icon. ICO uses a 32-bit uncompressed DIB, no external assets.
import { mkdirSync, writeFileSync } from "node:fs";
const n = 256,
  pixels = Buffer.alloc(n * n * 4),
  mask = Buffer.alloc((n * n) / 8);
const bars = [
  [64, 100, 72, 156],
  [88, 64, 100, 192],
  [118, 36, 134, 220],
  [152, 75, 164, 181],
  [184, 108, 192, 148],
];
for (let y = 0; y < n; y++)
  for (let x = 0; x < n; x++) {
    const wave = bars.some(
      ([l, t, r, b]) => x >= l && x <= r && y >= t && y <= b,
    );
    const i = ((n - 1 - y) * n + x) * 4;
    const rgb = wave ? [182, 173, 255] : [27, 33, 48];
    pixels[i] = rgb[2];
    pixels[i + 1] = rgb[1];
    pixels[i + 2] = rgb[0];
    pixels[i + 3] = 255;
  }
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(n, 4);
dib.writeInt32LE(n * 2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(pixels.length + mask.length, 20);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(dib.length + pixels.length + mask.length, 14);
header.writeUInt32LE(22, 18);
mkdirSync("build", { recursive: true });
writeFileSync("build/icon.ico", Buffer.concat([header, dib, pixels, mask]));
