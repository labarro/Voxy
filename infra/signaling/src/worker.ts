// Rendezvous only. No chat history, files, media, TURN token or billable relay.
interface Env {
  ROOMS: DurableObjectNamespace;
  ADMISSION: DurableObjectNamespace;
  VOXY_DEPLOYMENT_ENABLED: string;
  VOXY_RELAY_ENABLED: string;
  VOXY_DAILY_ADMISSIONS: string;
  VOXY_MAX_ROOMS: string;
}
type Invite = { protocol: number; room: string; host_key: string; signal_url: string; capability: string; expires_at: number; signature: string };
type Peer = { key: string; host: boolean; tokens: number; updatedAt: number; expiresAt: number; nonce: string };
const encoder = new TextEncoder();
const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
function decode(raw: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw Error("encoding");
  return Uint8Array.from(atob(raw.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}
async function verify(key: string, bytes: Uint8Array<ArrayBuffer>, signature: string) {
  const publicKey = await crypto.subtle.importKey("raw", decode(key), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", publicKey, decode(signature), bytes);
}
async function parseInvite(request: Request, room: string): Promise<Invite> {
  const raw = request.headers.get("X-Voxy-Invite") ?? "";
  if (raw.length > 8192 || !raw.startsWith("voxy://join/")) throw Error("invite");
  const invite: Invite = JSON.parse(new TextDecoder().decode(decode(raw.slice(12))));
  const fields = ["protocol", "room", "host_key", "signal_url", "capability", "expires_at", "signature"];
  if (Object.keys(invite).some(k => !fields.includes(k)) || fields.some(k => !(k in invite))) throw Error("schema");
  if (invite.protocol !== 3 || invite.room !== room || !Number.isSafeInteger(invite.expires_at) || invite.expires_at <= Date.now() || invite.expires_at > Date.now() + 7 * 86400000) throw Error("expired");
  if (decode(invite.host_key).length !== 32 || decode(invite.capability).length !== 32) throw Error("capability");
  const endpoint = new URL(invite.signal_url);
  const current = new URL(request.url);
  const expected = `${current.protocol === "https:" ? "wss:" : "ws:"}//${current.host}/v3/${room}`;
  if (endpoint.href !== expected || !await verify(invite.host_key, encoder.encode(JSON.stringify(["voxy-invite-v3",3,room,invite.host_key,invite.signal_url,invite.capability,invite.expires_at])), invite.signature)) throw Error("signature");
  return invite;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.VOXY_DEPLOYMENT_ENABLED !== "true") return error("Implantação experimental desativada", 503);
    // Even a configuration mistake must not activate a paid API.
    if (env.VOXY_RELAY_ENABLED !== "false") return error("Relay não homologado", 503);
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") return Response.json({ protocol: 3, relay: false, transport: "signaling-only" });
    const match = /^\/v3\/([a-f0-9-]{36})$/.exec(path);
    if (!match || request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("Rota inválida", 404);
    if (request.headers.has("Origin")) return error("Cliente não autorizado", 403);
    let invite: Invite;
    try { invite = await parseInvite(request, match[1]); } catch { return error("Convite inválido ou expirado", 403); }
    const key = request.headers.get("X-Voxy-Peer") ?? "";
    const signature = request.headers.get("X-Voxy-Proof") ?? "";
    const nonce = request.headers.get("X-Voxy-Nonce") ?? "";
    const timestamp = Number(request.headers.get("X-Voxy-Time"));
    try {
      if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 30000 || decode(nonce).length !== 16 || decode(key).length !== 32) return error("Sessão inválida", 403);
      const proof = encoder.encode(JSON.stringify(["voxy-admission-v3", invite.room, invite.capability, key, nonce, timestamp]));
      if (!await verify(key, proof, signature)) return error("Identidade inválida", 403);
    } catch { return error("Identidade inválida", 403); }
    const admitted = await env.ADMISSION.get(env.ADMISSION.idFromName("global-v3")).fetch(new Request("https://budget.internal/admit", { method: "POST", body: JSON.stringify({ room: invite.room, expiry: invite.expires_at, nonce, host: key === invite.host_key }) }));
    if (!admitted.ok) return error("Limite gratuito de admissões atingido; tente mais tarde", 429);
    return env.ROOMS.get(env.ROOMS.idFromName(invite.room)).fetch(request);
  }
};

export class AdmissionBudget {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(request: Request) {
    const data = await request.json() as { room: string; expiry: number; nonce: string; host: boolean };
    return this.state.storage.transaction(async tx => {
      const today = new Date().toISOString().slice(0,10);
      const old = await tx.get<{ day: string; count: number; rooms: Record<string, number>; nonces: Record<string, number> }>("budget");
      const budget = old?.day === today ? old : { day: today, count: 0, rooms: {}, nonces: {} };
      const now = Date.now();
      budget.rooms = Object.fromEntries(Object.entries(budget.rooms).filter(([,expires]) => expires > now));
      budget.nonces = Object.fromEntries(Object.entries(budget.nonces).filter(([,expires]) => expires > now));
      if (budget.nonces[data.nonce] || budget.count >= Math.min(10000, Number(this.env.VOXY_DAILY_ADMISSIONS) || 1000)) return error("Quota", 429);
      if (!(data.room in budget.rooms)) {
        if (!data.host || Object.keys(budget.rooms).length >= Math.min(10, Number(this.env.VOXY_MAX_ROOMS) || 10)) return error("Room quota", 429);
        budget.rooms[data.room] = data.expiry;
      }
      budget.nonces[data.nonce] = now + 60000;
      budget.count++;
      await tx.put("budget", budget);
      return new Response("ok");
    });
  }
}

export class SignalRoom {
  constructor(private state: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
    const match = /^\/v3\/([a-f0-9-]{36})$/.exec(new URL(request.url).pathname);
    if (!match) return error("Room",404);
    let invite: Invite;
    try { invite = await parseInvite(request, match[1]); } catch { return error("Convite",403); }
    const key = request.headers.get("X-Voxy-Peer")!;
    const host = key === invite.host_key;
    const capabilityHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(invite.capability)))).map(b => b.toString(16).padStart(2,"0")).join("");
    const registered = await this.state.storage.get<{ key: string; hash: string }>("host");
    if (!registered) {
      if (!host) return error("Host offline",409);
      await this.state.storage.put("host", { key, hash: capabilityHash });
    } else if (registered.key !== invite.host_key) return error("Host incorreto",403);
    else if (registered.hash !== capabilityHash) {
      if (!host) return error("Convite revogado",403);
      if (this.state.getWebSockets().some(s => (s.deserializeAttachment() as Peer).host)) return error("Host já conectado",409);
      for (const old of this.state.getWebSockets()) old.close(1008,"Convite renovado pelo host");
      await this.state.storage.put("host", { key, hash: capabilityHash });
    }
    const sockets = this.state.getWebSockets();
    if (sockets.length >= 10 || sockets.some(s => (s.deserializeAttachment() as Peer).key === key)) return error("Sala cheia ou identidade já conectada",409);
    if (!host && !sockets.some(s => (s.deserializeAttachment() as Peer).host)) return error("Host offline",409);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ key, host, tokens: 512, updatedAt: Date.now(), expiresAt: invite.expires_at, nonce: request.headers.get("X-Voxy-Nonce")! } satisfies Peer);
    const alarm = await this.state.storage.getAlarm();
    if (!alarm || alarm > invite.expires_at) await this.state.storage.setAlarm(invite.expires_at);
    server.send(JSON.stringify({ type: "welcome", peers: sockets.map(s => { const p = s.deserializeAttachment() as Peer; return { key: p.key, host: p.host, session_nonce: p.nonce }; }) }));
    for (const socket of sockets) socket.send(JSON.stringify({ type: "peer-joined", key, host, session_nonce: request.headers.get("X-Voxy-Nonce") }));
    return new Response(null, { status: 101, webSocket: client });
    });
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || encoder.encode(message).length > 65536) { socket.close(1009,"Limite de sinalização"); return; }
    const peer = socket.deserializeAttachment() as Peer;
    if (peer.expiresAt <= Date.now()) { socket.close(1008,"Sessão expirada"); return; }
    const now = Date.now(); peer.tokens = Math.min(512, peer.tokens + (now - peer.updatedAt) * .128); peer.updatedAt = now;
    if (--peer.tokens < 0) { socket.close(1008,"Rate limit"); return; }
    socket.serializeAttachment(peer);
    try {
      const signal = JSON.parse(message);
      if (signal.from !== peer.key || signal.session_nonce !== peer.nonce || typeof signal.to !== "string" || signal.to === peer.key || !Number.isSafeInteger(signal.sequence) || signal.expires_at <= now) throw Error("signal");
      const target = this.state.getWebSockets().find(s => (s.deserializeAttachment() as Peer).key === signal.to);
      if (!target) throw Error("target");
      // Clients verify end-to-end signatures before applying SDP/ICE. DO is not an identity authority.
      target.send(message);
    } catch { socket.close(1008,"Sinal inválido"); }
  }
  async webSocketClose(socket: WebSocket) {
    const peer = socket.deserializeAttachment() as Peer;
    for (const other of this.state.getWebSockets()) if (other !== socket) other.send(JSON.stringify({ type: "peer-left", key: peer.key }));
    try { socket.close(1000,"Encerrado"); } catch { /* already closed */ }
  }
  async webSocketError(socket: WebSocket) { await this.webSocketClose(socket); }
  async alarm() {
    let next = Number.MAX_SAFE_INTEGER;
    for (const socket of this.state.getWebSockets()) {
      const peer = socket.deserializeAttachment() as Peer;
      if (peer.expiresAt <= Date.now()) socket.close(1008,"Sessão expirada");
      else next = Math.min(next,peer.expiresAt);
    }
    if (next !== Number.MAX_SAFE_INTEGER) await this.state.storage.setAlarm(next);
  }
}
