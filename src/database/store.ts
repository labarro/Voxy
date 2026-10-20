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
import type { Channel, Community, Message } from "../shared/types";
export class Store {
  private constructor(
    private db: Database,
    private path: string,
  ) {}
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
    if (!columns.some((row) => row[1] === "editedAt"))
      db.run("ALTER TABLE messages ADD COLUMN editedAt INTEGER");
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
  snapshot() {
    const messages = this.rows<Message>(
      "SELECT id,channelId,author,name,avatar,text,time,editedAt,(SELECT id FROM images WHERE messageId=recent.id) AS imageId FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY channelId ORDER BY time DESC) AS rank FROM messages) recent WHERE rank<=500 ORDER BY time",
    );
    return {
      servers: this.rows<Community>("SELECT * FROM servers"),
      channels: this.rows<Channel>("SELECT * FROM channels"),
      messages,
      avatars: this.avatarImages(messages.map((m) => m.avatar)),
    };
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
  createServer(name: string) {
    const id = randomUUID();
    this.db.run("INSERT INTO servers VALUES(?,?)", [id, name]);
    this.createChannel(id, "geral", "text");
    this.createChannel(id, "Sala dos amigos", "voice");
    this.flush();
    return id;
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
    this.db.run("BEGIN");
    try {
      this.db.run(
        "INSERT INTO messages(id,channelId,author,name,avatar,text,time) VALUES(?,?,?,?,?,?,?)",
        [m.id, m.channelId, m.author, m.name, m.avatar, m.text, m.time],
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
  image(id: string) {
    const row = this.rows<{ data: string }>(
      "SELECT data FROM images WHERE id=?",
      [id],
    )[0];
    if (!row) throw Error("Imagem não encontrada.");
    return row.data;
  }
  flush() {
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
