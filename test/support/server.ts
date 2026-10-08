/**
 * Zero-dependency local preview: runs the real Worker against in-memory fakes.
 *   npm run preview:node   →  http://localhost:8788
 * Emails are captured (not sent) and printed to the console, so you can read the
 * admin sign-in code locally. Prefer `npm run dev` (wrangler dev) when wrangler is installed.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import worker from "../../src/index.ts";
import { fakeAssets, fakeD1, fakeKV } from "./fakes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SentMail { to: unknown; subject: string; html?: string; text?: string; headers?: Record<string, string> }

export async function makeEnv(over: Record<string, unknown> = {}) {
  const outbox: SentMail[] = [];
  return {
    DB: fakeD1(join(root, "migrations")),
    FILES_KV: fakeKV(),
    ASSETS: fakeAssets(join(root, "public")),
    EMAIL: { outbox, async send(m: SentMail) { outbox.push(m); return { messageId: `local-${outbox.length}` }; } },
    STORAGE_DRIVER: "kv", MAX_UPLOAD_MB: "10", ENVIRONMENT: "development",
    SITE_URL: "http://localhost:8788", ADMIN_EMAIL: "aogsccmedia@gmail.com", MAIL_FROM: "noreply@aogsccyouth.com",
    GOOGLE_CLIENT_ID: "",
    ...over,
  };
}

/** Run the scheduled handler once and wait for its background work. */
export async function runCron(env: unknown, when = Date.now()) {
  const pending: Promise<unknown>[] = [];
  await worker.scheduled({ scheduledTime: when, cron: "*/10 * * * *" } as never, env as never, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as never);
  await Promise.all(pending);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = await makeEnv({ GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "" });
  const port = Number(process.env.PORT || 8788);
  const origSend = env.EMAIL.send.bind(env.EMAIL);
  env.EMAIL.send = async (m: SentMail) => {
    console.log(`\n✉️  ${JSON.stringify(m.to)} — ${m.subject}\n${(m.text || "").split("\n").slice(0, 4).join("\n")}`);
    return origSend(m);
  };
  createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    // Last captured email, handy for previewing templates: /__mail/last
    if (req.url === "/__mail/last") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(env.EMAIL.outbox.at(-1)?.html || "No mail yet"); return; }
    if (req.url?.startsWith("/__cron")) { await runCron(env); res.end("ok"); return; }
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method, headers: req.headers as HeadersInit,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const r = await worker.fetch(request, env as never, {} as never);
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(port, () => console.log(`Preview on http://localhost:${port}  — admin code emails print here`));
}
