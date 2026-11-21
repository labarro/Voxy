import { useState } from "react";
import { Crosshair, LogOut, X, RotateCcw, Hand, Trophy } from "lucide-react";
import {
  newPool,
  poolMode,
  onEight,
  groupOf,
  ballColor,
  pockets,
  POCKET_NAMES,
  GROUP_NAMES,
  type PoolMode,
  type PoolState,
} from "../../shared/pool";
import type { Command, Participant } from "../../shared/types";

const MODES: { id: PoolMode; label: string }[] = [
  { id: "rotation", label: "Rotação 7" },
  { id: "eight", label: "Bola 8" },
];
function Chip({ id }: { id: number }) {
  const color = ballColor(id),
    stripe = groupOf(id) === "stripes";
  return (
    <span
      className={"pool-chip" + (stripe ? " stripe" : "")}
      style={{ ["--ball" as string]: color }}
      aria-label={`Bola ${id}`}
    >
      {id}
    </span>
  );
}
// Control strip and match summary. Picking, aiming, cue placement, balls and
// the scoreboard live in the Three.js scene, not in an HTML copy of the table.
export function PoolPanel({
  game,
  people,
  self,
  command,
  close,
  angle = 0,
  ready = false,
  aim,
  shoot,
}: {
  game?: PoolState;
  people: Participant[];
  self: string;
  command: (c: Command) => Promise<unknown>;
  close: () => void;
  angle?: number;
  ready?: boolean;
  aim: (angle: number, power: number, spin?: number) => void;
  shoot: () => Promise<unknown>;
}) {
  const s = game ?? newPool(),
    mode = poolMode(s),
    eight = mode === "eight",
    [power, setPower] = useState(0.55),
    [spin, setSpin] = useState(0),
    [wanted, setWanted] = useState<PoolMode>(mode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const name = (id?: string) =>
    (id && people.find((p) => p.id === id)?.profile.name) || "Jogador";
  const member = s.players.includes(self),
    myTurn = s.players[s.turn] === self,
    playing = s.phase !== "waiting" && s.phase !== "finished",
    mustCall = eight && member && myTurn && onEight(s),
    chooseMode =
      (member && !playing) || (!member && s.players.length === 0),
    shownMode = member ? mode : s.players.length ? mode : wanted;
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const status =
    s.phase === "finished"
      ? s.winner
        ? "Vencedor: " + name(s.winner)
        : "Partida encerrada"
      : s.phase === "waiting"
        ? "Aguardando outro jogador"
        : myTurn
          ? "Sua vez"
          : "Vez de " + name(s.players[s.turn]);
  const remaining = (filter: (id: number) => boolean) =>
    s.balls.filter((b) => b.id && !b.sunk && filter(b.id)).map((b) => b.id);
  const openTable = eight && !s.opening && !s.groups?.some(Boolean);
  return (
    <aside className="game-hud pool-hud" aria-label="Mesa de sinuca">
      <div className="game-hud-title">
        <Crosshair size={18} />
        <div>
          <strong>{eight ? "Bola 8" : "Rotação 7"}</strong>
          <span role="status">{status}</span>
          {!member && s.players.length === 2 && (
            <em className="pool-tag">Assistindo</em>
          )}
        </div>
        <button
          aria-label="Fechar sinuca"
          onClick={() =>
            void run(async () => {
              if (member) await command({ type: "pool.leave" });
              close();
            })
          }
        >
          <X size={17} />
        </button>
      </div>
      {chooseMode && (
        <div className="pool-modes" role="group" aria-label="Modo de jogo">
          <span>{s.phase === "finished" ? "Próxima partida" : "Modo"}</span>
          {MODES.map((m) => (
            <button
              key={m.id}
              aria-pressed={shownMode === m.id}
              disabled={busy}
              title={
                s.phase === "finished" && s.players.length === 2 && m.id !== mode
                  ? "Inicia uma nova partida neste modo"
                  : undefined
              }
              onClick={() => {
                if (!member) setWanted(m.id);
                else if (m.id !== mode || s.phase === "finished")
                  void run(() => command({ type: "pool.mode", mode: m.id }));
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div className="pool-players">
        {[0, 1].map((i) => {
          const id = s.players[i],
            group = s.groups?.[i],
            active = playing && s.turn === i;
          return (
            <div
              key={i}
              className={
                "pool-player" +
                (active ? " active" : "") +
                (s.winner && s.winner === id ? " winner" : "")
              }
            >
              <div className="pool-player-head">
                <i aria-hidden="true" />
                <b>{id ? name(id) + (id === self ? " (você)" : "") : "Lugar livre"}</b>
                {s.winner && s.winner === id && <Trophy size={13} />}
              </div>
              <div className="pool-player-meta">
                {eight ? (
                  <span>{group ? GROUP_NAMES[group] : "Mesa aberta"}</span>
                ) : (
                  <span>
                    {s.scores[i] ?? 0} {s.scores[i] === 1 ? "ponto" : "pontos"}
                  </span>
                )}
                <span>
                  Faltas <b>{s.fouls?.[i] ?? 0}</b>
                </span>
              </div>
              {eight && group && (
                <div className="pool-chips">
                  {remaining((b) => groupOf(b) === group).map((b) => (
                    <Chip key={b} id={b} />
                  ))}
                  {!remaining((b) => groupOf(b) === group).length && (
                    <>
                      <Chip id={8} />
                      <small>bola 8</small>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(openTable || (!eight && s.phase !== "waiting")) && (
        <div className="pool-chips pool-chips-table" aria-label="Bolas na mesa">
          {remaining((b) => b !== 8 || !eight).map((b) => (
            <Chip key={b} id={b} />
          ))}
        </div>
      )}
      <p className="pool-message">
        {s.phase === "placing" && (
          <span className="pool-badge">
            <Hand size={13} />
            Bola na mão
            {s.ballInHand === "kitchen"
              ? " · atrás da linha de cabeceira"
              : eight
                ? " · qualquer lugar"
                : ""}
          </span>
        )}
        {s.called !== undefined && playing && (
          <span className="pool-badge gold">
            8 na caçapa {POCKET_NAMES[s.called].toLowerCase()}
          </span>
        )}
        <span>{s.message}</span>
      </p>
      {mustCall && (s.phase === "aiming" || s.phase === "placing") && (
        <div className="pool-call">
          <div className="pool-call-table" role="group" aria-label="Anunciar caçapa da bola 8">
            {pockets.map((p, i) => (
              <button
                key={i}
                aria-pressed={s.called === i}
                aria-label={"Anunciar " + POCKET_NAMES[i]}
                title={POCKET_NAMES[i]}
                disabled={busy}
                style={{
                  left: p.x < 0 ? "0%" : "100%",
                  top: `${((p.z / Math.abs(pockets[2].z) + 1) / 2) * 100}%`,
                }}
                onClick={() =>
                  void run(() =>
                    command({ type: "pool.call", pocket: i, revision: s.revision }),
                  )
                }
              />
            ))}
            <span>pé</span>
            <span>cabeceira</span>
          </div>
          <span className="game-hud-hint">
            {s.called === undefined
              ? "Bola 8: escolha a caçapa antes da tacada. Encaçapar em outra caçapa perde a partida."
              : "Caçapa anunciada. Você pode trocar até dar a tacada."}
          </span>
        </div>
      )}
      <div className="game-hud-body">
        {!member && s.players.length < 2 && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(() =>
                command(
                  s.players.length
                    ? { type: "pool.join" }
                    : { type: "pool.join", mode: wanted },
                ),
              )
            }
          >
            Entrar na partida
          </button>
        )}
        {member && myTurn && s.phase === "aiming" && (
          <>
            <span className="game-hud-hint">
              {ready
                ? "Clique ou arraste no feltro para mirar. Solte para fixar; Espaço/Enter dá a tacada e Esc desfaz a mira."
                : "Caminhando para a posição…"}
            </span>
            <label>
              Direção
              <input
                aria-label="Direção da tacada"
                type="range"
                min={-180}
                max={180}
                step={0.01}
                value={(angle * 180) / Math.PI}
                onChange={(e) =>
                  aim((+e.target.value * Math.PI) / 180, power, spin)
                }
              />
            </label>
            <label>
              Força <b>{Math.round(power * 100)}%</b>
              <input
                aria-label="Força da tacada"
                type="range"
                min={5}
                max={100}
                value={power * 100}
                onChange={(e) => {
                  setPower(+e.target.value / 100);
                  aim(angle, +e.target.value / 100, spin);
                }}
              />
            </label>
            <label>
              Efeito{" "}
              <b>
                {spin === 0
                  ? "nenhum"
                  : `${spin < 0 ? "puxar" : "seguir"} ${Math.round(Math.abs(spin) * 100)}%`}
              </b>
              <input
                aria-label="Efeito na branca"
                type="range"
                min={-100}
                max={100}
                step={10}
                value={spin * 100}
                onChange={(e) => {
                  setSpin(+e.target.value / 100);
                  aim(angle, power, +e.target.value / 100);
                }}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !ready || (mustCall && s.called === undefined)}
              onClick={() => void run(shoot)}
            >
              Dar tacada
            </button>
          </>
        )}
        {member && myTurn && s.phase === "placing" && (
          <span className="game-hud-hint">
            {s.ballInHand === "kitchen"
              ? "Clique na área destacada, atrás da linha de cabeceira, para colocar a branca."
              : "Reposição: clique em um espaço livre do feltro para colocar a branca."}
          </span>
        )}
        {member && !myTurn && playing && (
          <span className="game-hud-hint">Aguarde a tacada de {name(s.players[s.turn])}.</span>
        )}
        {(s.phase === "preparing" || s.phase === "rolling") && (
          <span className="game-hud-hint">
            {s.phase === "preparing"
              ? "Preparando a tacada…"
              : "Acompanhe as bolas na mesa"}
          </span>
        )}
        {s.phase === "finished" && member && s.players.length === 2 && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => command({ type: "pool.restart" }))}
          >
            <RotateCcw size={16} />
            Revanche
          </button>
        )}
        {member && (
          <button
            className="pool-leave"
            title="Sair da partida"
            aria-label="Sair da partida"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await command({ type: "pool.leave" });
                close();
              })
            }
          >
            <LogOut size={16} />
            Sair
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="game-hud-error">
          {error}
        </p>
      )}
    </aside>
  );
}
