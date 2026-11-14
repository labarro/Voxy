import { gameClients } from "./games.app.harness";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { SOCIAL_EMOTES } from "../src/renderer/room3d/EmoteWheel";
async function main() {
  const h = await gameClients(2, "social-rooftop-app", 43189),
    { pages, root, focus } = h;
  try {
    await pages[1].evaluate(() =>
      window.voxy.onEvent((e) => {
        if (e.type === "room-pose") ((window as any).poses ??= []).push(e);
      }),
    );
    for (const emote of SOCIAL_EMOTES) {
      await focus(0);
      const canvas = pages[0].locator(".room3d canvas");
      await canvas.focus();
      await pages[0].keyboard.press("g");
      await pages[0]
        .getByRole("menu", { name: "Emotes e ações", exact: true })
        .waitFor();
      if (emote.id === "clap")
        await pages[0].screenshot({ path: join(root, "radial.png") });
      await pages[0]
        .getByRole("menuitem", { name: emote.label, exact: true })
        .click();
      await pages[1].waitForFunction(
        (id) => (window as any).poses?.some((e: any) => e.pose?.emote === id),
        emote.id,
      );
      await pages[0].waitForTimeout(200);
    }
    await focus(0);
    await pages[0].locator(".room3d canvas").focus();
    await pages[0].keyboard.press("g");
    await pages[0].keyboard.press("Escape");
    assert.equal(
      await pages[0]
        .getByRole("menu", { name: "Emotes e ações", exact: true })
        .count(),
      0,
    );
    await pages[0].evaluate(async () => {
      const r = (window as any).room,
        c = r.participants.find(
          (p: any) => p.id === (window as any).selfId,
        ).channelId;
      await window.voxy.command({
        type: "channel.room",
        id: c,
        preset: "rooftop",
      });
    });
    for (let i = 0; i < 2; i++) {
      await focus(i);
      await pages[i]
        .getByRole("region", { name: "Rooftop 3D", exact: true })
        .waitFor();
      await pages[i]
        .locator('.room3d canvas[data-ready="true"]')
        .waitFor({ timeout: 30000 });
      await pages[i].waitForTimeout(1500);
      await pages[i].screenshot({ path: join(root, `rooftop-${i}.png`) });
      assert(
        await pages[i]
          .getByText("Voz conectada", { exact: true })
          .first()
          .isVisible(),
      );
    }
    await focus(0);
    await pages[0].getByRole("button", { name: "Xadrez", exact: true }).click();
    await pages[0]
      .getByRole("region", { name: "Xadrez", exact: true })
      .waitFor({ timeout: 20000 });
    await pages[0].screenshot({ path: join(root, "rooftop-chess.png") });
    await pages[0]
      .getByRole("button", { name: "Sair da mesa", exact: true })
      .click();
    await pages[0].getByRole("button", { name: "Sinuca", exact: true }).click();
    await pages[0]
      .getByRole("button", { name: "Entrar na partida", exact: true })
      .click({ timeout: 20000 });
    await pages[0].screenshot({ path: join(root, "rooftop-pool.png") });
    assert.deepEqual(h.errors, []);
    await writeFile(
      join(root, "results.json"),
      JSON.stringify(
        {
          errors: h.errors,
          checks: [
            "two native clients",
            "all twelve radial actions synchronized",
            "keyboard opening and Escape cancellation",
            "Rooftop channel selection",
            "voice remains connected",
            "walk to Rooftop chess and pool",
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
