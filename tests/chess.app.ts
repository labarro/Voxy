import { gameClients } from "./games.app.harness";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { ChessView } from "../src/shared/chess";
import { tableCamera } from "../src/shared/gameTables";
import { chessSquare } from "../src/shared/chessMotion";
import * as T from "three";
async function main() {
  const h = await gameClients(2, "chess-app", 43188),
    { pages, root, focus } = h;
  try {
    for (let i = 0; i < 2; i++) {
      await focus(i);
      await pages[i]
        .getByRole("button", { name: "Xadrez", exact: true })
        .click();
      await pages[i]
        .getByRole("region", { name: "Xadrez", exact: true })
        .waitFor({ timeout: 30000 });
      await pages[i].waitForTimeout(1200);
      await pages[i].screenshot({ path: join(root, `seated-${i}.png`) });
    }
    const identities = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => {
          const r = (window as any).room;
          return r.participants.find(
            (p: any) => p.id === (window as any).selfId,
          )?.profile.id;
        }),
      ),
    );
    const snapshots = [];
    for (const [from, to] of [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ]) {
      const s = await pages[0].evaluate(
          () => (window as any).games.chess as ChessView,
        ),
        index = identities.indexOf(s.players[s.turn]),
        p = pages[index];
      await focus(index);
      await p.waitForTimeout(1000);
      const own = await p.evaluate(
          () => (window as any).games.chess as ChessView,
        ),
        box = (await p.locator(".room3d canvas").boundingBox())!,
        view = tableCamera("chess", s.turn),
        cam = new T.PerspectiveCamera(55, box.width / box.height, 0.12, 80);
      cam.position.set(view.position.x, view.position.y, view.position.z);
      cam.lookAt(view.target.x, view.target.y, view.target.z);
      cam.updateMatrixWorld(true);
      for (const square of [from, to]) {
        const target = chessSquare(square),
          point = new T.Vector3(target.x, 0.84, target.z).project(cam);
        await p.mouse.click(
          box.x + ((point.x + 1) * box.width) / 2,
          box.y + ((1 - point.y) * box.height) / 2,
        );
        if (square === from)
          await p.screenshot({ path: join(root, `select-${from}.png`) });
      }
      await p.waitForFunction(
        (rev) => (window as any).games.chess.revision !== rev,
        own.revision,
      );
      await p.waitForTimeout(350);
      await p.screenshot({ path: join(root, `move-${from}.png`) });
      const after = await p.evaluate(
        () => (window as any).games.chess as ChessView,
      );
      snapshots.push(after);
      await pages[1 - index].waitForFunction(
        (fen) => (window as any).games.chess.fen === fen,
        after.fen,
      );
    }
    const result = await pages[0].evaluate(
      () => (window as any).games.chess as ChessView,
    );
    assert.equal(result.phase, "finished");
    assert.equal(result.winner, 1);
    assert.deepEqual(h.errors, []);
    for (let i = 0; i < 2; i++)
      await pages[i].screenshot({ path: join(root, `final-${i}.png`) });
    await writeFile(
      join(root, "results.json"),
      JSON.stringify(
        {
          result,
          snapshots,
          errors: h.errors,
          checks: [
            "two Electron clients",
            "physical seat approach",
            "3D board picking",
            "legal-move highlights",
            "four-ply checkmate",
            "identical FEN on both clients",
          ],
        },
        null,
        2,
      ),
    );
    console.log(root);
  } catch (e) {
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({ path: join(root, `failure-${i}.png`) })
        .catch(() => {});
    throw e;
  } finally {
    await h.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
