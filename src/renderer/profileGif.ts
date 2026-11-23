import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { inspectGif, type GifInfo } from "../shared/image";
import { PROFILE_GIF } from "../shared/constants";

/** Largest file accepted from disk before any decoding. */
export const GIF_FILE_LIMIT = 15 * 1024 * 1024;

type DecodedFrame = {
  image: VideoFrame;
  /** Frame duration in microseconds (may be null for single frames). */
  duration: number | null;
};
type Decoder = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<DecodedFrame>;
  close(): void;
};
type DecoderCtor = new (init: { data: ArrayBuffer; type: string }) => Decoder;

export type ProfileGifKind = "avatar" | "banner";
const TARGET = {
  avatar: { width: 128, height: 128, frames: 90 },
  banner: { width: 600, height: 225, frames: 72 },
};

function dataUrl(bytes: Uint8Array, type: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

function fits(kind: ProfileGifKind, info: GifInfo, size: number) {
  return kind === "avatar"
    ? info.width <= PROFILE_GIF.avatar.side &&
        info.height <= PROFILE_GIF.avatar.side &&
        size <= PROFILE_GIF.avatar.bytes
    : info.width <= PROFILE_GIF.banner.width &&
        info.height <= PROFILE_GIF.banner.height &&
        size <= PROFILE_GIF.banner.bytes;
}

/** Reads a file chosen by the user and validates its real GIF structure. */
export async function readGif(file: File) {
  if (file.size > GIF_FILE_LIMIT)
    throw Error("Escolha um GIF de até 15 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Validates the block structure, frame count and decoded-pixel budget
  // before anything is handed to a decoder.
  const info = inspectGif(bytes);
  return { bytes, info };
}

/**
 * Prepares an animated GIF for a profile while keeping it animated: a file
 * already within limits is kept byte-for-byte; otherwise every frame is
 * decoded, center-cropped/scaled and re-encoded as GIF (never as a still).
 */
export async function prepareProfileGif(
  file: File,
  kind: ProfileGifKind,
): Promise<{ gif: string; poster: string; info: GifInfo }> {
  const { bytes, info } = await readGif(file);
  if (info.frames < 2) throw Error("Este GIF não é animado.");
  const target = TARGET[kind];
  const Ctor = (globalThis as unknown as { ImageDecoder?: DecoderCtor })
    .ImageDecoder;
  if (!Ctor) throw Error("Este computador não consegue decodificar o GIF.");
  const decoder = new Ctor({ data: bytes.slice().buffer, type: "image/gif" });
  try {
    await decoder.tracks.ready;
    const count = Math.min(
      info.frames,
      decoder.tracks.selectedTrack?.frameCount ?? info.frames,
    );
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const draw = (frame: VideoFrame) => {
      const w = frame.displayWidth,
        h = frame.displayHeight;
      const scale = Math.max(target.width / w, target.height / h);
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(
        frame,
        (target.width - w * scale) / 2,
        (target.height - h * scale) / 2,
        w * scale,
        h * scale,
      );
    };
    // Poster (first frame) for the static avatar, older clients and
    // reduced-motion viewers.
    const first = await decoder.decode({ frameIndex: 0 });
    draw(first.image);
    first.image.close();
    let poster = canvas.toDataURL("image/webp", 0.8);
    if (poster.length > 43720) poster = canvas.toDataURL("image/webp", 0.5);
    if (kind === "avatar" && poster.length > 43720)
      throw Error("Não foi possível gerar a prévia estática do GIF.");
    if (fits(kind, info, bytes.length))
      return { gif: dataUrl(bytes, "image/gif"), poster, info };

    const limit =
      kind === "avatar" ? PROFILE_GIF.avatar.bytes : PROFILE_GIF.banner.bytes;
    // Try progressively lighter encodings until the result fits.
    for (const [step, colors] of [
      [Math.ceil(count / target.frames), 256],
      [Math.ceil(count / target.frames) * 2, 128],
      [Math.ceil(count / target.frames) * 3, 64],
      [Math.ceil(count / target.frames) * 4, 32],
    ] as const) {
      const encoder = GIFEncoder();
      for (let index = 0; index < count; index += step) {
        let delay = 0;
        let frame: DecodedFrame | undefined;
        for (let k = index; k < Math.min(count, index + step); k++) {
          const decoded = await decoder.decode({ frameIndex: k });
          const ms = Math.round((decoded.duration ?? 100000) / 1000);
          delay += ms < 20 ? 100 : ms;
          if (k === index) frame = decoded;
          else decoded.image.close();
        }
        draw(frame!.image);
        frame!.image.close();
        const { data } = ctx.getImageData(0, 0, target.width, target.height);
        const palette = quantize(data, colors, {
          format: "rgba4444",
          oneBitAlpha: true,
        });
        const indexed = applyPalette(data, palette, "rgba4444");
        const transparentIndex = palette.findIndex((c) => c[3] === 0);
        encoder.writeFrame(indexed, target.width, target.height, {
          palette,
          delay,
          transparent: transparentIndex >= 0,
          transparentIndex: Math.max(0, transparentIndex),
          dispose: 2,
        });
      }
      encoder.finish();
      const out = encoder.bytes();
      if (out.length <= limit) {
        const checked = inspectGif(out);
        return { gif: dataUrl(out, "image/gif"), poster, info: checked };
      }
    }
    throw Error(
      kind === "avatar"
        ? "Não foi possível reduzir o GIF para 384 KB. Escolha um GIF mais curto."
        : "Não foi possível reduzir o GIF para 1 MB. Escolha um GIF mais curto.",
    );
  } finally {
    decoder.close();
  }
}
