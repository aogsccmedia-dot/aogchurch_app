import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { voidTickets } from "../lib/tickets.ts";
import { approvedMember, createComplaint } from "../lib/complaints.ts";
import { confirmMembership, revokeMembership, revokeReason, type MemberRow } from "../lib/membership.ts";
import { remindersOn, setReminders } from "../lib/reminders.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { overLimit, rateLimit } from "../lib/ratelimit.ts";
import {
  clearSessionCookie, consumeLoginCode, createLoginCode, createSession, destroySession, getSession,
  canAdmin, isAdminEmail, upsertUser, verifyGoogleToken,
} from "../lib/auth.ts";
import { sendMail } from "../lib/email.ts";
import { subscribe } from "../lib/newsletter.ts";
import * as T from "../emails/templates.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../lib/password.ts";
import { uuid } from "../lib/crypto.ts";
import { promoteWaitlist } from "../lib/registrations.ts";

const mask = (email: string) => email.replace(/^(.)(.*)(.@.*)$/, (_m, a, mid, c) => a + "•".repeat(Math.min(6, mid.length)) + c);

export function authRoutes(router: Router, env: Env): void {
  router.get("/api/auth/me", async (req) => {
    const s = await getSession(env, req);
    if (!s) return json({ ok: true, user: null, google_client_id: env.GOOGLE_CLIENT_ID || null });
    // One trip for both (they don't depend on each other). Whether they can open the admin portal is already in the session.
    const [member, sub] = await Promise.all([
      env.DB.prepare("SELECT ref_code, status, first_name, preferred_name, created_at FROM members WHERE (user_id = ? OR email = ?) AND status != 'revoked' ORDER BY created_at DESC LIMIT 1").bind(s.user.id, s.user.email).first(),
      env.DB.prepare("SELECT status FROM subscribers WHERE email = ?").bind(s.user.email).first<{ status: string }>(),
    ]);
    if (s.visitor) return json({ ok: true, user: s.user, visitor: true, is_admin: false, admin_role: null, admin_perms: null, can_admin: false, admin_account: false, member: null, subscribed: false, google_client_id: env.GOOGLE_CLIENT_ID || null });
    return json({ ok: true, user: s.user, is_admin: s.kind === "admin", admin_role: s.role ?? null, admin_perms: s.role && s.role !== "super" ? s.perms : null, can_admin: s.kind === "admin", admin_account: isAdminEmail(env, s.user.email),
      pastor: !!s.pastor, member, subscribed: sub?.status === "active", google_client_id: env.GOOGLE_CLIENT_ID || null });
  });

  /** Sign in with Google (everyone). The main admin account goes straight in too: no emailed codes. */
  router.post("/api/auth/google", async (req) => {
    await rateLimit(env, "google", clientIp(req), 30, 600);
    const { credential } = await readJson<{ credential?: string }>(req);
    if (!credential) throw new HttpError(400, "Missing Google credential.");
    const g = await verifyGoogleToken(env, credential);
    const user = await upsertUser(env, g);
    // Only the main admin account needs an emailed code on top of Google. Everyone else, including admins and
    // youth leaders, is signed in straight away with exactly the access they've been given.
    if (isAdminEmail(env, user.email)) {
      await env.DB.prepare("INSERT INTO audit_log (user_id, action) VALUES (?, 'admin_login')").bind(user.id).run();
      return json({ ok: true, user, admin: true }, 200, { "Set-Cookie": await createSession(env, req, user.id, "admin") });
    }
    // A visitor who now signs in with Google has a full account from here on (still not a member until a leader confirms).
    await env.DB.prepare("UPDATE users SET visitor = 0 WHERE id = ? AND visitor = 1").bind(user.id).run();
    // Link any earlier join-form record made with the same email.
    await env.DB.prepare("UPDATE members SET user_id = ? WHERE user_id IS NULL AND email = ?").bind(user.id, user.email).run();
    const member = await env.DB.prepare("SELECT ref_code FROM members WHERE user_id = ?").bind(user.id).first();
    return json({ ok: true, user, member }, 200, { "Set-Cookie": await createSession(env, req, user.id, "user") });
  });

  // ---------------- email + password (for people who don't use Google)
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const normEmail = (e: unknown) => String(e || "").trim().toLowerCase().slice(0, 200);
  const signIn = async (req: Request, userId: string, email: string, extra: Record<string, unknown> = {}) => {
    await env.DB.prepare("UPDATE members SET user_id = ? WHERE user_id IS NULL AND lower(email) = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND email_verified_at IS NOT NULL)").bind(userId, email, userId).run();
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), userId).run();
    const user = await env.DB.prepare("SELECT id, email, name, given_name, family_name, picture FROM users WHERE id = ?").bind(userId).first();
    return json({ ok: true, user, ...extra }, 200, { "Set-Cookie": await createSession(env, req, userId, isAdminEmail(env, email) ? "admin" : "user") });
  };
  const isMemberEmail = async (email: string) => !!(await env.DB.prepare("SELECT 1 FROM members WHERE lower(email) = ? AND status = 'member' LIMIT 1").bind(email).first());
  /** Does the church already hold records under this email (so the person should prove it's theirs first)? */
  const knownEmail = async (email: string) => !!(await env.DB.prepare(
    "SELECT 1 FROM members WHERE lower(email) = ? UNION SELECT 1 FROM event_registrations WHERE lower(email) = ? UNION SELECT 1 FROM subscribers WHERE lower(email) = ? LIMIT 1")
    .bind(email, email, email).first()) || isAdminEmail(env, email);
  const sendCode = async (email: string, userId: string | null, purpose: string, payload: unknown, ctx?: { waitUntil(p: Promise<unknown>): void }) => {
    const { id, code } = await createLoginCode(env, email, userId);
    await env.DB.prepare("UPDATE login_codes SET purpose = ?, payload = ? WHERE id = ?").bind(purpose, payload ? JSON.stringify(payload) : null, id).run();
    const mail = sendMail(env, { to: email, ...T.accountCode({ site: siteUrl(env) }, code), template: "account_code" });
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(mail.catch(() => false)); else await mail;
    return { challenge: id, sent_to: mask(email) };
  };

  router.post("/api/auth/password/login", async (req) => {
    // Only wrong passwords count towards the limits, so signing in normally never locks anyone out.
    const ip = clientIp(req);
    const b = await readJson<{ email?: string; password?: string }>(req);
    const email = normEmail(b.email), pw = String(b.password || "");
    if (!EMAIL_RE.test(email) || !pw) throw new HttpError(400, "Enter your email and password.");
    if (await overLimit(env, "pw-login", ip, 20, 900) || await overLimit(env, "pw-login-acct", email, 8, 900))
      throw new HttpError(429, "Too many tries. Wait 15 minutes, or tap “Forgot password” to get back in now.");
    const fail = async (msg: string) => { await rateLimit(env, "pw-login", ip, 1000, 900); await rateLimit(env, "pw-login-acct", email, 1000, 900); return new HttpError(401, msg); };
    const u = await env.DB.prepare("SELECT id, password_hash FROM users WHERE lower(email) = ?").bind(email).first<{ id: string; password_hash: string | null }>();
    if (!u?.password_hash) {
      await verifyPassword(pw, "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");   // same work either way
      throw await fail(u ? "This account signs in with Google. Tap the Google button, or use “Forgot password” to add a password." : "That email and password don't match. Try again, or tap “Forgot password”.");
    }
    if (!(await verifyPassword(pw, u.password_hash))) throw await fail("That email and password don't match. Try again, or tap “Forgot password”.");
    return signIn(req, u.id, email);
  });

  router.post("/api/auth/password/signup", async (req, _p, ctx) => {
    await rateLimit(env, "pw-signup", clientIp(req), 8, 3600);
    const b = await readJson<{ name?: string; email?: string; password?: string }>(req);
    const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 80), email = normEmail(b.email), pw = String(b.password || "");
    if (name.length < 2) throw new HttpError(422, "Please add your name.");
    if (!EMAIL_RE.test(email)) throw new HttpError(422, "Please enter a valid email address.");
    const problem = passwordProblem(pw, email); if (problem) throw new HttpError(422, problem);
    const existing = await env.DB.prepare("SELECT id, password_hash FROM users WHERE lower(email) = ?").bind(email).first<{ id: string; password_hash: string | null }>();
    if (existing?.password_hash) throw new HttpError(409, "This email already has an account. Please sign in, or tap “Forgot password”.");
    // A church member's email: they sign in (Google, or “Forgot password” to set a password), never sign up again.
    if (!existing && await isMemberEmail(email)) throw new HttpError(409, "This email already belongs to a church member. Please sign in, or tap “Forgot password” to set a password.");
    const given = name.split(" ")[0], hash = await hashPassword(pw);
    if (existing || await knownEmail(email)) {
      // An account (e.g. from Google) or church records already use this email: prove it's yours once, then the password is added.
      // The church already has records under this email: prove it's yours once, then everything links up.
      return json({ ok: true, needs_code: true, ...(await sendCode(email, null, "signup", { name, given, hash }, ctx)) });
    }
    const id = uuid();
    await env.DB.prepare("INSERT INTO users (id, email, name, given_name, password_hash, last_login_at) VALUES (?,?,?,?,?,?)").bind(id, email, name, given, hash, new Date().toISOString()).run();
    return signIn(req, id, email, { created: true });
  });

  // ---------------- visitors: sign in as a guest with name and email (phone optional). Never verified as a member.
  // A brand-new email goes straight in. An email the church already knows (an account, a booking or records) gets a
  // 6-digit code first, so nobody can open someone else's tickets by typing their email.
  router.post("/api/auth/visitor", async (req, _p, ctx) => {
    await rateLimit(env, "visitor", clientIp(req), 10, 3600);
    const b = await readJson<{ name?: string; email?: string; phone?: string }>(req);
    const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 80), email = normEmail(b.email);
    const phone = String(b.phone || "").replace(/[^\d+ ]/g, "").trim().slice(0, 20) || null;
    if (name.length < 2) throw new HttpError(422, "Please add your name.");
    if (!EMAIL_RE.test(email)) throw new HttpError(422, "Please enter a valid email address.");
    const existing = await env.DB.prepare("SELECT id, visitor FROM users WHERE lower(email) = ?").bind(email).first<{ id: string; visitor: number }>();
    if (existing && !existing.visitor) throw new HttpError(409, "This email already has an account. Please sign in instead.");
    if (await isMemberEmail(email)) throw new HttpError(409, "This email already belongs to a church member. Please sign in instead.");
    if (isAdminEmail(env, email)) throw new HttpError(409, "Please sign in instead.");
    if (existing || await knownEmail(email)) return json({ ok: true, needs_code: true, ...(await sendCode(email, existing?.id ?? null, "visitor", { name, given: name.split(" ")[0], phone }, ctx)) });
    const id = uuid();
    await env.DB.prepare("INSERT INTO users (id, email, name, given_name, phone, visitor, last_login_at) VALUES (?,?,?,?,?,1,?)").bind(id, email, name, name.split(" ")[0], phone, new Date().toISOString()).run();
    const user = { id, email, name, given_name: name.split(" ")[0], family_name: null, picture: null };
    return json({ ok: true, user, visitor: true, created: true }, 200, { "Set-Cookie": await createSession(env, req, id, "user") });
  });

  router.post("/api/auth/password/forgot", async (req, _p, ctx) => {
    await rateLimit(env, "pw-forgot", clientIp(req), 6, 900);
    const email = normEmail((await readJson<{ email?: string }>(req)).email);
    if (!EMAIL_RE.test(email)) throw new HttpError(422, "Please enter a valid email address.");
    await rateLimit(env, "pw-forgot-acct", email, 4, 900);
    const u = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(email).first<{ id: string }>();
    if (!u && !(await knownEmail(email))) return json({ ok: true, challenge: crypto.randomUUID(), sent_to: mask(email) });   // same answer either way
    return json({ ok: true, ...(await sendCode(email, u?.id ?? null, "reset", null, ctx)) });
  });

  // Confirm a code: finishes a sign-up that needed proof, or sets a new password after "Forgot password".
  router.post("/api/auth/password/confirm", async (req) => {
    await rateLimit(env, "pw-confirm", clientIp(req), 15, 900);
    const b = await readJson<{ challenge?: string; code?: string; password?: string }>(req);
    if (!b.challenge || !b.code) throw new HttpError(400, "Enter the 6-digit code from your email.");
    const row = await env.DB.prepare("SELECT purpose, payload, email FROM login_codes WHERE id = ?").bind(String(b.challenge)).first<{ purpose: string | null; payload: string | null; email: string }>();
    if (!row) throw new HttpError(400, "That code has expired. Please ask for a new one.");
    await rateLimit(env, "pw-confirm-acct", row.email.toLowerCase(), 12, 3600);   // guesses per email, whatever the network
    if (row.purpose === "reset") { const problem = passwordProblem(String(b.password || "")); if (problem) throw new HttpError(422, problem); }
    const r = await consumeLoginCode(env, b.challenge, b.code);
    const email = r.email.toLowerCase();
    let u = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(email).first<{ id: string }>();
    const p = row.payload ? JSON.parse(row.payload) as { name: string; given: string; hash?: string; phone?: string | null } : null;
    const hash = row.purpose === "reset" ? await hashPassword(String(b.password)) : p?.hash ?? null;
    if (row.purpose === "visitor") {
      // A returning visitor (or someone whose email has bookings) proved the email: in as a guest, still not verified as a member.
      if (!u) { const id = uuid(); await env.DB.prepare("INSERT INTO users (id, email, name, given_name, phone, visitor, last_login_at) VALUES (?,?,?,?,?,1,?)").bind(id, email, p?.name ?? null, p?.given ?? null, p?.phone ?? null, new Date().toISOString()).run(); u = { id }; }
      else await env.DB.prepare("UPDATE users SET phone = COALESCE(?, phone), last_login_at = ? WHERE id = ? AND visitor = 1").bind(p?.phone ?? null, new Date().toISOString(), u.id).run();
      const user = await env.DB.prepare("SELECT id, email, name, given_name, family_name, picture FROM users WHERE id = ?").bind(u.id).first();
      return json({ ok: true, user, visitor: true }, 200, { "Set-Cookie": await createSession(env, req, u.id, "user") });
    }
    if (!u) {
      const id = uuid();
      await env.DB.prepare("INSERT INTO users (id, email, name, given_name, password_hash, email_verified_at) VALUES (?,?,?,?,?,?)").bind(id, email, p?.name ?? null, p?.given ?? null, hash, new Date().toISOString()).run();
      u = { id };
    } else {
      await env.DB.prepare("UPDATE users SET password_hash = COALESCE(?, password_hash), email_verified_at = COALESCE(email_verified_at, ?), visitor = 0 WHERE id = ?").bind(hash, new Date().toISOString(), u.id).run();
      // A new password signs out every other device (whoever knew the old one is out).
      if (row.purpose === "reset") await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id).run();
    }
    return signIn(req, u.id, email);
  });

  router.post("/api/auth/logout", async (req) => {
    await destroySession(env, req);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(req) });
  });

  // ---------------- member self-service
  router.get("/api/me", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    // Five independent lookups, sent together: the page waits for one trip, not five.
    const [member, { results: registrations }, sub, pw, reminders] = await Promise.all([
      env.DB.prepare(
        `SELECT ref_code, status, membership_type, first_name, last_name, preferred_name, phone, email, suburb, interests, created_at,
                last_confirmed_at, next_checkin_at, revoked_at
           FROM members WHERE user_id = ? OR email = ? ORDER BY created_at DESC LIMIT 1`).bind(s.user.id, s.user.email).first(),
      env.DB.prepare(
        `SELECT r.ref_code, r.status, r.created_at, r.guests, e.title, e.slug, e.starts_at, e.ends_at, e.location,
                (SELECT code FROM tickets t WHERE t.registration_id = r.id AND t.status = 'valid' ORDER BY seq LIMIT 1) AS ticket_code FROM event_registrations r
           JOIN events e ON e.id = r.event_id WHERE (r.user_id = ? OR r.email = ?) AND r.status NOT IN ('cancelled') ORDER BY e.starts_at DESC LIMIT 50`,
      ).bind(s.user.id, s.user.email).all(),
      env.DB.prepare("SELECT status FROM subscribers WHERE email = ?").bind(s.user.email).first<{ status: string }>(),
      env.DB.prepare("SELECT opted_out FROM prayer_weekly WHERE email = ?").bind(s.user.email.toLowerCase()).first<{ opted_out: number }>(),
      remindersOn(env, s.user.email),
    ]);
    return json({ ok: true, user: s.user, member, registrations, subscribed: sub?.status === "active", service_reminders: reminders, prayer_weekly: !pw?.opted_out, is_admin: s.kind === "admin" });
  });

  // The Monday prayer-wall email: on unless switched off here or from the link in the email.
  router.patch("/api/me/prayer-weekly", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    const { on } = await readJson<{ on?: boolean }>(req);
    const email = s.user.email.toLowerCase();
    await env.DB.prepare("INSERT INTO prayer_weekly (email, token, opted_out) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET opted_out = excluded.opted_out, updated_at = ?")
      .bind(email, crypto.randomUUID().replace(/-/g, ""), on ? 0 : 1, new Date().toISOString()).run();
    return json({ ok: true, on: !!on });
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
    const why = revokeReason(await readJson<{ reason_code?: string; reason?: string }>(req));
    const m = await myMember(req);
    return json({ ok: true, first_name: m.preferred_name || m.first_name, ...(await revokeMembership(env, m, why.text, "profile", new Date(), why.code)) });
  });

  router.patch("/api/me/reminders", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    const { on } = await readJson<{ on?: boolean }>(req);
    await setReminders(env, s.user.email, !!on);
    return json({ ok: true, on: !!on });
  });

  // Complaints (approved members only).
  router.get("/api/me/complaints", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    const m = await approvedMember(env, s.user.id, s.user.email);
    const { results } = m ? await env.DB.prepare("SELECT ref_code, category, subject, status, response, responded_at, created_at FROM complaints WHERE member_id = ? ORDER BY created_at DESC LIMIT 50").bind(m.id).all() : { results: [] };
    return json({ ok: true, eligible: !!m, complaints: results });
  });
  router.post("/api/me/complaints", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in.");
    await rateLimit(env, "complaint", clientIp(req), 5, 3600);
    const m = await approvedMember(env, s.user.id, s.user.email);
    if (!m) throw new HttpError(403, "Complaints can be raised by approved members. If you've recently joined, a leader will approve your membership soon.");
    return json({ ok: true, ...(await createComplaint(env, m, s.user.id, await readJson(req))) }, 201);
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
    await voidTickets(env, reg.id);
    await promoteWaitlist(env, reg.event_id);
    return json({ ok: true });
  });
}
