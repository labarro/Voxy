// Beta 3: persistent membership passes, short invite codes, offline status and
// same-identity socket replacement. Same Miniflare harness as signaling.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const bundle = await build({ entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const makeKey = () => { const pair = generateKeyPairSync('ed25519'); return { privateKey: pair.privateKey, key: pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url') }; };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function invite(host, room = randomUUID()) {
  const body = { protocol: 3, room, host_key: host.key, signal_url: `ws://localhost/v3/${room}`, capability: randomBytes(32).toString('base64url'), expires_at: Date.now() + 60000, signature: '' };
  body.signature = sign(null, Buffer.from(JSON.stringify(['voxy-invite-v3', 3, body.room, body.host_key, body.signal_url, body.capability, body.expires_at])), host.privateKey).toString('base64url');
  return body;
}
function headers(body, peer) {
  const nonce = randomBytes(16).toString('base64url'), now = Date.now();
  const proof = sign(null, Buffer.from(JSON.stringify(['voxy-admission-v3', body.room, body.capability, peer.key, nonce, now])), peer.privateKey).toString('base64url');
  return { Upgrade: 'websocket', 'X-Voxy-Invite': `voxy-native://join/${b64(body)}`, 'X-Voxy-Peer': peer.key, 'X-Voxy-Nonce': nonce, 'X-Voxy-Time': String(now), 'X-Voxy-Proof': proof };
}
function pass(host, member, room, { epoch = 0, expires = Date.now() + 86400000, signer = host } = {}) {
  const body = { protocol: 3, room, host_key: host.key, signal_url: `ws://localhost/v3/${room}`, member_key: member.key, epoch, expires_at: expires, signature: '' };
  body.signature = sign(null, Buffer.from(JSON.stringify(['voxy-member-pass-v1', 3, room, body.host_key, body.signal_url, body.member_key, epoch, expires])), signer.privateKey).toString('base64url');
  return body;
}
function passHeaders(p, peer) {
  const nonce = randomBytes(16).toString('base64url'), now = Date.now();
  const proof = sign(null, Buffer.from(JSON.stringify(['voxy-admission-v3', p.room, p.signature, peer.key, nonce, now])), peer.privateKey).toString('base64url');
  return { Upgrade: 'websocket', 'X-Voxy-Pass': `voxy-pass:${b64(p)}`, 'X-Voxy-Peer': peer.key, 'X-Voxy-Nonce': nonce, 'X-Voxy-Time': String(now), 'X-Voxy-Proof': proof };
}
function setup(extra = {}) {
  return new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-30',
    durableObjects: { ROOMS: { className: 'SignalRoom', useSQLite: true }, ADMISSION: { className: 'AdmissionBudget', useSQLite: true }, CODES: { className: 'InviteCodes', useSQLite: true } },
    bindings: { VOXY_DEPLOYMENT_ENABLED: 'true', VOXY_RELAY_ENABLED: 'false', VOXY_DAILY_ADMISSIONS: '1000', VOXY_MAX_ROOMS: '10', ...extra },
  });
}
const nextMessage = socket => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('WebSocket timeout')), 3000); socket.addEventListener('message', e => { clearTimeout(timer); resolve(JSON.parse(e.data)); }, { once: true }); });
const nextClose = socket => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Close timeout')), 3000); socket.addEventListener('close', e => { clearTimeout(timer); resolve(e.code); }, { once: true }); });
const nextOf = (socket, type) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(`timeout waiting ${type}`)), 3000); const listener = e => { const m = JSON.parse(e.data); if (m.type === type) { clearTimeout(timer); socket.removeEventListener('message', listener); resolve(m); } }; socket.addEventListener('message', listener); });
const roomUrl = room => `http://localhost/v3/${room}`;
async function accept(response, sockets) { assert.equal(response.status, 101); const socket = response.webSocket; sockets.push(socket); const welcome = nextMessage(socket); socket.accept(); assert.equal((await welcome).type, 'welcome'); return socket; }
async function open(mf, body, peer, sockets) { const h = headers(body, peer); return { socket: await accept(await mf.dispatchFetch(roomUrl(body.room), { headers: h }), sockets), h }; }
const rotate = (hs, h, replacement, extra = {}) => { const ack = nextOf(hs, 'invite-rotated'); hs.send(JSON.stringify({ type: 'rotate-invite', session_nonce: h['X-Voxy-Nonce'], invite: `voxy-native://join/${b64(replacement)}`, ...extra })); return ack; };

test('member pass reconnects without an invite; offline attempts never consume admissions', async () => {
  const mf = setup({ VOXY_DAILY_ADMISSIONS: '3' }), sockets = [];
  try {
    const host = makeKey(), guest = makeKey(), body = invite(host), p = pass(host, guest, body.room);
    for (let i = 0; i < 5; i++) assert.equal((await mf.dispatchFetch(roomUrl(body.room), { headers: passHeaders(p, guest) })).status, 409, 'never hosted: offline');
    const { socket: hs } = await open(mf, body, host, sockets);
    await accept(await mf.dispatchFetch(roomUrl(body.room), { headers: passHeaders(p, guest) }), sockets);
    const closed = nextClose(hs); hs.close(1000, 'bye'); await closed.catch(() => {});
    await new Promise(r => setTimeout(r, 100));
    const other = makeKey();
    for (let i = 0; i < 5; i++) assert.equal((await mf.dispatchFetch(roomUrl(body.room), { headers: passHeaders(pass(host, other, body.room), other) })).status, 409, 'host left: offline');
    // Budget 3: host + guest consumed two; offline polls consumed none, so the host can re-host.
    assert.ok((await open(mf, body, host, sockets)).socket, 'host re-hosts with the same persisted invite');
  } finally { for (const socket of sockets) { try { socket.close(); } catch {} } await mf.dispose(); }
});

test('member pass is bound to the member key, the registered host, its lifetime and the revocation epoch', async () => {
  const mf = setup(), sockets = [];
  try {
    const host = makeKey(), guest = makeKey(), intruder = makeKey(), body = invite(host);
    const { socket: hs, h } = await open(mf, body, host, sockets);
    const status = async (p, peer) => (await mf.dispatchFetch(roomUrl(body.room), { headers: passHeaders(p, peer) })).status;
    assert.equal(await status(pass(host, guest, body.room), intruder), 403, 'pass presented by another key');
    assert.equal(await status(pass(intruder, intruder, body.room), intruder), 403, 'pass from a different host key');
    assert.equal(await status(pass(host, guest, body.room, { signer: intruder }), guest), 403, 'forged signature');
    assert.equal(await status(pass(host, guest, body.room, { expires: Date.now() + 400 * 86400000 }), guest), 403, 'lifetime limit');
    assert.equal(await status(pass(host, guest, body.room, { expires: Date.now() - 1 }), guest), 403, 'expired');
    assert.equal((await rotate(hs, h, invite(host, body.room), { epoch: 1 })).type, 'invite-rotated');
    assert.equal(await status(pass(host, guest, body.room, { epoch: 0 }), guest), 403, 'revoked epoch');
    await accept(await mf.dispatchFetch(roomUrl(body.room), { headers: passHeaders(pass(host, guest, body.room, { epoch: 1 }), guest) }), sockets);
    const refused = nextClose(hs); hs.send(JSON.stringify({ type: 'rotate-invite', session_nonce: h['X-Voxy-Nonce'], invite: `voxy-native://join/${b64(invite(host, body.room))}`, epoch: 0 }));
    assert.equal(await refused, 1008, 'epoch can never decrease');
  } finally { for (const socket of sockets) { try { socket.close(); } catch {} } await mf.dispose(); }
});

test('a reconnecting identity replaces its own stale socket instead of being locked out', async () => {
  const mf = setup(), sockets = [];
  try {
    const host = makeKey(), body = invite(host);
    const { socket: stale } = await open(mf, body, host, sockets); const replaced = nextOf(stale, 'replaced');
    assert.ok((await open(mf, body, host, sockets)).socket);
    assert.equal((await replaced).type, 'replaced');
  } finally { for (const socket of sockets) { try { socket.close(); } catch {} } await mf.dispose(); }
});

const registerCode = (hs, h) => { const reply = nextOf(hs, 'invite-code'); hs.send(JSON.stringify({ type: 'register-code', session_nonce: h['X-Voxy-Nonce'] })); return reply; };
async function resolveCode(mf, code, ip = '203.0.113.7') {
  const r = await mf.dispatchFetch(`http://localhost/v3/code/${encodeURIComponent(code)}`, { headers: { Upgrade: 'websocket', 'CF-Connecting-IP': ip } });
  if (r.status !== 101) return { status: r.status };
  const message = nextMessage(r.webSocket); r.webSocket.accept(); return { status: 101, message: await message };
}

test('short invite codes: host-only registration, resolution, normalization, revocation and HTML link', async () => {
  const mf = setup(), sockets = [];
  try {
    const host = makeKey(), guest = makeKey(), body = invite(host);
    const { socket: hs, h } = await open(mf, body, host, sockets);
    const { socket: gs, h: gh } = await open(mf, body, guest, sockets);
    const denied = nextClose(gs); gs.send(JSON.stringify({ type: 'register-code', session_nonce: gh['X-Voxy-Nonce'] })); assert.equal(await denied, 1008, 'guest cannot register codes');
    const reply = await registerCode(hs, h);
    assert.equal(reply.type, 'invite-code'); assert.match(reply.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/); assert.equal(reply.expires_at, body.expires_at);
    assert.equal((await registerCode(hs, h)).code, reply.code, 'same invite keeps the same code');
    const resolved = await resolveCode(mf, reply.code.toLowerCase().replace('-', ''));
    assert.equal(resolved.status, 101); assert.equal(resolved.message.type, 'invite');
    assert.equal(JSON.parse(Buffer.from(resolved.message.invite.slice('voxy-native://join/'.length), 'base64url')).capability, body.capability);
    assert.equal((await resolveCode(mf, 'ZZZZ-ZZZZ')).status, 404);
    assert.equal((await resolveCode(mf, 'not-a-code!')).status, 400);
    const html = await mf.dispatchFetch(`http://localhost/join/${reply.code}`); assert.equal(html.status, 200);
    const text = await html.text(); assert.ok(text.includes(reply.code)); assert.ok(!text.includes(body.capability), 'link page never contains the capability');
    assert.equal(html.headers.get('Cache-Control'), 'no-store');
    await rotate(hs, h, invite(host, body.room));
    assert.equal((await resolveCode(mf, reply.code)).status, 404, 'rotation revokes the old code');
    assert.notEqual((await registerCode(hs, h)).code, reply.code);
  } finally { for (const socket of sockets) { try { socket.close(); } catch {} } await mf.dispose(); }
});

test('code lookups are rate limited per client address', async () => {
  const mf = setup();
  try {
    let limited = false;
    for (let i = 0; i < 16 && !limited; i++) limited = (await resolveCode(mf, `ZZZZ-ZZZ${i % 10}`, '198.51.100.9')).status === 429;
    assert.ok(limited, 'enumeration burst must be throttled');
    assert.equal((await resolveCode(mf, 'ZZZZ-ZZZZ', '198.51.100.10')).status, 404, 'other addresses unaffected');
  } finally { await mf.dispose(); }
});
