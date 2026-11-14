import { randomInt } from "node:crypto";
import { TrucoGame, type TrucoAction } from "../../shared/truco";
import { ChessGame, type ChessAction } from "../../shared/chess";
import type { SocialGamesView, Command } from "../../shared/types";
import type { TableGame } from "../../shared/gameTables";
export class GameRoom {
  truco = new TrucoGame(randomInt);
  chess = new ChessGame();
  view(viewer?: string): SocialGamesView {
    return { truco: this.truco.view(viewer), chess: this.chess.view(viewer) };
  }
  get occupied() {
    return this.truco.seats.occupied || this.chess.seats.occupied;
  }
  seat(id: string) {
    for (const game of ["truco", "chess"] as const) {
      const index = this[game].seats.players.indexOf(id);
      if (index >= 0) return { game, index };
    }
    return undefined;
  }
  join(kind: TableGame, id: string, now: number, index?: number) {
    const existing = this.seat(id);
    if (existing && existing.game !== kind)
      throw Error("Saia da partida atual primeiro.");
    return this[kind].join(id, now, index);
  }
  leave(kind: TableGame, id: string) {
    this[kind].leave(id);
  }
  act(
    command: Extract<Command, { type: "game.act" }>,
    id: string,
    now: number,
  ) {
    if (command.game === "truco")
      this.truco.act(id, command.action, command.revision, now);
    else this.chess.act(id, command.action, command.revision, now);
  }
  sync(online: Set<string>, now: number) {
    const revision = this.truco.revision + this.chess.revision;
    this.truco.sync(online, now);
    this.chess.sync(online, now);
    return revision !== this.truco.revision + this.chess.revision;
  }
}
