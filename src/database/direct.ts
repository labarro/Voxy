import type { Database } from "sql.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  DirectContact,
  DirectMessage,
  Participant,
} from "../shared/types";

export class DirectStore {
  constructor(
    private db: Database,
    private flush: () => void,
  ) {
    db.run(`CREATE TABLE IF NOT EXISTS direct_contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profile_auth(profileId TEXT NOT NULL,scope TEXT NOT NULL,keyHash TEXT NOT NULL,PRIMARY KEY(profileId,scope));
      CREATE TABLE IF NOT EXISTS direct_messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,recipient TEXT NOT NULL,name TEXT NOT NULL,avatar TEXT NOT NULL,text TEXT NOT NULL,time INTEGER NOT NULL,editedAt INTEGER);
      CREATE INDEX IF NOT EXISTS direct_pair ON direct_messages(author,recipient,sequence);
      CREATE TABLE IF NOT EXISTS direct_images(id TEXT PRIMARY KEY,messageId TEXT UNIQUE REFERENCES direct_messages(id) ON DELETE CASCADE,data TEXT NOT NULL);`);
    const columns =
      db.exec("PRAGMA table_info(direct_messages)")[0]?.values || [];
    if (!columns.some((r) => r[1] === "replyTo"))
      db.run("ALTER TABLE direct_messages ADD COLUMN replyTo TEXT");
    db.run(
      "CREATE TABLE IF NOT EXISTS direct_reactions(messageId TEXT NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,memberId TEXT NOT NULL,emoji TEXT NOT NULL,PRIMARY KEY(messageId,memberId,emoji))",
    );
  }
  private rows<T>(sql: string, params: (string | number)[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const result: T[] = [];
      while (stmt.step()) result.push(stmt.getAsObject() as T);
      return result;
    } finally {
      stmt.free();
    }
  }
  // Trust on first registration, then bind the profile UUID to a per-room device secret.
  authorize(profileId: string, scope: string, credential?: string) {
    const prior = this.rows<{ keyHash: string }>(
      "SELECT keyHash FROM profile_auth WHERE profileId=? AND scope=?",
      [profileId, scope],
    )[0];
    if (prior) {
      const digest = createHash("sha256")
        .update(credential ?? "")
        .digest("hex");
      if (
        !credential ||
        !timingSafeEqual(Buffer.from(digest), Buffer.from(prior.keyHash))
      )
        throw Error(
          "Este perfil pertence a outro dispositivo. Use o perfil e a identidade originais; clientes antigos precisam atualizar.",
        );
      return true;
    }
    if (!credential) return false;
    this.db.run("INSERT INTO profile_auth VALUES(?,?,?)", [
      profileId,
      scope,
      createHash("sha256").update(credential).digest("hex"),
    ]);
    this.flush();
    return true;
  }
  remember(profile: Participant["profile"]) {
    const old = this.rows<DirectContact>(
      "SELECT * FROM direct_contacts WHERE id=?",
      [profile.id],
    )[0];
    if (old?.name === profile.name && old.avatar === profile.avatar) return;
    this.db.run(
      "INSERT INTO direct_contacts(id,name,avatar) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar",
      [profile.id, profile.name, profile.avatar],
    );
    this.flush();
  }
  enabled(id: string, scope: string) {
    return !!this.rows(
      "SELECT 1 FROM profile_auth WHERE profileId=? AND scope=?",
      [id, scope],
    ).length;
  }
  snapshot(viewer: string, scope: string) {
    const contacts = this.rows<
      Omit<DirectContact, "directEnabled"> & { directEnabled: number }
    >(
      "SELECT c.*,(EXISTS(SELECT 1 FROM profile_auth a WHERE a.profileId=c.id AND a.scope=?)) AS directEnabled FROM direct_contacts c WHERE c.id<>? ORDER BY name LIMIT 1000",
      [scope, viewer],
    ).map((c) => ({ ...c, directEnabled: !!c.directEnabled }));
    const messages = this.rows<DirectMessage>(
      `SELECT sequence,id,author,recipient,name,avatar,text,time,editedAt,replyTo,
      (SELECT id FROM direct_images WHERE messageId=recent.id) AS imageId FROM
      (SELECT *,ROW_NUMBER() OVER(PARTITION BY CASE WHEN author=? THEN recipient ELSE author END ORDER BY sequence DESC) AS rank FROM direct_messages WHERE author=? OR recipient=?) recent WHERE rank<=500 ORDER BY sequence DESC LIMIT 5000`,
      [viewer, viewer, viewer],
    ).reverse();
    return { contacts, messages: this.withReactions(messages) };
  }
  message(
    profile: Participant["profile"],
    recipient: string,
    text: string,
    scope: string,
    image?: string,
    replyTo?: string,
  ) {
    if (
      replyTo &&
      !this.rows(
        "SELECT id FROM direct_messages WHERE id=? AND ((author=? AND recipient=?) OR (author=? AND recipient=?))",
        [replyTo, profile.id, recipient, recipient, profile.id],
      ).length
    )
      throw Error("A resposta precisa pertencer a esta conversa.");
    if (profile.id === recipient)
      throw Error("Escolha outra pessoa para conversar.");
    if (!this.enabled(recipient, scope))
      throw Error(
        "Essa pessoa precisa atualizar e conectar uma vez para receber mensagens privadas.",
      );
    const id = randomUUID();
    this.db.run("BEGIN");
    try {
      this.db.run(
        "INSERT INTO direct_messages(id,author,recipient,name,avatar,text,time,replyTo) VALUES(?,?,?,?,?,?,?,?)",
        [
          id,
          profile.id,
          recipient,
          profile.name,
          profile.avatar,
          text,
          Date.now(),
          replyTo || null,
        ],
      );
      if (image)
        this.db.run("INSERT INTO direct_images VALUES(?,?,?)", [id, id, image]);
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    this.flush();
    return [profile.id, recipient];
  }
  change(id: string, author: string, text?: string) {
    const message = this.rows<DirectMessage>(
      "SELECT * FROM direct_messages WHERE id=?",
      [id],
    )[0];
    if (!message || message.author !== author)
      throw Error("Você só pode alterar suas próprias mensagens privadas.");
    if (text === undefined)
      this.db.run("DELETE FROM direct_messages WHERE id=?", [id]);
    else {
      if (
        !text.trim() &&
        !this.rows("SELECT id FROM direct_images WHERE messageId=?", [id])
          .length
      )
        throw Error("Uma mensagem sem imagem precisa ter texto.");
      this.db.run("UPDATE direct_messages SET text=?,editedAt=? WHERE id=?", [
        text,
        Date.now(),
        id,
      ]);
    }
    this.flush();
    return [message.author, message.recipient];
  }
  image(id: string, viewer: string) {
    const row = this.rows<{ data: string }>(
      "SELECT i.data FROM direct_images i JOIN direct_messages m ON m.id=i.messageId WHERE i.id=? AND (m.author=? OR m.recipient=?)",
      [id, viewer, viewer],
    )[0];
    if (!row) throw Error("Imagem privada indisponível para este perfil.");
    return row.data;
  }
  private withReactions(messages: DirectMessage[]) {
    if (!messages.length) return messages;
    const index = new Map(
      messages.map((m) => [
        m.id,
        { ...m, reactions: {} as Record<string, string[]> },
      ]),
    );
    for (const r of this.rows<{
      messageId: string;
      memberId: string;
      emoji: string;
    }>(
      `SELECT * FROM direct_reactions WHERE messageId IN (${messages.map(() => "?").join(",")})`,
      messages.map((m) => m.id),
    ))
      (index.get(r.messageId)!.reactions[r.emoji] ||= []).push(r.memberId);
    return [...index.values()];
  }
  react(id: string, actor: string, emoji: string) {
    const m = this.rows<DirectMessage>(
      "SELECT * FROM direct_messages WHERE id=? AND (author=? OR recipient=?)",
      [id, actor, actor],
    )[0];
    if (!m) throw Error("Mensagem privada indisponível.");
    if (
      this.rows(
        "SELECT 1 FROM direct_reactions WHERE messageId=? AND memberId=? AND emoji=?",
        [id, actor, emoji],
      ).length
    )
      this.db.run(
        "DELETE FROM direct_reactions WHERE messageId=? AND memberId=? AND emoji=?",
        [id, actor, emoji],
      );
    else
      this.db.run("INSERT INTO direct_reactions VALUES(?,?,?)", [
        id,
        actor,
        emoji,
      ]);
    this.flush();
    return [m.author, m.recipient];
  }
  history(viewer: string, q: import("../shared/types").HistoryQuery) {
    const params: (string | number)[] = [viewer, q.peer!, q.peer!, viewer];
    let where = "((author=? AND recipient=?) OR (author=? AND recipient=?))";
    if (q.messageId) {
      where += " AND id=?";
      params.push(q.messageId);
    }
    if (q.before !== undefined) {
      where += " AND (time<? OR (time=? AND id<?))";
      params.push(q.before, q.before, q.beforeId || "");
    }
    if (q.search) {
      where += " AND instr(lower(text),lower(?))>0";
      params.push(q.search);
    }
    return this.withReactions(
      this.rows<DirectMessage>(
        `SELECT *,(SELECT id FROM direct_images WHERE messageId=direct_messages.id) AS imageId FROM direct_messages WHERE ${where} ORDER BY time DESC,id DESC LIMIT 100`,
        params,
      ).reverse(),
    ).map((m) => ({ ...m, channelId: q.peer! }));
  }
}
