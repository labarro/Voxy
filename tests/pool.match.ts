import { PoolGame } from "../src/shared/pool";
import { chooseShot, placement } from "./pool.bot";
import assert from "node:assert/strict";
const game = new PoolGame();
game.join("a");
game.join("b");
const shots = [];
for (let i = 0; i < 60 && game.state.phase !== "finished"; i++) {
  const s = game.state;
  if (s.phase === "placing") {
    const p = placement(s);
    game.place(s.players[s.turn], p.x, p.z, s.revision);
  }
  const input = chooseShot(game.state);
  game.shoot(s.players[s.turn], input.angle, input.power, s.revision);
  for (
    let n = 0;
    n < 2600 && ["preparing", "rolling"].includes(game.state.phase);
    n++
  )
    game.step();
  shots.push({
    input,
    phase: game.state.phase,
    scores: [...game.state.scores],
  });
  console.log(i + 1, JSON.stringify(shots.at(-1)));
}
assert.equal(game.state.phase, "finished");
assert.equal(
  game.state.scores.reduce((a, b) => a + b, 0),
  7,
);
console.log("Complete legal match:", game.state.winner, game.state.scores);
