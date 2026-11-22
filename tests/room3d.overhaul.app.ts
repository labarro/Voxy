import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

// Voxy 1.6 overhaul in two real Electron processes and the real host: new
// skinned avatars, bar interaction, holding/drinking/toasting synchronized to
// the other participant, stools, and captures of the three rebuilt rooms.
async function main() {
  const packed = process.argv.includes("--packaged");
  let executablePath: string | undefined;
  if (packed) {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    const { directory } = JSON.parse(
      await readFile(`release/${version}/latest-build.json`, "utf8"),
    );
    executablePath = join(directory, "win-unpacked", "Voxy.exe");
  }
  const root = resolve("test-results", "room3d-overhaul-" + Date.now());
  await mkdir(root, { recursive: true });
  const apps: ElectronApplication[] = [],
    pages: Page[] = [],
    errors: string[] = [];
  const software = !!(process.env.CI || process.env.VOXY_TEST_SOFTWARE_GL);
  const activate = async (index: number) => {
    for (const [other, app] of apps.entries()) {
      if (other === index || !software) continue;
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].minimize(),
      );
    }
    await apps[index].evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
  };
  // Bring the follow camera close for detail captures (clamped by the rig).
  const zoomIn = async (page: Page, amount = 1400) => {
    const box = await page.locator(".room3d canvas").boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -amount);
  };
  const shot = async (page: Page, name: string, wait = 600) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: join(root, name + ".png") });
  };
  // Walk with the keyboard until the confirmed pose satisfies the predicate.
  const walk = async (
    page: Page,
    key: string,
    check: string,
    timeout = 20000,
  ) => {
    await page.locator(".room3d canvas").focus();
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        (code) => {
          const p = (window as any).myPose;
          return p && new Function("p", "return " + code)(p);
        },
        check,
        { timeout },
      );
    } finally {
      await page.keyboard.up(key);
    }
  };
  try {
    for (let i = 0; i < 2; i++) {
      const env = Object.fromEntries(
        Object.entries({
          ...process.env,
          VOXY_DATA_DIR: join(root, String(i)),
        }).filter((p): p is [string, string] => p[1] !== undefined),
      );
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({
        executablePath,
        args: [
          ...(packed ? [] : ["."]),
          "--use-fake-device-for-media-stream",
          "--mute-audio",
          "--use-fake-ui-for-media-stream",
          ...(software
            ? [
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--disable-features=CalculateNativeWinOcclusion",
              ]
            : []),
        ],
        env,
      });
      apps.push(app);
      const page = await app.firstWindow();
      pages.push(page);
      await app.evaluate(({ BrowserWindow }, index) => {
        BrowserWindow.getAllWindows()[0].setPosition(
          60 + index * 90,
          40 + index * 70,
        );
      }, i);
      await activate(i);
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .getByRole("heading", { name: "Sua frequência.", exact: false })
        .waitFor({ timeout: 20000 });
      const notes = page.getByRole("button", {
        name: "Entendi, vamos lá",
        exact: true,
      });
      if (await notes.count()) await notes.click();
      await page
        .getByRole("button", { name: "Configurações", exact: true })
        .click();
      await page.getByLabel("Nome de exibição").fill(i ? "Bruno" : "Ana");
      await page.getByRole("button", { name: "Salas 3D", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Ao entrar em canal compatível" })
        .selectOption("always");
      if (software)
        await page
          .getByRole("combobox", { name: "Qualidade gráfica", exact: true })
          .selectOption("low");
      else
        await page
          .getByRole("combobox", { name: "Qualidade gráfica", exact: true })
          .selectOption("high");
      await page
        .getByRole("button", { name: "Salvar perfil e dispositivos" })
        .click();
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      // Character creator: base, hair and outfit persist in the profile.
      await page
        .getByRole("button", { name: "Configurações", exact: true })
        .click();
      await page.getByRole("button", { name: "Salas 3D", exact: true }).click();
      await page
        .getByRole("button", { name: /Seu personagem, do seu jeito/ })
        .click();
      await page.locator('.avatar-studio[data-ready="true"]').waitFor();
      await page.getByRole("tab", { name: "Corpo", exact: true }).click();
      await page
        .getByRole("button", {
          name: i ? "Base Masculina" : "Base Feminina",
          exact: true,
        })
        .click();
      await page.waitForTimeout(400);
      await shot(page, `creator-${i}`, 900);
      await page
        .getByRole("button", { name: "Aplicar personagem", exact: true })
        .click();
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      assert.equal(
        (await page.evaluate(() => window.voxy.profile())).avatar3d?.base,
        i ? "m" : "f",
      );
    }
    const [a, b] = pages;
    // Own participant id arrives with the connection event; poses are split
    // between mine and the other participant's.
    for (const page of pages)
      await page.evaluate(() => {
        const w = window as any;
        w.others = {};
        window.voxy.onEvent((event: any) => {
          if (event.type === "connection" && event.selfId)
            w.selfId = event.selfId;
          if (event.type !== "room-pose") return;
          if (event.id === w.selfId) w.myPose = event.pose;
          else w.others[event.id] = event.pose;
        });
      });
    const host = await a.evaluate(() =>
      window.voxy.host({
        address: "127.0.0.1",
        port: 43176,
        name: "Overhaul 3D",
      }),
    );
    await b.evaluate((invite) => window.voxy.connect(invite), host.invite);
    const setPreset = async (preset: string) => {
      await activate(0);
      await a
        .getByRole("button", {
          name: "Gerenciar servidor e canais",
          exact: true,
        })
        .click();
      await a
        .locator(".hub-nav")
        .getByRole("button", { name: "Ambientes 3D", exact: true })
        .click();
      await a
        .getByRole("combobox", {
          name: "Ambiente de Sala dos amigos",
          exact: true,
        })
        .selectOption(preset);
      await a
        .locator("dialog[open]")
        .getByRole("button", { name: "Fechar", exact: true })
        .click();
    };
    await setPreset("lounge");
    for (const [index, page] of pages.entries()) {
      await activate(index);
      await page
        .getByRole("button", { name: "Sala dos amigos", exact: true })
        .click();
      await page
        .locator('.room3d canvas[data-ready="true"]')
        .waitFor({ timeout: 45000 });
    }
    // Ana walks to the bar and takes a mug.
    await activate(0);
    await shot(a, "lounge-entry", 900);
    // The Bar shortcut walks to the counter and opens the drink menu.
    await a.getByRole("button", { name: "Bar", exact: true }).click();
    await a
      .getByRole("dialog", { name: "Escolher bebida" })
      .waitFor({ timeout: 30000 });
    await a.waitForFunction(() =>
      document
        .querySelector(".room-context")
        ?.textContent?.includes("Pegar bebida"),
    );
    // E at the counter reopens the same menu (keyboard path).
    await a.keyboard.press("Escape");
    await a.locator(".room3d canvas").focus();
    await a.keyboard.press("KeyE");
    await a.getByRole("dialog", { name: "Escolher bebida" }).waitFor();
    await shot(a, "bar-menu", 300);
    await a.keyboard.press("Digit3");
    await a.waitForFunction(() => (window as any).myPose?.held === "mug");
    // Bruno follows and sees Ana holding the mug.
    await activate(1);
    await b.waitForFunction(() =>
      Object.values((window as any).others).some((p: any) => p?.held === "mug"),
    );
    await b.getByRole("button", { name: "Bar", exact: true }).click();
    await b
      .getByRole("dialog", { name: "Escolher bebida" })
      .waitFor({ timeout: 30000 });
    await b.getByRole("button", { name: /Lata/ }).click();
    await b.waitForFunction(() => (window as any).myPose?.held === "can");
    // Walking while holding keeps the container: route to the pool table and
    // back; Ana receives moving poses that still carry the can.
    await b.getByRole("button", { name: "Sinuca", exact: true }).click();
    await b.waitForFunction(
      () =>
        (window as any).myPose?.moving &&
        (window as any).myPose?.held === "can",
    );
    await shot(b, "walking-with-can", 200);
    const close = b.getByRole("button", { name: "Fechar", exact: true });
    await b.waitForTimeout(1500);
    if (await close.count())
      await close
        .first()
        .click()
        .catch(() => {});
    await activate(0);
    await a.waitForFunction(() =>
      Object.values((window as any).others).some(
        (p: any) => p?.moving && p?.held === "can",
      ),
    );
    await activate(1);
    await b.getByRole("button", { name: "Bar", exact: true }).click();
    await b
      .getByRole("dialog", { name: "Escolher bebida" })
      .waitFor({ timeout: 40000 });
    await b.keyboard.press("Escape");
    // Ana drinks; Bruno receives the drink emote.
    await activate(0);
    await a.locator(".room3d canvas").focus();
    await a.keyboard.press("KeyQ");
    await a.waitForFunction(() => (window as any).myPose?.emote === "drink");
    await activate(1);
    await b.waitForFunction(() =>
      Object.values((window as any).others).some(
        (p: any) => p?.emote === "drink",
      ),
    );
    await zoomIn(b);
    await shot(b, "bruno-sees-ana-drinking", 1300);
    // Toast together.
    await b.getByRole("button", { name: "Brindar", exact: true }).click();
    await activate(0);
    await a.getByRole("button", { name: "Brindar", exact: true }).click();
    await a.waitForFunction(() =>
      Object.values((window as any).others).some(
        (p: any) => p?.emote === "toast",
      ),
    );
    await zoomIn(a);
    await shot(a, "toast-ana", 700);
    await activate(1);
    await shot(b, "toast-bruno", 300);
    // Stow the drink.
    await a.getByRole("button", { name: "Guardar", exact: true }).click();
    await a.waitForFunction(() => (window as any).myPose?.held == null);
    await activate(1);
    await b.getByRole("button", { name: "Guardar", exact: true }).click();
    await b.waitForFunction(() => (window as any).myPose?.held == null);
    // Rooftop and cinema captures.
    await setPreset("rooftop");
    for (const page of pages)
      await page
        .getByRole("region", { name: "Rooftop 3D", exact: true })
        .waitFor();
    await activate(0);
    await a
      .locator('.room3d canvas[data-ready="true"]')
      .waitFor({ timeout: 45000 });
    await shot(a, "rooftop-a", 1500);
    await activate(1);
    await shot(b, "rooftop-b", 1500);
    await setPreset("cinema");
    for (const page of pages)
      await page
        .getByRole("region", { name: "Cinema 3D", exact: true })
        .waitFor();
    await activate(0);
    await a
      .locator('.room3d canvas[data-ready="true"]')
      .waitFor({ timeout: 45000 });
    await shot(a, "cinema-a", 1500);
    assert.deepEqual(errors, []);
    await writeFile(
      join(root, "results.json"),
      JSON.stringify(
        {
          errors,
          checks: [
            "two Electron clients with skinned avatars (female and male bases)",
            "avatar base persisted in the profile",
            "bar interaction menu (keyboard and pointer)",
            "mug and can held, synchronized to the other client",
            "walking while holding keeps the container",
            "drink emote synchronized",
            "toast between two participants",
            "stow drink",
            "rooftop and cinema load with the rebuilt environments",
          ],
        },
        null,
        2,
      ),
    );
    console.log("3D overhaul passed in two Electron clients. " + root);
  } catch (error) {
    for (const [index, page] of pages.entries())
      if (!page.isClosed())
        await page
          .screenshot({ path: join(root, `failure-${index}.png`) })
          .catch(() => {});
    await writeFile(
      join(root, "failure.json"),
      JSON.stringify({ errors, error: String(error) }, null, 2),
    );
    throw error;
  } finally {
    for (const app of apps) await app.close().catch(() => {});
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
