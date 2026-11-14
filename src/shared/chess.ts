import { Chess, type Square } from "chess.js";
import { GameSeats } from "./gameSession";
export type ChessMoveInput = {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
};
export type ChessAction =
  | ({ type: "move" } & ChessMoveInput)
  | { type: "resign" }
  | { type: "offer" }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "claim"; move?: ChessMoveInput }
  | { type: "restart" };
export type ChessView = {
  kind: "chess";
  revision: number;
  clock: number;
  actionAt: number;
  players: (string | null)[];
  paused: boolean;
  reconnecting: { id: string; until: number }[];
  phase: "waiting" | "playing" | "finished";
  fen: string;
  turn: number;
  check: boolean;
  winner?: number;
  message: string;
  offer?: number;
  claim: boolean;
  claimMoves: ChessMoveInput[];
  moves: ChessMoveInput[];
  last?: {
    actor: number;
    at: number;
    sequence: number;
    before: string;
    after: string;
    from: string;
    to: string;
    piece: string;
    color: string;
    captured?: string;
    promotion?: string;
    flags: string;
    san: string;
  };
};
const positionKey = (fen: string) =>
  new Chess(fen).fen().split(" ").slice(0, 4).join(" ");
export class ChessGame {
  readonly seats = new GameSeats(2);
  #board: Chess;
  #positions = new Map<string, number>();
  #last?: ChessView["last"];
  #locked = false;
  revision = 0;
  clock = 0;
  actionAt = 0;
  phase: ChessView["phase"] = "waiting";
  winner?: number;
  message = "Dois lugares. As brancas começam.";
  offer?: number;
  constructor(fen?: string) {
    this.#board = new Chess(fen);
    this.record();
  }
  private record() {
    const key = positionKey(this.#board.fen());
    this.#positions.set(key, (this.#positions.get(key) ?? 0) + 1);
  }
  private turn() {
    return this.#board.turn() === "w" ? 0 : 1;
  }
  join(id: string, now: number, index?: number) {
    if (this.phase === "playing" && !this.seats.players.includes(id))
      throw Error("Partida em andamento.");
    this.seats.join(id, index);
    this.clock = now;
    if (this.phase === "waiting" && this.seats.full) {
      this.phase = "playing";
      this.message = "Brancas jogam.";
    }
    this.revision++;
  }
  leave(id: string) {
    const index = this.seats.index(id);
    if (this.phase === "playing")
      this.finish(1 - index, "Vitória por abandono.");
    this.seats.leave(id);
    this.revision++;
  }
  sync(online: Set<string>, now: number) {
    const old = this.seats.pausedAt,
      r = this.seats.presence(online, now);
    this.clock = now;
    if (r.resumed) {
      this.actionAt += r.resumed;
      if (this.#last) this.#last.at += r.resumed;
    }
    if (old !== this.seats.pausedAt) this.revision++;
    for (const id of r.expired)
      if (this.seats.players.includes(id)) this.leave(id);
    if (!this.seats.pausedAt && this.#locked && now >= this.actionAt) {
      this.#locked = false;
      this.revision++;
    }
  }
  private finish(winner: number | undefined, message: string) {
    this.phase = "finished";
    this.winner = winner;
    this.message = message;
    this.offer = undefined;
    this.revision++;
  }
  private claims(fen = this.#board.fen()) {
    return (
      (this.#positions.get(positionKey(fen)) ?? 0) >= 3 ||
      Number(fen.split(" ")[4]) >= 100
    );
  }
  private candidateClaim(move: ChessMoveInput) {
    const board = new Chess(this.#board.fen());
    board.move(move);
    return (
      Number(board.fen().split(" ")[4]) >= 100 ||
      (this.#positions.get(positionKey(board.fen())) ?? 0) + 1 >= 3
    );
  }
  act(id: string, action: ChessAction, revision: number, now: number) {
    const seat = this.seats.index(id);
    this.clock = now;
    if (revision !== this.revision)
      throw Error("O tabuleiro mudou. Use o estado atual.");
    if (this.seats.pausedAt !== undefined) throw Error("Aguardando reconexão.");
    if (action.type === "restart") {
      if (this.phase !== "finished" || !this.seats.full)
        throw Error("Reúna dois jogadores para reiniciar.");
      this.#board = new Chess();
      this.#positions.clear();
      this.record();
      this.#last = undefined;
      this.winner = undefined;
      this.offer = undefined;
      this.actionAt = 0;
      this.#locked = false;
      this.phase = "playing";
      this.message = "Nova partida. Brancas jogam.";
      this.revision++;
      return;
    }
    if (this.phase !== "playing") throw Error("Não há partida em andamento.");
    if (action.type === "resign") {
      this.finish(1 - seat, "Vitória por desistência.");
      return;
    }
    if (action.type === "accept" || action.type === "decline") {
      if (this.offer === undefined || this.offer === seat)
        throw Error("Não há proposta adversária.");
      if (action.type === "accept")
        this.finish(undefined, "Empate por acordo.");
      else {
        this.offer = undefined;
        this.revision++;
      }
      return;
    }
    if (action.type === "offer") {
      if (
        this.#last?.actor !== seat ||
        this.turn() === seat ||
        this.offer !== undefined
      )
        throw Error("Ofereça empate após o seu lance.");
      this.offer = seat;
      this.revision++;
      return;
    }
    if (this.turn() !== seat) throw Error("Aguarde sua vez.");
    if (now < this.actionAt) throw Error("Aguarde a peça chegar ao destino.");
    if (action.type === "claim") {
      if (action.move ? !this.candidateClaim(action.move) : !this.claims())
        throw Error("Ainda não há repetição tripla ou cinquenta lances.");
      this.finish(
        undefined,
        "Empate reivindicado por repetição tripla ou cinquenta lances.",
      );
      return;
    }
    if (action.type !== "move") throw Error("Ação indisponível.");
    const legal = this.#board
      .moves({ square: action.from as Square, verbose: true })
      .find(
        (m) =>
          m.to === action.to &&
          (!m.promotion || m.promotion === action.promotion),
      );
    if (!legal)
      throw Error("Movimento ilegal. Confira a peça, o destino e a promoção.");
    const move = this.#board.move(action);
    this.#last = {
      actor: seat,
      at: now,
      sequence: (this.#last?.sequence ?? 0) + 1,
      before: move.before,
      after: move.after,
      from: move.from,
      to: move.to,
      piece: move.piece,
      color: move.color,
      captured: move.captured,
      promotion: move.promotion,
      flags: move.flags,
      san: move.san,
    };
    this.actionAt = now + 850;
    this.#locked = true;
    this.offer = undefined;
    this.record();
    this.revision++;
    if (this.#board.isCheckmate()) this.finish(seat, "Xeque-mate.");
    else if (this.#board.isStalemate())
      this.finish(undefined, "Empate por afogamento.");
    else if (this.#board.isInsufficientMaterial())
      this.finish(undefined, "Empate por material insuficiente.");
    else if ((this.#positions.get(positionKey(this.#board.fen())) ?? 0) >= 5)
      this.finish(undefined, "Empate automático por cinco repetições.");
    else if (Number(this.#board.fen().split(" ")[4]) >= 150)
      this.finish(undefined, "Empate automático por setenta e cinco lances.");
    else
      this.message = this.#board.isCheck()
        ? "Xeque."
        : this.turn() === 0
          ? "Brancas jogam."
          : "Pretas jogam.";
  }
  view(viewer?: string): ChessView {
    const own = this.seats.players.indexOf(viewer ?? ""),
      can = own === this.turn() && this.phase === "playing";
    const moves = can
      ? this.#board
          .moves({ verbose: true })
          .map((m) => ({
            from: m.from,
            to: m.to,
            ...(m.promotion
              ? { promotion: m.promotion as ChessMoveInput["promotion"] }
              : {}),
          }))
      : [];
    return {
      kind: "chess",
      revision: this.revision,
      clock: this.seats.pausedAt ?? this.clock,
      actionAt: this.actionAt,
      ...this.seats.view(),
      phase: this.phase,
      fen: this.#board.fen(),
      turn: this.turn(),
      check: this.#board.isCheck(),
      winner: this.winner,
      message: this.message,
      offer: this.offer,
      claim: can && this.claims(),
      claimMoves: can ? moves.filter((m) => this.candidateClaim(m)) : [],
      moves,
      last: this.#last ? { ...this.#last } : undefined,
    };
  }
}
