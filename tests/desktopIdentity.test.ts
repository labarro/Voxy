import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopIdentity,
  startHidden,
  repairShortcut,
} from "../src/main/desktopIdentity";
test("identidade instalada e desenvolvimento não colidem e preservam a pasta dos perfis", () => {
  const production = desktopIdentity(true, "data", "app", "resources");
  const development = desktopIdentity(false, "data", "app", "resources");
  assert.equal(production.name, "Voxy");
  assert.notEqual(production.appId, development.appId);
  assert.notEqual(production.userData, development.userData);
  assert.equal(production.userData, join("data", "voxy-desktop"));
  assert.equal(production.icon, join("resources", "icon.ico"));
});
test("abertura manual e atualização mostram janela; somente login explícito pode ocultar", () => {
  assert.equal(startHidden([]), false);
  assert.equal(startHidden(["--start-minimized"]), true);
  assert.equal(startHidden(["--start-minimized", "--updated"]), false);
});
test("reparo cria ou atualiza atalho com alvo, ícone, argumentos e identidade explícitos", () => {
  const dir = mkdtempSync(join(tmpdir(), "voxy-shortcut-"));
  const shortcut = join(dir, "Programs", "Voxy.lnk");
  try {
    for (const exists of [false, true]) {
      if (exists) writeFileSync(shortcut, "old link");
      assert(
        repairShortcut(
          shortcut,
          join(dir, "Voxy.exe"),
          join(dir, "icon.ico"),
          (path, operation, details) => {
            assert.equal(path, shortcut);
            assert.equal(operation, exists ? "update" : "create");
            assert.equal(details.appUserModelId, "dev.voxy.desktop");
            assert.equal(details.args, "");
            assert.equal(details.icon, join(dir, "icon.ico"));
            assert.equal(details.target, join(dir, "Voxy.exe"));
            return true;
          },
        ),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
