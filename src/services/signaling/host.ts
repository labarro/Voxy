import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
  constructor(
    private store: Store,
    private token: string,
    ownerKey: string,
  ) {
    this.ownerKey = ownerKey;
    this.http = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
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
      socket.data.profile = p.data;
      socket.data.host = auth.ownerKey === this.ownerKey;
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
        },
        channelId: null,
        muted: false,
        deafened: false,
        sharing: false,
        host: socket.data.host,
      });
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
          if (c.type === "message" && c.image) {
            if (Date.now() - lastImage < 2000)
              throw Error("Aguarde 2 segundos entre imagens.");
            validateImage(c.image);
            lastImage = Date.now();
          }
          this.command(socket.id, c);
          this.broadcast();
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
      socket.on("disconnect", () => {
        this.people.delete(socket.id);
        this.broadcast();
      });
      this.broadcast();
    });
  }
  state(): RoomState {
    return {
      ...this.store.snapshot(),
      participants: [...this.people.values()],
    };
  }
  private broadcast() {
    this.io.emit("state", this.state());
  }
  private command(socketId: string, c: Command) {
    const p = this.people.get(socketId);
    if (!p) throw Error("Participante desconectado.");
    const state = this.store.snapshot();
    if (
      (c.type.startsWith("server.") || c.type.startsWith("channel.")) &&
      !p.host
    )
      throw Error("Somente o host pode gerenciar servidores e canais.");
    switch (c.type) {
      case "server.create":
        if (state.servers.length >= 20) throw Error("Limite de servidores.");
        this.store.createServer(c.name);
        break;
      case "server.rename":
        this.store.rename("servers", c.id, c.name);
        break;
      case "server.delete":
        this.store.delete("servers", c.id);
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
        break;
      case "status":
        p.muted = c.muted;
        p.deafened = c.deafened;
        p.sharing = !!p.channelId && c.sharing;
        break;
      case "profile":
        p.profile.name = c.name;
        p.profile.avatar = c.avatar;
        break;
    }
    const ids = new Set(this.store.snapshot().channels.map((x) => x.id));
    for (const person of this.people.values())
      if (person.channelId && !ids.has(person.channelId)) {
        person.channelId = null;
        person.sharing = false;
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
