import { GameSeats } from "./gameSession";
export const TRUCO_RANKS = [
  "4",
  "5",
  "6",
  "7",
  "Q",
  "J",
  "K",
  "A",
  "2",
  "3",
] as const;
export const TRUCO_SUITS = ["d", "s", "h", "c"] as const;
export type Card = {
  rank: (typeof TRUCO_RANKS)[number];
  suit: (typeof TRUCO_SUITS)[number];
};
export const cardId = (c: Card) => c.rank + c.suit;
export function manilha(vira: Card) {
  return TRUCO_RANKS[(TRUCO_RANKS.indexOf(vira.rank) + 1) % 10];
}
export function cardStrength(card: Card, vira: Card) {
  return card.rank === manilha(vira)
    ? 10 + TRUCO_SUITS.indexOf(card.suit)
    : TRUCO_RANKS.indexOf(card.rank);
}
export type Play = {
  seat: number;
  card: Card | null;
  covered: boolean;
  at: number;
  sequence: number;
};
type Phase =
  | "waiting"
  | "dealing"
  | "playing"
  | "responding"
  | "eleven"
  | "trick-result"
  | "hand-result"
  | "finished";
export type TrucoView = {
  kind: "truco";
  revision: number;
  clock: number;
  actionAt: number;
  players: (string | null)[];
  paused: boolean;
  reconnecting: { id: string; until: number }[];
  phase: Phase;
  dealer: number;
  mano: number;
  turn: number;
  handNumber: number;
  trick: number;
  value: number;
  scores: [number, number];
  vira?: Card;
  played: Play[][];
  trickWinners: (number | null)[];
  hand: (Card | null)[];
  partnerHand?: (Card | null)[];
  counts: number[];
  pending?: { team: number; by: number; requested: number; previous: number };
  eleven?: number;
  elevenVotes: number[];
  iron: boolean;
  lastRaiseTeam?: number;
  winner?: number;
  message: string;
  animation?: {
    type: "deal" | "play" | "raise" | "accept" | "fold" | "win";
    actor: number;
    at: number;
    sequence: number;
    value?: number;
  };
};
export type TrucoAction =
  | { type: "play"; index: number; covered?: boolean }
  | { type: "raise" }
  | { type: "accept" }
  | { type: "fold" }
  | { type: "eleven"; accept: boolean }
  | { type: "restart" };
export function handWinner(
  tricks: (number | null)[],
): number | null | undefined {
  const [a, b, c] = tricks;
  if (tricks.length === 2) {
    if (a !== null && (b === a || b === null)) return a;
    if (a === null && b !== null) return b;
  }
  if (tricks.length === 3) {
    if (a === null && b === null) return c;
    if (c === null) return a !== null ? a : b;
    return c;
  }
  return undefined;
}
export class TrucoGame {
  readonly seats = new GameSeats(4);
  #hands: Card[][] = [[], [], [], []];
  #state: Omit<
    TrucoView,
    "players" | "paused" | "reconnecting" | "hand" | "partnerHand" | "counts"
  >;
  #until = 0;
  #locked = false;
  #sequence = 0;
  #resumeTurn = 0;
  #nextLead = 0;
  constructor(private randomIndex: (max: number) => number) {
    this.#state = this.empty();
  }
  private empty(): Omit<
    TrucoView,
    "players" | "paused" | "reconnecting" | "hand" | "partnerHand" | "counts"
  > {
    return {
      kind: "truco",
      revision: 0,
      clock: 0,
      actionAt: 0,
      phase: "waiting",
      dealer: 3,
      mano: 0,
      turn: 0,
      handNumber: 0,
      trick: 0,
      value: 1,
      scores: [0, 0],
      played: [[]],
      trickWinners: [],
      elevenVotes: [],
      iron: false,
      message: "Quatro assentos, duas duplas. Parceiros ficam frente a frente.",
    };
  }
  get phase() {
    return this.#state.phase;
  }
  get revision() {
    return this.#state.revision;
  }
  private event(
    type: NonNullable<TrucoView["animation"]>["type"],
    actor: number,
    value?: number,
  ) {
    this.#state.animation = {
      type,
      actor,
      at: this.#state.clock,
      sequence: ++this.#sequence,
      value,
    };
  }
  join(id: string, now: number, seat?: number) {
    if (
      this.phase !== "waiting" &&
      this.phase !== "finished" &&
      !this.seats.players.includes(id)
    )
      throw Error("Partida em andamento. Aguarde uma nova partida.");
    this.seats.join(id, seat);
    this.#state.clock = now;
    this.#state.revision++;
    if (this.seats.full && this.phase === "waiting") this.deal(now);
  }
  leave(id: string) {
    const seat = this.seats.index(id);
    if (this.phase !== "waiting" && this.phase !== "finished")
      this.finish(1 - (seat % 2), "Vitória por abandono da dupla adversária.");
    this.seats.leave(id);
    this.#state.revision++;
  }
  sync(online: Set<string>, now: number) {
    const was = this.seats.pausedAt;
    const result = this.seats.presence(online, now);
    if (result.resumed) {
      this.#until += result.resumed;
      this.#state.actionAt += result.resumed;
      for (const trick of this.#state.played)
        for (const play of trick) play.at += result.resumed;
      if (this.#state.animation) this.#state.animation.at += result.resumed;
      this.#state.revision++;
    }
    if (was !== this.seats.pausedAt) this.#state.revision++;
    for (const id of result.expired) {
      if (this.seats.players.includes(id)) this.leave(id);
    }
    return this.advance(now);
  }
  private deal(now: number) {
    const s = this.#state;
    this.#hands = [[], [], [], []];
    const deck: Card[] = TRUCO_RANKS.flatMap((rank) =>
      TRUCO_SUITS.map((suit) => ({ rank, suit })),
    );
    for (let i = deck.length - 1; i > 0; i--) {
      const j = this.randomIndex(i + 1);
      if (!Number.isInteger(j) || j < 0 || j > i)
        throw Error("Embaralhamento inválido.");
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    s.mano = (s.dealer + 1) % 4;
    s.turn = s.mano;
    for (let round = 0; round < 3; round++)
      for (let i = 0; i < 4; i++)
        this.#hands[(s.mano + i) % 4].push(deck.pop()!);
    s.vira = deck.pop()!;
    this.#locked = false;
    s.actionAt = 0;
    s.handNumber++;
    s.trick = 0;
    s.played = [[]];
    s.trickWinners = [];
    s.value = 1;
    s.pending = undefined;
    s.lastRaiseTeam = undefined;
    s.elevenVotes = [];
    s.iron = s.scores.every((score) => score === 11);
    s.eleven =
      !s.iron && s.scores.includes(11) ? s.scores.indexOf(11) : undefined;
    s.clock = now;
    s.phase = "dealing";
    s.message = "Embaralhando e distribuindo as cartas.";
    this.#until = now + 3400;
    this.event("deal", s.dealer);
    s.revision++;
  }
  advance(now: number) {
    const s = this.#state;
    s.clock = now;
    if (this.seats.pausedAt !== undefined) return false;
    if (this.#locked && now >= s.actionAt) {
      this.#locked = false;
      s.revision++;
      return true;
    }
    if (now < this.#until) return false;
    if (s.phase === "dealing") {
      s.phase = s.eleven !== undefined ? "eleven" : "playing";
      if (s.iron) s.value = 3;
      s.message = s.iron
        ? "Mão de ferro: cartas no escuro, sem pedidos. Vale 3."
        : s.eleven !== undefined
          ? "Mão de onze: a dupla decide se joga por 3 ou corre por 1."
          : "Jogue sua carta ou peça truco.";
      s.revision++;
      return true;
    }
    if (s.phase === "trick-result") {
      s.trick++;
      s.played.push([]);
      s.turn = this.#nextLead;
      s.phase = "playing";
      s.message = "Nova vaza.";
      s.revision++;
      return true;
    }
    if (s.phase === "hand-result") {
      s.dealer = (s.dealer + 1) % 4;
      this.deal(now);
      return true;
    }
    return false;
  }
  act(id: string, action: TrucoAction, revision: number, now: number) {
    const s = this.#state,
      seat = this.seats.index(id);
    s.clock = now;
    if (this.seats.pausedAt !== undefined)
      throw Error("Aguardando a reconexão dos participantes.");
    if (revision !== s.revision)
      throw Error("A mesa mudou. Use o estado atual.");
    if (action.type === "restart") {
      if (s.phase !== "finished" || !this.seats.full)
        throw Error("Reúna quatro participantes para reiniciar.");
      const revision = s.revision;
      this.#state = this.empty();
      this.#state.revision = revision + 1;
      this.deal(now);
      return;
    }
    if (action.type === "eleven") {
      if (s.phase !== "eleven" || seat % 2 !== s.eleven)
        throw Error("Esta decisão pertence à dupla com onze.");
      if (!action.accept) {
        this.award(1 - s.eleven!, 1, "A dupla de onze correu.");
        this.event("fold", seat);
        return;
      }
      if (s.elevenVotes.includes(seat))
        throw Error("Sua decisão já foi registrada.");
      s.elevenVotes.push(seat);
      if (s.elevenVotes.length === 2) {
        s.value = 3;
        s.phase = "playing";
        s.message = "Mão de onze aceita: vale 3, sem aumentos.";
      }
      s.revision++;
      return;
    }
    if (s.phase === "responding") {
      const pending = s.pending!;
      if (seat % 2 === pending.team)
        throw Error("A outra dupla precisa responder.");
      if (action.type === "fold") {
        this.award(
          pending.team,
          pending.previous,
          "A dupla adversária correu.",
        );
        this.event("fold", seat);
        return;
      }
      if (action.type === "accept") {
        s.value = pending.requested;
        s.pending = undefined;
        s.phase = "playing";
        s.turn = this.#resumeTurn;
        s.message = "Pedido aceito. Continue a vaza.";
        this.event("accept", seat, s.value);
        s.revision++;
        return;
      }
      if (action.type === "raise") {
        const next = this.nextValue(pending.requested);
        if (!next) throw Error("Doze é o limite.");
        s.value = pending.requested;
        s.pending = {
          team: seat % 2,
          by: seat,
          previous: s.value,
          requested: next,
        };
        s.lastRaiseTeam = seat % 2;
        s.message = `Pedido de ${next}! A outra dupla responde.`;
        this.event("raise", seat, next);
        s.revision++;
        return;
      }
      throw Error("Responda ao pedido antes de jogar.");
    }
    if (now < s.actionAt) throw Error("Aguarde a carta chegar à mesa.");
    if (s.phase !== "playing" || s.turn !== seat)
      throw Error("Aguarde sua vez e a animação da mesa.");
    if (action.type === "raise") {
      if (s.eleven !== undefined || s.iron)
        throw Error("Não há pedidos na mão especial.");
      if (s.lastRaiseTeam === seat % 2)
        throw Error("A outra dupla deve fazer o próximo aumento.");
      const next = this.nextValue(s.value);
      if (!next) throw Error("Doze é o limite.");
      this.#resumeTurn = s.turn;
      s.pending = {
        team: seat % 2,
        by: seat,
        previous: s.value,
        requested: next,
      };
      s.lastRaiseTeam = seat % 2;
      s.phase = "responding";
      s.message = `${next === 3 ? "Truco" : next}!`;
      this.event("raise", seat, next);
      s.revision++;
      return;
    }
    if (action.type !== "play") throw Error("Ação indisponível nesta fase.");
    if (
      !Number.isInteger(action.index) ||
      action.index < 0 ||
      action.index >= this.#hands[seat].length
    )
      throw Error("Carta inválida.");
    if (action.covered && (s.trick === 0 || s.iron))
      throw Error(
        "Carta coberta somente a partir da segunda vaza, fora da mão de ferro.",
      );
    const [card] = this.#hands[seat].splice(action.index, 1);
    s.played[s.trick].push({
      seat,
      card: action.covered ? null : card,
      covered: !!action.covered,
      at: now,
      sequence: ++this.#sequence,
    });
    this.event("play", seat);
    s.actionAt = now + 550;
    this.#locked = true;
    s.turn = (seat + 1) % 4;
    s.message = "Carta na mesa.";
    if (s.played[s.trick].length === 4) this.resolveTrick(now);
    s.revision++;
  }
  private nextValue(value: number) {
    return [1, 3, 6, 9, 12][[1, 3, 6, 9, 12].indexOf(value) + 1];
  }
  private resolveTrick(now: number) {
    const s = this.#state,
      plays = s.played[s.trick],
      strengths = plays.map((p) =>
        p.card ? cardStrength(p.card, s.vira!) : -1,
      ),
      max = Math.max(...strengths),
      winners = plays.filter((_, i) => strengths[i] === max),
      team =
        max < 0 || new Set(winners.map((p) => p.seat % 2)).size !== 1
          ? null
          : winners[0].seat % 2;
    s.trickWinners.push(team);
    this.#nextLead =
      team === null
        ? s.trick === 0
          ? s.mano
          : this.#nextLead
        : winners[0].seat;
    const result = handWinner(s.trickWinners);
    if (result !== undefined) {
      if (result === null) {
        s.phase = "hand-result";
        s.message = "Três empates: ninguém pontua. Nova mão.";
        this.#until = now + 2500;
      } else this.award(result, s.value, "Mão vencida.");
    } else {
      s.phase = "trick-result";
      s.message =
        team === null ? "Vaza empatada." : `Vaza da dupla ${team + 1}.`;
      this.#until = now + 1600;
    }
  }
  private award(team: number, value: number, message: string) {
    const s = this.#state;
    s.scores[team] += value;
    s.pending = undefined;
    s.message = message + ` Dupla ${team + 1}: +${value}.`;
    s.phase = "hand-result";
    this.#until = s.clock + 2800;
    this.event("win", team);
    s.revision++;
    if (s.scores[team] >= 12)
      this.finish(
        team,
        "Partida encerrada. Dupla vencedora: " + (team + 1) + ".",
      );
  }
  private finish(team: number, message: string) {
    this.#state.phase = "finished";
    this.#state.winner = team;
    this.#state.pending = undefined;
    this.#state.message = message;
    this.event("win", team);
    this.#state.revision++;
  }
  view(viewer?: string): TrucoView {
    const s = this.#state,
      index = viewer ? this.seats.players.indexOf(viewer) : -1;
    const visible = index >= 0 && !s.iron;
    const own =
      index >= 0
        ? this.#hands[index].map((c) => (visible ? { ...c } : null))
        : [];
    const partner =
      index >= 0 && s.eleven === index % 2 && !s.iron
        ? this.#hands[(index + 2) % 4].map((c) => ({ ...c }))
        : undefined;
    return {
      ...structuredClone(s),
      ...this.seats.view(),
      clock: this.seats.pausedAt ?? s.clock,
      hand: own,
      partnerHand: partner,
      counts: this.#hands.map((h) => h.length),
    };
  }
}
