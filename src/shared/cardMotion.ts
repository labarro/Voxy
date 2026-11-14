import { tableSeat } from "./gameTables";
import type { TrucoView } from "./truco";
export function cardMotion(state: TrucoView, index: number, clock: number) {
  const seat = tableSeat("truco", index),
    a = state.animation,
    age = a ? (clock - a.at) / 1000 : 10;
  const transform = (x: number, y: number, z: number) => ({
    x: seat.x + Math.cos(seat.yaw) * x + Math.sin(seat.yaw) * z,
    y,
    z: seat.z - Math.sin(seat.yaw) * x + Math.cos(seat.yaw) * z,
  });
  const own = a?.actor === index;
  let reach = 0,
    raise = 0;
  if (own && a?.type === "play" && age < 0.7)
    reach = Math.sin(Math.min(1, age / 0.5) * Math.PI) * 0.24;
  if (own && a?.type === "deal" && age < 3.4)
    reach = 0.08 + 0.1 * Math.sin(age * 16);
  if (own && a?.type === "raise" && age < 1.8)
    raise = Math.sin(Math.min(1, age / 1.8) * Math.PI) * 0.3;
  const winning = a?.type === "win" && index % 2 === a.actor && age < 2.6;
  if (winning) raise = 0.18 * Math.max(0, Math.sin(age * 7));
  return {
    left: transform(-0.15, 1.01, 0.35),
    right: transform(0.19, 1.0 + raise, 0.38 + reach - raise * 0.4),
    lean: reach * 0.4,
    age,
  };
}
