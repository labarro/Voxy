// Voxy pool. Two independent modes share one host-only fixed-step 2D simulation:
// - "rotation" (Rotação 7): seven numbered balls, lowest ball first, one point per pot.
// - "eight" (Bola 8): fifteen balls, WPA-based Eight-Ball (see JOGOS-SOCIAIS.md).
// Only the room host advances the simulation. Clients render snapshots.
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
export type PoolMode = "rotation" | "eight";
export type PoolGroup = "solids" | "stripes";
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
    /** Optional follow (+) / draw (−) applied to the cue ball, −1…1. */
    spin?: number;
  };
  balls: PoolBall[];
  revision: number;
  message: string;
  winner?: string;
  // Fields below were added in 1.6. They are optional so snapshots from older
  // hosts (always Rotação 7) keep type-checking and rendering.
  mode?: PoolMode;
  /** Index in `players` of who breaks this rack; alternates on rematch. */
  breaker?: number;
  /** Rack seed for the deterministic Eight-Ball shuffle. */
  seed?: number;
  /** Eight-Ball groups per player index; null means open table. */
  groups?: (PoolGroup | null)[];
  /** Foul counters per player index (informative, no three-foul rule). */
  fouls?: number[];
  /** Ball in hand restriction while `phase === "placing"`. */
  ballInHand?: "kitchen" | "table";
  /** Pocket index (see `pockets`) announced for the 8-ball. */
  called?: number;
  /** True while the next Eight-Ball shot is the break. */
  opening?: boolean;
};
export const pockets = [-1, 1].flatMap((x) =>
  [-1, 0, 1].map((z) => ({ x: x * POOL.halfX, z: z * POOL.halfZ })),
);
/** Names seen from the head of the table (break side, +z) looking at the rack. */
export const POCKET_NAMES = [
  "Pé esquerda",
  "Meio esquerda",
  "Cabeceira esquerda",
  "Pé direita",
  "Meio direita",
  "Cabeceira direita",
];
/** The head string: the kitchen is the area with z ≥ HEAD_STRING. */
export const HEAD_STRING = POOL.halfZ / 2;
export const FOOT_SPOT = { x: 0, z: -POOL.halfZ / 2 };
/** Official colors: 1/9 yellow, 2/10 blue, 3/11 red, 4/12 purple, 5/13 orange, 6/14 green, 7/15 maroon, 8 black. */
export const BALL_COLORS = [
  "#f4efe2",
  "#f2c230",
  "#2557b8",
  "#c8322c",
  "#5b3a91",
  "#ec7a24",
  "#1f7f4a",
  "#7a2730",
  "#141414",
];
export const ballColor = (id: number) => BALL_COLORS[id > 8 ? id - 8 : id];
export const groupOf = (id: number): PoolGroup | undefined =>
  id >= 1 && id <= 7 ? "solids" : id >= 9 && id <= 15 ? "stripes" : undefined;
export const poolMode = (s: Pick<PoolState, "mode">): PoolMode =>
  s.mode ?? "rotation";
export const GROUP_NAMES: Record<PoolGroup, string> = {
  solids: "Lisas",
  stripes: "Listradas",
};
const otherGroup = (g: PoolGroup): PoolGroup =>
  g === "solids" ? "stripes" : "solids";

function random(seed: number) {
  // mulberry32: small deterministic PRNG so racks are reproducible from `seed`.
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** WPA triangle: apex on the foot spot, 8 in the middle of the third row, one
 * solid and one stripe in the two back corners. Other balls are shuffled. */
export function eightRack(seed: number): PoolBall[] {
  const next = random(seed),
    spacing = POOL.radius * 2 + 0.003,
    row = spacing * Math.sin(Math.PI / 3);
  const shuffle = <A>(list: A[]) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]),
    stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  const corners = next() < 0.5 ? [solids.pop()!, stripes.pop()!] : [stripes.pop()!, solids.pop()!];
  const rest = shuffle([...solids, ...stripes]);
  const balls: PoolBall[] = Array.from({ length: 16 }, (_, id) => ({
    id,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    sunk: false,
  }));
  Object.assign(balls[0], { x: 0, z: HEAD_STRING + 0.25 });
  for (let r = 0; r < 5; r++)
    for (let c = 0; c <= r; c++) {
      const id =
        r === 2 && c === 1
          ? 8
          : r === 4 && c === 0
            ? corners[0]
            : r === 4 && c === 4
              ? corners[1]
              : rest.pop()!;
      Object.assign(balls[id], {
        x: (c - r / 2) * spacing,
        z: FOOT_SPOT.z - r * row,
      });
    }
  return balls;
}
function rotationRack(): PoolBall[] {
  return [
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
  ];
}
export function newPool(mode: PoolMode = "rotation", seed = 1): PoolState {
  const state: PoolState = {
    players: [],
    scores: [0, 0],
    turn: 0,
    phase: "waiting",
    revision: 0,
    clock: 0,
    message: "Entre na mesa. Dois jogadores iniciam a partida.",
    balls: mode === "eight" ? eightRack(seed) : rotationRack(),
    mode,
    breaker: 0,
    seed,
    fouls: [0, 0],
  };
  if (mode === "eight") {
    state.groups = [null, null];
    state.opening = true;
  }
  return state;
}
/** Balls the shooter may legally contact first. */
export function legalTargets(s: PoolState, turn = s.turn): number[] {
  const remaining = s.balls.filter((b) => b.id && !b.sunk).map((b) => b.id);
  if (poolMode(s) === "rotation") return [Math.min(...remaining)];
  const objects = remaining.filter((id) => id !== 8);
  if (s.opening) return remaining;
  const group = s.groups?.[turn];
  if (!group) return objects.length ? objects : [8];
  const own = objects.filter((id) => groupOf(id) === group);
  return own.length ? own : [8];
}
/** True when the player must shoot the 8 (and therefore call its pocket). */
export function onEight(s: PoolState, turn = s.turn) {
  return (
    poolMode(s) === "eight" &&
    !s.opening &&
    legalTargets(s, turn).length === 1 &&
    legalTargets(s, turn)[0] === 8
  );
}
export class PoolGame {
  state: PoolState;
  private first: number | null = null;
  private target = 1;
  private legal: number[] = [];
  private potted: number[] = [];
  private pocketOf = new Map<number, number>();
  private railed = new Set<number>();
  private railAfterContact = false;
  private steps = 0;
  private spin = 0;
  private spinLeft = 0;
  private spinSteps = 0;
  constructor(seed = 1) {
    this.state = newPool("rotation", seed);
  }
  private get mode() {
    return poolMode(this.state);
  }
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
    if (s.ballInHand === "kitchen" && z < HEAD_STRING)
      throw Error(
        "Bola na mão atrás da linha de cabeceira: posicione a branca na área destacada.",
      );
    Object.assign(s.balls[0], { x, z, vx: 0, vz: 0, sunk: false });
    s.phase = "aiming";
    s.ballInHand = undefined;
    s.revision++;
    s.message = onEight(s)
      ? "Branca posicionada. Anuncie a caçapa da bola 8 e prepare a tacada."
      : s.opening
        ? "Branca posicionada. Mire no triângulo e faça a abertura."
        : "Branca posicionada. Mire no feltro e prepare sua tacada.";
  }
  /** Rematch: same players and mode, the other player breaks. */
  restart(id: string) {
    if (this.state.phase !== "finished" || !this.state.players.includes(id))
      throw Error("A partida ainda não terminou.");
    this.rack(this.mode);
  }
  /** Chooses the mode before the match starts or after it ends. With two
   * players at a finished table the new rack starts at once (rematch). */
  setMode(id: string, mode: PoolMode) {
    const s = this.state;
    if (!s.players.includes(id)) throw Error("Entre na mesa para escolher o modo.");
    if (s.phase !== "waiting" && s.phase !== "finished")
      throw Error("O modo só pode ser trocado antes ou depois da partida.");
    if (s.phase === "finished" && s.players.length === 2) {
      this.rack(mode);
      return;
    }
    const players = [...s.players],
      revision = s.revision + 1;
    this.state = newPool(mode, (s.seed ?? 1) + 1);
    this.state.players = players;
    this.state.revision = revision;
    this.state.message =
      (mode === "eight" ? "Bola 8 selecionada." : "Rotação 7 selecionada.") +
      " Aguardando o segundo jogador.";
  }
  private rack(mode: PoolMode) {
    const players = [...this.state.players],
      revision = this.state.revision + 1,
      breaker = players.length === 2 ? 1 - (this.state.breaker ?? 0) : 0;
    this.state = newPool(mode, (this.state.seed ?? 1) + 1);
    this.state.breaker = breaker;
    for (const player of players) this.join(player);
    this.state.revision = revision;
  }
  /** Announces the pocket for the 8-ball (Eight-Ball only). */
  call(id: string, pocket: number, revision: number) {
    const s = this.state;
    if (
      (s.phase !== "aiming" && s.phase !== "placing") ||
      s.players[s.turn] !== id ||
      revision !== s.revision
    )
      throw Error("Aguarde sua vez para anunciar a caçapa.");
    if (!onEight(s)) throw Error("A caçapa só é anunciada na bola 8.");
    if (!Number.isInteger(pocket) || pocket < 0 || pocket >= pockets.length)
      throw Error("Caçapa inválida.");
    s.called = pocket;
    s.revision++;
    s.message = `Bola 8 anunciada na caçapa ${POCKET_NAMES[pocket].toLowerCase()}.`;
  }
  join(id: string, mode?: PoolMode) {
    if (this.state.phase === "finished" && this.state.players.length < 2) {
      const previous = this.state.players.slice(),
        revision = this.state.revision + 1;
      this.state = newPool(this.mode, (this.state.seed ?? 1) + 1);
      this.state.players = previous;
      this.state.revision = revision;
    }
    const s = this.state;
    if (s.players.includes(id)) return;
    if (s.players.length >= 2) throw Error("A mesa já tem dois jogadores.");
    if (mode && !s.players.length && mode !== this.mode) {
      const revision = s.revision;
      this.state = newPool(mode, (s.seed ?? 1) + 1);
      this.state.revision = revision;
    }
    this.state.players.push(id);
    if (this.state.players.length === 2) this.start();
    else {
      this.state.phase = "waiting";
      this.state.message = "Aguardando o segundo jogador.";
    }
    this.state.revision++;
  }
  private start() {
    const s = this.state;
    s.turn = s.breaker ?? 0;
    if (this.mode === "eight") {
      s.phase = "placing";
      s.ballInHand = "kitchen";
      s.opening = true;
      s.message =
        "Abertura: posicione a branca atrás da linha de cabeceira e quebre o triângulo.";
    } else {
      s.phase = "aiming";
      s.message = "Acerte primeiro a menor bola. Cada bola vale um ponto.";
    }
  }
  leave(id: string) {
    if (!this.state.players.includes(id)) return;
    const remaining = this.state.players.filter((p) => p !== id);
    const revision = this.state.revision + 1;
    if (this.state.players.length === 2 && this.state.phase !== "waiting") {
      const index = this.state.players.indexOf(remaining[0]);
      this.state.scores = [this.state.scores[index], 0];
      if (this.state.fouls) this.state.fouls = [this.state.fouls[index] ?? 0, 0];
      if (this.state.groups)
        this.state.groups = [this.state.groups[index] ?? null, null];
      this.state.players = remaining;
      this.state.turn = 0;
      this.state.phase = "finished";
      this.state.winner = remaining[0];
      this.state.revision = revision;
      this.state.ballInHand = undefined;
      this.state.message =
        "Vitória por abandono. Uma nova entrada inicia outra partida.";
      for (const b of this.state.balls) b.vx = b.vz = 0;
      return;
    }
    this.state = newPool(this.mode, (this.state.seed ?? 1) + 1);
    this.state.revision = revision;
    this.state.players = remaining;
    this.state.message =
      "Jogador saiu. Aguardando um novo adversário; placar reiniciado.";
  }
  shoot(
    id: string,
    angle: number,
    power: number,
    revision: number,
    spin = 0,
  ) {
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
      power > 1 ||
      !Number.isFinite(spin) ||
      Math.abs(spin) > 1
    )
      throw Error("Tacada inválida.");
    if (onEight(s) && s.called === undefined)
      throw Error("Anuncie a caçapa da bola 8 antes da tacada.");
    this.first = null;
    this.potted = [];
    this.pocketOf.clear();
    this.railed.clear();
    this.railAfterContact = false;
    this.steps = 0;
    this.spin = spin;
    this.spinLeft = 0;
    this.spinSteps = 0;
    this.legal = legalTargets(s);
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
    if (spin) s.shot.spin = spin;
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
    if (this.spinSteps > 0 && !s.balls[0].sunk) {
      // Follow/draw: the stored cue-ball rotation is released over 0.15 s
      // after the first contact, along the original shot direction.
      const share = this.spinLeft / this.spinSteps,
        angle = s.shot!.angle;
      s.balls[0].vx += Math.sin(angle) * share;
      s.balls[0].vz -= Math.cos(angle) * share;
      this.spinLeft -= share;
      this.spinSteps--;
    }
    for (const b of s.balls) {
      if (b.sunk) continue;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const pocket = pockets.findIndex(
        (p) => Math.hypot(b.x - p.x, b.z - p.z) < POOL.pocket,
      );
      if (pocket >= 0) {
        b.sunk = true;
        b.vx = b.vz = 0;
        this.potted.push(b.id);
        this.pocketOf.set(b.id, pocket);
        continue;
      }
      for (const axis of ["x", "z"] as const) {
        const limit = (axis === "x" ? POOL.halfX : POOL.halfZ) - r;
        const v = axis === "x" ? "vx" : "vz";
        if (Math.abs(b[axis]) > limit) {
          b[axis] = Math.sign(b[axis]) * limit;
          b[v] *= -0.86;
          if (b.id) this.railed.add(b.id);
          if (this.first !== null) this.railAfterContact = true;
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
        if (a.id === 0 && this.first === null) {
          this.first = b.id;
          if (this.spin) {
            this.spinLeft = this.spin * impulse * 0.7;
            this.spinSteps = 18;
          }
        }
        a.vx -= impulse * nx * 0.98;
        a.vz -= impulse * nz * 0.98;
        b.vx += impulse * nx * 0.98;
        b.vz += impulse * nz * 0.98;
      }
    this.steps++;
    if (
      this.steps >= 2400 ||
      (!this.spinSteps && s.balls.every((b) => b.sunk || (!b.vx && !b.vz)))
    )
      this.finishShot();
    s.revision++;
    return true;
  }
  private finishShot() {
    for (const b of this.state.balls) b.vx = b.vz = 0;
    this.spinSteps = 0;
    if (this.mode === "eight") this.finishEight();
    else this.finishRotation();
  }
  private finishRotation() {
    const s = this.state,
      foul = this.first !== this.target || this.potted.includes(0);
    if (foul) {
      // Object balls potted on a foul are respotted in a collision-free location.
      for (const id of this.potted) this.respot(s.balls[id]);
      if (s.fouls) s.fouls[s.turn]++;
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
  private finishEight() {
    const s = this.state,
      shooter = s.turn,
      opponent = 1 - shooter,
      potted = this.potted,
      scratch = potted.includes(0),
      eight = potted.includes(8),
      objects = potted.filter((id) => id && id !== 8);
    s.aim = undefined;
    s.fouls ??= [0, 0];
    s.groups ??= [null, null];
    const called = s.called;
    s.called = undefined;
    if (s.opening) {
      s.opening = false;
      // WPA: a legal break pockets a ball or drives four numbered balls to a cushion.
      if (!potted.some((id) => id) && this.railed.size < 4) {
        s.fouls[shooter]++;
        const players = s.players,
          fouls = s.fouls,
          seed = (s.seed ?? 1) + 1;
        this.state = newPool("eight", seed);
        // Keep the host clock and revisions monotonic for interpolating clients.
        Object.assign(this.state, {
          players,
          fouls,
          clock: s.clock,
          revision: s.revision + 1,
        });
        this.state.breaker = opponent;
        this.start();
        this.state.message =
          "Abertura ilegal: nenhuma bola caiu e menos de quatro bolas tocaram as tabelas. Falta; as bolas foram rearrumadas e o adversário abre.";
        return;
      }
      let note = "Abertura válida. Mesa aberta.";
      if (eight) {
        this.spotEight();
        note = "Abertura válida. A bola 8 caiu e voltou ao ponto do pé. Mesa aberta.";
      }
      if (scratch) {
        s.fouls[shooter]++;
        this.ballInHand("kitchen");
        s.turn = opponent;
        s.message = `Falta na abertura: a branca caiu. ${note} Adversário com bola na mão atrás da linha de cabeceira.`;
      } else if (objects.length || eight) {
        s.phase = "aiming";
        s.message = `${note} Bola encaçapada: continue jogando.`;
      } else {
        s.phase = "aiming";
        s.turn = opponent;
        s.message = `${note} Nenhuma bola caiu; vez do adversário.`;
      }
      this.updateScores();
      return;
    }
    let foul: string | undefined;
    if (this.first === null) foul = "a branca não tocou nenhuma bola";
    else if (!this.legal.includes(this.first))
      foul =
        this.first === 8
          ? "a bola 8 não pode ser a primeira tocada"
          : "a primeira bola tocada não era uma bola válida";
    else if (!potted.length && !this.railAfterContact)
      foul = "nenhuma bola caiu ou tocou uma tabela depois do contato";
    if (scratch)
      foul = "a branca caiu" + (foul && this.first !== null ? " e " + foul : "");
    if (eight) {
      const wasOnEight = this.legal.length === 1 && this.legal[0] === 8;
      const pocket = this.pocketOf.get(8);
      let loss: string | undefined;
      if (!wasOnEight) loss = "a bola 8 caiu antes de terminar o grupo";
      else if (foul) loss = `a bola 8 caiu com falta (${foul})`;
      else if (pocket !== called)
        loss = `a bola 8 caiu na caçapa ${POCKET_NAMES[pocket ?? 0].toLowerCase()}, diferente da anunciada`;
      if (loss) s.fouls[shooter] += foul ? 1 : 0;
      s.phase = "finished";
      s.winner = s.players[loss ? opponent : shooter];
      s.message = loss
        ? `Derrota: ${loss}. Vitória do adversário.`
        : "Bola 8 encaçapada na caçapa anunciada. Vitória!";
      if (scratch) this.respot(s.balls[0]);
      this.updateScores();
      return;
    }
    if (foul) {
      // WPA: object balls pocketed on a foul stay pocketed.
      s.fouls[shooter]++;
      this.ballInHand("table");
      s.turn = opponent;
      s.message = `Falta: ${foul}. Adversário com bola na mão em qualquer lugar da mesa.`;
      this.updateScores();
      return;
    }
    let assigned = "";
    if (!s.groups[shooter] && objects.length) {
      const group = groupOf(objects[0])!;
      s.groups[shooter] = group;
      s.groups[opponent] = otherGroup(group);
      assigned = ` Grupo definido: ${GROUP_NAMES[group]}.`;
    }
    const own = s.groups[shooter];
    s.phase = "aiming";
    if (own && objects.some((id) => groupOf(id) === own)) {
      s.message = `Bola do seu grupo encaçapada.${assigned} Continue jogando.`;
      if (onEight(s)) s.message += " Agora é a bola 8: anuncie a caçapa.";
    } else {
      s.turn = opponent;
      s.message = objects.length
        ? "Somente bolas do adversário caíram. Troca de turno."
        : "Nenhuma bola encaçapada. Troca de turno.";
    }
    this.updateScores();
  }
  private updateScores() {
    const s = this.state;
    s.scores = [0, 1].map((i) => {
      const g = s.groups?.[i];
      return g
        ? s.balls.filter((b) => b.sunk && groupOf(b.id) === g).length
        : 0;
    });
  }
  private ballInHand(kind: "kitchen" | "table") {
    const s = this.state,
      cue = s.balls[0];
    s.phase = "placing";
    s.ballInHand = kind;
    if (cue.sunk) {
      // Keep the cue ball visible at a legal default spot until it is placed.
      Object.assign(cue, { x: 0, z: HEAD_STRING + 0.25, sunk: false });
      if (!this.free(cue)) this.respot(cue);
    }
  }
  private free(ball: PoolBall, x = ball.x, z = ball.z) {
    return this.state.balls.every(
      (b) =>
        b === ball || b.sunk || Math.hypot(x - b.x, z - b.z) > POOL.radius * 2.1,
    );
  }
  /** WPA spotting: foot spot, else the closest free point on the long string
   * behind it (towards the foot rail), else in front of it. */
  private spotEight() {
    const ball = this.state.balls[8];
    for (let d = 0; d <= 2.5; d += 0.01)
      for (const z of [FOOT_SPOT.z - d, FOOT_SPOT.z + d]) {
        if (Math.abs(z) > POOL.halfZ - POOL.radius) continue;
        if (this.free(ball, 0, z)) {
          Object.assign(ball, { x: 0, z, vx: 0, vz: 0, sunk: false });
          return;
        }
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
