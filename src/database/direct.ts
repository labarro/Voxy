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
      `SELECT sequence,id,author,recipient,name,avatar,text,time,editedAt,
      (SELECT id FROM direct_images WHERE messageId=recent.id) AS imageId FROM
      (SELECT *,ROW_NUMBER() OVER(PARTITION BY CASE WHEN author=? THEN recipient ELSE author END ORDER BY sequence DESC) AS rank FROM direct_messages WHERE author=? OR recipient=?) recent WHERE rank<=500 ORDER BY sequence DESC LIMIT 5000`,
      [viewer, viewer, viewer],
    ).reverse();
    return { contacts, messages };
  }
  message(
    profile: Participant["profile"],
    recipient: string,
    text: string,
    scope: string,
    image?: string,
  ) {
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
        "INSERT INTO direct_messages(id,author,recipient,name,avatar,text,time) VALUES(?,?,?,?,?,?,?)",
        [
          id,
          profile.id,
          recipient,
          profile.name,
          profile.avatar,
          text,
          Date.now(),
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
}
