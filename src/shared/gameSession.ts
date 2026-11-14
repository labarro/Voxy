// Stable authenticated profile IDs survive Socket.IO reconnection. This small
// seat reservation primitive is shared by the turn-based games, not by media.
export class GameSeats {
  players: (string | null)[];
  private missing = new Map<string, number>();
  pausedAt?: number;
  constructor(readonly size: number) {
    this.players = Array(size).fill(null);
  }
  join(id: string, seat?: number) {
    const existing = this.players.indexOf(id);
    if (existing >= 0) return existing;
    const index = seat ?? this.players.indexOf(null);
    if (index < 0 || index >= this.size || this.players[index])
      throw Error("Assento ocupado.");
    this.players[index] = id;
    return index;
  }
  index(id: string) {
    const index = this.players.indexOf(id);
    if (index < 0) throw Error("Você não participa desta partida.");
    return index;
  }
  leave(id: string) {
    const index = this.players.indexOf(id);
    if (index >= 0) this.players[index] = null;
    this.missing.delete(id);
  }
  get full() {
    return this.players.every(Boolean);
  }
  get occupied() {
    return this.players.some(Boolean);
  }
  // Returns resumed duration for animation deadlines and expired identities for
  // forfeit handling. Secret state remains in the game while a seat is reserved.
  presence(online: Set<string>, now: number) {
    for (const id of this.players) {
      if (!id) continue;
      if (online.has(id)) this.missing.delete(id);
      else if (!this.missing.has(id)) this.missing.set(id, now + 60000);
    }
    let resumed = 0;
    if (this.missing.size) {
      this.pausedAt ??= now;
    } else if (this.pausedAt !== undefined) {
      resumed = now - this.pausedAt;
      this.pausedAt = undefined;
    }
    return {
      resumed,
      expired: [...this.missing]
        .filter(([, deadline]) => now >= deadline)
        .map(([id]) => id),
    };
  }
  view() {
    return {
      players: [...this.players],
      reconnecting: [...this.missing].map(([id, until]) => ({ id, until })),
      paused: this.pausedAt !== undefined,
    };
  }
}
