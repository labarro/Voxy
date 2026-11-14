import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
export async function gameClients(count: number, label: string, port: number) {
  const root = resolve("test-results", label + "-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    errors: string[] = [];
  const focus = async (i: number) =>
    apps[i].evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      w.focus();
    });
  const close = async () => {
    for (const app of apps) await app.close().catch(() => {});
  };
  try {
    for (let i = 0; i < count; i++) {
      const data = join(root, String(i));
      await mkdir(data, { recursive: true });
      await writeFile(
        join(data, "profile.json"),
        JSON.stringify({
          id: randomUUID(),
          name: ["Ana", "Bruno", "Cris", "Davi"][i],
          avatar: "🌙",
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
      const p = await app.firstWindow();
      pages.push(p);
      p.on("pageerror", (e) => errors.push(e.message));
      await p
        .getByRole("button", { name: "Configurações", exact: true })
        .waitFor();
      const notes = p.getByRole("button", { name: "Entendi, vamos lá" });
      if (await notes.count()) await notes.click();
      await p.evaluate(() =>
        window.voxy.onEvent((e) => {
          if (e.type === "connection" && e.selfId)
            (window as any).selfId = e.selfId;
          if (e.type === "state") {
            (window as any).room = e.state;
            const c = e.state.participants.find(
              (p) => p.id === (window as any).selfId,
            )?.channelId;
            if (c) (window as any).games = e.state.socialGames?.[c];
          }
          if (e.type === "room-games") {
            (window as any).games = e.games;
            ((window as any).packets ??= []).push(e.games);
          }
        }),
      );
    }
    const host = await pages[0].evaluate(
      (port) =>
        window.voxy.host({
          address: "127.0.0.1",
          port,
          name: "Social & Games",
        }),
      port,
    );
    for (const p of pages.slice(1))
      await p.evaluate((invite) => window.voxy.connect(invite), host.invite);
    await pages[0].evaluate(async () => {
      const state = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(Error("No state after status"));
        }, 5000);
        const off = window.voxy.onEvent((e) => {
          if (e.type === "state") {
            clearTimeout(timer);
            off();
            resolve(e.state);
          }
        });
        void window.voxy
          .command({
            type: "status",
            muted: false,
            deafened: false,
            sharing: false,
          })
          .catch(reject);
      });
      const c = state.channels.find((c: any) => c.kind === "voice");
      await window.voxy.command({
        type: "channel.room",
        id: c.id,
        preset: "lounge",
      });
    });
    for (let i = 0; i < count; i++) {
      await focus(i);
      await pages[i]
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
      await pages[i]
        .locator('.room3d canvas[data-ready="true"]')
        .waitFor({ timeout: 30000 });
    }
    return { root, apps, pages, errors, focus, close };
  } catch (e) {
    await close();
    throw e;
  }
}
