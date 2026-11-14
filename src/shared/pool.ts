// Voxy rotation pool: seven numbered balls, lowest ball first, one point per pot.
// Only the room host advances this fixed-step simulation. Clients render snapshots.
export const POOL = {
  x: 7.4,
  z: 3.5,
  halfX: 1.25,
  halfZ: 2.3,
  radius: 0.09,
  pocket: 0.21,
  scale: 0.56,
  clothY: 0.91,
  contact: 0.65,
  step: 1 / 120,
};
export type PoolBall = {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  sunk: boolean;
};
export type PoolState = {
  players: string[];
  scores: number[];
  turn: number;
  phase:
    "waiting" | "aiming" | "preparing" | "rolling" | "placing" | "finished";
  clock: number;
  aim?: { actor: string; angle: number; power: number };
  shot?: {
    actor: string;
    angle: number;
    power: number;
    started: number;
    sequence: number;
    x: number;
    z: number;
  };
  balls: PoolBall[];
  revision: number;
  message: string;
  winner?: string;
};
export const pockets = [-1, 1].flatMap((x) =>
  [-1, 0, 1].map((z) => ({ x: x * POOL.halfX, z: z * POOL.halfZ })),
);
export function newPool(): PoolState {
  return {
    players: [],
    scores: [0, 0],
    turn: 0,
    phase: "waiting",
    revision: 0,
    clock: 0,
    message: "Entre na mesa. Dois jogadores iniciam a partida.",
    balls: [
      { id: 0, x: 0, z: 1.25, vx: 0, vz: 0, sunk: false },
      ...Array.from({ length: 7 }, (_, i) => {
        const row = i < 1 ? 0 : i < 3 ? 1 : i < 6 ? 2 : 3;
        const col = i - [0, 1, 3, 6][row];
        return {
          id: i + 1,
          x: (col - row / 2) * 0.185,
          z: -1 - row * 0.165,
          vx: 0,
          vz: 0,
          sunk: false,
        };
      }),
    ],
  };
}
export class PoolGame {
  state = newPool();
  private first: number | null = null;
  private target = 1;
  private potted: number[] = [];
  private steps = 0;
  aim(id: string, angle: number, power: number) {
    if (
      this.state.phase !== "aiming" ||
      this.state.players[this.state.turn] !== id
    )
      throw Error("Aguarde sua vez para mirar.");
    if (
      !Number.isFinite(angle) ||
      !Number.isFinite(power) ||
      power < 0.05 ||
      power > 1
    )
      throw Error("Mira inválida.");
    this.state.aim = { actor: id, angle, power };
  }
  place(id: string, x: number, z: number, revision: number) {
    const s = this.state;
    if (
      s.phase !== "placing" ||
      s.players[s.turn] !== id ||
      revision !== s.revision
    )
      throw Error("Aguarde a reposição da branca.");
    if (
      !Number.isFinite(x + z) ||
      Math.abs(x) > POOL.halfX - POOL.radius ||
      Math.abs(z) > POOL.halfZ - POOL.radius ||
      pockets.some((p) => Math.hypot(x - p.x, z - p.z) < POOL.pocket) ||
      s.balls.some(
        (b) =>
          b.id && !b.sunk && Math.hypot(x - b.x, z - b.z) < POOL.radius * 2.05,
      )
    )
      throw Error("Escolha um espaço livre no feltro.");
    Object.assign(s.balls[0], { x, z, vx: 0, vz: 0, sunk: false });
    s.phase = "aiming";
    s.revision++;
    s.message = "Branca posicionada. Mire no feltro e prepare sua tacada.";
  }
  restart(id: string) {
    if (this.state.phase !== "finished" || !this.state.players.includes(id))
      throw Error("A partida ainda não terminou.");
    const players = [...this.state.players],
      revision = this.state.revision + 1;
    this.state = newPool();
    for (const player of players) this.join(player);
    this.state.revision = revision;
  }
  join(id: string) {
    if (this.state.phase === "finished" && this.state.players.length < 2) {
      const previous = this.state.players.slice(),
        revision = this.state.revision + 1;
      this.state = newPool();
      this.state.players = previous;
      this.state.revision = revision;
    }
    const s = this.state;
    if (s.players.includes(id)) return;
    if (s.players.length >= 2) throw Error("A mesa já tem dois jogadores.");
    this.state.players.push(id);
    this.state.phase = this.state.players.length === 2 ? "aiming" : "waiting";
    this.state.message =
      this.state.phase === "aiming"
        ? "Acerte primeiro a menor bola. Cada bola vale um ponto."
        : "Aguardando o segundo jogador.";
    this.state.revision++;
  }
  leave(id: string) {
    if (!this.state.players.includes(id)) return;
    const remaining = this.state.players.filter((p) => p !== id);
    const revision = this.state.revision + 1;
    if (this.state.players.length === 2 && this.state.phase !== "waiting") {
      this.state.scores = [
        this.state.scores[this.state.players.indexOf(remaining[0])],
        0,
      ];
      this.state.players = remaining;
      this.state.phase = "finished";
      this.state.winner = remaining[0];
      this.state.revision = revision;
      this.state.message =
        "Vitória por abandono. Uma nova entrada inicia outra partida.";
      for (const b of this.state.balls) b.vx = b.vz = 0;
      return;
    }
    this.state = newPool();
    this.state.revision = revision;
    this.state.players = remaining;
    this.state.message =
      "Jogador saiu. Aguardando um novo adversário; placar reiniciado.";
  }
  shoot(id: string, angle: number, power: number, revision: number) {
    const s = this.state;
    if (
      s.phase !== "aiming" ||
      s.players[s.turn] !== id ||
      revision !== s.revision
    )
      throw Error("Aguarde sua vez e o estado atual da mesa.");
    if (
      !Number.isFinite(angle) ||
      !Number.isFinite(power) ||
      power < 0.05 ||
      power > 1
    )
      throw Error("Tacada inválida.");
    this.first = null;
    this.potted = [];
    this.steps = 0;
    this.target = Math.min(
      ...s.balls.filter((b) => b.id && !b.sunk).map((b) => b.id),
    );
    s.aim = { actor: id, angle, power };
    s.shot = {
      actor: id,
      angle,
      power,
      started: s.clock,
      sequence: s.revision + 1,
      x: s.balls[0].x,
      z: s.balls[0].z,
    };
    s.phase = "preparing";
    s.revision++;
    s.message = "Preparando a tacada…";
  }
  step() {
    const s = this.state;
    s.clock += POOL.step;
    if (s.phase === "preparing") {
      if (s.clock - s.shot!.started >= POOL.contact) {
        const cue = s.balls[0],
          shot = s.shot!;
        cue.vx = Math.sin(shot.angle) * shot.power * 8;
        cue.vz = -Math.cos(shot.angle) * shot.power * 8;
        s.phase = "rolling";
        s.message = "Bolas em movimento…";
      }
      s.revision++;
      return true;
    }
    if (s.phase !== "rolling") return false;
    const dt = 1 / 120,
      r = POOL.radius;
    for (const b of s.balls) {
      if (b.sunk) continue;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      if (pockets.some((p) => Math.hypot(b.x - p.x, b.z - p.z) < POOL.pocket)) {
        b.sunk = true;
        b.vx = b.vz = 0;
        this.potted.push(b.id);
        continue;
      }
      for (const axis of ["x", "z"] as const) {
        const limit = (axis === "x" ? POOL.halfX : POOL.halfZ) - r;
        const v = axis === "x" ? "vx" : "vz";
        if (Math.abs(b[axis]) > limit) {
          b[axis] = Math.sign(b[axis]) * limit;
          b[v] *= -0.86;
        }
      }
      const speed = Math.hypot(b.vx, b.vz),
        friction = Math.max(0, 1 - (0.72 * dt) / (speed || 1));
      b.vx *= friction;
      b.vz *= friction;
      if (speed < 0.025) b.vx = b.vz = 0;
    }
    for (let i = 0; i < s.balls.length; i++)
      for (let j = i + 1; j < s.balls.length; j++) {
        const a = s.balls[i],
          b = s.balls[j];
        if (a.sunk || b.sunk) continue;
        const dx = b.x - a.x,
          dz = b.z - a.z,
          d = Math.hypot(dx, dz);
        if (d >= r * 2 || d < 1e-8) continue;
        const nx = dx / d,
          nz = dz / d,
          overlap = (r * 2 - d) / 2;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;
        const impulse = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (impulse <= 0) continue;
        if (a.id === 0 && this.first === null) this.first = b.id;
        a.vx -= impulse * nx * 0.98;
        a.vz -= impulse * nz * 0.98;
        b.vx += impulse * nx * 0.98;
        b.vz += impulse * nz * 0.98;
      }
    this.steps++;
    if (this.steps >= 2400 || s.balls.every((b) => b.sunk || (!b.vx && !b.vz)))
      this.finishShot();
    s.revision++;
    return true;
  }
  private finishShot() {
    const s = this.state,
      foul = this.first !== this.target || this.potted.includes(0);
    for (const b of s.balls) {
      b.vx = b.vz = 0;
    }
    if (foul) {
      // Object balls potted on a foul are respotted in a collision-free location.
      for (const id of this.potted) this.respot(s.balls[id]);
      s.message =
        "Falta: branca encaçapada ou primeiro contato incorreto. Vez do adversário.";
    } else {
      s.scores[s.turn] += this.potted.length;
      s.message = this.potted.length
        ? "Bola encaçapada! Continue jogando."
        : "Nenhuma bola encaçapada. Troca de turno.";
    }
    if (foul || !this.potted.length) s.turn = 1 - s.turn;
    s.phase = foul ? "placing" : "aiming";
    s.aim = undefined;
    if (foul) s.message += " Reposicione a branca em um espaço livre.";
    if (s.balls.slice(1).every((b) => b.sunk)) {
      s.phase = "finished";
      s.winner = s.players[s.scores[0] > s.scores[1] ? 0 : 1];
      s.message = "Fim de partida. Vence quem fez mais pontos.";
    }
  }
  private respot(ball: PoolBall) {
    const s = this.state;
    for (let z = 1.8; z >= -1.8; z -= 0.22)
      for (let x = -0.9; x <= 0.9; x += 0.22) {
        if (
          s.balls.every(
            (b) => b === ball || b.sunk || Math.hypot(x - b.x, z - b.z) > 0.19,
          )
        ) {
          Object.assign(ball, { x, z, vx: 0, vz: 0, sunk: false });
          return;
        }
      }
  }
}
