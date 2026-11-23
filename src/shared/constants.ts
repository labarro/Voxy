export const MAX_PARTICIPANTS = 10;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/**
 * Animated profile images. The static avatar (≤ 128 px / 32 KB) keeps riding
 * the room snapshot; the GIF is fetched on demand and cached, so a large file
 * never rides every state broadcast or competes with voice.
 */
export const PROFILE_GIF = {
  avatar: { side: 256, bytes: 384 * 1024 },
  banner: { width: 960, height: 360, bytes: 1024 * 1024 },
};
