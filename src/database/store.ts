import initSqlJs, { type Database } from "sql.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type {
  Channel,
  Community,
  Message,
  ServerRole,
  MemberRole,
  Participant,
} from "../shared/types";
import { DirectStore } from "./direct";
import { SocialStore } from "./social";
export class Store {
  private cachedSnapshot?: ReturnType<Store["snapshot"]>;
  readonly social: SocialStore;
  readonly direct: DirectStore;
  private constructor(
    private db: Database,
    private path: string,
  ) {
    this.direct = new DirectStore(db, () => this.flush());
    this.social = new SocialStore(db, () => this.flush());
  }
  static async open(path: string) {
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const db = new SQL.Database(
      existsSync(path) ? readFileSync(path) : undefined,
    );
    db.run(
      "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS servers(id TEXT PRIMARY KEY,name TEXT NOT NULL); CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,serverId TEXT REFERENCES servers(id) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,channelId TEXT REFERENCES channels(id) ON DELETE CASCADE,author TEXT,name TEXT,avatar TEXT,text TEXT,time INTEGER); CREATE INDEX IF NOT EXISTS message_channel_time ON messages(channelId,time);",
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,messageId TEXT UNIQUE REFERENCES messages(id) ON DELETE CASCADE,data TEXT NOT NULL)",
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS avatars(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    const columns = db.exec("PRAGMA table_info(messages)")[0]?.values ?? [];
    db.run(
      "CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY,serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT NOT NULL,position INTEGER NOT NULL,permissions TEXT NOT NULL DEFAULT '[]'); CREATE TABLE IF NOT EXISTS member_roles(serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,roleId TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,memberId TEXT NOT NULL,PRIMARY KEY(roleId,memberId)); CREATE TABLE IF NOT EXISTS public_profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    if (!columns.some((row) => row[1] === "editedAt"))
      db.run("ALTER TABLE messages ADD COLUMN editedAt INTEGER");
    if (!columns.some((row) => row[1] === "replyTo"))
      db.run("ALTER TABLE messages ADD COLUMN replyTo TEXT");
    db.run(
      "CREATE TABLE IF NOT EXISTS reactions(messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,memberId TEXT NOT NULL,emoji TEXT NOT NULL,PRIMARY KEY(messageId,memberId,emoji))",
    );
    const serverColumns =
      db.exec("PRAGMA table_info(servers)")[0]?.values ?? [];
    if (!serverColumns.some((row) => row[1] === "ownerId"))
      db.run("ALTER TABLE servers ADD COLUMN ownerId TEXT");
    if (!serverColumns.some((row) => row[1] === "icon"))
      db.run("ALTER TABLE servers ADD COLUMN icon TEXT");
    return new Store(db, path);
  }
  private rows<T>(sql: string, params: string[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }
  snapshot(): {
    servers: Community[];
    channels: Channel[];
    messages: Message[];
    avatars: Record<string, string>;
    roles: ServerRole[];
    memberRoles: MemberRole[];
    profiles: Record<string, Participant["profile"]>;
  } {
    if (this.cachedSnapshot) return this.cachedSnapshot;
    const messages = this.rows<Message>(
      "SELECT id,channelId,author,name,avatar,text,time,editedAt,replyTo,(SELECT id FROM images WHERE messageId=recent.id) AS imageId FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY channelId ORDER BY time DESC,id DESC) AS rank FROM messages) recent WHERE rank<=100 ORDER BY time,id",
    );
    const servers = this.rows<Community>("SELECT * FROM servers");
    return (this.cachedSnapshot = {
      roles: this.roles(),
      memberRoles: this.rows<MemberRole>("SELECT * FROM member_roles"),
      profiles: Object.fromEntries(
        this.rows<{ id: string; data: string }>(
          "SELECT * FROM public_profiles",
        ).map((r) => [r.id, JSON.parse(r.data) as Participant["profile"]]),
      ),
      servers,
      channels: this.rows<Channel>("SELECT * FROM channels"),
      messages: this.withReactions(messages),
      avatars: this.avatarImages([
        ...messages.map((m) => m.avatar),
        ...servers.map((s) => s.icon ?? ""),
        ...this.rows<{ data: string }>("SELECT data FROM public_profiles").map(
          (p) => (JSON.parse(p.data) as Participant["profile"]).avatar,
        ),
      ]),
    });
  }
  registerAvatar(value: string) {
    if (!value.startsWith("data:")) return value;
    const id = "avatar:" + createHash("sha256").update(value).digest("hex");
    if (!this.rows("SELECT id FROM avatars WHERE id=?", [id]).length) {
      this.db.run("INSERT INTO avatars VALUES(?,?)", [id, value]);
      this.flush();
    }
    return id;
  }
  rememberProfile(profile: Participant["profile"]) {
    this.db.run("INSERT OR REPLACE INTO public_profiles VALUES(?,?)", [
      profile.id,
      JSON.stringify(profile),
    ]);
    this.flush();
  }
  roles(): ServerRole[] {
    return this.rows<Omit<ServerRole, "permissions"> & { permissions: string }>(
      "SELECT * FROM roles ORDER BY position,id",
    ).map((r) => ({ ...r, permissions: JSON.parse(r.permissions) }));
  }
  manageRole(
    actor: string,
    command: Extract<
      import("../shared/types").Command,
      { type: "role.save" | "role.delete" | "role.assign" }
    >,
  ) {
    const server = this.rows<Community>("SELECT * FROM servers WHERE id=?", [
      command.serverId,
    ])[0];
    // Central authority check; role permissions are reserved for future versions.
    if (!server || server.ownerId !== actor)
      throw Error("Somente o criador do servidor pode gerenciar cargos.");
    const roles = this.roles().filter((r) => r.serverId === server.id);
    if (command.type === "role.save") {
      if (command.id) {
        if (!roles.some((r) => r.id === command.id))
          throw Error("Cargo não encontrado neste servidor.");
        this.db.run("UPDATE roles SET name=?,color=? WHERE id=?", [
          command.name,
          command.color,
          command.id,
        ]);
      } else {
        if (roles.length >= 50)
          throw Error("Limite de 50 cargos por servidor.");
        this.db.run("INSERT INTO roles VALUES(?,?,?,?,?,?)", [
          randomUUID(),
          server.id,
          command.name,
          command.color,
          Math.max(-1, ...roles.map((r) => r.position)) + 1,
          "[]",
        ]);
      }
    } else {
      const roleId =
        command.type === "role.delete" ? command.id : command.roleId;
      if (!roles.some((r) => r.id === roleId))
        throw Error("Cargo não encontrado neste servidor.");
      if (command.type === "role.delete")
        this.db.run("DELETE FROM roles WHERE id=?", [roleId]);
      else if (command.assigned) {
        if (
          !this.rows("SELECT id FROM public_profiles WHERE id=?", [
            command.memberId,
          ]).length
        )
          throw Error("Membro não encontrado.");
        this.db.run("INSERT OR IGNORE INTO member_roles VALUES(?,?,?)", [
          server.id,
          roleId,
          command.memberId,
        ]);
      } else
        this.db.run("DELETE FROM member_roles WHERE roleId=? AND memberId=?", [
          roleId,
          command.memberId,
        ]);
    }
    this.flush();
  }
  avatarImages(values: string[]) {
    const result: Record<string, string> = {};
    for (const id of new Set(
      values.filter((v) => typeof v === "string" && v.startsWith("avatar:")),
    )) {
      const row = this.rows<{ data: string }>(
        "SELECT data FROM avatars WHERE id=?",
        [id],
      )[0];
      if (row) result[id] = row.data;
    }
    return result;
  }
  createServer(name: string, ownerId?: string) {
    const id = randomUUID();
    this.db.run("INSERT INTO servers(id,name,ownerId) VALUES(?,?,?)", [
      id,
      name,
      ownerId ?? null,
    ]);
    this.createChannel(id, "geral", "text");
    this.createChannel(id, "Sala dos amigos", "voice");
    this.flush();
    return id;
  }
  claimLegacyServers(ownerId: string) {
    this.db.run("UPDATE servers SET ownerId=? WHERE ownerId IS NULL", [
      ownerId,
    ]);
    this.flush();
  }
  setServerIcon(id: string, ownerId: string, image: string | null) {
    const server = this.rows<Community>("SELECT * FROM servers WHERE id=?", [
      id,
    ])[0];
    if (!server) throw Error("Servidor não encontrado.");
    if (server.ownerId !== ownerId)
      throw Error("Somente o criador pode alterar a imagem do servidor.");
    const icon = image === null ? null : this.registerAvatar(image);
    this.db.run("UPDATE servers SET icon=? WHERE id=?", [icon, id]);
    this.flush();
  }
  createChannel(serverId: string, name: string, kind: string) {
    this.db.run("INSERT INTO channels VALUES(?,?,?,?)", [
      randomUUID(),
      serverId,
      name,
      kind,
    ]);
    this.flush();
  }
  rename(table: "servers" | "channels", id: string, name: string) {
    this.db.run(`UPDATE ${table} SET name=? WHERE id=?`, [name, id]);
    this.flush();
  }
  delete(table: "servers" | "channels", id: string) {
    this.db.run(`DELETE FROM ${table} WHERE id=?`, [id]);
    this.flush();
  }
  message(m: Message, image?: string) {
    if (
      m.replyTo &&
      !this.rows("SELECT id FROM messages WHERE id=? AND channelId=?", [
        m.replyTo,
        m.channelId,
      ]).length
    )
      throw Error("A mensagem original não pertence a este canal.");
    this.db.run("BEGIN");
    try {
      this.db.run(
        "INSERT INTO messages(id,channelId,author,name,avatar,text,time,replyTo) VALUES(?,?,?,?,?,?,?,?)",
        [
          m.id,
          m.channelId,
          m.author,
          m.name,
          m.avatar,
          m.text,
          m.time,
          m.replyTo || null,
        ],
      );
      if (image)
        this.db.run("INSERT INTO images VALUES(?,?,?)", [m.id, m.id, image]);
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    this.flush();
  }
  changeMessage(id: string, author: string, text?: string) {
    const row = this.rows<Message>("SELECT * FROM messages WHERE id=?", [
      id,
    ])[0];
    if (!row) throw Error("Mensagem não encontrada.");
    if (row.author !== author)
      throw Error("Você só pode alterar suas próprias mensagens.");
    if (text === undefined)
      this.db.run("DELETE FROM messages WHERE id=?", [id]);
    else {
      if (
        !text.trim() &&
        !this.rows("SELECT id FROM images WHERE messageId=?", [id]).length
      )
        throw Error("Uma mensagem sem imagem precisa ter texto.");
      this.db.run("UPDATE messages SET text=?,editedAt=? WHERE id=?", [
        text,
        Date.now(),
        id,
      ]);
    }
    this.flush();
  }
  withReactions(messages: Message[]) {
    if (!messages.length) return messages;
    const index = new Map(
      messages.map((m) => [
        m.id,
        { ...m, reactions: {} as Record<string, string[]> },
      ]),
    );
    for (const row of this.rows<{
      messageId: string;
      memberId: string;
      emoji: string;
    }>(
      `SELECT * FROM reactions WHERE messageId IN (${messages.map(() => "?").join(",")})`,
      messages.map((m) => m.id),
    )) {
      const m = index.get(row.messageId);
      if (m) (m.reactions[row.emoji] ||= []).push(row.memberId);
    }
    return [...index.values()];
  }
  react(id: string, memberId: string, emoji: string) {
    if (!this.rows("SELECT id FROM messages WHERE id=?", [id]).length)
      throw Error("Mensagem não encontrada.");
    if (
      this.rows(
        "SELECT 1 FROM reactions WHERE messageId=? AND memberId=? AND emoji=?",
        [id, memberId, emoji],
      ).length
    )
      this.db.run(
        "DELETE FROM reactions WHERE messageId=? AND memberId=? AND emoji=?",
        [id, memberId, emoji],
      );
    else
      this.db.run("INSERT INTO reactions VALUES(?,?,?)", [id, memberId, emoji]);
    this.flush();
  }
  messageRecord(id: string) {
    return this.rows<Message>("SELECT * FROM messages WHERE id=?", [id])[0];
  }
  history(q: import("../shared/types").HistoryQuery) {
    const params = [q.channelId!];
    let where = "channelId=?";
    if (q.messageId) {
      where += " AND id=?";
      params.push(q.messageId);
    }
    if (q.before !== undefined) {
      where += " AND (time<? OR (time=? AND id<?))";
      params.push(String(q.before), String(q.before), q.beforeId || "");
    }
    if (q.search) {
      where += " AND instr(lower(text),lower(?))>0";
      params.push(q.search);
    }
    return this.withReactions(
      this.rows<Message>(
        `SELECT *,(SELECT id FROM images WHERE messageId=messages.id) AS imageId FROM messages WHERE ${where} ORDER BY time DESC,id DESC LIMIT 100`,
        params,
      ).reverse(),
    );
  }
  image(id: string) {
    const row = this.rows<{ data: string }>(
      "SELECT data FROM images WHERE id=?",
      [id],
    )[0];
    if (!row) throw Error("Imagem não encontrada.");
    return row.data;
  }
  flush() {
    this.cachedSnapshot = undefined;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + ".tmp", this.db.export());
    // sql.js export reopens its connection and resets PRAGMA settings.
    this.db.run("PRAGMA foreign_keys=ON");
    renameSync(this.path + ".tmp", this.path);
  }
  close() {
    this.flush();
    this.db.close();
  }
}
