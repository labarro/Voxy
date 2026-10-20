import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
let path = "";
export function configureLog(file: string) {
  path = file;
}
export function log(
  event: string,
  fields: Record<string, string | number | boolean> = {},
) {
  if (!path) return;
  // Call sites supply only allowlisted metadata. Never SDP, candidate addresses,
  // invitations, message contents, names or credentials.
  try {
    if (existsSync(path) && statSync(path).size > 256000)
      writeFileSync(path, "");
    appendFileSync(
      path,
      JSON.stringify({ time: new Date().toISOString(), event, ...fields }) +
        "\n",
    );
  } catch {
    /* Logging must not interrupt calls. */
  }
}
