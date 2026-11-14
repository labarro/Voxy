import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TrucoGame,
  TRUCO_RANKS,
  TRUCO_SUITS,
  cardStrength,
  cardId,
  manilha,
  handWinner,
  type TrucoAction,
} from "../src/shared/truco";
let now = 100;
function game() {
  let seed = 918273;
  const g = new TrucoGame((n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  });
  for (let i = 0; i < 4; i++) g.join("p" + i, now, i);
  g.advance((now += 4000));
  return g;
}
function act(g: TrucoGame, seat: number, action: TrucoAction) {
  now = Math.max(now + 1, g.view().actionAt);
  g.advance(now);
  g.act("p" + seat, action, g.revision, now);
}
function next(g: TrucoGame) {
  for (
    let i = 0;
    i < 4 && ["dealing", "trick-result", "hand-result"].includes(g.phase);
    i++
  )
    g.advance((now += 10000));
}
function point(g: TrucoGame, team: number) {
  next(g);
  let s = g.view();
  if (s.phase === "eleven") {
    act(g, s.eleven!, { type: "eleven", accept: false });
    return;
  }
  if (s.turn % 2 !== team) act(g, s.turn, { type: "play", index: 0 });
  s = g.view();
  assert.equal(s.turn % 2, team);
  act(g, s.turn, { type: "raise" });
  act(g, 1 - team, { type: "fold" });
}

test("Paulista uses 40 unique cards, circular variable manilhas and suit order only on manilhas", () => {
  const cards = TRUCO_RANKS.flatMap((rank) =>
    TRUCO_SUITS.map((suit) => ({ rank, suit })),
  );
  assert.equal(new Set(cards.map(cardId)).size, 40);
  for (let i = 0; i < 10; i++) {
    const vira = { rank: TRUCO_RANKS[i], suit: "d" as const };
    assert.equal(manilha(vira), TRUCO_RANKS[(i + 1) % 10]);
    assert.deepEqual(
      TRUCO_SUITS.map((suit) =>
        cardStrength({ rank: manilha(vira), suit }, vira),
      ),
      [10, 11, 12, 13],
    );
    for (const rank of TRUCO_RANKS)
      if (rank !== manilha(vira))
        assert.equal(
          new Set(TRUCO_SUITS.map((suit) => cardStrength({ rank, suit }, vira)))
            .size,
          1,
        );
  }
  assert.equal(manilha({ rank: "7", suit: "c" }), "Q");
  assert.equal(manilha({ rank: "J", suit: "h" }), "K");
  assert.equal(manilha({ rank: "K", suit: "s" }), "A");
  assert.equal(manilha({ rank: "3", suit: "d" }), "4");
});
test("deal reserves opposite partners, three unique cards each, explicit viewer-only hands and no enumerable private cards", () => {
  const g = game(),
    cards = [];
  assert.deepEqual(g.view().players, ["p0", "p1", "p2", "p3"]);
  assert.deepEqual(g.view().counts, [3, 3, 3, 3]);
  for (let i = 0; i < 4; i++) {
    const view = g.view("p" + i);
    assert.equal(view.hand.length, 3);
    assert.equal(view.partnerHand, undefined);
    cards.push(...view.hand.map((c) => cardId(c!)));
  }
  assert.equal(new Set([...cards, cardId(g.view().vira!)]).size, 13);
  assert.deepEqual(g.view().hand, []);
  assert(!JSON.stringify(g).includes('"rank"'));
  assert(!JSON.stringify(g.view("spectator")).includes('"partnerHand":['));
});
test("counterclockwise turns, mano/pe rotation, covered-card restrictions and obsolete actions are enforced", () => {
  const g = game();
  assert.equal(g.view().dealer, 3);
  assert.equal(g.view().mano, 0);
  assert.throws(() => act(g, 1, { type: "play", index: 0 }));
  assert.throws(() => act(g, 0, { type: "play", index: 0, covered: true }));
  const rev = g.revision;
  act(g, 0, { type: "play", index: 0 });
  assert.throws(() => g.act("p1", { type: "play", index: 0 }, rev, ++now));
  for (let i = 1; i < 4; i++) {
    assert.equal(g.view().turn, i);
    act(g, i, { type: "play", index: 0 });
  }
  assert.equal(g.phase, "trick-result");
  next(g);
  const s = g.view();
  act(g, s.turn, { type: "play", index: 0, covered: true });
  const play = g.view().played[1][0];
  assert.equal(play.card, null);
  assert.equal(play.covered, true);
  assert.deepEqual(
    g.view().counts.reduce((sum, n) => sum + n, 0),
    7,
  );
});
test("reference tie policy resolves first/second/third ties consistently and three ties award nobody", () => {
  assert.equal(handWinner([0, null]), 0);
  assert.equal(handWinner([1, null]), 1);
  assert.equal(handWinner([null, 0]), 0);
  assert.equal(handWinner([null, 1]), 1);
  assert.equal(handWinner([0, 1, null]), 0);
  assert.equal(handWinner([1, 0, null]), 1);
  assert.equal(handWinner([null, null, 0]), 0);
  assert.equal(handWinner([null, null, 1]), 1);
  assert.equal(handWinner([null, null, null]), null);
  assert.equal(handWinner([0, 1]), undefined);
});
test("Truco/Seis/Nove/Doze alternate teams; first matching partner response wins and fold pays prior value", () => {
  for (const [raises, award] of [
    [1, 1],
    [2, 3],
    [3, 6],
    [4, 9],
  ]) {
    const g = game();
    act(g, 0, { type: "raise" });
    for (let i = 1; i < raises; i++) {
      const pending = g.view().pending!;
      act(g, 1 - pending.team, { type: "raise" });
    }
    const p = g.view().pending!,
      rev = g.revision;
    assert.equal(p.previous, award);
    act(g, 1 - p.team, { type: "fold" });
    assert.equal(g.view().scores[p.team], award);
    assert.throws(() =>
      g.act("p" + (3 - p.team), { type: "accept" }, rev, ++now),
    );
  }
  const g = game();
  act(g, 0, { type: "raise" });
  assert.throws(() => act(g, 2, { type: "accept" }));
  const revision = g.revision;
  act(g, 1, { type: "accept" });
  assert.throws(() => g.act("p3", { type: "fold" }, revision, ++now));
  assert.equal(g.view().value, 3);
  assert.throws(() => act(g, 0, { type: "raise" }));
  act(g, 0, { type: "play", index: 0 });
  act(g, 1, { type: "raise" });
  assert.equal(g.view().pending!.requested, 6);
});
test("mão de onze reveals only the authorized partner; two accepts required and no further raises", () => {
  const g = game();
  for (let i = 0; i < 11; i++) point(g, 0);
  next(g);
  assert.deepEqual(g.view().scores, [11, 0]);
  assert.equal(g.phase, "eleven");
  assert.deepEqual(g.view("p0").partnerHand, g.view("p2").hand);
  assert.equal(g.view("p1").partnerHand, undefined);
  assert.equal(g.view().partnerHand, undefined);
  assert.throws(() => act(g, 1, { type: "eleven", accept: true }));
  act(g, 0, { type: "eleven", accept: true });
  assert.equal(g.phase, "eleven");
  assert.throws(() => act(g, 0, { type: "eleven", accept: true }));
  act(g, 2, { type: "eleven", accept: true });
  assert.equal(g.phase, "playing");
  assert.equal(g.view().value, 3);
  assert.throws(() => act(g, g.view().turn, { type: "raise" }));
});
test("mão de ferro at 11×11 never transmits even the owner's cards, blocks raises and determines a winner", () => {
  const g = game();
  for (let i = 0; i < 11; i++) point(g, 0);
  for (let i = 0; i < 11; i++) point(g, 1);
  next(g);
  assert.deepEqual(g.view().scores, [11, 11]);
  assert.equal(g.view().iron, true);
  assert.equal(g.view().value, 3);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(g.view("p" + i).hand, [null, null, null]);
    assert.equal(g.view("p" + i).partnerHand, undefined);
  }
  assert.throws(() => act(g, g.view().turn, { type: "raise" }));
  assert.throws(() =>
    act(g, g.view().turn, { type: "play", index: 0, covered: true }),
  );
  for (let i = 0; i < 100 && g.phase !== "finished"; i++) {
    next(g);
    if (g.phase === "playing")
      act(g, g.view().turn, { type: "play", index: 0 });
  }
  assert.equal(g.phase, "finished");
  assert(g.view().winner !== undefined);
  assert(g.view().scores.some((score) => score >= 12));
});
test("disconnect reserves the same secret hand, pauses play, reconnects safely, expires as forfeit and allows rematch", () => {
  const g = game(),
    own = g.view("p0").hand,
    online = new Set(["p1", "p2", "p3"]);
  g.sync(online, (now += 100));
  assert.equal(g.view().paused, true);
  assert.throws(() => act(g, g.view().turn, { type: "play", index: 0 }));
  online.add("p0");
  g.sync(online, (now += 1500));
  assert.equal(g.view().paused, false);
  assert.deepEqual(g.view("p0").hand, own);
  online.delete("p0");
  g.sync(online, (now += 100));
  g.sync(online, (now += 61000));
  assert.equal(g.phase, "finished");
  assert.equal(g.view().winner, 1);
  assert.equal(g.view().players[0], null);
  g.join("p0", ++now, 0);
  g.sync(new Set(["p0", "p1", "p2", "p3"]), ++now);
  act(g, 1, { type: "restart" });
  assert.deepEqual(g.view().scores, [0, 0]);
  next(g);
  assert.equal(g.view("p0").hand.length, 3);
});
test("a full deterministic four-player match uses only valid actions and reaches the winning score", () => {
  const g = game();
  for (let i = 0; i < 1000 && g.phase !== "finished"; i++) {
    next(g);
    const s = g.view();
    if (s.phase === "eleven") {
      for (const seat of [s.eleven!, s.eleven! + 2])
        act(g, seat, { type: "eleven", accept: true });
    } else if (s.phase === "playing")
      act(g, s.turn, { type: "play", index: 0 });
  }
  assert.equal(g.phase, "finished");
  assert(g.view().scores.some((score) => score >= 12));
  assert(g.view().handNumber > 1);
});
