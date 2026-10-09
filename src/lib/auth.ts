import type { Env } from "../env.ts";
import { adminEmail } from "../env.ts";
import { HttpError, getCookie } from "./http.ts";
import { randomToken, sha256Hex, uuid } from "./crypto.ts";

export const SESSION_COOKIE = "scc_session";
const USER_DAYS = 30;
const ADMIN_HOURS = 12;

export interface User { id: string; email: string; name: string | null; given_name: string | null; family_name: string | null; picture: string | null }
export interface Session { user: User; kind: "user" | "admin"; role?: "super" | "staff" }

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
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new HttpError(401, "Invalid Google credential.");
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) { jwksCache = null; throw new HttpError(401, "Google key not recognised. Please try again."); }
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]) as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(401, "Invalid Google credential.");
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(String(c.iss))) throw new HttpError(401, "Invalid Google credential.");
  if (c.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "Invalid Google credential.");
  if (typeof c.exp !== "number" || c.exp < now - 30) throw new HttpError(401, "Your Google sign-in expired. Please try again.");
  if (c.email_verified !== true && c.email_verified !== "true") throw new HttpError(401, "Please use a Google account with a verified email.");
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: c.name as string, given_name: c.given_name as string, family_name: c.family_name as string, picture: c.picture as string };
}

// ---------------------------------------------------------------- users & sessions

export async function upsertUser(env: Env, g: { sub?: string; email: string; name?: string | null; given_name?: string | null; family_name?: string | null; picture?: string | null }): Promise<User> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? OR (google_sub IS NOT NULL AND google_sub = ?)")
    .bind(g.email, g.sub ?? "").first<{ id: string }>();
  const id = existing?.id ?? uuid();
  if (existing) {
    await env.DB.prepare(`UPDATE users SET google_sub = COALESCE(?, google_sub), name = COALESCE(?, name), given_name = COALESCE(?, given_name),
      family_name = COALESCE(?, family_name), picture = COALESCE(?, picture), last_login_at = ? WHERE id = ?`)
      .bind(g.sub ?? null, g.name ?? null, g.given_name ?? null, g.family_name ?? null, g.picture ?? null, now, id).run();
  } else {
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, given_name, family_name, picture, last_login_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, g.sub ?? null, g.email, g.name ?? null, g.given_name ?? null, g.family_name ?? null, g.picture ?? null, now).run();
  }
  return (await env.DB.prepare("SELECT id, email, name, given_name, family_name, picture FROM users WHERE id = ?").bind(id).first<User>())!;
}

export function isAdminEmail(env: Env, email: string) { return email.toLowerCase() === adminEmail(env); }

export async function createSession(env: Env, req: Request, userId: string, kind: "user" | "admin"): Promise<string> {
  const token = randomToken();
  const ms = kind === "admin" ? ADMIN_HOURS * 3600_000 : USER_DAYS * 86400_000;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)")
    .bind(await sha256Hex(token), userId, kind, new Date(Date.now() + ms).toISOString()).run();
  const secure = new URL(req.url).protocol === "https:";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ms / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(req: Request) {
  const secure = new URL(req.url).protocol === "https:";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function getSession(env: Env, req: Request): Promise<Session | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.kind, u.id, u.email, u.name, u.given_name, u.family_name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256Hex(token), new Date().toISOString()).first<User & { kind: "user" | "admin" }>();
  if (!row) return null;
  const { kind, ...user } = row;
  if (kind !== "admin") return { user, kind };
  // Admin sessions: the super admin (ADMIN_EMAIL), or someone the super admin has given a role.
  // If a role is removed, the session quietly drops back to a normal member session.
  if (isAdminEmail(env, user.email)) return { user, kind, role: "super" };
  if (await hasStaffRole(env, user.id)) return { user, kind, role: "staff" };
  return { user, kind: "user" };
}

export async function destroySession(env: Env, req: Request) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export async function hasStaffRole(env: Env, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM admin_roles WHERE user_id = ?").bind(userId).first());
}
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

export async function createLoginCode(env: Env, email: string, userId: string | null): Promise<{ id: string; code: string }> {
  const id = uuid();
  const code = sixDigitCode();
  await env.DB.batch([
    env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL").bind(new Date().toISOString(), email),
    env.DB.prepare("INSERT INTO login_codes (id, user_id, email, code_hash, expires_at) VALUES (?,?,?,?,?)")
      .bind(id, userId, email, await sha256Hex(`${id}:${code}`), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString()),
  ]);
  return { id, code };
}

export async function consumeLoginCode(env: Env, id: string, code: string): Promise<{ email: string; user_id: string | null }> {
  const row = await env.DB.prepare("SELECT * FROM login_codes WHERE id = ?").bind(id)
    .first<{ id: string; email: string; user_id: string | null; code_hash: string; attempts: number; expires_at: string; consumed_at: string | null }>();
  if (!row || row.consumed_at || row.expires_at < new Date().toISOString()) throw new HttpError(400, "That code has expired. Please request a new one.");
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "Too many attempts. Please request a new code.");
  const clean = code.replace(/\D/g, "");
  if ((await sha256Hex(`${id}:${clean}`)) !== row.code_hash) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(id).run();
    throw new HttpError(400, `That code isn't right. ${MAX_ATTEMPTS - row.attempts - 1} attempt(s) left.`);
  }
  await env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  return { email: row.email, user_id: row.user_id };
}
