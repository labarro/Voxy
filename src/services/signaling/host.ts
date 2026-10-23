import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { Server } from "socket.io";
import { z } from "zod";
import { Store } from "../../database/store";
import { MAX_PARTICIPANTS } from "../../shared/constants";
import {
  commandSchema,
  signalSchema,
  publicProfileSchema,
  roomIPv4,
  historySchema,
} from "../../shared/validation";
import type {
  Participant,
  Reply,
  Command,
  RoomState,
  DirectCall,
} from "../../shared/types";
import { validateImage } from "../../shared/image";
export class RoomHost {
  private io: Server;
  private http: HttpServer;
  private people = new Map<string, Participant>();
  private ownerKey: string;
  private identityScope: string;
  private calls = new Map<string, DirectCall>();
  private callTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private store: Store,
    private token: string,
    ownerKey: string,
  ) {
    this.ownerKey = ownerKey;
    this.identityScope = createHash("sha256").update(token).digest("hex");
    let probeBudget = 80,
      probeAt = Date.now();
    this.http = createServer((req, res) => {
      if (
        req.method !== "POST" ||
        req.url !== "/availability" ||
        req.headers.origin
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      const now = Date.now();
      probeBudget = Math.min(80, probeBudget + (now - probeAt) / 1000);
      probeAt = now;
      if (--probeBudget < 0) {
        res.writeHead(429);
        res.end();
        return;
      }
      let data = "";
      req.setTimeout(2000, () => req.destroy());
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1024) req.destroy();
      });
      req.on("end", () => {
        try {
          const value = z
            .object({
              token: z.string().regex(/^[a-f0-9]{64}$/),
              serverId: z.string().min(1).max(100),
            })
            .parse(JSON.parse(data));
          if (!timingSafeEqual(Buffer.from(value.token), Buffer.from(token))) {
            res.writeHead(401);
            res.end();
            return;
          }
          const exists = this.store
            .snapshot()
            .servers.some((s) => s.id === value.serverId);
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(
            JSON.stringify({
              status: !exists
                ? "missing"
                : this.people.size >= MAX_PARTICIPANTS
                  ? "full"
                  : "available",
            }),
          );
        } catch {
          res.writeHead(401);
          res.end();
        }
      });
      req.on("error", () => {});
    });
    this.io = new Server(this.http, {
      maxHttpBufferSize: 3 * 1024 * 1024,
      serveClient: false,
      transports: ["websocket"],
      pingTimeout: 10000,
      pingInterval: 5000,
      allowRequest: (req, cb) => cb(null, !req.headers.origin),
    });
    this.io.use((socket, next) => {
      const auth = socket.handshake.auth;
      if (auth.protocol !== 2)
        return next(
          Error(
            "Versão incompatível. Atualize todos os participantes para Voxy 0.4.0 ou posterior.",
          ),
        );
      const p = publicProfileSchema.safeParse(auth.profile);
      const secret =
          typeof auth.token === "string"
            ? Buffer.from(auth.token)
            : Buffer.alloc(0),
        expected = Buffer.from(token);
      if (
        !p.success ||
        secret.length !== expected.length ||
        !timingSafeEqual(secret, expected)
      )
        return next(Error("Convite ou perfil inválido."));
      if (this.people.size >= MAX_PARTICIPANTS)
        return next(Error(`A sala está cheia (${MAX_PARTICIPANTS} pessoas).`));
      if ([...this.people.values()].some((x) => x.profile.id === p.data.id))
        return next(Error("Este perfil já está conectado."));
      try {
        if (
          auth.identityKey !== undefined &&
          !/^[a-f0-9]{64}$/.test(auth.identityKey)
        )
          throw Error("Identidade inválida.");
        socket.data.privateIdentity = this.store.direct.authorize(
          p.data.id,
          this.identityScope,
          auth.identityKey,
        );
        socket.data.profile = {
          ...p.data,
          avatar: this.store.registerAvatar(p.data.avatar),
          banner: p.data.banner ? this.store.registerAvatar(p.data.banner) : "",
        };
      } catch (error) {
        return next(
          Error(
            error instanceof Error
              ? error.message
              : "Não foi possível validar o perfil.",
          ),
        );
      }
      socket.data.host = auth.ownerKey === this.ownerKey;
      if (socket.data.host) this.store.claimLegacyServers(p.data.id);
      next();
    });
    this.io.on("connection", (socket) => {
      const profile = socket.data.profile;
      this.people.set(socket.id, {
        id: socket.id,
        profile: {
          id: profile.id,
          name: profile.name,
          avatar: profile.avatar,
          presence: profile.presence,
          nicknameColor: profile.nicknameColor,
          banner: profile.banner,
          mediaSubscriptions: profile.mediaSubscriptions,
        },
        channelId: null,
        muted: false,
        deafened: false,
        sharing: false,
        camera: false,
        host: socket.data.host,
      });
      this.store.direct.remember(profile);
      this.store.rememberProfile(this.people.get(socket.id)!.profile);
      let budget = 120,
        last = Date.now();
      let lastImage = 0;
      const limited = () => {
        const now = Date.now();
        budget = Math.min(120, budget + (now - last) * 0.06);
        last = now;
        if (--budget < 0) throw Error("Muitas ações. Aguarde um momento.");
      };
      socket.on("command", (raw: unknown, ack: unknown) => {
        const reply = typeof ack === "function" ? ack : () => {};
        try {
          limited();
          const c = commandSchema.parse(raw);
          if (
            (c.type.startsWith("friend.") || c.type.startsWith("call.")) &&
            !socket.data.privateIdentity
          )
            throw Error(
              "Atualize o aplicativo para usar amigos e chamadas privadas.",
            );
          if (
            (c.type === "message" || c.type === "direct.message") &&
            c.image
          ) {
            if (Date.now() - lastImage < 2000)
              throw Error("Aguarde 2 segundos entre imagens.");
            validateImage(c.image);
            lastImage = Date.now();
          }
          if (
            c.type === "direct.message" ||
            c.type === "direct.edit" ||
            c.type === "direct.delete" ||
            c.type === "direct.react"
          ) {
            if (!socket.data.privateIdentity)
              throw Error(
                "Atualize o aplicativo para usar mensagens privadas.",
              );
            const person = this.people.get(socket.id)!;
            if (
              c.scope !==
              createHash("sha256")
                .update(person.profile.id + ":" + this.token)
                .digest("hex")
            )
              throw Error("Esta conversa pertence a outra sala.");
            const targets =
              c.type === "direct.message"
                ? this.store.direct.message(
                    person.profile,
                    c.recipient,
                    c.text,
                    this.identityScope,
                    c.image,
                    c.replyTo,
                  )
                : c.type === "direct.react"
                  ? this.store.direct.react(c.id, person.profile.id, c.emoji)
                  : this.store.direct.change(
                      c.id,
                      person.profile.id,
                      c.type === "direct.edit" ? c.text : undefined,
                    );
            this.broadcastDirect(targets);
            if (c.type !== "direct.message") {
              for (const target of this.io.sockets.sockets.values()) {
                const viewer = this.people.get(target.id)?.profile.id;
                if (
                  !viewer ||
                  !targets.includes(viewer) ||
                  !target.data.privateIdentity
                )
                  continue;
                const peer = targets.find((id) => id !== viewer)!;
                const message = this.store.direct.history(viewer, {
                  peer,
                  messageId: c.id,
                })[0];
                target.emit("message-update", { id: c.id, peer, message });
              }
            }
          } else {
            const changed =
              c.type === "message.edit" ||
              c.type === "message.delete" ||
              c.type === "message.react"
                ? this.store.messageRecord(c.id)
                : undefined;
            this.command(socket.id, c);
            this.broadcast();
            if (changed)
              this.io.emit("message-update", {
                id: changed.id,
                channelId: changed.channelId,
                message: this.store.history({
                  channelId: changed.channelId,
                  messageId: changed.id,
                })[0],
              });
            if (c.type === "profile" || c.type.startsWith("friend."))
              this.broadcastDirect();
          }
          reply({ ok: true, value: null });
        } catch (e) {
          reply({
            ok: false,
            error:
              e instanceof z.ZodError ? "Ação inválida." : (e as Error).message,
          });
        }
      });
      socket.on("signal", (raw: unknown, ack: unknown) => {
        const reply = typeof ack === "function" ? ack : () => {};
        try {
          limited();
          const s = signalSchema.parse(raw),
            from = this.people.get(socket.id),
            to = this.people.get(s.to);
          if (
            !from?.channelId ||
            from.channelId !== to?.channelId ||
            s.to === socket.id
          )
            throw Error("Sinalização fora do canal.");
          this.io.to(s.to).emit("signal", { ...s, from: socket.id });
          reply({ ok: true, value: null });
        } catch {
          reply({ ok: false, error: "Sinalização inválida ou fora do canal." });
        }
      });
      socket.on("image", (raw: unknown, ack: unknown) => {
        const reply = typeof ack === "function" ? ack : () => {};
        try {
          limited();
          const id = z.uuid().parse(raw);
          reply({ ok: true, value: this.store.image(id) });
        } catch {
          reply({
            ok: false,
            error: "Imagem não encontrada ou pedido inválido.",
          });
        }
      });
      socket.on("profile-image", (raw: unknown, ack: unknown) => {
        const reply = typeof ack === "function" ? ack : () => {};
        try {
          limited();
          const id = z
            .string()
            .regex(/^avatar:[a-f0-9]{64}$/)
            .parse(raw);
          const data = this.store.avatarImages([id])[id];
          if (!data) throw Error();
          reply({ ok: true, value: data });
        } catch {
          reply({ ok: false, error: "Capa indisponível nesta sala." });
        }
      });
      socket.on("history", (raw: unknown, ack: unknown) => {
        const reply = typeof ack === "function" ? ack : () => {};
        try {
          limited();
          const q = historySchema.parse(raw),
            person = this.people.get(socket.id)!;
          if (q.scope) {
            if (
              !socket.data.privateIdentity ||
              q.scope !==
                createHash("sha256")
                  .update(person.profile.id + ":" + this.token)
                  .digest("hex")
            )
              throw Error("Conversa privada indisponível.");
            reply({
              ok: true,
              value: this.store.direct.history(person.profile.id, q),
            });
          } else {
            if (
              !this.store
                .snapshot()
                .channels.some((c) => c.id === q.channelId && c.kind === "text")
            )
              throw Error("Canal inexistente.");
            reply({ ok: true, value: this.store.history(q) });
          }
        } catch {
          reply({
            ok: false,
            error: "Não foi possível carregar o histórico desta conversa.",
          });
        }
      });
      socket.on("direct-image", (raw: unknown, ack: unknown) => {
        const reply = typeof ack === "function" ? ack : () => {};
        try {
          limited();
          if (!socket.data.privateIdentity) throw Error();
          reply({
            ok: true,
            value: this.store.direct.image(z.uuid().parse(raw), profile.id),
          });
        } catch {
          reply({
            ok: false,
            error: "Imagem privada indisponível para este perfil.",
          });
        }
      });
      socket.on("disconnect", () => {
        for (const call of this.calls.values())
          if ([call.caller, call.recipient].includes(profile.id))
            this.endCall(call.id);
        this.people.delete(socket.id);
        this.broadcast();
      });
      this.broadcast();
      this.broadcastDirect();
    });
  }
  state(viewer?: string, state = this.store.snapshot()): RoomState {
    return {
      protocol: 2,
      features: {
        directMessages: true,
        presence: true,
        mediaSubscriptions: true,
        social: true,
        richChat: true,
      },
      ...state,
      friendships: viewer ? this.store.social.snapshot(viewer) : [],
      calls: [...this.calls.values()].filter(
        (c) => viewer && [c.caller, c.recipient].includes(viewer),
      ),
      channels: [
        ...state.channels,
        ...[...this.calls.values()]
          .filter(
            (c) =>
              c.accepted && viewer && [c.caller, c.recipient].includes(viewer),
          )
          .map((c) => ({
            id: c.id,
            serverId: state.servers[0]?.id || "",
            name: "Chamada privada",
            kind: "voice" as const,
            privateMembers: [c.caller, c.recipient],
          })),
      ],
      avatars: {
        ...state.avatars,
        ...this.store.avatarImages(
          [...this.people.values()].map((p) => p.profile.avatar),
        ),
      },
      participants: [...this.people.values()],
    };
  }
  private broadcast() {
    const snapshot = this.store.snapshot();
    for (const socket of this.io.sockets.sockets.values())
      socket.emit(
        "state",
        this.state(this.people.get(socket.id)?.profile.id, snapshot),
      );
  }
  private broadcastDirect(targets?: string[]) {
    for (const socket of this.io.sockets.sockets.values()) {
      const person = this.people.get(socket.id);
      if (
        !person ||
        !socket.data.privateIdentity ||
        (targets && !targets.includes(person.profile.id))
      )
        continue;
      const snapshot = this.store.direct.snapshot(
        person.profile.id,
        this.identityScope,
      );
      socket.emit("direct", {
        friendships: this.store.social.snapshot(person.profile.id),
        ...snapshot,
        avatars: this.store.avatarImages([
          ...snapshot.contacts.map((c) => c.avatar),
          ...snapshot.messages.map((m) => m.avatar),
        ]),
      });
    }
  }
  private command(socketId: string, c: Command) {
    const p = this.people.get(socketId);
    if (!p) throw Error("Participante desconectado.");
    const state = this.store.snapshot();
    if (
      (c.type.startsWith("server.") || c.type.startsWith("channel.")) &&
      c.type !== "server.icon" &&
      !p.host
    )
      throw Error("Somente o host pode gerenciar servidores e canais.");
    switch (c.type) {
      case "friend.request":
      case "friend.respond":
      case "friend.remove":
        this.store.social.change(
          p.profile.id,
          c.memberId,
          c.type === "friend.request"
            ? "request"
            : c.type === "friend.remove"
              ? "remove"
              : c.accept
                ? "accept"
                : "decline",
        );
        break;
      case "call.invite": {
        if (!this.store.social.friends(p.profile.id, c.memberId))
          throw Error("Adicione esta pessoa aos amigos antes de ligar.");
        if (![...this.people.values()].some((x) => x.profile.id === c.memberId))
          throw Error("Esta pessoa está offline.");
        if (
          [...this.calls.values()].some((call) =>
            [call.caller, call.recipient].some(
              (id) => id === p.profile.id || id === c.memberId,
            ),
          )
        )
          throw Error("Uma das pessoas já está em outra chamada privada.");
        const call = {
          id: randomUUID(),
          caller: p.profile.id,
          recipient: c.memberId,
          accepted: false,
          createdAt: Date.now(),
        };
        this.calls.set(call.id, call);
        this.callTimers.set(
          call.id,
          setTimeout(() => {
            this.endCall(call.id);
            this.broadcast();
          }, 45000),
        );
        break;
      }
      case "call.respond": {
        const call = this.calls.get(c.id);
        if (!call || call.recipient !== p.profile.id || call.accepted)
          throw Error("Convite de chamada indisponível.");
        if (!c.accept) this.endCall(c.id);
        else {
          call.accepted = true;
          clearTimeout(this.callTimers.get(c.id));
          this.callTimers.delete(c.id);
        }
        break;
      }
      case "call.end": {
        const call = this.calls.get(c.id);
        if (!call || ![call.caller, call.recipient].includes(p.profile.id))
          throw Error("Chamada privada indisponível.");
        this.endCall(c.id);
        break;
      }
      case "role.save":
      case "role.delete":
      case "role.assign":
        this.store.manageRole(p.profile.id, c);
        break;
      case "server.create":
        if (state.servers.length >= 20) throw Error("Limite de servidores.");
        this.store.createServer(c.name, p.profile.id);
        break;
      case "server.rename":
        this.store.rename("servers", c.id, c.name);
        break;
      case "server.delete":
        this.store.delete("servers", c.id);
        break;
      case "server.icon":
        this.store.setServerIcon(c.id, p.profile.id, c.image);
        break;
      case "channel.create":
        if (state.channels.length >= 100) throw Error("Limite de canais.");
        this.store.createChannel(c.serverId, c.name, c.kind);
        break;
      case "channel.rename":
        this.store.rename("channels", c.id, c.name);
        break;
      case "channel.delete":
        this.store.delete("channels", c.id);
        break;
      case "message":
        if (
          !state.channels.some((x) => x.id === c.channelId && x.kind === "text")
        )
          throw Error("Canal de texto inexistente.");
        this.store.message(
          {
            id: randomUUID(),
            channelId: c.channelId,
            author: p.profile.id,
            name: p.profile.name,
            avatar: p.profile.avatar,
            text: c.text,
            time: Date.now(),
            replyTo: c.replyTo,
          },
          c.image,
        );
        break;
      case "message.edit":
        this.store.changeMessage(c.id, p.profile.id, c.text);
        break;
      case "message.delete":
        this.store.changeMessage(c.id, p.profile.id);
        break;
      case "message.react":
        this.store.react(c.id, p.profile.id, c.emoji);
        break;
      case "voice":
        if (
          p.channelId &&
          this.calls.has(p.channelId) &&
          p.channelId !== c.channelId
        )
          this.endCall(p.channelId);
        if (
          c.channelId !== null &&
          !this.state(p.profile.id).channels.some(
            (x) => x.id === c.channelId && x.kind === "voice",
          )
        )
          throw Error("Canal de voz inexistente.");
        p.channelId = c.channelId;
        p.sharing = false;
        p.camera = false;
        break;
      case "status":
        p.muted = c.muted;
        p.microphoneState = c.microphoneState ?? (c.muted ? "muted" : "active");
        p.deafened = c.deafened;
        p.sharing = !!p.channelId && c.sharing;
        if (c.camera !== undefined) p.camera = !!p.channelId && c.camera;
        break;
      case "profile":
        p.profile.name = c.name;
        p.profile.avatar = this.store.registerAvatar(c.avatar);
        if (c.presence !== undefined) p.profile.presence = c.presence;
        if (c.nicknameColor !== undefined)
          p.profile.nicknameColor = c.nicknameColor;
        if (c.banner !== undefined)
          p.profile.banner = c.banner
            ? this.store.registerAvatar(c.banner)
            : "";
        this.store.rememberProfile(p.profile);
        this.store.direct.remember(p.profile);
        break;
    }
    const ids = new Set([
      ...this.store.snapshot().channels.map((x) => x.id),
      ...[...this.calls.values()].filter((c) => c.accepted).map((c) => c.id),
    ]);
    for (const person of this.people.values())
      if (person.channelId && !ids.has(person.channelId)) {
        person.channelId = null;
        person.sharing = false;
        person.camera = false;
      }
  }
  private endCall(id: string) {
    clearTimeout(this.callTimers.get(id));
    this.callTimers.delete(id);
    this.calls.delete(id);
    for (const p of this.people.values())
      if (p.channelId === id) {
        p.channelId = null;
        p.sharing = false;
        p.camera = false;
      }
  }
  async listen(address: string, port: number) {
    if (!roomIPv4(address)) throw Error("Escolha um IPv4 privado ou loopback.");
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(port, address, () => {
        this.http.off("error", reject);
        resolve();
      });
    });
    return (this.http.address() as { port: number }).port;
  }
  async close() {
    for (const timer of this.callTimers.values()) clearTimeout(timer);
    this.callTimers.clear();
    this.calls.clear();
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}
