import type { Env } from "../env.ts";
import { adminEmail } from "../env.ts";
import { HttpError, getCookie } from "./http.ts";
import { randomToken, sha256Hex, uuid } from "./crypto.ts";

export const SESSION_COOKIE = "scc_session";
const USER_DAYS = 30;
const ADMIN_HOURS = 12;

export interface User { id: string; email: string; name: string | null; given_name: string | null; family_name: string | null; picture: string | null }
export interface Session { user: User; kind: "user" | "admin"; role?: "super" | "staff" | "youth"; perms?: string[]; visitor?: boolean; pastor?: boolean }

// ---------------------------------------------------------------- youth leaders: a limited admin role
/** What a youth leader can be allowed to open. The main admin ticks these per person. */
export const YOUTH_PERMS = [
  ["fridays", "Friday services (attendance & money)"],
  ["scan", "Door scanner"],
  ["reports", "Reports"],
  ["services", "Weekly services"],
  ["events", "Events & forms"],
  ["members", "Members (all)"],
  ["people", "My people (members assigned to me)"],
  ["votes", "Voting"],
  ["prayer", "Prayer requests"],
  ["youth_tickets", "Approve tickets for youth events"],
  ["calls", "Call Office (check-ups & evangelism follow-up)"],
] as const;
export const YOUTH_DEFAULT = ["fridays", "scan", "reports", "youth_tickets"];
/** New admins start with reports and weekly services only; the main admin ticks anything else. */
export const ADMIN_DEFAULT = ["reports", "services"];

/** Which permission an admin API call needs (null = full admins only). */
export function permFor(method: string, path: string): string | null {
  const p = path.replace(/\/+$/, "");
  if (p === "/api/admin/whoami" || p === "/api/admin/meta" || (p === "/api/admin/stats" && method === "GET")) return "*";
  if (/^\/api\/admin\/files\//.test(p) && method === "GET") return "events|services|reports|youth_tickets";
  if (/^\/api\/admin\/access-requests?(\/|$)/.test(p)) return "*";   // anyone on the team can ask for more access (super decides)
  // Youth events: youth leaders with "youth_tickets" approve tickets and tell ticket holders about changes (checked per event).
  if ((p === "/api/admin/approvals" && method === "GET") || (/^\/api\/admin\/registrations\/[^/]+$/.test(p) && method === "PATCH")
    || (/^\/api\/admin\/events\/[^/]+\/notify$/.test(p) && method === "POST")) return "events|youth_tickets";
  if (/^\/api\/admin\/fridays(\/|$)/.test(p)) return "fridays";
  if (/^\/api\/admin\/tickets\/(check-in|[^/]+)$/.test(p) && p !== "/api/admin/tickets/undo") return "scan";
  if (method === "GET" && (p === "/api/admin/events" || /^\/api\/admin\/events\/[^/]+\/tickets$/.test(p))) return "scan|events";
  if (/^\/api\/admin\/(reports|report|report\.csv|ledger)(\/|$)/.test(p)) return "reports";
  // Recording a service is open to everyone on the team; managing the list of services, reminders and deleting stay with "services".
  if ((p === "/api/admin/services" || p === "/api/admin/rsvps") && method === "GET") return "*";
  if (p === "/api/admin/sessions/people" && method === "GET") return "*";
  if ((p === "/api/admin/sessions" && (method === "GET" || method === "POST")) || (/^\/api\/admin\/sessions\/[^/]+$/.test(p) && method === "PUT")) return "*";
  if (/^\/api\/admin\/(services|sessions|rsvps)(\/|$)/.test(p)) return "services";
  if (/^\/api\/admin\/(events|registrations|insights|approvals)(\/|$)/.test(p)) return "events";
  if (/^\/api\/admin\/people(\/|$)/.test(p)) return "members|people";
  if (/^\/api\/admin\/members(\/|$)/.test(p)) return "members";
  if (/^\/api\/admin\/votes(\/|$)/.test(p)) return "votes";
  if (/^\/api\/admin\/(prayers|wall)(\/|$)/.test(p)) return "prayer";
  if (/^\/api\/admin\/calls(\/|$)/.test(p)) return "calls";
  if (/^\/api\/admin\/discipleship(\/|$)/.test(p)) return "discipleship";   // verified pastors only (never a tickable permission)
  return null;
}
export function youthMay(perms: string[] | undefined, need: string | null): boolean {
  if (!need) return false;
  if (need === "*") return true;
  return need.split("|").some((n) => (perms || []).includes(n));
}
export function parsePerms(raw: string | null | undefined, dflt: readonly string[] = YOUTH_DEFAULT): string[] {
  try { const v = JSON.parse(raw || "null"); if (Array.isArray(v)) return v.filter((x) => YOUTH_PERMS.some(([k]) => k === x)); } catch { /* fall through */ }
  return [...dflt];
}

// ---------------------------------------------------------------- Google ID tokens

interface Jwk { kid: string; n: string; e: string; kty: string; alg?: string }
let jwksCache: { keys: Jwk[]; exp: number } | null = null;
let jwksOverride: Jwk[] | null = null;
/** Test hook: supply signing keys instead of fetching Google's. */
export function __setJwksForTests(keys: Jwk[] | null) { jwksOverride = keys; }

async function googleKeys(): Promise<Jwk[]> {
  if (jwksOverride) return jwksOverride;
  if (jwksCache && jwksCache.exp > Date.now()) return jwksCache.keys;
  // Cached at Cloudflare's edge too, so a cold Worker doesn't wait on Google for every sign-in.
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs", { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new HttpError(502, "Couldn't reach Google. Please try again.");
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1] || 3600);
  const { keys } = await res.json() as { keys: Jwk[] };
  jwksCache = { keys, exp: Date.now() + maxAge * 1000 };
  return keys;
}

const b64urlToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

export interface GoogleProfile { sub: string; email: string; name?: string; given_name?: string; family_name?: string; picture?: string }

/** Verify a Google Identity Services credential (RS256 JWT) for our client ID. */
export async function verifyGoogleToken(env: Env, token: string): Promise<GoogleProfile> {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, "Google sign-in isn't switched on yet.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Invalid Google credential.");
  let header: { kid?: string; alg?: string };
  try { header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))); } catch { throw new HttpError(401, "Invalid Google credential."); }
  if (header.alg !== "RS256") throw new HttpError(401, "Invalid Google credential.");
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) { jwksCache = null; throw new HttpError(401, "Google key not recognised. Please try again."); }
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]) as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(401, "Invalid Google credential.");
  let c: Record<string, unknown>;
  try { c = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))); } catch { throw new HttpError(401, "Invalid Google credential."); }
  const now = Math.floor(Date.now() / 1000);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(String(c.iss))) throw new HttpError(401, "Invalid Google credential.");
  if (c.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "Invalid Google credential.");
  if (typeof c.exp !== "number" || c.exp < now - 30) throw new HttpError(401, "Your Google sign-in expired. Please try again.");
  if (typeof c.nbf === "number" && c.nbf > now + 60) throw new HttpError(401, "Invalid Google credential.");
  if (typeof c.iat === "number" && c.iat > now + 300) throw new HttpError(401, "Invalid Google credential.");
  if (c.email_verified !== true && c.email_verified !== "true") throw new HttpError(401, "Please use a Google account with a verified email.");
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: c.name as string, given_name: c.given_name as string, family_name: c.family_name as string, picture: c.picture as string };
}

// ---------------------------------------------------------------- users & sessions

export async function upsertUser(env: Env, g: { sub?: string; email: string; name?: string | null; given_name?: string | null; family_name?: string | null; picture?: string | null }): Promise<User> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? OR (google_sub IS NOT NULL AND google_sub = ?)")
    .bind(g.email, g.sub ?? "").first<{ id: string }>();
  const id = existing?.id ?? uuid();
  if (existing && g.sub) {
    // Google proves who owns this address: a password set earlier without proof is removed (it may not be theirs).
    await env.DB.prepare("UPDATE users SET password_hash = CASE WHEN email_verified_at IS NULL THEN NULL ELSE password_hash END, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").bind(new Date().toISOString(), existing.id).run();
  }
  if (existing) {
    await env.DB.prepare(`UPDATE users SET google_sub = COALESCE(?, google_sub), name = COALESCE(?, name), given_name = COALESCE(?, given_name),
      family_name = COALESCE(?, family_name), picture = COALESCE(?, picture), last_login_at = ? WHERE id = ?`)
      .bind(g.sub ?? null, g.name ?? null, g.given_name ?? null, g.family_name ?? null, g.picture ?? null, now, id).run();
  } else {
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, given_name, family_name, picture, last_login_at, email_verified_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, g.sub ?? null, g.email, g.name ?? null, g.given_name ?? null, g.family_name ?? null, g.picture ?? null, now, g.sub ? now : null).run();
  }
  return (await env.DB.prepare("SELECT id, email, name, given_name, family_name, picture FROM users WHERE id = ?").bind(id).first<User>())!;
}

export function isAdminEmail(env: Env, email: string) { return email.toLowerCase() === adminEmail(env); }

export async function createSession(env: Env, req: Request, userId: string, kind: "user" | "admin"): Promise<string> {
  const token = randomToken();
  const ms = USER_DAYS * 86400_000;   // the sign-in itself; admin powers have their own shorter, renewing window
  const adminUntil = kind === "admin" ? new Date(Date.now() + ADMIN_HOURS * 3600_000).toISOString() : null;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, kind, expires_at, admin_until) VALUES (?,?,?,?,?)")
    .bind(await sha256Hex(token), userId, kind, new Date(Date.now() + ms).toISOString(), adminUntil).run();
  const secure = new URL(req.url).protocol === "https:";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ms / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(req: Request) {
  const secure = new URL(req.url).protocol === "https:";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// One lookup per request: the visitor guard, the route and its helpers all ask, and all get the same answer.
const sessionMemo = new WeakMap<Request, Promise<Session | null>>();
export function getSession(env: Env, req: Request): Promise<Session | null> {
  let p = sessionMemo.get(req);
  if (!p) { p = loadSession(env, req); sessionMemo.set(req, p); p.catch(() => sessionMemo.delete(req)); }
  return p;
}
async function loadSession(env: Env, req: Request): Promise<Session | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    // Account, role and pastor status in one trip to the database (every signed-in request needs them).
    `SELECT s.kind, s.admin_until, u.id, u.email, u.name, u.given_name, u.family_name, u.picture, u.visitor,
            r.role AS role_, r.perms AS perms_, EXISTS (SELECT 1 FROM pastors p WHERE p.user_id = u.id) AS pastor_
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN admin_roles r ON r.user_id = u.id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(hash, new Date(now).toISOString()).first<User & { kind: "user" | "admin"; admin_until: string | null; visitor: number | null; role_: string | null; perms_: string | null; pastor_: number }>();
  if (!row) return null;
  const { kind, admin_until, visitor, role_, perms_, pastor_, ...user } = row;
  // Visitors (guest sign-in): never admins, never members; see lib/visitors.ts for what they can use.
  if (visitor && !isAdminEmail(env, user.email)) return { user, kind: "user", visitor: true };
  // The main (super) admin account still needs the emailed code after Google: its powers only come with a
  // verified admin session, which lapses after 12 quiet hours and renews while in use.
  // The main admin account: its normal sign-in (Google, or email and password) opens the full admin portal.
  if (isAdminEmail(env, user.email)) { void kind; void admin_until; return { user, kind: "admin", role: "super" }; }
  // Everyone else: one account. Admins and youth leaders get exactly the parts the main admin ticked for them,
  // on their normal sign-in, with no switching and no codes. Remove the role and it's a member's sign-in again.
  const r = { role: role_, perms: perms_, pastor: pastor_ };
  // Verified pastors (marked by the main admin) always look after discipleship classes, on top of any other role.
  const pastor = !!r?.pastor;
  const plus = (list: string[]) => (pastor ? [...new Set([...list, "discipleship"])] : list);
  if (r?.role === "youth_leader") return { user, kind: "admin", role: "youth", perms: plus(parsePerms(r.perms)), pastor };
  if (r?.role) return { user, kind: "admin", role: "staff", perms: plus(parsePerms(r.perms, ADMIN_DEFAULT)), pastor };
  if (pastor) return { user, kind: "admin", role: "staff", perms: ["discipleship"], pastor };
  return { user, kind: "user" };
}

export async function destroySession(env: Env, req: Request) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export async function hasStaffRole(env: Env, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM admin_roles WHERE user_id = ?1 UNION ALL SELECT 1 FROM pastors WHERE user_id = ?1 LIMIT 1").bind(userId).first());
}
/** Discipleship classes are run only by the main admin and verified pastors. */
export const canTeach = (s: Session | null | undefined) => !!s && !s.visitor && (s.role === "super" || !!s.pastor);
/** Can this account open the admin dashboard (after the emailed code)? */
export async function canAdmin(env: Env, user: { id: string; email: string }): Promise<boolean> {
  return isAdminEmail(env, user.email) || hasStaffRole(env, user.id);
}

/** Only the main (super) admin: deleting people and managing admin roles. */
export async function requireSuper(env: Env, req: Request): Promise<Session> {
  const s = await requireAdmin(env, req);
  if (s.role !== "super") throw new HttpError(403, "Only the main church admin can do this.");
  return s;
}

export async function requireAdmin(env: Env, req: Request): Promise<Session> {
  const s = await getSession(env, req);
  if (!s || s.kind !== "admin") throw new HttpError(401, "Please sign in as the church admin.");
  // Admins and youth leaders only reach the parts the main admin has switched on for them.
  if (s.role !== "super" && !youthMay(s.perms, permFor(req.method, new URL(req.url).pathname))) {
    throw new HttpError(403, "You don't have access to this yet. Use “Request more access” in Settings and the main admin will decide.");
  }
  return s;
}

// ---------------------------------------------------------------- admin email codes

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export function sixDigitCode(): string {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return String(u[0] % 1_000_000).padStart(6, "0");
}

export async function createLoginCode(env: Env, email: string, userId: string | null, opts: { keepRecent?: boolean } = {}): Promise<{ id: string; code: string }> {
  const id = uuid();
  const code = sixDigitCode();
  // Admin codes: earlier codes stay valid until they expire, so whichever email arrives first works.
  const retire = opts.keepRecent
    ? env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL AND expires_at < ?").bind(new Date().toISOString(), email, new Date().toISOString())
    : env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL").bind(new Date().toISOString(), email);
  await env.DB.batch([
    retire,
    env.DB.prepare("INSERT INTO login_codes (id, user_id, email, code_hash, expires_at) VALUES (?,?,?,?,?)")
      .bind(id, userId, email, await sha256Hex(`${id}:${code}`), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString()),
  ]);
  return { id, code };
}

/** Admin code check: the code may match this challenge or any other code emailed to the same address in the last 10 minutes. */
export async function consumeAdminCode(env: Env, id: string, code: string): Promise<{ email: string; user_id: string | null }> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) throw new HttpError(400, "Enter the 6-digit code from your email.");
  const first = await env.DB.prepare("SELECT email FROM login_codes WHERE id = ?").bind(id).first<{ email: string }>();
  if (!first) throw new HttpError(400, "That code has expired. Tap Resend for a new one.");
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare("SELECT id, email, user_id, code_hash, attempts FROM login_codes WHERE email = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 5")
    .bind(first.email, now).all<{ id: string; email: string; user_id: string | null; code_hash: string; attempts: number }>();
  if (!results.length) throw new HttpError(400, "That code has expired. Tap Resend for a new one.");
  // Count this guess against every live code for the address first (atomically), so parallel guesses can't slip past the limit.
  const counted = await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ? AND consumed_at IS NULL AND expires_at > ? RETURNING attempts").bind(first.email, now).all<{ attempts: number }>();
  const tries = counted.results.reduce((n, r) => Math.max(n, r.attempts), 0) - 1;
  if (tries >= MAX_ATTEMPTS * 2) throw new HttpError(429, "Too many attempts. Tap Resend for a new code.");
  for (const r of results) {
    if ((await sha256Hex(`${r.id}:${clean}`)) === r.code_hash) {
      const used = await env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL RETURNING id").bind(now, r.email).all();
      if (!used.results.length) throw new HttpError(400, "That code has already been used. Tap Resend for a new one.");
      return { email: r.email, user_id: r.user_id };
    }
  }
  const left = MAX_ATTEMPTS * 2 - tries - 1;
  throw new HttpError(400, left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many attempts. Tap Resend for a new code.");
}

export async function consumeLoginCode(env: Env, id: string, code: string): Promise<{ email: string; user_id: string | null }> {
  const now = new Date().toISOString();
  const clean = String(code || "").replace(/\D/g, "");
  // Count the guess first, atomically, so parallel guesses can't get past the limit.
  const row = await env.DB.prepare(
    "UPDATE login_codes SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ? RETURNING email, user_id, code_hash, attempts")
    .bind(id, now, MAX_ATTEMPTS).first<{ email: string; user_id: string | null; code_hash: string; attempts: number }>();
  if (!row) {
    const r = await env.DB.prepare("SELECT attempts, consumed_at, expires_at FROM login_codes WHERE id = ?").bind(id).first<{ attempts: number; consumed_at: string | null; expires_at: string }>();
    if (r && !r.consumed_at && r.expires_at > now && r.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "Too many attempts. Please request a new code.");
    throw new HttpError(400, "That code has expired. Please request a new one.");
  }
  if (clean.length !== 6 || (await sha256Hex(`${id}:${clean}`)) !== row.code_hash) {
    const left = MAX_ATTEMPTS - row.attempts;
    throw new HttpError(left > 0 ? 400 : 429, left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many attempts. Please request a new code.");
  }
  // Use it once: only the first request to get here wins.
  const used = await env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL RETURNING id").bind(now, id).first();
  if (!used) throw new HttpError(400, "That code has already been used. Please request a new one.");
  return { email: row.email, user_id: row.user_id };
}
