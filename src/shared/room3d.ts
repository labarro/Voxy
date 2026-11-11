import type { Avatar3D, RoomPose, RoomPreset } from "./types";

export const defaultAvatar: Avatar3D = {
  hair: "short",
  hairColor: "#44302d",
  skin: "#dca780",
  outfit: "sweater",
  color: "#7c72df",
  accessory: "none",
};
export const defaultRoomSettings = {
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
        [-3, -1, 1, 3].map((x, col) => ({
          id: `cinema-${row}-${col}`,
          x,
          z: row * 2.1 - 1,
          yaw: Math.PI,
          kind: "chair" as const,
        })),
      )
    : [
        { id: "sofa-0", x: -2, z: 2, yaw: Math.PI, kind: "sofa" },
        { id: "sofa-1", x: 0, z: 2, yaw: Math.PI, kind: "sofa" },
        { id: "sofa-2", x: 2, z: 2, yaw: Math.PI, kind: "sofa" },
        { id: "chair-0", x: -4, z: -1, yaw: Math.PI / 2, kind: "chair" },
        { id: "chair-1", x: 4, z: -1, yaw: -Math.PI / 2, kind: "chair" },
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
export function walkable(preset: RoomPreset, x: number, z: number) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Math.abs(x) <= 6.7 &&
    z >= -5.2 &&
    z <= 6.7 &&
    !(Math.abs(x) < 4.3 && z < -4.75) &&
    !(preset === "lounge" && Math.abs(x) < 2 && Math.abs(z + 0.2) < 1) &&
    !(preset === "lounge" && Math.abs(x) < 3.05 && Math.abs(z - 2) < 0.85) &&
    ![-5.6, 5.6].some(
      (px) =>
        Math.abs(x - px) < 0.7 &&
        (Math.abs(z + 4.1) < 0.7 || Math.abs(z - 3.8) < 0.55),
    ) &&
    !seats(preset).some(
      (s) => Math.abs(x - s.x) < 0.65 && Math.abs(z - s.z) < 0.65,
    )
  );
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
