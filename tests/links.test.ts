import { test } from "node:test";
import assert from "node:assert/strict";
import { externalUrl, messageParts } from "../src/shared/links";
import { microphoneConstraints } from "../src/services/webrtc/microphone";
test("links preservam texto e pontuação, rejeitando esquemas e credenciais", () => {
  const text =
    "Veja (https://devbarros.com/), https://example.com/a_(b)?q=1&x=2. fim";
  const parts = messageParts(text);
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.deepEqual(
    parts.filter((p) => p.href).map((p) => p.href),
    ["https://devbarros.com/", "https://example.com/a_(b)?q=1&x=2"],
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/Windows",
    "voxy://host",
    "https://user:password@example.com",
    "https://example.com/\nfile",
    {},
  ])
    assert.throws(() => externalUrl(url));
  assert.equal(
    messageParts("javascript:alert(1) https://u:p@example.com").filter(
      (p) => p.href,
    ).length,
    0,
  );
});
test("captura mantém AGC desativado e compartilha os ajustes entre teste e chamada", () => {
  assert.deepEqual(microphoneConstraints(), {
    deviceId: undefined,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: false,
  });
  const c = microphoneConstraints({
    input: "device",
    noiseSuppression: false,
    echoCancellation: false,
  } as any);
  assert.deepEqual(c.deviceId, { exact: "device" });
  assert.equal(c.noiseSuppression, false);
  assert.equal(c.echoCancellation, false);
  assert.equal(c.autoGainControl, false);
});
