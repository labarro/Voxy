import fs from "node:fs";
import { randomUUID } from "node:crypto";

const delay = new Int32Array(new SharedArrayBuffer(4));
const waits = [10, 20, 40, 80, 120];
function retryLocked(operation: () => void) {
  for (let attempt = 0; ; attempt++) {
    try {
      operation();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        !code ||
        !["EPERM", "EACCES", "EBUSY"].includes(code) ||
        attempt >= waits.length
      )
        throw error;
      // Windows scanners may hold a newly written file briefly. Keep the retry
      // bounded (270 ms), rather than remove the destination or spin the CPU.
      Atomics.wait(delay, 0, 0, waits[attempt]);
    }
  }
}

export function writeAtomicFileSync(path: string, data: string | Uint8Array) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let committed = false;
  try {
    retryLocked(() => fs.writeFileSync(temporary, data, { mode: 0o600 }));
    retryLocked(() => fs.renameSync(temporary, path));
    committed = true;
  } finally {
    if (!committed) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        /* Preserve the original error. */
      }
    }
  }
}
