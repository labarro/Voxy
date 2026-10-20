import { MAX_IMAGE_BYTES } from "./constants";
// Inspect headers before decoding; reject SVG, oversized frames and MIME spoofing.
export function validateImage(data: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(
    data,
  );
  if (!match) throw Error("Use uma imagem PNG, JPEG ou WebP.");
  const bytes = Buffer.from(match[2], "base64");
  if (
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.length < 24 ||
    bytes.toString("base64") !== match[2]
  )
    throw Error("Imagem inválida ou maior que 2 MB.");
  let width = 0,
    height = 0;
  if (
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
  return { width, height, bytes: bytes.length };
}
