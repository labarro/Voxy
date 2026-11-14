import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import * as T from "three";
import { POOL, type PoolState } from "../src/shared/pool";
import { chooseShot, placement } from "./pool.bot";
import assert from "node:assert/strict";
async function main() {
  const root = resolve("test-results", "pool-match-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    errors: string[] = [],
    shots: unknown[] = [];
  const focus = async (i: number) => {
    await apps[i].evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      w.focus();
    });
  };
  const project = async (page: Page, x: number, z: number) => {
    const canvas = page.locator(".room3d canvas");
    const box = (await canvas.boundingBox())!;
    const cam = new T.PerspectiveCamera(55, box.width / box.height, 0.12, 80);
    cam.position.set(
      POOL.x + Math.sin(1.1) * 3.3,
      4.5,
      POOL.z + Math.cos(1.1) * 3.3,
    );
    cam.lookAt(POOL.x, 1, POOL.z);
    cam.updateMatrixWorld(true);
    const p = new T.Vector3(
      POOL.x + x * POOL.scale,
      POOL.clothY,
      POOL.z + z * POOL.scale,
    ).project(cam);
    return {
      x: box.x + ((p.x + 1) * box.width) / 2,
      y: box.y + ((1 - p.y) * box.height) / 2,
    };
  };
  try {
    for (let i = 0; i < 2; i++) {
      const data = join(root, String(i));
      await mkdir(data, { recursive: true });
      await writeFile(
        join(data, "profile.json"),
        JSON.stringify({
          id: randomUUID(),
          name: i ? "Bruno" : "Ana",
          avatar: i ? "🦊" : "🌙",
          input: "",
          output: "",
          callSounds: false,
          room3d: {
            entry: "always",
            quality: "medium",
            proximity: true,
            range: 10,
            volume: 1,
            sensitivity: 1,
            names: true,
          },
        }),
      );
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      env.VOXY_DATA_DIR = data;
      const app = await electron.launch({
        args: [
          ".",
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
        ],
        env,
      });
      apps.push(app);
      const page = await app.firstWindow();
      pages.push(page);
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .getByRole("button", { name: "Configurações", exact: true })
        .waitFor();
      const notes = page.getByRole("button", { name: "Entendi, vamos lá" });
      if (await notes.count()) await notes.click();
      await page.evaluate(() =>
        window.voxy.onEvent((e) => {
          if (e.type === "room-pool") {
            (window as any).pool = e.game;
            ((window as any).packets ??= []).push(e.game);
          }
          if (e.type === "state") (window as any).room = e.state;
        }),
      );
    }
    const [a, b] = pages;
    const host = await a.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43186,
        name: "Sinuca completa",
      }),
    );
    await b.evaluate((invite) => window.voxy.connect(invite), host.invite);
    await a.evaluate(async () => {
      const state = await new Promise<any>((resolve) => {
        const off = window.voxy.onEvent((e) => {
          if (e.type === "state") {
            off();
            resolve(e.state);
          }
        });
        void window.voxy.command({
          type: "status",
          muted: false,
          deafened: false,
          sharing: false,
        });
      });
      const c = state.channels.find((c: any) => c.kind === "voice");
      await window.voxy.command({
        type: "channel.room",
        id: c.id,
        preset: "lounge",
      });
    });
    for (let i = 0; i < 2; i++) {
      await focus(i);
      const p = pages[i];
      await p
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
      await p
        .locator('.room3d canvas[data-ready="true"]')
        .waitFor({ timeout: 30000 });
      await p.getByRole("button", { name: "Sinuca", exact: true }).click();
      await p
        .getByRole("button", { name: "Entrar na partida", exact: true })
        .click({ timeout: 20000 });
    }
    await a.waitForFunction(() => (window as any).pool?.phase === "aiming");
    for (let n = 0; n < 40; n++) {
      let state = await a.evaluate(() => (window as any).pool as PoolState);
      if (state.phase === "finished") break;
      const index = await a.evaluate(
        (id) =>
          (window as any).room.participants.find((p: any) => p.id === id)
            ?.profile.name === "Ana"
            ? 0
            : 1,
        state.players[state.turn],
      );
      const p = pages[index];
      await focus(index);
      await p.waitForTimeout(1300);
      if (state.phase === "placing") {
        const point = placement(state),
          screen = await project(p, point.x, point.z);
        await p.mouse.click(screen.x, screen.y);
        await p.waitForFunction(() => (window as any).pool?.phase === "aiming");
        state = await p.evaluate(() => (window as any).pool);
      }
      const input = chooseShot(state);
      await p
        .getByLabel("Força da tacada")
        .fill(String(Math.round(input.power * 100)));
      // First aim by pointing at the actual cloth; then use the fine keyboard
      // adjustment for a repeatable full-match physics regression.
      if (n === 0) {
        const cue = state.balls[0],
          screen = await project(
            p,
            cue.x + Math.sin(input.angle) * 0.5,
            cue.z - Math.cos(input.angle) * 0.5,
          );
        await p.mouse.move(screen.x, screen.y);
        await p.waitForTimeout(250);
      }
      await p
        .getByLabel("Direção da tacada")
        .fill(
          (Math.round(((input.angle * 180) / Math.PI) * 100) / 100).toString(),
        );
      await p
        .getByRole("button", { name: "Dar tacada", exact: true })
        .waitFor();
      await p
        .getByRole("button", { name: "Dar tacada", exact: true })
        .click({ timeout: 20000 });
      await p.waitForFunction(
        () => (window as any).pool?.phase === "preparing",
      );
      await p.waitForTimeout(450);
      await p.screenshot({ path: join(root, `preparation-${n}.png`) });
      await p.waitForFunction(
        () =>
          ["aiming", "placing", "finished"].includes(
            (window as any).pool?.phase,
          ),
        {},
        { timeout: 30000 },
      );
      const result = await p.evaluate(() => (window as any).pool as PoolState);
      await pages[1 - index].waitForFunction(
        (rev) => (window as any).pool?.revision === rev,
        result.revision,
      );
      assert.deepEqual(
        await pages[1 - index].evaluate(() => (window as any).pool),
        result,
      );
      shots.push({ input, result });
      console.log("Shot", n + 1, result.phase, result.scores);
    }
    const result = await a.evaluate(() => (window as any).pool as PoolState);
    assert.equal(result.phase, "finished");
    assert.equal(
      result.scores.reduce((x, y) => x + y, 0),
      7,
    );
    assert.deepEqual(errors, []);
    for (let i = 0; i < 2; i++) {
      await focus(i);
      await pages[i].screenshot({ path: join(root, `final-${i}.png`) });
    }
    await writeFile(
      join(root, "results.json"),
      JSON.stringify(
        {
          errors,
          shots,
          winner: result.winner,
          scores: result.scores,
          checks: [
            "two real Electron clients",
            "complete seven-ball match",
            "physical mouse aim",
            "keyboard fine aim",
            "windup before impulse",
            "legal ball-in-hand placement by clicking cloth",
            "identical authoritative snapshots after every shot",
            "winning result",
          ],
        },
        null,
        2,
      ),
    );
    console.log("Complete in-app pool match passed", root);
  } catch (e) {
    await writeFile(
      join(root, "failure-state.json"),
      JSON.stringify(
        await Promise.all(
          pages.map((p) =>
            p.evaluate(() => {
              let fiber = document.querySelector(".room3d") as any;
              fiber =
                fiber?.[
                  Object.keys(fiber).find((k) => k.startsWith("__reactFiber"))!
                ];
              for (let n = 0; fiber && n < 20; n++, fiber = fiber.return) {
                for (let h = fiber.memoizedState; h; h = h.next) {
                  const s = h.memoizedState?.current;
                  if (s?.pose && s?.models) {
                    const avatar = s.models.get(s.self)?.avatar;
                    return {
                      pose: s.pose,
                      route: s.route,
                      target: s.stanceTarget,
                      angle: s.poolAngle,
                      stroke: s.stroke({
                        ...s.data.pool,
                        shot: undefined,
                        aim: {
                          actor: s.self,
                          angle: s.poolAngle,
                          power: s.poolPower,
                        },
                      }),
                      errors: avatar?.handErrors,
                      aligned: avatar?.poolAligned,
                      pool: s.data.pool,
                      draw: s.drawPool,
                    };
                  }
                }
              }
              return null;
            }),
          ),
        ),
        null,
        2,
      ),
    );
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({ path: join(root, `failure-${i}.png`) })
        .catch(() => {});
    throw e;
  } finally {
    for (const app of apps) await app.close().catch(() => {});
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
