import { useState } from "react";
import type { ChessAction, ChessView } from "../../shared/chess";
export function ChessHUD({
  game,
  self,
  act,
  leave,
  promote,
}: {
  game: ChessView;
  self: string;
  act: (a: ChessAction) => Promise<unknown>;
  leave: () => void;
  promote: (v: "q" | "r" | "b" | "n") => void;
}) {
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [choice, setChoice] = useState(""),
    [promotion, setPromotion] = useState<"q" | "r" | "b" | "n">("q");
  const own = game.players.indexOf(self),
    action = async (a: ChessAction) => {
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
  return (
    <section
      className="table-game-hud"
      aria-label="Xadrez"
      data-phase={game.phase}
    >
      <header>
        <strong>Xadrez</strong>
        <span>
          {own === 0 ? "Você joga de brancas" : "Você joga de pretas"}
        </span>
        <button onClick={leave}>Sair da mesa</button>
      </header>
      <p role="status">
        {game.paused
          ? "Aguardando reconexão."
          : game.phase === "playing"
            ? `${game.turn === 0 ? "Brancas" : "Pretas"} jogam${game.check ? " · Xeque" : ""}`
            : game.message}
      </p>
      <div className="table-game-controls" inert={pending || game.paused}>
        {game.phase === "playing" && (
          <>
            <label>
              Promoção{" "}
              <select
                aria-label="Peça da promoção"
                value={promotion}
                onChange={(e) => {
                  const value = e.target.value as typeof promotion;
                  setPromotion(value);
                  promote(value);
                }}
              >
                <option value="q">♕ Dama</option>
                <option value="r">♖ Torre</option>
                <option value="b">♗ Bispo</option>
                <option value="n">♘ Cavalo</option>
              </select>
            </label>
            {game.last?.actor === own &&
              game.offer === undefined &&
              game.turn !== own && (
                <button onClick={() => void action({ type: "offer" })}>
                  Oferecer empate
                </button>
              )}
            {game.offer !== undefined && game.offer !== own && (
              <>
                <button onClick={() => void action({ type: "accept" })}>
                  Aceitar empate
                </button>
                <button onClick={() => void action({ type: "decline" })}>
                  Continuar jogando
                </button>
              </>
            )}
            {game.claim && (
              <button onClick={() => void action({ type: "claim" })}>
                Reivindicar empate
              </button>
            )}
            {game.claimMoves.length > 0 && !game.claim && (
              <>
                <select
                  aria-label="Lance para reivindicar empate"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="">Empate após lance…</option>
                  {game.claimMoves.map((m) => (
                    <option
                      key={m.from + m.to + m.promotion}
                      value={JSON.stringify(m)}
                    >
                      {m.from}–{m.to} {m.promotion ?? ""}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!choice}
                  onClick={() =>
                    void action({ type: "claim", move: JSON.parse(choice) })
                  }
                >
                  Reivindicar
                </button>
              </>
            )}
            <button onClick={() => void action({ type: "resign" })}>
              Desistir
            </button>
          </>
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
