import { gameClients } from "./games.app.harness";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { TrucoView } from "../src/shared/truco";
import { tableSeat, GAME_TABLES, tableCamera } from "../src/shared/gameTables";
import { cardMotion } from "../src/shared/cardMotion";
import * as T from "three";
async function main() {
  const h = await gameClients(4, "truco-app", 43187),
    { pages, root, focus } = h;
  try {
    for (let i = 0; i < 4; i++) {
      await focus(i);
      await pages[i]
        .getByRole("button", { name: "Truco Paulista", exact: true })
        .click();
      await pages[i]
        .getByRole("region", { name: "Truco Paulista", exact: true })
        .waitFor({ timeout: 30000 });
      await pages[i].screenshot({ path: join(root, `seated-${i}.png`) });
    }
    await pages[0].waitForFunction(
      () => (window as any).games?.truco?.phase === "playing",
      {},
      { timeout: 15000 },
    );
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
    const read = () =>
      pages[0].evaluate(() => (window as any).games.truco as TrucoView);
    for (let n = 0; n < 4000; n++) {
      const s = await read();
      if (s.phase === "finished") break;
      if (["dealing", "trick-result", "hand-result"].includes(s.phase)) {
        await pages[0].waitForTimeout(250);
        continue;
      }
      if (s.actionAt > s.clock) {
        await pages[0].waitForTimeout(100);
        continue;
      }
      const index = identities.indexOf(s.players[s.turn]),
        p = pages[index];
      await focus(index);
      if (s.phase === "responding") {
        const receiver = identities.indexOf(s.players[1 - s.pending!.team]);
        await pages[receiver]
          .getByRole("button", {
            name: `Aceitar ${s.pending!.requested}`,
            exact: true,
          })
          .click();
        continue;
      }
      if (s.phase === "eleven") {
        for (const seat of [s.eleven!, s.eleven! + 2])
          await pages[identities.indexOf(s.players[seat])]
            .getByRole("button", { name: "Jogar por 3", exact: true })
            .click();
        continue;
      }
      await p.waitForTimeout(250);
      const own = await p.evaluate(
        () => (window as any).games.truco as TrucoView,
      );
      assert.equal(own.hand.length, own.counts[s.turn]);
      assert.equal(own.partnerHand, undefined);
      if (own.revision !== s.revision) continue;
      if (
        s.value === 1 &&
        s.played[0].length === 0 &&
        !s.iron &&
        s.eleven === undefined
      ) {
        await p
          .getByRole("button", { name: "Pedir truco", exact: true })
          .click();
        await pages[0].waitForFunction(
          (rev) => (window as any).games.truco.revision !== rev,
          s.revision,
        );
        continue;
      }
      const box = (await p.locator(".room3d canvas").boundingBox())!,
        view = tableCamera("truco", s.turn),
        cam = new T.PerspectiveCamera(55, box.width / box.height, 0.12, 80);
      cam.position.set(view.position.x, view.position.y, view.position.z);
      cam.lookAt(view.target.x, view.target.y, view.target.z);
      cam.updateMatrixWorld(true);
      const target = cardMotion(own, s.turn, own.clock).left,
        point = new T.Vector3(target.x, target.y, target.z).project(cam);
      await p.mouse.click(
        box.x + ((point.x + 1) * box.width) / 2,
        box.y + ((1 - point.y) * box.height) / 2,
      );
      await p.waitForFunction(
        (revision) => (window as any).games.truco.revision !== revision,
        own.revision,
        { timeout: 4000 },
      );
      if (n < 4) await p.screenshot({ path: join(root, `play-${n}.png`) });
    }
    const result = await read();
    assert.equal(result.phase, "finished");
    assert.deepEqual(h.errors, []);
    await writeFile(
      join(root, "results.json"),
      JSON.stringify(
        {
          result,
          errors: h.errors,
          checks: [
            "four Electron clients",
            "physical seat approach",
            "3D card picking",
            "complete match",
          ],
        },
        null,
        2,
      ),
    );
    console.log(root);
  } catch (e) {
    for (let i = 0; i < 4; i++)
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
