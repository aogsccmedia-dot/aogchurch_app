import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { confirmMembership, revokeMembership, type MemberRow } from "../lib/membership.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import {
  clearSessionCookie, consumeLoginCode, createLoginCode, createSession, destroySession, getSession,
  isAdminEmail, upsertUser, verifyGoogleToken,
} from "../lib/auth.ts";
import { sendMail } from "../lib/email.ts";
import { subscribe } from "../lib/newsletter.ts";
import * as T from "../emails/templates.ts";
import { promoteWaitlist } from "../lib/registrations.ts";

async function sendAdminCode(env: Env, userId: string | null) {
  const email = adminEmail(env);
  const { id, code } = await createLoginCode(env, email, userId);
  const sent = await sendMail(env, { to: email, ...T.adminCode({ site: siteUrl(env) }, code), template: "admin_code" });
  if (!sent && env.ENVIRONMENT !== "development") throw new HttpError(503, "We couldn't send the verification email. Check that Email Sending is enabled for the domain.");
  const masked = email.replace(/^(.)(.*)(.@.*)$/, (_m, a, mid, c) => a + "•".repeat(Math.min(6, mid.length)) + c);
  return { challenge: id, sent_to: masked };
}

export function authRoutes(router: Router, env: Env): void {
  router.get("/api/auth/me", async (req) => {
    const s = await getSession(env, req);
    if (!s) return json({ ok: true, user: null, google_client_id: env.GOOGLE_CLIENT_ID || null });
    const member = await env.DB.prepare("SELECT ref_code, status, first_name, preferred_name, created_at FROM members WHERE (user_id = ? OR email = ?) AND status != 'revoked' ORDER BY created_at DESC LIMIT 1")
      .bind(s.user.id, s.user.email).first();
    const sub = await env.DB.prepare("SELECT status FROM subscribers WHERE email = ?").bind(s.user.email).first<{ status: string }>();
    return json({ ok: true, user: s.user, is_admin: s.kind === "admin", admin_account: isAdminEmail(env, s.user.email),
      member, subscribed: sub?.status === "active", google_client_id: env.GOOGLE_CLIENT_ID || null });
  });

  /** Sign in with Google (everyone). The admin account must additionally pass an emailed code. */
  router.post("/api/auth/google", async (req) => {
    await rateLimit(env, "google", clientIp(req), 30, 600);
    const { credential } = await readJson<{ credential?: string }>(req);
    if (!credential) throw new HttpError(400, "Missing Google credential.");
    const g = await verifyGoogleToken(env, credential);
    const user = await upsertUser(env, g);
    if (isAdminEmail(env, user.email)) {
      const c = await sendAdminCode(env, user.id);
      // Also give a normal user session so the public site recognises them.
      return json({ ok: true, needs_code: true, ...c }, 200, { "Set-Cookie": await createSession(env, req, user.id, "user") });
    }
    // Link any earlier join-form record made with the same email.
    await env.DB.prepare("UPDATE members SET user_id = ? WHERE user_id IS NULL AND email = ?").bind(user.id, user.email).run();
    const member = await env.DB.prepare("SELECT ref_code FROM members WHERE user_id = ?").bind(user.id).first();
    return json({ ok: true, user, member }, 200, { "Set-Cookie": await createSession(env, req, user.id, "user") });
  });

  /**
   * Request an admin code by email. When Google sign-in is configured, the admin must
   * sign in with Google first (this endpoint then only re-sends). Before Google is set up
   * it lets the admin bootstrap with the email code alone.
   */
  router.post("/api/auth/admin/request-code", async (req) => {
    await rateLimit(env, "admincode", clientIp(req), 5, 900);
    const { email } = await readJson<{ email?: string }>(req);
    const s = await getSession(env, req);
    const viaGoogle = s && isAdminEmail(env, s.user.email);
    if (env.GOOGLE_CLIENT_ID && !viaGoogle) throw new HttpError(403, "Please continue with Google using the church media account.");
    if (!viaGoogle && (!email || !isAdminEmail(env, email))) {
      // Same answer for any other address so the admin email can't be probed.
      return json({ ok: true, challenge: crypto.randomUUID(), sent_to: "your inbox" });
    }
    const user = s?.user ?? await upsertUser(env, { email: adminEmail(env) });
    return json({ ok: true, ...(await sendAdminCode(env, user.id)) });
  });

  router.post("/api/auth/admin/verify", async (req) => {
    await rateLimit(env, "adminverify", clientIp(req), 12, 900);
    const { challenge, code } = await readJson<{ challenge?: string; code?: string }>(req);
    if (!challenge || !code) throw new HttpError(400, "Enter the 6-digit code from your email.");
    const r = await consumeLoginCode(env, challenge, code);
    if (!isAdminEmail(env, r.email)) throw new HttpError(403, "Not allowed.");
    const user = await upsertUser(env, { email: r.email });
    await destroySession(env, req);
    await env.DB.prepare("INSERT INTO audit_log (user_id, action) VALUES (?, 'admin_login')").bind(user.id).run();
    return json({ ok: true, user }, 200, { "Set-Cookie": await createSession(env, req, user.id, "admin") });
  });

  router.post("/api/auth/logout", async (req) => {
    await destroySession(env, req);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(req) });
  });

  // ---------------- member self-service
  router.get("/api/me", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    const member = await env.DB.prepare(
      `SELECT ref_code, status, membership_type, first_name, last_name, preferred_name, phone, email, suburb, interests, created_at,
              last_confirmed_at, next_checkin_at, revoked_at
         FROM members WHERE user_id = ? OR email = ? ORDER BY created_at DESC LIMIT 1`).bind(s.user.id, s.user.email).first();
    const { results: registrations } = await env.DB.prepare(
      `SELECT r.ref_code, r.status, r.created_at, e.title, e.slug, e.starts_at, e.ends_at, e.location FROM event_registrations r
         JOIN events e ON e.id = r.event_id WHERE (r.user_id = ? OR r.email = ?) AND r.status NOT IN ('cancelled') ORDER BY e.starts_at DESC LIMIT 50`,
    ).bind(s.user.id, s.user.email).all();
    const sub = await env.DB.prepare("SELECT status FROM subscribers WHERE email = ?").bind(s.user.email).first<{ status: string }>();
    return json({ ok: true, user: s.user, member, registrations, subscribed: sub?.status === "active", is_admin: s.kind === "admin" });
  });

  // Membership: confirm "still a member" or revoke, from the profile page.
  const myMember = async (req: Request) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    const m = await env.DB.prepare("SELECT * FROM members WHERE user_id = ? OR email = ? ORDER BY created_at DESC LIMIT 1").bind(s.user.id, s.user.email).first<MemberRow>();
    if (!m) throw new HttpError(404, "We couldn't find a membership for this account.");
    return m;
  };
  router.post("/api/me/membership/confirm", async (req) => json({ ok: true, ...(await confirmMembership(env, await myMember(req))) }));
  router.post("/api/me/membership/revoke", async (req) => {
    const { reason } = await readJson<{ reason?: string }>(req);
    return json({ ok: true, ...(await revokeMembership(env, await myMember(req), reason ?? null, "profile")) });
  });

  router.post("/api/me/letter", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    const { subscribed } = await readJson<{ subscribed?: boolean }>(req);
    if (subscribed) {
      await subscribe(env, { email: s.user.email, name: s.user.given_name, source: "google", userId: s.user.id, verified: true });
    } else {
      await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE email = ?").bind(new Date().toISOString(), s.user.email).run();
    }
    return json({ ok: true, subscribed: !!subscribed });
  });

  router.post("/api/me/registrations/:ref/cancel", async (req, { ref }) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    const reg = await env.DB.prepare("SELECT id, event_id FROM event_registrations WHERE ref_code = ? AND (user_id = ? OR email = ?)")
      .bind(ref, s.user.id, s.user.email).first<{ id: string; event_id: string }>();
    if (!reg) throw new HttpError(404, "Registration not found.");
    await env.DB.prepare("UPDATE event_registrations SET status = 'cancelled' WHERE id = ?").bind(reg.id).run();
    await promoteWaitlist(env, reg.event_id);
    return json({ ok: true });
  });
}
