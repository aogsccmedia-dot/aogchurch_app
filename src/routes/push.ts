// Phone notifications (Web Push) for the church app: works on Android, computers, and iPhone when the app is added to the Home Screen.
// Pushes carry no data; the app's service worker asks /api/push/today what to show (so nothing personal travels through push services).
// The signing keys (VAPID) are created by the server on first use and kept in the database; they never appear in code.
import type { Env } from "../env.ts";
import { HttpError, Router, json, readJson } from "../lib/http.ts";
import { getSession, requireSuper } from "../lib/auth.ts";
import { wordFor, saDay } from "../lib/word.ts";
import { siteUrl, adminEmail } from "../env.ts";

const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

type Keys = { publicKey: string; privateJwk: JsonWebKey };
let cached: Keys | null = null;

async function vapidKeys(env: Env): Promise<Keys> {
  if (cached) return cached;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'vapid_keys'").first<{ value: string }>();
  if (row) return (cached = JSON.parse(row.value) as Keys);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer;
  const keys: Keys = { publicKey: b64u(raw), privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey };
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_keys', ?)").bind(JSON.stringify(keys)).run();
  const again = await env.DB.prepare("SELECT value FROM settings WHERE key = 'vapid_keys'").first<{ value: string }>();
  return (cached = JSON.parse(again!.value) as Keys);
}

async function vapidAuth(env: Env, endpoint: string): Promise<string> {
  const keys = await vapidKeys(env);
  const aud = new URL(endpoint).origin;
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: `mailto:${adminEmail(env)}` })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Send one data-less push. Returns false if the subscription is gone (and should be removed). */
export async function sendPush(env: Env, endpoint: string, topic = "scc"): Promise<"ok" | "gone" | "fail"> {
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { Authorization: await vapidAuth(env, endpoint), TTL: "43200", Urgency: "normal", Topic: topic, "Content-Length": "0" } });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "fail";
  } catch { return "fail"; }
}

function todayMessage() {
  const w = wordFor(saDay()), ref = w.ref, text = w.text;
  return { title: "Today's verse 📖", body: text ? `“${text.length > 150 ? text.slice(0, 147) + "…" : text}” ${ref}` : "Your daily verse is ready.", url: "/devotions", tag: "verse" };
}

export function pushRoutes(router: Router, env: Env): void {
  router.get("/api/push/key", async () => json({ ok: true, key: (await vapidKeys(env)).publicKey }));

  router.post("/api/push/subscribe", async (req) => {
    const b = await readJson<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; verse?: boolean }>(req);
    const sub = b.subscription;
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) throw new HttpError(422, "That notification address isn't valid.");
    const s = await getSession(env, req);
    await env.DB.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, user_id, verse) VALUES (?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = COALESCE(excluded.user_id, push_subs.user_id), verse = excluded.verse, fails = 0`)
      .bind(sub.endpoint, sub.keys?.p256dh ?? null, sub.keys?.auth ?? null, s?.user.id ?? null, b.verse === false ? 0 : 1).run();
    return json({ ok: true });
  });

  router.post("/api/push/prefs", async (req) => {
    const b = await readJson<{ endpoint?: string; verse?: boolean }>(req);
    if (!b.endpoint) throw new HttpError(422, "Missing subscription.");
    await env.DB.prepare("UPDATE push_subs SET verse = ? WHERE endpoint = ?").bind(b.verse ? 1 : 0, b.endpoint).run();
    return json({ ok: true });
  });

  router.post("/api/push/unsubscribe", async (req) => {
    const b = await readJson<{ endpoint?: string }>(req);
    if (b.endpoint) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(b.endpoint).run();
    return json({ ok: true });
  });

  // What the service worker shows when a push arrives.
  router.get("/api/push/today", async () => json({ ok: true, ...todayMessage() }));

  // Main admin: send a test to every device (to check it works).
  router.post("/api/admin/push/test", async (req) => {
    await requireSuper(env, req);
    const { results } = await env.DB.prepare("SELECT endpoint FROM push_subs LIMIT 500").all<{ endpoint: string }>();
    let sent = 0;
    for (const r of results) { const x = await sendPush(env, r.endpoint, "verse"); if (x === "ok") sent++; if (x === "gone") await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(r.endpoint).run(); }
    return json({ ok: true, sent, devices: results.length, site: siteUrl(env) });
  });
}

/** Cron: from 06:00 SAST, the daily verse goes to every device that has it on (a few hundred per run until everyone has it). */
export async function processDailyVerse(env: Env, now: Date): Promise<void> {
  const sast = new Date(now.getTime() + 2 * 3600_000);
  if (sast.getUTCHours() < 6 || sast.getUTCHours() >= 21) return;
  const today = sast.toISOString().slice(0, 10);
  const { results } = await env.DB.prepare("SELECT endpoint FROM push_subs WHERE verse = 1 AND (last_sent IS NULL OR last_sent < ?) AND hour <= ? LIMIT 300")
    .bind(today, sast.getUTCHours()).all<{ endpoint: string }>();
  for (const r of results) {
    const x = await sendPush(env, r.endpoint, "verse");
    if (x === "gone") await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(r.endpoint).run();
    else if (x === "ok") await env.DB.prepare("UPDATE push_subs SET last_sent = ?, fails = 0 WHERE endpoint = ?").bind(today, r.endpoint).run();
    else await env.DB.prepare("UPDATE push_subs SET fails = fails + 1, last_sent = CASE WHEN fails >= 5 THEN ? ELSE last_sent END WHERE endpoint = ?").bind(today, r.endpoint).run();
  }
  await env.DB.prepare("DELETE FROM push_subs WHERE fails >= 20").run();
}
