// Plays complete Eight-Ball matches on the authoritative host model with a
// simple search bot. Usage: npx tsx tests/pool.eight.match.ts [seeds...]
import assert from "node:assert/strict";
import { PoolGame, newPool, onEight, type PoolState } from "../src/shared/pool";
import { chooseShot, placement } from "./pool.bot";

export function playEightMatch(seed: number, log = false) {
  const game = new PoolGame(seed);
  game.state = newPool("eight", seed);
  game.join("a");
  game.join("b");
  const shots: { turn: number; phase: string; message: string }[] = [];
  for (let i = 0; i < 300 && game.state.phase !== "finished"; i++) {
    const s = game.state,
      player = s.players[s.turn];
    if (s.phase === "placing") {
      const p = placement(s);
      game.place(player, p.x, p.z, s.revision);
    }
    const input = chooseShot(game.state);
    if (onEight(game.state)) game.call(player, input.call ?? 0, game.state.revision);
    game.shoot(player, input.angle, input.power, game.state.revision);
    for (let n = 0; n < 2600 && ["preparing", "rolling"].includes(game.state.phase); n++)
      game.step();
    assert(!["preparing", "rolling"].includes(game.state.phase), "shot settled");
    check(game.state);
    shots.push({ turn: s.turn, phase: game.state.phase, message: game.state.message });
    if (log) console.log(i + 1, s.turn, game.state.phase, game.state.message);
  }
  return { state: game.state, shots };
}
function check(s: PoolState) {
  for (const b of s.balls) {
    assert(Number.isFinite(b.x + b.z));
    assert.equal(b.vx, 0);
    assert.equal(b.vz, 0);
  }
  if (s.groups?.[0]) assert.notEqual(s.groups[0], s.groups[1]);
}
if (process.argv[1]?.endsWith("pool.eight.match.ts")) {
  const seeds = process.argv.slice(2).map(Number);
  for (const seed of seeds.length ? seeds : [1, 2, 3, 4, 5]) {
    const started = Date.now(),
      { state, shots } = playEightMatch(seed, !!process.env.VERBOSE);
    assert.equal(state.phase, "finished", "match must end");
    assert(state.winner && state.players.includes(state.winner));
    console.log(
      `seed ${seed}: ${shots.length} tacadas, vencedor ${state.winner}, faltas ${state.fouls}, grupos ${state.groups}, ${Date.now() - started} ms — ${state.message}`,
    );
  }
  console.log("Complete Eight-Ball matches passed");
}
