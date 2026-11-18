// Rendezvous only. No chat history, files, media, TURN token or billable relay.
//
// Identity model (Beta 3):
// - A server is a room UUID owned by one host Ed25519 key. The first host
//   registration pins the key; no other key can ever host the same room.
// - Invites (capability + host signature) admit NEW members. Hosts keep reusing
//   the same persisted invite between hosting sessions; rotation revokes it.
// - Member passes (host-signed, bound to the member key and a revocation epoch)
//   let existing members reconnect after the invite expires or is rotated.
// - Short codes map to the current invite of a room. They are created only over
//   the authenticated host socket and are revoked when the invite rotates.
interface Env {
  ROOMS: DurableObjectNamespace;
  ADMISSION: DurableObjectNamespace;
  CODES: DurableObjectNamespace;
  VOXY_DEPLOYMENT_ENABLED: string;
  VOXY_RELAY_ENABLED: string;
  VOXY_DAILY_ADMISSIONS: string;
  VOXY_MAX_ROOMS: string;
}
type Invite = { protocol: number; room: string; host_key: string; signal_url: string; capability: string; expires_at: number; signature: string };
type Pass = { protocol: number; room: string; host_key: string; signal_url: string; member_key: string; epoch: number; expires_at: number; signature: string };
type Admission = { kind: "invite"; invite: Invite; raw: string; hostKey: string; secret: string; expiresAt: number } | { kind: "pass"; pass: Pass; hostKey: string; secret: string; expiresAt: number };
type Registered = { key: string; hash: string; epoch?: number; invite?: string };
type Peer = { key: string; host: boolean; room: string; endpoint: string; tokens: number; updatedAt: number; expiresAt: number; nonce: string; sequences: Record<string, { nonce: string; sequence: number }> };
const encoder = new TextEncoder();
const roomPath = /^\/v3\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const PASS_MAX_MS = 180 * 86400000;
const MAX_EPOCH = 1_000_000;
// Crockford base32 without I, L, O, U: 8 symbols = 40 bits, shown as XXXX-XXXX.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
function decode(raw: string): Uint8Array<ArrayBuffer> {
  if (typeof raw !== "string" || raw.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error("encoding");
  const bytes = Uint8Array.from(atob(raw.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
  if (btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") !== raw) throw Error("noncanonical encoding");
  return bytes;
}
async function verify(key: string, bytes: Uint8Array<ArrayBuffer>, signature: string) {
  const publicKey = await crypto.subtle.importKey("raw", decode(key), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", publicKey, decode(signature), bytes);
}
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))).map(b => b.toString(16).padStart(2, "0")).join("");
function expectedEndpoint(requestUrl: string, room: string) {
  const current = new URL(requestUrl);
  return `${current.protocol === "https:" ? "wss:" : "ws:"}//${current.host}/v3/${room}`;
}
function exactFields(value: Record<string, unknown>, fields: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k)) || fields.some(k => !(k in value))) throw Error("schema");
}
async function parseInviteText(raw: string, room: string, requestUrl: string): Promise<Invite> {
  const prefix = raw.startsWith("voxy-native://join/") ? "voxy-native://join/" : "voxy://join/";
  if (raw.length > 8192 || !raw.startsWith(prefix)) throw Error("invite");
  const invite: Invite = JSON.parse(new TextDecoder().decode(decode(raw.slice(prefix.length))));
  exactFields(invite, ["protocol", "room", "host_key", "signal_url", "capability", "expires_at", "signature"]);
  if (invite.protocol !== 3 || invite.room !== room || room === "00000000-0000-0000-0000-000000000000" || !Number.isSafeInteger(invite.expires_at) || invite.expires_at <= Date.now() || invite.expires_at > Date.now() + 7 * 86400000) throw Error("expired");
  if (decode(invite.host_key).length !== 32 || decode(invite.capability).length !== 32) throw Error("capability");
  if (new URL(invite.signal_url).href !== expectedEndpoint(requestUrl, room) || !await verify(invite.host_key, encoder.encode(JSON.stringify(["voxy-invite-v3", 3, room, invite.host_key, invite.signal_url, invite.capability, invite.expires_at])), invite.signature)) throw Error("signature");
  return invite;
}
async function parsePass(raw: string, room: string, requestUrl: string): Promise<Pass> {
  if (raw.length > 4096 || !raw.startsWith("voxy-pass:")) throw Error("pass");
  const pass: Pass = JSON.parse(new TextDecoder().decode(decode(raw.slice("voxy-pass:".length))));
  exactFields(pass, ["protocol", "room", "host_key", "signal_url", "member_key", "epoch", "expires_at", "signature"]);
  if (pass.protocol !== 3 || pass.room !== room || !Number.isSafeInteger(pass.expires_at) || pass.expires_at <= Date.now() || pass.expires_at > Date.now() + PASS_MAX_MS) throw Error("expired");
  if (!Number.isSafeInteger(pass.epoch) || pass.epoch < 0 || pass.epoch > MAX_EPOCH) throw Error("epoch");
  if (decode(pass.host_key).length !== 32 || decode(pass.member_key).length !== 32) throw Error("key");
  if (new URL(pass.signal_url).href !== expectedEndpoint(requestUrl, room) || !await verify(pass.host_key, encoder.encode(JSON.stringify(["voxy-member-pass-v1", 3, room, pass.host_key, pass.signal_url, pass.member_key, pass.epoch, pass.expires_at])), pass.signature)) throw Error("signature");
  return pass;
}
/** Validates the credential and the per-connection proof of key possession. */
async function parseAdmission(request: Request, room: string): Promise<{ admission: Admission; key: string; nonce: string }> {
  const passHeader = request.headers.get("X-Voxy-Pass");
  let admission: Admission;
  if (passHeader !== null) {
    const pass = await parsePass(passHeader, room, request.url);
    admission = { kind: "pass", pass, hostKey: pass.host_key, secret: pass.signature, expiresAt: pass.expires_at };
  } else {
    const raw = request.headers.get("X-Voxy-Invite") ?? "";
    const invite = await parseInviteText(raw, room, request.url);
    admission = { kind: "invite", invite, raw, hostKey: invite.host_key, secret: invite.capability, expiresAt: invite.expires_at };
  }
  const key = request.headers.get("X-Voxy-Peer") ?? "";
  const signature = request.headers.get("X-Voxy-Proof") ?? "";
  const nonce = request.headers.get("X-Voxy-Nonce") ?? "";
  const timestamp = Number(request.headers.get("X-Voxy-Time"));
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 30000 || decode(nonce).length !== 16 || decode(key).length !== 32) throw Error("session");
  if (admission.kind === "pass" && admission.pass.member_key !== key) throw Error("member");
  const proof = encoder.encode(JSON.stringify(["voxy-admission-v3", room, admission.secret, key, nonce, timestamp]));
  if (!await verify(key, proof, signature)) throw Error("identity");
  return { admission, key, nonce };
}
export function normalizeCode(raw: string): string | null {
  const value = raw.toUpperCase().replaceAll("-", "").replaceAll(" ", "").replaceAll("I", "1").replaceAll("L", "1").replaceAll("O", "0");
  if (value.length !== 8 || [...value].some(c => !CODE_ALPHABET.includes(c))) return null;
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}
function joinPage(code: string) {
  // No lookup and no capability here: the page cannot be used to enumerate codes.
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Convite Voxy</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1b2130;color:#e8e6f5;font:16px system-ui,sans-serif}main{max-width:420px;padding:32px;text-align:center}code{display:block;margin:20px 0;font-size:34px;letter-spacing:4px;color:#b6adff}a{color:#b6adff}p{line-height:1.5;color:#c9c6dc}</style></head>
<body><main><h1>Convite para um servidor Voxy</h1><code>${code}</code><p>Abra o <strong>Voxy 2.0 Beta</strong>, escolha <strong>Entrar com convite</strong> e cole este link ou digite o código acima.</p><p><a href="voxy-native://code/${code}">Abrir no Voxy</a></p></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.VOXY_DEPLOYMENT_ENABLED !== "true") return error("Implantação experimental desativada", 503);
    // Even a configuration mistake must not activate a paid API.
    if (env.VOXY_RELAY_ENABLED !== "false") return error("Relay não homologado", 503);
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") return Response.json({ protocol: 3, relay: false, transport: "signaling-only", codes: true, passes: true });
    if (request.method === "GET" && path.startsWith("/join/")) {
      const code = normalizeCode(decodeURIComponent(path.slice("/join/".length)));
      return code ? joinPage(code) : error("Código inválido", 400);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || request.method !== "GET") return error("Rota inválida", 404);
    if (request.headers.has("Origin")) return error("Cliente não autorizado", 403);
    if (path.startsWith("/v3/code/")) {
      const code = normalizeCode(decodeURIComponent(path.slice("/v3/code/".length)));
      if (!code) return error("Código inválido", 400);
      const resolved = await env.CODES.get(env.CODES.idFromName("codes-v1")).fetch(new Request("https://codes.internal/resolve", { method: "POST", body: JSON.stringify({ code, client: request.headers.get("CF-Connecting-IP") ?? "local" }) }));
      if (!resolved.ok) return error(resolved.status === 429 ? "Muitas tentativas; aguarde um minuto" : "Código inválido ou expirado", resolved.status === 429 ? 429 : 404);
      const { invite } = await resolved.json() as { invite: string };
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({ type: "invite", invite }));
      pair[1].close(1000, "ok");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const match = roomPath.exec(path);
    if (!match) return error("Rota inválida", 404);
    try { await parseAdmission(request, match[1]); } catch { return error("Convite inválido ou expirado", 403); }
    // The room decides online/offline before any admission is consumed.
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  }
};

// A room slot is a short host lease, renewed by the room's alarm while the host
// socket is connected and released when it closes. It never lasts until the
// invite expiry, so departed hosts stop consuming the global room quota.
const ROOM_LEASE_MS = 15 * 60_000;
const LEASE_RENEW_MS = 5 * 60_000;
type Budget = { day: string; count: number; rooms: Record<string, number>; nonces: Record<string, number> };
export class AdmissionBudget {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(request: Request) {
    const action = new URL(request.url).pathname;
    const data = await request.json() as { room: string; expiry?: number; nonce?: string; host?: boolean };
    return this.state.storage.transaction(async tx => {
      const today = new Date().toISOString().slice(0,10);
      const old = await tx.get<Budget>("budget");
      // Daily usage resets; live room leases and replay windows survive UTC midnight.
      const budget: Budget = old ? { ...old, day: today, count: old.day === today ? old.count : 0 } : { day: today, count: 0, rooms: {}, nonces: {} };
      const now = Date.now();
      // Older deployments stored invite expiry; cap every entry to one lease.
      budget.rooms = Object.fromEntries(Object.entries(budget.rooms).filter(([,expires]) => expires > now).map(([room, expires]) => [room, Math.min(expires, now + ROOM_LEASE_MS)]));
      budget.nonces = Object.fromEntries(Object.entries(budget.nonces).filter(([,expires]) => expires > now));
      const maxRooms = Math.min(10, Number(this.env.VOXY_MAX_ROOMS) || 10);
      if (action === "/release") {
        delete budget.rooms[data.room];
        await tx.put("budget", budget);
        return new Response("ok");
      }
      if (action === "/renew") {
        // Renewal does not consume a daily admission. A lapsed lease is
        // re-acquired only while capacity exists.
        if (!(data.room in budget.rooms) && Object.keys(budget.rooms).length >= maxRooms) return error("Room quota", 429);
        budget.rooms[data.room] = now + ROOM_LEASE_MS;
        await tx.put("budget", budget);
        return new Response("ok");
      }
      if (action !== "/admit" || typeof data.nonce !== "string") return error("Ação", 404);
      if (budget.nonces[data.nonce] || budget.count >= Math.min(10000, Number(this.env.VOXY_DAILY_ADMISSIONS) || 1000)) return error("Quota", 429);
      // Hosts acquire a lease; a guest may re-acquire a lapsed lease only while
      // capacity exists, and SignalRoom still refuses guests unless the host is online.
      if (!(data.room in budget.rooms) && Object.keys(budget.rooms).length >= maxRooms) return error("Room quota", 429);
      if (data.host || !(data.room in budget.rooms)) budget.rooms[data.room] = now + ROOM_LEASE_MS;
      budget.nonces[data.nonce] = now + 60000;
      budget.count++;
      await tx.put("budget", budget);
      return new Response("ok");
    });
  }
}

export class SignalRoom {
  constructor(private state: DurableObjectState, private env: Env) {}
  private peers() { return this.state.getWebSockets().map(socket => ({ socket, peer: socket.deserializeAttachment() as Peer })); }
  async fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
    const match = roomPath.exec(new URL(request.url).pathname);
    if (!match) return error("Room",404);
    let parsed: Awaited<ReturnType<typeof parseAdmission>>;
    try { parsed = await parseAdmission(request, match[1]); } catch { return error("Convite",403); }
    const { admission, key, nonce } = parsed;
    const host = admission.kind === "invite" && key === admission.invite.host_key;
    const registered = await this.state.storage.get<Registered>("host");
    const hostOnline = this.peers().some(({ peer }) => peer.host && peer.key !== key);
    let register: Registered | undefined;
    if (admission.kind === "pass") {
      if (!registered) return error("Host offline",409);
      if (registered.key !== admission.pass.host_key) return error("Host incorreto",403);
      if (admission.pass.epoch < (registered.epoch ?? 0)) return error("Acesso revogado pelo host",403);
      if (!hostOnline) return error("Host offline",409);
    } else {
      const hash = await sha256(admission.invite.capability);
      if (!registered) {
        if (!host) return error("Host offline",409);
        register = { key, hash, epoch: 0, invite: admission.raw };
      } else if (registered.key !== admission.invite.host_key) return error("Host incorreto",403);
      else if (registered.hash !== hash) {
        if (!host) return error("Convite revogado",403);
        if (hostOnline) return error("Host já conectado",409);
        register = { ...registered, key, hash, invite: admission.raw };
      } else if (host && registered.invite !== admission.raw) register = { ...registered, invite: admission.raw };
      if (!host && !hostOnline) return error("Host offline",409);
    }
    const stale = this.peers().filter(({ peer }) => peer.key === key);
    if (this.peers().length - stale.length >= 10) return error("Sala cheia",409);
    // Only now consume a daily admission: offline polls and refusals are free.
    const admitted = await this.env.ADMISSION.get(this.env.ADMISSION.idFromName("global-v3")).fetch(new Request("https://budget.internal/admit", { method: "POST", body: JSON.stringify({ room: match[1], expiry: admission.expiresAt, nonce, host }) }));
    if (!admitted.ok) return error("Limite gratuito de admissões atingido; tente mais tarde", 429);
    if (register) {
      if (registered && registered.hash !== register.hash) {
        for (const { socket } of this.peers()) socket.close(1008,"Convite renovado pelo host");
        await this.revokeCodes(match[1]);
      }
      await this.state.storage.put("host", register);
    }
    // The key owner proved possession with a fresh nonce: replace its stale socket.
    for (const { socket, peer } of stale) {
      for (const { socket: other } of this.peers()) if (other !== socket) other.send(JSON.stringify({ type: "peer-left", key: peer.key, session_nonce: peer.nonce }));
      try { socket.send(JSON.stringify({ type: "replaced" })); } catch { /* already closed */ }
      socket.serializeAttachment({ ...peer, expiresAt: 0 });
      try { socket.close(4000,"Substituído por nova conexão"); } catch { /* already closed */ }
    }
    const sockets = this.peers().filter(({ peer }) => peer.expiresAt > 0).map(({ socket }) => socket);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server);
    const endpoint = admission.kind === "pass" ? admission.pass.signal_url : admission.invite.signal_url;
    server.serializeAttachment({ key, host, room: match[1], endpoint, tokens: 512, updatedAt: Date.now(), expiresAt: admission.expiresAt, nonce, sequences: {} } satisfies Peer);
    const wake = host ? Math.min(admission.expiresAt, Date.now() + LEASE_RENEW_MS) : admission.expiresAt;
    const alarm = await this.state.storage.getAlarm();
    if (!alarm || alarm > wake) await this.state.storage.setAlarm(wake);
    server.send(JSON.stringify({ type: "welcome", peers: sockets.map(s => { const p = s.deserializeAttachment() as Peer; return { key: p.key, host: p.host, session_nonce: p.nonce }; }) }));
    for (const socket of sockets) socket.send(JSON.stringify({ type: "peer-joined", key, host, session_nonce: nonce }));
    return new Response(null, { status: 101, webSocket: client });
    });
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || encoder.encode(message).length > 65536) { socket.close(1009,"Limite de sinalização"); return; }
    const peer = socket.deserializeAttachment() as Peer;
    if (peer.expiresAt <= Date.now()) { socket.close(1008,"Sessão expirada"); return; }
    const now = Date.now(); peer.tokens = Math.min(512, peer.tokens + (now - peer.updatedAt) * .128); peer.updatedAt = now;
    // Charge large SDP proportionately; the budget is bounded in bytes as well as messages.
    peer.tokens -= Math.max(1, encoder.encode(message).length / 4096);
    if (peer.tokens < 0) { socket.close(1008,"Rate limit"); return; }
    socket.serializeAttachment(peer);
    try {
      const signal = JSON.parse(message);
      if (signal.type === "register-code") {
        if (!peer.host || signal.session_nonce !== peer.nonce || Object.keys(signal).some(k => !["type", "session_nonce"].includes(k))) throw Error("host control");
        const registered = await this.state.storage.get<Registered>("host");
        if (!registered?.invite || registered.key !== peer.key) throw Error("no invite");
        const invite = await parseInviteText(registered.invite, peer.room, `${new URL(peer.endpoint).protocol === "wss:" ? "https:" : "http:"}//${new URL(peer.endpoint).host}/v3/${peer.room}`);
        const response = await this.env.CODES.get(this.env.CODES.idFromName("codes-v1")).fetch(new Request("https://codes.internal/register", { method: "POST", body: JSON.stringify({ room: peer.room, invite: registered.invite, hash: registered.hash, expires_at: invite.expires_at }) }));
        if (!response.ok) { socket.send(JSON.stringify({ type: "invite-code-error" })); return; }
        const { code } = await response.json() as { code: string };
        socket.send(JSON.stringify({ type: "invite-code", code, expires_at: invite.expires_at }));
        return;
      }
      if (signal.type === "rotate-invite") {
        if (!peer.host || signal.session_nonce !== peer.nonce || Object.keys(signal).some(k => !["type", "session_nonce", "invite", "epoch"].includes(k))) throw Error("host control");
        // Revalidate the host signature and bind rotation to this room's original origin.
        // Constructing a Request does not fetch a supplied URL.
        const url = new URL(peer.endpoint);
        const replacement = await parseInviteText(signal.invite, peer.room, `${url.protocol === "wss:" ? "https:" : "http:"}//${url.host}/v3/${peer.room}`);
        if (replacement.host_key !== peer.key) throw Error("host key");
        const registered = await this.state.storage.get<Registered>("host");
        const epoch = signal.epoch === undefined ? (registered?.epoch ?? 0) : signal.epoch;
        if (!Number.isSafeInteger(epoch) || epoch < (registered?.epoch ?? 0) || epoch > MAX_EPOCH) throw Error("epoch");
        await this.rotateInvite(socket, peer, replacement, signal.invite, epoch);
        return;
      }
      const fields = ["room", "from", "to", "sequence", "expires_at", "session_nonce", "payload", "signature"];
      if (Object.keys(signal).some(k => !fields.includes(k)) || fields.some(k => !(k in signal)) || signal.room !== peer.room || signal.from !== peer.key || signal.session_nonce !== peer.nonce || typeof signal.to !== "string" || signal.to === peer.key || !Number.isSafeInteger(signal.sequence) || signal.sequence <= 0 || !Number.isSafeInteger(signal.expires_at) || signal.expires_at <= now || signal.expires_at > now + 60000 || typeof signal.signature !== "string" || decode(signal.signature).length !== 64 || typeof signal.payload !== "object" || !signal.payload || Array.isArray(signal.payload)) throw Error("signal");
      const payloadKeys = Object.keys(signal.payload);
      if (payloadKeys.length !== 1 || !["candidate", "description"].includes(payloadKeys[0]) || (payloadKeys[0] === "candidate" && encoder.encode(JSON.stringify(signal.payload)).length > 4096)) throw Error("payload");
      const target = this.peers().find(({ peer: candidate }) => candidate.key === signal.to && candidate.expiresAt > 0)?.socket;
      if (!target) throw Error("target");
      const recipient = target.deserializeAttachment() as Peer;
      const previous = peer.sequences[signal.to];
      if (recipient.expiresAt <= now || (previous?.nonce === recipient.nonce && signal.sequence <= previous.sequence)) throw Error("replay");
      const active = new Set(this.peers().map(({ peer: p }) => p.key));
      peer.sequences = Object.fromEntries(Object.entries(peer.sequences).filter(([key]) => active.has(key)));
      peer.sequences[signal.to] = { nonce: recipient.nonce, sequence: signal.sequence };
      socket.serializeAttachment(peer);
      // Clients verify end-to-end signatures before applying SDP/ICE. DO is not an identity authority.
      target.send(message);
    } catch { socket.close(1008,"Sinal inválido"); }
  }
  private async revokeCodes(room: string) {
    await this.env.CODES.get(this.env.CODES.idFromName("codes-v1")).fetch(new Request("https://codes.internal/revoke", { method: "POST", body: JSON.stringify({ room }) }));
  }
  private async rotateInvite(socket: WebSocket, peer: Peer, invite: Invite, raw: string, epoch: number) {
    const hash = await sha256(invite.capability);
    const registered = await this.state.storage.get<Registered>("host");
    if (registered?.hash === hash) throw Error("capability unchanged");
    // Renew the global registration too; rotation may extend the room beyond the
    // original invite's expiry. A rotation consumes one admission, never bypassing quotas.
    const admitted = await this.env.ADMISSION.get(this.env.ADMISSION.idFromName("global-v3")).fetch(new Request("https://budget.internal/admit", {
      method: "POST", body: JSON.stringify({room: peer.room, expiry: invite.expires_at, nonce: `renew:${hash}`, host: true}),
    }));
    if (!admitted.ok) throw Error("rotation quota");
    await this.revokeCodes(peer.room);
    await this.state.storage.put("host", { key: peer.key, hash, epoch, invite: raw } satisfies Registered);
    peer.expiresAt = invite.expires_at;
    peer.sequences = {};
    socket.serializeAttachment(peer);
    for (const guest of this.state.getWebSockets()) {
      const attachment = guest.deserializeAttachment() as Peer;
      if (attachment.key !== peer.key) {
        attachment.expiresAt = 0;
        guest.serializeAttachment(attachment);
        guest.send(JSON.stringify({ type: "invite-revoked" }));
        guest.close(1008,"Convite revogado pelo host");
      }
    }
    await this.state.storage.setAlarm(Math.min(invite.expires_at, Date.now() + LEASE_RENEW_MS));
    socket.send(JSON.stringify({ type: "invite-rotated", expires_at: invite.expires_at }));
  }
  async webSocketClose(socket: WebSocket) {
    const peer = socket.deserializeAttachment() as Peer;
    // A replaced socket already announced its departure and must not release the new host lease.
    if (peer.expiresAt !== 0 || !this.peers().some(({ socket: other, peer: p }) => other !== socket && p.key === peer.key)) {
      if (peer.host && !this.peers().some(({ socket: other, peer: p }) => other !== socket && p.host)) await this.lease("/release", peer.room);
      if (peer.expiresAt !== 0) for (const { socket: other } of this.peers()) if (other !== socket) other.send(JSON.stringify({ type: "peer-left", key: peer.key, session_nonce: peer.nonce }));
    }
    try { socket.close(1000,"Encerrado"); } catch { /* already closed */ }
  }
  async webSocketError(socket: WebSocket) { await this.webSocketClose(socket); }
  private async lease(action: "/renew" | "/release", room: string) {
    return this.env.ADMISSION.get(this.env.ADMISSION.idFromName("global-v3")).fetch(new Request(`https://budget.internal${action}`, { method: "POST", body: JSON.stringify({ room }) }));
  }
  async alarm() {
    let next = Number.MAX_SAFE_INTEGER;
    let hostRoom: string | undefined;
    for (const socket of this.state.getWebSockets()) {
      const peer = socket.deserializeAttachment() as Peer;
      if (peer.expiresAt <= Date.now()) socket.close(1008,"Sessão expirada");
      else { next = Math.min(next,peer.expiresAt); if (peer.host) hostRoom = peer.room; }
    }
    if (hostRoom) { await this.lease("/renew", hostRoom); next = Math.min(next, Date.now() + LEASE_RENEW_MS); }
    if (next !== Number.MAX_SAFE_INTEGER) await this.state.storage.setAlarm(next);
  }
}

// Short invite codes. One global instance; at most ten active rooms exist, so
// the table stays tiny. Lookups are throttled per client address and globally.
type CodeEntry = { room: string; invite: string; hash: string; expires_at: number };
const LOOKUPS_PER_MINUTE = 10;
const GLOBAL_FAILURES_PER_10_MIN = 600;
export class InviteCodes {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private failures: number[] = [];
  constructor(private state: DurableObjectState, private env: Env) {}
  private allow(client: string) {
    const now = Date.now();
    if (this.buckets.size > 5000) for (const [k, b] of this.buckets) if (now - b.at > 120_000) this.buckets.delete(k);
    const bucket = this.buckets.get(client) ?? { tokens: LOOKUPS_PER_MINUTE, at: now };
    bucket.tokens = Math.min(LOOKUPS_PER_MINUTE, bucket.tokens + (now - bucket.at) * LOOKUPS_PER_MINUTE / 60_000);
    bucket.at = now;
    this.failures = this.failures.filter(t => now - t < 600_000);
    if (bucket.tokens < 1 || this.failures.length >= GLOBAL_FAILURES_PER_10_MIN) { this.buckets.set(client, bucket); return false; }
    bucket.tokens -= 1;
    this.buckets.set(client, bucket);
    return true;
  }
  private generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const raw = Array.from(bytes, b => CODE_ALPHABET[b & 31]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  }
  async fetch(request: Request) {
    const action = new URL(request.url).pathname;
    const data = await request.json() as { room?: string; invite?: string; hash?: string; expires_at?: number; code?: string; client?: string };
    const now = Date.now();
    if (action === "/resolve") {
      if (!this.allow(String(data.client ?? "local").slice(0, 64))) return error("Rate", 429);
      const entry = typeof data.code === "string" ? await this.state.storage.get<CodeEntry>(`code:${data.code}`) : undefined;
      if (!entry || entry.expires_at <= now) { this.failures.push(now); if (entry) await this.state.storage.delete(`code:${data.code}`); return error("Código", 404); }
      return Response.json({ invite: entry.invite });
    }
    if (typeof data.room !== "string" || !/^[a-f0-9-]{36}$/.test(data.room)) return error("Sala", 400);
    if (action === "/revoke") {
      const current = await this.state.storage.get<{ code: string }>(`room:${data.room}`);
      if (current) await this.state.storage.delete([`room:${data.room}`, `code:${current.code}`]);
      return new Response("ok");
    }
    if (action !== "/register" || typeof data.invite !== "string" || typeof data.hash !== "string" || !Number.isSafeInteger(data.expires_at)) return error("Ação", 404);
    const current = await this.state.storage.get<{ code: string; hash: string; expires_at: number }>(`room:${data.room}`);
    if (current && current.hash === data.hash && current.expires_at > now) return Response.json({ code: current.code });
    if (current) await this.state.storage.delete([`room:${data.room}`, `code:${current.code}`]);
    let code = "";
    for (let attempt = 0; attempt < 8 && !code; attempt++) {
      const candidate = this.generate();
      const existing = await this.state.storage.get<CodeEntry>(`code:${candidate}`);
      if (!existing || existing.expires_at <= now) code = candidate;
    }
    if (!code) return error("Colisão", 503);
    await this.state.storage.put({ [`code:${code}`]: { room: data.room, invite: data.invite, hash: data.hash, expires_at: data.expires_at! } satisfies CodeEntry, [`room:${data.room}`]: { code, hash: data.hash, expires_at: data.expires_at! } });
    // Opportunistic cleanup keeps storage bounded without a scheduled job.
    if (Math.random() < 0.1) {
      const all = await this.state.storage.list<CodeEntry>({ prefix: "code:", limit: 500 });
      const expired = [...all].filter(([, e]) => e.expires_at <= now).map(([k]) => k);
      if (expired.length) await this.state.storage.delete(expired.slice(0, 128));
    }
    return Response.json({ code });
  }
}
