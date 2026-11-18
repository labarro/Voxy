// Fails if a TypeScript rule source changed without regenerating its differential fixtures.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
// Hash LF-normalised text: a Windows checkout (core.autocrlf) must not change the oracle identity.
const hash=path=>createHash("sha256").update(readFileSync(path,"utf8").replace(/\r\n/g,"\n")).digest("hex");
const fixture=name=>JSON.parse(readFileSync(`evidence/native-2.0/functional/${name}-fixtures.json`,"utf8"));
assert.equal(fixture("truco").oracle.truco,hash("src/shared/truco.ts"));
assert.equal(fixture("truco").oracle.seats,hash("src/shared/gameSession.ts"));
assert.equal(fixture("pool").oracleSha256,hash("src/shared/pool.ts"));
assert.equal(fixture("chess").oracleSha256,hash("src/shared/chess.ts"));
console.log("All differential game fixture oracle hashes match the preserved TypeScript sources.");
