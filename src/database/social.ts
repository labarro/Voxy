import type { Database } from "sql.js";
import type { Friendship } from "../shared/types";
export class SocialStore {
  constructor(
    private db: Database,
    private flush: () => void,
  ) {
    db.run(
      "CREATE TABLE IF NOT EXISTS friendships(requester TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(requester,recipient)); CREATE INDEX IF NOT EXISTS friendship_recipient ON friendships(recipient)",
    );
  }
  snapshot(viewer: string): Friendship[] {
    const stmt = this.db.prepare(
      "SELECT * FROM friendships WHERE requester=? OR recipient=?",
    );
    try {
      stmt.bind([viewer, viewer]);
      const rows: Friendship[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Friendship);
      return rows;
    } finally {
      stmt.free();
    }
  }
  change(
    actor: string,
    member: string,
    action: "request" | "accept" | "decline" | "remove",
  ) {
    if (actor === member) throw Error("Escolha outra pessoa.");
    const link = this.snapshot(actor).find(
      (f) => f.requester === member || f.recipient === member,
    );
    if (action === "request") {
      if (link)
        throw Error(
          link.status === "accepted"
            ? "Vocês já são amigos."
            : "Já existe uma solicitação pendente.",
        );
      const stmt = this.db.prepare("SELECT 1 FROM public_profiles WHERE id=?");
      try {
        stmt.bind([member]);
        if (!stmt.step())
          throw Error(
            "ID não encontrado. A pessoa precisa conectar a esta sala uma vez.",
          );
      } finally {
        stmt.free();
      }
      if (this.snapshot(actor).length >= 1000)
        throw Error("Limite de amizades atingido.");
      this.db.run("INSERT INTO friendships VALUES(?,?,?)", [
        actor,
        member,
        "pending",
      ]);
    } else if (action === "accept" || action === "decline") {
      if (!link || link.recipient !== actor || link.status !== "pending")
        throw Error("Solicitação não encontrada.");
      if (action === "accept")
        this.db.run(
          "UPDATE friendships SET status='accepted' WHERE requester=? AND recipient=?",
          [member, actor],
        );
      else
        this.db.run(
          "DELETE FROM friendships WHERE requester=? AND recipient=?",
          [member, actor],
        );
    } else {
      this.db.run(
        "DELETE FROM friendships WHERE (requester=? AND recipient=?) OR (requester=? AND recipient=?)",
        [actor, member, member, actor],
      );
    }
    this.flush();
  }
  friends(a: string, b: string) {
    return this.snapshot(a).some(
      (f) =>
        f.status === "accepted" && (f.requester === b || f.recipient === b),
    );
  }
}
