/**
 * Local stand-ins for Cloudflare bindings so the real Worker code can run under
 * plain Node (node:sqlite for D1, a Map for KV, the filesystem for ASSETS).
 * Used by the test suite and by `npm run preview:node`. Production uses the real bindings.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

type Val = string | number | null | Uint8Array;

class Stmt {
  db: DatabaseSync; sql: string; args: Val[];
  constructor(db: DatabaseSync, sql: string, args: Val[] = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args: unknown[]) {
    for (const a of args) if (a === undefined) throw new Error("D1_TYPE_ERROR: undefined bound in " + this.sql.slice(0, 60));
    return new Stmt(this.db, this.sql, args.map((a) => (typeof a === "boolean" ? (a ? 1 : 0) : a)) as Val[]);
  }
  private returnsRows() { return /^\s*(select|with|pragma)/i.test(this.sql) || /\breturning\b/i.test(this.sql); }
  async all<T = unknown>() { return this.exec() as { results: T[]; success: true; meta: { changes: number } }; }
  async first<T = unknown>(col?: string) {
    const r = (this.exec().results[0] ?? null) as Record<string, unknown> | null;
    return (col && r ? r[col] : r) as T | null;
  }
  async run() { return this.exec(); }
  exec() {
    const p = this.db.prepare(this.sql);
    if (this.returnsRows()) {
      const rows = p.all(...this.args) as Record<string, unknown>[];
      return { results: rows.map((r) => ({ ...r })), success: true as const, meta: { changes: rows.length } };
    }
    const info = p.run(...this.args);
    return { results: [], success: true as const, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export function fakeD1(migrationsDir: string) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrationsDir, f), "utf8"));
  }
  return {
    _db: db,
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN");
      try { const out = stmts.map((s) => s.exec()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    async exec(sql: string) { db.exec(sql); return { count: 1 }; },
  };
}

export function fakeKV() {
  const store = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
  return {
    _store: store,
    async put(key: string, value: ArrayBuffer, opts?: { metadata?: unknown }) { store.set(key, { value, metadata: opts?.metadata ?? null }); },
    async getWithMetadata(key: string) { const v = store.get(key); return { value: v?.value ?? null, metadata: v?.metadata ?? null }; },
    async delete(key: string) { store.delete(key); },
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".json": "application/json", ".txt": "text/plain",
};

/** Mimics Workers Static Assets with html_handling "auto-trailing-slash" + 404-page. */
export function fakeAssets(dir: string) {
  const resolve = (p: string) => {
    const tries = p.endsWith("/") ? [p + "index.html"] : [p, p + ".html", p + "/index.html"];
    for (const t of tries) { const f = join(dir, t); if (existsSync(f) && statSync(f).isFile()) return f; }
    return null;
  };
  return {
    async fetch(req: Request) {
      const url = new URL(req.url);
      const file = resolve(decodeURIComponent(url.pathname));
      if (!file) {
        const nf = join(dir, "404.html");
        return new Response(existsSync(nf) ? readFileSync(nf) : "Not found", { status: 404, headers: { "Content-Type": "text/html" } });
      }
      return new Response(readFileSync(file), { headers: { "Content-Type": MIME[extname(file)] || "application/octet-stream" } });
    },
  };
}
