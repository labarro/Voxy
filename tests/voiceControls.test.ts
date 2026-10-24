import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { profileSchema } from "../src/shared/validation";
import { shortcutConflict } from "../src/shared/preferences";
import { safeSystemAudio, shareAudioConstraints } from "../src/shared/capture";
import { VoiceEngine } from "../src/services/webrtc/engine";
const shortcut = (key: string, ctrl = false) => ({
  key,
  ctrl,
  alt: false,
  shift: false,
});
test("atalhos migram perfis antigos e rejeitam conflitos e códigos inválidos", () => {
  const p = profileSchema.parse({
    id: randomUUID(),
    name: "Amigo",
    avatar: "x",
    input: "",
    output: "",
  });
  assert.equal(p.muteShortcut, null);
  assert.equal(p.deafenShortcut, null);
  for (const key of ["KeyM", "Mouse4", "Mouse5", "F12"])
    assert(
      profileSchema.safeParse({ ...p, muteShortcut: shortcut(key, true) })
        .success,
    );
  for (const key of ["__proto__", "ControlLeft", "MetaLeft"])
    assert(
      !profileSchema.safeParse({ ...p, muteShortcut: shortcut(key) }).success,
    );
  assert(
    shortcutConflict({
      pttEnabled: true,
      pttKey: "KeyV",
      muteShortcut: shortcut("KeyV", true),
    }),
  );
  assert(
    !profileSchema.safeParse({
      ...p,
      muteShortcut: shortcut("Enter"),
      deafenShortcut: shortcut("NumpadEnter", true),
    }).success,
  );
  assert(
    !profileSchema.safeParse({
      ...p,
      muteShortcut: shortcut("Mouse4"),
      deafenShortcut: shortcut("Mouse4"),
    }).success,
  );
});
test("Deafen bloqueia PTT e restaura o mute manual e volumes sem alterá-los", () => {
  const engine = new VoiceEngine(
    async () => {},
    () => {},
    () => {},
  );
  for (const manual of [false, true]) {
    for (const ptt of [false, true]) {
      engine.configurePreferences(
        profileSchema.parse({
          id: randomUUID(),
          name: "A",
          avatar: "x",
          input: "",
          output: "",
          pttEnabled: ptt,
        }),
      );
      engine.setMuted(manual);
      engine.setPttPressed(true);
      engine.setDeafened(true);
      assert(engine.isMuted());
      assert.equal(engine.microphoneState(), "muted");
      engine.setPttPressed(false);
      engine.setPttPressed(true);
      assert(engine.isMuted());
      engine.setDeafened(false);
      assert.equal(engine.isMuted(), manual);
      engine.setPttPressed(false);
      assert.equal(engine.isMuted(), manual || ptt);
    }
  }
});
test("captura segura exige Windows process-loopback e solicita exclusão sem processamento de voz", () => {
  assert(safeSystemAudio("win32", "10.0.26100", "44.9.0"));
  assert(!safeSystemAudio("win32", "10.0.19045", "44.9.0"));
  assert(!safeSystemAudio("win32", "10.0.26100", "43.0.0"));
  assert(!safeSystemAudio("linux", "6.0.0", "44.9.0"));
  assert.equal(shareAudioConstraints(false), false);
  assert.deepEqual(shareAudioConstraints(true), {
    restrictOwnAudio: true,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  });
});
