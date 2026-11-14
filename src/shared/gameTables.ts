export type TableGame = "truco" | "chess";
export const GAME_TABLES = {
  truco: { x: -6.6, z: 8.1, seats: 4, radius: 1.25 },
  chess: { x: 1.5, z: 8.8, seats: 2, radius: 0.86 },
} as const;
export function tableSeat(kind: TableGame, index: number) {
  const t = GAME_TABLES[kind],
    angle = kind === "chess" ? index * Math.PI : (index * Math.PI) / 2;
  return {
    id: `${kind}-${index}`,
    x: t.x + Math.sin(angle) * t.radius,
    z: t.z + Math.cos(angle) * t.radius,
    yaw: Math.atan2(-Math.sin(angle), -Math.cos(angle)),
    kind: "chair" as const,
    game: kind,
  };
}
export const tableSeats = (kind: TableGame) =>
  Array.from({ length: GAME_TABLES[kind].seats }, (_, i) => tableSeat(kind, i));
export function tableCamera(kind: TableGame, index: number) {
  const seat = tableSeat(kind, index),
    t = GAME_TABLES[kind];
  if (kind === "chess")
    return {
      position: {
        x: t.x + Math.cos(seat.yaw) * 1.5,
        y: 1.9,
        z: t.z - Math.sin(seat.yaw) * 1.5 + (seat.z - t.z) * 0.15,
      },
      target: { x: t.x, y: 0.85, z: t.z },
    };
  return {
    position: {
      x: seat.x - Math.sin(seat.yaw) * 0.2 - Math.cos(seat.yaw) * 0.98,
      y: 2.45,
      z: seat.z - Math.cos(seat.yaw) * 0.2 + Math.sin(seat.yaw) * 0.98,
    },
    target: { x: t.x, y: 0.85, z: t.z },
  };
}
