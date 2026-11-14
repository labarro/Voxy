import { Chess } from "chess.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChessGame, type ChessAction } from "../src/shared/chess";
let now = 100;
function game(fen?: string) {
  const g = new ChessGame(fen);
  g.join("white", now, 0);
  g.join("black", now, 1);
  return g;
}
function action(g: ChessGame, seat: number, a: ChessAction) {
  now = Math.max(now + 1, g.actionAt);
  g.sync(new Set(["white", "black"]), now);
  g.act(seat ? "black" : "white", a, g.revision, now);
}
function move(
  g: ChessGame,
  from: string,
  to: string,
  promotion?: "q" | "r" | "b" | "n",
) {
  action(g, g.view().turn, { type: "move", from, to, promotion });
}
test("chess validates seats, turns, revisions and the physical move animation deadline", () => {
  const g = game();
  assert.throws(() =>
    g.act("other", { type: "move", from: "e2", to: "e4" }, g.revision, ++now),
  );
  assert.throws(() => action(g, 1, { type: "move", from: "e7", to: "e5" }));
  assert.throws(() => move(g, "e2", "e5"));
  move(g, "e2", "e4");
  assert.throws(() =>
    g.act("black", { type: "move", from: "e7", to: "e5" }, g.revision, ++now),
  );
  const revision = g.revision;
  move(g, "e7", "e5");
  assert.throws(() =>
    g.act(
      "white",
      { type: "move", from: "g1", to: "f3" },
      revision,
      now + 1000,
    ),
  );
  assert.equal(g.view("spectator").moves.length, 0);
  assert(g.view("white").moves.length > 0);
});
test("castling moves king and rook, and cannot pass through attack", () => {
  const g = game("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  move(g, "e1", "g1");
  assert(g.view().fen.startsWith("r3k2r/8/8/8/8/8/8/R4RK1"));
  move(g, "e8", "c8");
  assert(g.view().fen.startsWith("2kr3r"));
  const blocked = game("4kr2/8/8/8/8/8/8/4K2R w K - 0 1");
  assert.throws(() => move(blocked, "e1", "g1"));
});
test("en passant removes the pawn and expires after a different move", () => {
  const g = game();
  move(g, "e2", "e4");
  move(g, "a7", "a6");
  move(g, "e4", "e5");
  move(g, "d7", "d5");
  move(g, "e5", "d6");
  assert.equal(g.view().last?.flags, "e");
  const board = new Chess(g.view().fen);
  assert.equal(board.get("d5"), undefined);
  assert.equal(board.get("d6")?.type, "p");
  const expired = game();
  move(expired, "e2", "e4");
  move(expired, "a7", "a6");
  move(expired, "e4", "e5");
  move(expired, "d7", "d5");
  move(expired, "g1", "f3");
  move(expired, "a6", "a5");
  assert.throws(() => move(expired, "e5", "d6"));
});
test("all promotion choices are explicit, captures and checkmate resolve correctly", () => {
  for (const promotion of ["q", "r", "b", "n"] as const) {
    const g = game("7k/P7/8/8/8/8/8/7K w - - 0 1");
    assert.throws(() => move(g, "a7", "a8"));
    move(g, "a7", "a8", promotion);
    assert(g.view().fen.startsWith(promotion.toUpperCase()));
  }
  const g = game();
  move(g, "f2", "f3");
  move(g, "e7", "e5");
  move(g, "g2", "g4");
  move(g, "d8", "h4");
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 1);
  assert.equal(g.message, "Xeque-mate.");
});
test("stalemate and insufficient material end automatically", () => {
  const stale = game("7k/5K2/5Q2/8/8/8/8/8 w - - 0 1");
  move(stale, "f6", "g6");
  assert.equal(stale.message, "Empate por afogamento.");
  const bare = game("7k/8/8/8/8/8/2b5/KB6 w - - 0 1");
  move(bare, "b1", "c2");
  assert.equal(bare.phase, "finished");
  assert.equal(bare.winner, undefined);
});
test("threefold and fifty moves require a claim; fivefold and seventy-five moves are automatic", () => {
  const g = game();
  for (let i = 0; i < 2; i++) {
    move(g, "g1", "f3");
    move(g, "g8", "f6");
    move(g, "f3", "g1");
    if (i === 1) {
      assert(
        g
          .view("black")
          .claimMoves.some((m) => m.from === "f6" && m.to === "g8"),
      );
    }
    move(g, "f6", "g8");
  }
  assert.equal(g.phase, "playing");
  assert.equal(g.view("white").claim, true);
  action(g, 0, { type: "claim" });
  assert.equal(g.phase, "finished");
  const five = game();
  for (let i = 0; i < 4; i++) {
    move(five, "g1", "f3");
    move(five, "g8", "f6");
    move(five, "f3", "g1");
    move(five, "f6", "g8");
  }
  assert.equal(five.phase, "finished");
  assert.match(five.message, /cinco/);
  const fifty = game("7k/8/8/8/8/8/8/KR6 w - - 99 51");
  assert(fifty.view("white").claimMoves.some((m) => m.to === "b2"));
  action(fifty, 0, { type: "claim", move: { from: "b1", to: "b2" } });
  assert.equal(fifty.phase, "finished");
  const auto = game("7k/8/8/8/8/8/8/KR6 w - - 149 76");
  move(auto, "b1", "b2");
  assert.match(auto.message, /setenta/);
});
test("draw offers, resignation, reconnect reservation, forfeit and restart are authoritative", () => {
  const g = game();
  move(g, "e2", "e4");
  action(g, 0, { type: "offer" });
  assert.throws(() => action(g, 0, { type: "accept" }));
  action(g, 1, { type: "decline" });
  action(g, 0, { type: "offer" });
  action(g, 1, { type: "accept" });
  assert.equal(g.winner, undefined);
  action(g, 1, { type: "restart" });
  assert.equal(g.phase, "playing");
  const fen = g.view().fen;
  g.sync(new Set(["white"]), (now += 100));
  assert(g.view().paused);
  g.sync(new Set(["white", "black"]), (now += 1000));
  assert(!g.view().paused);
  assert.equal(g.view().fen, fen);
  g.sync(new Set(["white"]), (now += 100));
  g.sync(new Set(["white"]), (now += 61000));
  assert.equal(g.winner, 0);
  g.join("black", ++now, 1);
  g.sync(new Set(["white", "black"]), ++now);
  action(g, 0, { type: "restart" });
  action(g, 0, { type: "resign" });
  assert.equal(g.winner, 1);
});
