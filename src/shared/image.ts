import { MAX_IMAGE_BYTES } from "./constants";
// Inspect headers before decoding; reject SVG, oversized frames and MIME spoofing.
export function validateImage(data: string) {
  const match =
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+=*)$/.exec(data);
  if (!match) throw Error("Use uma imagem PNG, JPEG, WebP ou GIF.");
  const bytes = Buffer.from(match[2], "base64");
  if (
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.length < 24 ||
    bytes.toString("base64") !== match[2]
  )
    throw Error("Imagem inválida ou maior que 2 MB.");
  let width = 0,
    height = 0,
    frames = 1;
  if (match[1] === "gif") {
    const gif = inspectGif(bytes);
    width = gif.width;
    height = gif.height;
    frames = gif.frames;
  } else if (
    match[1] === "png" &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (match[1] === "jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
  } else if (
    match[1] === "webp" &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X" && bytes.length >= 30) {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (
      chunk === "VP8 " &&
      bytes.length >= 30 &&
      bytes.toString("hex", 23, 26) === "9d012a"
    ) {
      width = bytes.readUInt16LE(26) & 16383;
      height = bytes.readUInt16LE(28) & 16383;
    } else if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      width = 1 + (bits & 16383);
      height = 1 + ((bits >>> 14) & 16383);
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 24000000
  )
    throw Error(
      "Imagem inválida ou dimensões superiores a 8192 px / 24 megapixels.",
    );
  return { width, height, bytes: bytes.length, frames, format: match[1] };
}

// ── GIF ──────────────────────────────────────────────────────────────────
// Animated profile images are validated by walking the real block structure,
// never by trusting the MIME type or extension. The walk is linear in the
// file size and bounds what a decoder would have to allocate.
export const GIF_LIMITS = {
  /** Frames a single GIF may carry. */
  maxFrames: 300,
  /** Sum of decoded canvas pixels over all frames (frames × width × height). */
  maxDecodedPixels: 80_000_000,
  maxSide: 2048,
};
export type GifInfo = {
  width: number;
  height: number;
  frames: number;
  /** Total animation time of one loop, in milliseconds. */
  duration: number;
};
export function inspectGif(bytes: Uint8Array): GifInfo {
  const fail = (): never => {
    throw Error("GIF inválido ou corrompido.");
  };
  const at = (i: number) => (i < bytes.length ? bytes[i] : fail());
  const u16 = (i: number) => at(i) | (at(i + 1) << 8);
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") fail();
  const width = u16(6),
    height = u16(8);
  if (!width || !height || width > GIF_LIMITS.maxSide || height > GIF_LIMITS.maxSide)
    throw Error("O GIF deve ter até 2048 px de lado.");
  const packed = at(10);
  let offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
  const skipSubBlocks = () => {
    for (;;) {
      const size = at(offset++);
      if (!size) return;
      offset += size;
      if (offset > bytes.length) fail();
    }
  };
  let frames = 0,
    duration = 0,
    delay = 0;
  for (;;) {
    const block = at(offset++);
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = at(offset++);
      if (label === 0xf9 && at(offset) === 4) delay = u16(offset + 2) * 10;
      skipSubBlocks();
      continue;
    }
    if (block !== 0x2c) fail();
    const left = u16(offset),
      top = u16(offset + 2),
      w = u16(offset + 4),
      h = u16(offset + 6),
      local = at(offset + 8);
    offset += 9;
    if (!w || !h || left + w > width || top + h > height) fail();
    if (local & 0x80) offset += 3 * (1 << ((local & 7) + 1));
    const minimumCode = at(offset++);
    if (minimumCode < 2 || minimumCode > 11) fail();
    skipSubBlocks();
    frames++;
    // Browsers treat delays under 20 ms as 100 ms.
    duration += delay < 20 ? 100 : delay;
    delay = 0;
    if (frames > GIF_LIMITS.maxFrames)
      throw Error(`O GIF deve ter até ${GIF_LIMITS.maxFrames} quadros.`);
    if (frames * width * height > GIF_LIMITS.maxDecodedPixels)
      throw Error("O GIF é grande demais para animar com segurança.");
  }
  if (!frames) fail();
  return { width, height, frames, duration };
}
