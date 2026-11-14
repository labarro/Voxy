import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deadline,
  mediaFailure,
  networkClass,
} from "../src/services/webrtc/callDiagnostics";
test("deadline rejects pending capture, disposes late result, consumes late rejection and clears cancellation", async () => {
  let finish!: (value: number) => void;
  let stopped = 0;
  const pending = new Promise<number>((r) => (finish = r));
  await assert.rejects(
    deadline(
      pending,
      5,
      "microphone-timeout",
      undefined,
      (v) => (stopped += v),
    ),
    /microphone-timeout/,
  );
  finish(1);
  await Promise.resolve();
  assert.equal(stopped, 1);
  const abort = new AbortController();
  const result = deadline(
    new Promise(() => {}),
    50000,
    "timeout",
    abort.signal,
  );
  abort.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(await deadline(Promise.resolve(4), 100, "timeout"), 4);
});
test("diagnostic classification and media errors do not expose source identifiers", () => {
  assert.equal(networkClass("26.1.2.3"), "radmin-range");
  assert.equal(networkClass("192.168.1.2"), "private-v4");
  assert.equal(networkClass("secret.local"), "mdns");
  for (const name of [
    "NotAllowedError",
    "NotFoundError",
    "NotReadableError",
    "UnexpectedError",
  ])
    assert(
      !mediaFailure({
        name,
        message: "private-device-name secret password 26.1.2.3",
      }).includes("secret"),
    );
});
