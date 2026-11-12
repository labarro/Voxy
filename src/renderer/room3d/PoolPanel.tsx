import { useState } from "react";
import { newPool, POOL, pockets, type PoolState } from "../../shared/pool";
import type { Command, Participant } from "../../shared/types";

export function PoolPanel({
  game,
  people,
  self,
  command,
  close,
}: {
  game?: PoolState;
  people: Participant[];
  self: string;
  command: (c: Command) => Promise<unknown>;
  close: () => void;
}) {
  const s = game ?? newPool();
  const [angle, setAngle] = useState(0),
    [power, setPower] = useState(0.55),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const name = (id: string) =>
    people.find((p) => p.id === id)?.profile.name ?? "Jogador";
  const send = async (c: Command) => {
    setBusy(true);
    setError("");
    try {
      await command(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ação indisponível.");
    } finally {
      setBusy(false);
    }
  };
  const cue = s.balls[0],
    myTurn = s.phase === "aiming" && s.players[s.turn] === self;
  return (
    <aside className="pool-panel" aria-label="Mesa de sinuca">
      <header>
        <strong>Sinuca · Rotação 7</strong>
        <button aria-label="Fechar sinuca" onClick={close}>
          ×
        </button>
      </header>
      <p role="status">
        {s.phase === "finished"
          ? `Vencedor: ${name(s.winner!)}`
          : s.players.length === 2
            ? `Vez de ${name(s.players[s.turn])}`
            : "Convide alguém para a mesa"}
      </p>
      <p>
        Próxima bola:{" "}
        {Math.min(...s.balls.filter((b) => b.id && !b.sunk).map((b) => b.id)) <
        Infinity
          ? Math.min(...s.balls.filter((b) => b.id && !b.sunk).map((b) => b.id))
          : "—"}
      </p>
      <div className="pool-scores">
        {s.players.map((id, i) => (
          <span key={id}>
            {name(id)} <b>{s.scores[i]}</b>
          </span>
        ))}
      </div>
      <svg
        className="pool-board"
        viewBox="-1.55 -2.6 3.1 5.2"
        aria-label="Mira da sinuca. Toque na mesa para mirar."
        onClick={(e) => {
          if (!myTurn) return;
          const point = e.currentTarget.createSVGPoint();
          point.x = e.clientX;
          point.y = e.clientY;
          const matrix = e.currentTarget.getScreenCTM();
          if (!matrix) return;
          const local = point.matrixTransform(matrix.inverse());
          setAngle(Math.atan2(local.x - cue.x, -(local.y - cue.z)));
        }}
      >
        <rect
          x="-1.5"
          y="-2.55"
          width="3"
          height="5.1"
          rx=".12"
          fill="#926c4a"
        />
        <rect
          x={-POOL.halfX}
          y={-POOL.halfZ}
          width="2.5"
          height="4.6"
          fill="#377b70"
        />
        {pockets.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.z} r={POOL.pocket} fill="#142e2a" />
        ))}
        {myTurn && (
          <line
            x1={cue.x}
            y1={cue.z}
            x2={cue.x + Math.sin(angle) * 2}
            y2={cue.z - Math.cos(angle) * 2}
            stroke="#f5e9cd"
            strokeWidth=".018"
            strokeDasharray=".07 .06"
          />
        )}
        {s.balls
          .filter((b) => !b.sunk)
          .map((b) => (
            <g key={b.id}>
              <circle
                cx={b.x}
                cy={b.z}
                r=".09"
                fill={b.id ? "#e8b661" : "#f0ece0"}
              />
              {b.id > 0 && (
                <text
                  x={b.x}
                  y={b.z + 0.035}
                  fontSize=".1"
                  textAnchor="middle"
                  fill="#292735"
                >
                  {b.id}
                </text>
              )}
            </g>
          ))}
      </svg>
      <p className="pool-message">{s.message}</p>
      {myTurn && (
        <>
          <label>
            Direção{" "}
            <input
              aria-label="Direção da tacada"
              type="range"
              min={-180}
              max={180}
              value={Math.round((angle * 180) / Math.PI)}
              onChange={(e) => setAngle((+e.target.value * Math.PI) / 180)}
            />
          </label>
          <label>
            Força {Math.round(power * 100)}%
            <input
              aria-label="Força da tacada"
              type="range"
              min=".05"
              max="1"
              step=".01"
              value={power}
              onChange={(e) => setPower(+e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void send({
                type: "pool.shoot",
                angle,
                power,
                revision: s.revision,
              })
            }
          >
            Dar tacada
          </button>
        </>
      )}
      {!s.players.includes(self) && s.players.length < 2 && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => void send({ type: "pool.join" })}
        >
          Entrar na partida
        </button>
      )}
      {s.players.includes(self) && (
        <button
          disabled={busy}
          onClick={() => void send({ type: "pool.leave" })}
        >
          Sair da partida
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Como jogar</summary>
        <p>
          Acerte primeiro a menor bola. Cada bola vale um ponto e mantém a vez.
          Sem encaçapar, passa a vez. Encaçapar a branca ou tocar outra bola
          primeiro é falta: as bolas dessa tacada voltam e a vez passa. Sete
          bolas definem o vencedor. Sair reinicia a partida.
        </p>
      </details>
    </aside>
  );
}
