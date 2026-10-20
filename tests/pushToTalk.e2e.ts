import { PushToTalk } from "../src/main/pushToTalk";
import { key } from "./support/keyboard";
import assert from "node:assert/strict";
async function main() {
  const events: { pressed: boolean; error?: string }[] = [];
  const ptt = new PushToTalk((pressed, error) =>
    events.push({ pressed, error }),
  );
  try {
    for (const [code, vk] of [
      ["F9", 120],
      ["KeyQ", 81],
    ] as const) {
      events.length = 0;
      ptt.configure(true, code);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Leitor global não iniciou")),
          12000,
        );
        (ptt as any).child.stdout.once("data", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await key(false, vk);
      await wait(() => events.some((e) => e.pressed));
      assert(!events.some((e) => e.error));
      await key(true, vk);
      await wait(
        () => events.length >= 2 && !events[events.length - 1].pressed,
      );
      await key(false, vk);
      await wait(() => events[events.length - 1].pressed);
      ptt.stop();
      assert.equal(events[events.length - 1].pressed, false);
      assert(!(ptt as any).child);
    }
    assert.throws(() => ptt.configure(true, "__proto__"));
    console.log(
      "Windows global PTT: F9 e Q pressionadas/soltas detectadas; reconfiguração, validação e limpeza funcionam.",
    );
  } finally {
    ptt.stop();
    await key(true);
    await key(true, 81);
  }
}
async function wait(check: () => boolean) {
  for (let n = 0; n < 60; n++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Transição global de tecla não detectada.");
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
