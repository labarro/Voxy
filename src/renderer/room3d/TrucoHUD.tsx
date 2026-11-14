import { useState } from "react";
import type { TrucoAction, TrucoView } from "../../shared/truco";
import type { Participant } from "../../shared/types";
export function TrucoHUD({
  game,
  self,
  people,
  act,
  leave,
  covered,
}: {
  game: TrucoView;
  self: string;
  people: Participant[];
  act: (a: TrucoAction) => Promise<unknown>;
  leave: () => void;
  covered: (v: boolean) => void;
}) {
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [faceDown, setFaceDown] = useState(false);
  const seat = game.players.indexOf(self),
    team = seat % 2,
    respond = game.phase === "responding" && game.pending?.team !== team;
  const action = async (a: TrucoAction) => {
    setPending(true);
    try {
      await act(a);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const name = (index: number) =>
    people.find((p) => p.profile.id === game.players[index])?.profile.name ??
    `Assento ${index + 1}`;
  return (
    <section
      className="table-game-hud"
      aria-label="Truco Paulista"
      data-phase={game.phase}
    >
      <header>
        <strong>Truco Paulista</strong>
        <span>
          Dupla {team + 1} · {game.scores[0]} : {game.scores[1]}
        </span>
        <button onClick={leave}>Sair da mesa</button>
      </header>
      <p role="status">
        {game.paused
          ? "Partida pausada para reconexão."
          : game.phase === "playing"
            ? `${name(game.turn)} joga · mão vale ${game.value}`
            : game.message}
      </p>
      {game.phase === "waiting" ? (
        <p>
          {game.players.filter(Boolean).length}/4 jogadores · seu parceiro senta
          à frente.
        </p>
      ) : (
        <p className="table-game-hint">
          Clique numa carta na sua mão para jogar{game.iron ? " no escuro" : ""}
          .
        </p>
      )}
      <div className="table-game-controls" inert={pending || game.paused}>
        {(respond ||
          (game.phase === "playing" &&
            game.turn === seat &&
            !game.iron &&
            game.eleven === undefined &&
            game.value < 12 &&
            game.lastRaiseTeam !== team)) && (
          <button onClick={() => void action({ type: "raise" })}>
            {respond
              ? game.pending!.requested === 12
                ? "Limite: doze"
                : `Aumentar para ${[3, 6, 9, 12][[3, 6, 9, 12].indexOf(game.pending!.requested) + 1]}`
              : game.value === 1
                ? "Pedir truco"
                : `Pedir ${[3, 6, 9, 12][[1, 3, 6, 9].indexOf(game.value)]}`}
          </button>
        )}
        {respond && (
          <>
            <button onClick={() => void action({ type: "accept" })}>
              Aceitar {game.pending!.requested}
            </button>
            <button onClick={() => void action({ type: "fold" })}>
              Correr · ceder {game.pending!.previous}
            </button>
          </>
        )}
        {game.phase === "eleven" && game.eleven === team && (
          <>
            <button
              disabled={game.elevenVotes.includes(seat)}
              onClick={() => void action({ type: "eleven", accept: true })}
            >
              Jogar por 3
            </button>
            <button
              onClick={() => void action({ type: "eleven", accept: false })}
            >
              Correr · ceder 1
            </button>
          </>
        )}
        {game.phase === "playing" && game.trick > 0 && !game.iron && (
          <label>
            <input
              type="checkbox"
              checked={faceDown}
              onChange={(e) => {
                setFaceDown(e.target.checked);
                covered(e.target.checked);
              }}
            />
            Jogar coberta
          </label>
        )}
        {game.phase === "finished" && (
          <button onClick={() => void action({ type: "restart" })}>
            Nova partida
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
