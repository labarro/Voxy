import { POOL } from "./pool";
import type { Avatar3D, RoomPose, RoomPreset, RoomSettings } from "./types";

export const defaultAvatar: Avatar3D = {
  hair: "short",
  hairColor: "#44302d",
  skin: "#dca780",
  outfit: "sweater",
  color: "#7c72df",
  accessory: "none",
};
export const defaultRoomSettings: RoomSettings = {
  entry: "ask" as const,
  quality: "medium" as const,
  proximity: true,
  volume: 1,
  range: 10,
  sensitivity: 1,
  names: true,
};
export type Seat = {
  id: string;
  x: number;
  z: number;
  yaw: number;
  kind: "sofa" | "chair" | "puff";
};
export const seats = (preset: RoomPreset): Seat[] =>
  preset === "cinema"
    ? [0, 1, 2].flatMap((row) =>
        [-6, -3.6, 3.6, 6].map((x, col) => ({
          id: `cinema-${row}-${col}`,
          x,
          z: row * 3.2 - 2,
          yaw: Math.PI,
          kind: "chair" as const,
        })),
      )
    : [
        { id: "sofa-0", x: -2, z: 2, yaw: Math.PI, kind: "sofa" },
        { id: "sofa-1", x: 0, z: 2, yaw: Math.PI, kind: "sofa" },
        { id: "sofa-2", x: 2, z: 2, yaw: Math.PI, kind: "sofa" },
        { id: "chair-0", x: -8, z: 0, yaw: 0, kind: "chair" },
        { id: "chat-0", x: -10, z: 3, yaw: Math.PI / 2, kind: "chair" },
        { id: "chat-1", x: -8, z: 5, yaw: Math.PI, kind: "chair" },
        { id: "chair-1", x: -6, z: 3, yaw: -Math.PI / 2, kind: "chair" },
        { id: "puff-0", x: -3.7, z: 4.5, yaw: Math.PI, kind: "puff" },
        { id: "puff-1", x: 3.7, z: 4.5, yaw: Math.PI, kind: "puff" },
      ];
export const spawnPose = (slot = 0): RoomPose => ({
  x: [0, 1.2, -1.2, 2.4, -2.4, 3.6, -3.6, 4.8, -4.8, 6][slot % 10],
  z: 6,
  yaw: Math.PI,
  seat: null,
  moving: false,
});
// Keep the largest supported hair/headset silhouette (including the soft body
// width) clear of the interior wall faces; these are avatar-center limits.
export const roomBounds = { minX: -12.2, maxX: 12.2, minZ: -10.2, maxZ: 12.3 };
export function walkable(preset: RoomPreset, x: number, z: number) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    x < roomBounds.minX ||
    x > roomBounds.maxX ||
    z < roomBounds.minZ ||
    z > roomBounds.maxZ
  )
    return false;
  if (Math.abs(x) < 4.6 && z < -9.65) return false;
  if (preset === "lounge") {
    if (Math.abs(x) < 2.1 && Math.abs(z + 0.2) < 1.15) return false;
    if (Math.abs(x) < 3.3 && Math.abs(z - 2) < 1.05) return false;
    if (Math.abs(x - POOL.x) < 1.95 && Math.abs(z - POOL.z) < 3) return false;
    if (Math.hypot(x + 8, z - 2.5) < 1.2) return false;
    if (Math.abs(x + 8) < 3.15 && Math.abs(z - 11.8) < 0.85) return false;
    if (
      Math.abs(x - (POOL.x + 2.25)) < 0.7 &&
      Math.abs(z - (POOL.z - 1.65)) < 0.6
    )
      return false;
    if (
      (Math.abs(x - 7.2) < 1.55 && Math.abs(z + 9.8) < 0.8) ||
      (Math.abs(x + 11) < 1.6 && Math.abs(z + 5) < 0.7)
    )
      return false;
  }
  if (
    [-11, 11].some(
      (px) =>
        Math.abs(x - px) < 0.95 &&
        (Math.abs(z + 8.1) < 0.95 || Math.abs(z - 8.8) < 0.75),
    )
  )
    return false;
  return !seats(preset).some((s) => {
    const dx = x - s.x,
      dz = z - s.z;
    return (
      Math.abs(dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw)) < 1 &&
      Math.abs(dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw)) < 1.05
    );
  });
}
export function spatialVoice(
  listener: RoomPose,
  speaker: RoomPose,
  range: number,
  yaw: number,
) {
  const dx = speaker.x - listener.x,
    dz = speaker.z - listener.z;
  const distance = Math.hypot(dx, dz);
  return {
    gain: Math.max(
      0,
      1 - Math.max(0, distance - 1.5) / Math.max(1, range - 1.5),
    ),
    pan: Math.max(
      -1,
      Math.min(
        1,
        (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(1, distance),
      ),
    ),
  };
}
