import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomicFileSync } from "../src/services/atomicFile";

test("atomic persistence recovers from transient Windows rename locks", (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), "voxy-atomic-"));
  const path = join(directory, "profile.json");
  fs.writeFileSync(path, "old");
  const rename = fs.renameSync;
  let attempts = 0;
  t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    attempts++;
    assert.equal(fs.readFileSync(path, "utf8"), "old");
    if (attempts < 3)
      throw Object.assign(Error("Windows file lock"), {
        code: attempts === 1 ? "EPERM" : "EBUSY",
      });
    rename(from, to);
  });
  try {
    writeAtomicFileSync(path, "new");
    assert.equal(attempts, 3);
    assert.equal(fs.readFileSync(path, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(directory), ["profile.json"]);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("persistent locks keep the previous file and propagate the error after bounded retries", (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), "voxy-atomic-"));
  const path = join(directory, "room.sqlite");
  fs.writeFileSync(path, "previous snapshot");
  let attempts = 0;
  const error = Object.assign(Error("Locked"), { code: "EACCES" });
  t.mock.method(fs, "renameSync", () => {
    attempts++;
    throw error;
  });
  try {
    assert.throws(
      () => writeAtomicFileSync(path, "next snapshot"),
      (value) => value === error,
    );
    assert.equal(attempts, 6);
    assert.equal(fs.readFileSync(path, "utf8"), "previous snapshot");
    assert.deepEqual(fs.readdirSync(directory), ["room.sqlite"]);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("non-lock errors fail immediately without replacing the destination", (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), "voxy-atomic-"));
  const path = join(directory, "notifications.json");
  fs.writeFileSync(path, "previous");
  let attempts = 0;
  t.mock.method(fs, "renameSync", () => {
    attempts++;
    throw Object.assign(Error("I/O failure"), { code: "EIO" });
  });
  try {
    assert.throws(() => writeAtomicFileSync(path, "next"), { code: "EIO" });
    assert.equal(attempts, 1);
    assert.equal(fs.readFileSync(path, "utf8"), "previous");
    assert.deepEqual(fs.readdirSync(directory), ["notifications.json"]);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
