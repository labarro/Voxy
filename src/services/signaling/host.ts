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
} from "../../shared/validation";
import type {
  Participant,
  Reply,
  Command,
  RoomState,
} from "../../shared/types";
import { validateImage } from "../../shared/image";
export class RoomHost {
  private io: Server;
  private http: HttpServer;
  private people = new Map<string, Participant>();
  private ownerKey: string;
  private identityScope: string;
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
        },
        channelId: null,
        muted: false,
        deafened: false,
        sharing: false,
        camera: false,
        host: socket.data.host,
      });
      this.store.direct.remember(profile);
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
            c.type === "direct.delete"
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
                  )
                : this.store.direct.change(
                    c.id,
                    person.profile.id,
                    c.type === "direct.edit" ? c.text : undefined,
                  );
            this.broadcastDirect(targets);
          } else {
            this.command(socket.id, c);
            this.broadcast();
            if (c.type === "profile") this.broadcastDirect();
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
        this.people.delete(socket.id);
        this.broadcast();
      });
      this.broadcast();
      this.broadcastDirect();
    });
  }
  state(): RoomState {
    const state = this.store.snapshot();
    return {
      protocol: 2,
      features: { directMessages: true, presence: true },
      ...state,
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
    this.io.emit("state", this.state());
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
      case "voice":
        if (
          c.channelId !== null &&
          !state.channels.some(
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
        p.deafened = c.deafened;
        p.sharing = !!p.channelId && c.sharing;
        if (c.camera !== undefined) p.camera = !!p.channelId && c.camera;
        break;
      case "profile":
        p.profile.name = c.name;
        p.profile.avatar = this.store.registerAvatar(c.avatar);
        if (c.presence !== undefined) p.profile.presence = c.presence;
        this.store.direct.remember(p.profile);
        break;
    }
    const ids = new Set(this.store.snapshot().channels.map((x) => x.id));
    for (const person of this.people.values())
      if (person.channelId && !ids.has(person.channelId)) {
        person.channelId = null;
        person.sharing = false;
        person.camera = false;
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
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}
