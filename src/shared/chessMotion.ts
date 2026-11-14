import { GAME_TABLES, tableSeat } from "./gameTables";
import type { ChessView } from "./chess";
export const CHESS_SQUARE = 0.072;
export function chessSquare(square: string) {
  return {
    x: GAME_TABLES.chess.x + (square.charCodeAt(0) - 97 - 3.5) * CHESS_SQUARE,
    y: 0.829,
    z: GAME_TABLES.chess.z + (3.5 - (Number(square[1]) - 1)) * CHESS_SQUARE,
  };
}
export function chessTravel(
  last: NonNullable<ChessView["last"]>,
  clock: number,
) {
  const from = chessSquare(last.from),
    to = chessSquare(last.to),
    p = Math.max(0, Math.min(1, ((clock - last.at) / 1000 - 0.25) / 0.5));
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + Math.sin(p * Math.PI) * 0.075,
    z: from.z + (to.z - from.z) * p,
    p,
  };
}
export function chessMotion(state: ChessView, index: number, clock: number) {
  const seat = tableSeat("chess", index),
    last = state.last,
    age = last ? (clock - last.at) / 1000 : 10;
  const transform = (x: number, y: number, z: number) => ({
    x: seat.x + Math.cos(seat.yaw) * x + Math.sin(seat.yaw) * z,
    y,
    z: seat.z - Math.sin(seat.yaw) * x + Math.cos(seat.yaw) * z,
  });
  const left = transform(-0.2, 0.9, 0.36),
    right = transform(0.2, 0.9, 0.36);
  let lean = 0,
    forward = 0;
  if (last?.actor === index && age < 0.95) {
    const reach = Math.min(1, age / 0.2, Math.max(0, (0.95 - age) / 0.15));
    lean = reach * 0.78;
    forward = reach * 0.2;
    const p = chessTravel(last, clock),
      localX =
        (p.x - seat.x) * Math.cos(seat.yaw) -
        (p.z - seat.z) * Math.sin(seat.yaw);
    Object.assign(localX < 0 ? left : right, {
      x: p.x,
      y: p.y + (last.piece === "p" ? 0.1 : 0.14),
      z: p.z,
    });
  }
  return { left, right, lean, forward };
}
