import { useState } from "react";
import { Crosshair, LogOut, X, RotateCcw } from "lucide-react";
import { newPool, type PoolState } from "../../shared/pool";
import type { Command, Participant } from "../../shared/types";
// This is only the control strip. Picking, aiming, cue placement, balls and the
// scoreboard live in the Three.js scene, not in an HTML copy of the table.
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
  aim: (angle: number, power: number) => void;
  shoot: () => Promise<unknown>;
}) {
  const s = game ?? newPool(),
    [power, setPower] = useState(0.55),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const name = (id: string) =>
    people.find((p) => p.id === id)?.profile.name ?? "Jogador";
  const myTurn = s.players[s.turn] === self,
    member = s.players.includes(self);
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
  return (
    <aside className="game-hud pool-hud" aria-label="Mesa de sinuca">
      <div className="game-hud-title">
        <Crosshair size={18} />
        <div>
          <strong>Rotação 7</strong>
          <span role="status">
            {s.phase === "finished"
              ? "Vencedor: " + name(s.winner!)
              : s.phase === "waiting"
                ? "Aguardando outro jogador"
                : myTurn
                  ? "Sua vez"
                  : "Vez de " + name(s.players[s.turn])}
          </span>
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
      <div className="game-hud-body">
        {!member && s.players.length < 2 && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => command({ type: "pool.join" }))}
          >
            Entrar na partida
          </button>
        )}
        {member && myTurn && s.phase === "aiming" && (
          <>
            <span className="game-hud-hint">
              {ready
                ? "Mire no feltro com o mouse"
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
                onChange={(e) => aim((+e.target.value * Math.PI) / 180, power)}
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
                  aim(angle, +e.target.value / 100);
                }}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !ready}
              onClick={() => void run(shoot)}
            >
              Dar tacada
            </button>
          </>
        )}
        {member && myTurn && s.phase === "placing" && (
          <span className="game-hud-hint">
            Reposição: clique em um espaço livre do feltro para colocar a
            branca.
          </span>
        )}
        {(s.phase === "preparing" || s.phase === "rolling") && (
          <span className="game-hud-hint">
            {s.phase === "preparing"
              ? "Preparando a tacada…"
              : "Acompanhe as bolas na mesa"}
          </span>
        )}
        {s.phase === "finished" && member && (
          <button
            disabled={busy}
            onClick={() => void run(() => command({ type: "pool.restart" }))}
          >
            <RotateCcw size={16} />
            Jogar novamente
          </button>
        )}
        {member && (
          <button
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
            <LogOut size={17} />
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
