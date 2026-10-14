// Evangelism ("Go Ye"), the Call Office and Discipleship classes.
//  - Anyone can respond on the Evangelism page ("I prayed", "I'd like to visit", "talk to a leader") or sign up for discipleship classes.
//  - Signed-in members on the evangelism team log the people they meet; the Call Office follows them up.
//  - The Call Office (permission "calls") also checks up on brethren, logging each call.
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson, trustedWrite } from "../lib/http.ts";
import { getSession, requireAdmin } from "../lib/auth.ts";
import { rateLimit, ipHash } from "../lib/ratelimit.ts";
import { uuid } from "../lib/crypto.ts";
import { Validator } from "../lib/validate.ts";
import { sendMail } from "../lib/email.ts";

const DECISIONS = ["prayed", "interested", "visit", "prayer", "class", "talk"] as const;
const CONTACT_STATUS = ["new", "no_answer", "called", "connected", "closed"] as const;
const OUTCOMES = ["spoke", "no_answer", "message", "needs_help"] as const;
const TRACKS = ["foundations", "baptism", "growing", "serving"] as const;
const LABEL: Record<string, string> = { prayed: "Prayed to receive Jesus", interested: "Interested", visit: "Wants to visit church", prayer: "Asked for prayer", class: "Wants discipleship classes", talk: "Wants to talk to a leader" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function setting(env: Env, key: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
}

/** Church leaders people can call: only shown to signed-in confirmed members and the team. */
async function leaders(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT r.role, COALESCE(m.preferred_name, m.first_name, u.given_name, u.name) AS first, m.last_name AS last, m.phone
       FROM admin_roles r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN members m ON m.user_id = r.user_id
      WHERE m.phone IS NOT NULL AND m.phone != '' ORDER BY r.role, first`).all<{ role: string; first: string; last: string | null; phone: string }>();
  return results.map((l) => ({ name: [l.first, l.last].filter(Boolean).join(" "), role: l.role === "youth_leader" ? "Youth leader" : "Church leader", phone: l.phone }));
}
async function canSeeLeaders(env: Env, req: Request): Promise<boolean> {
  const s = await getSession(env, req);
  if (!s) return false;
  if (s.role) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM members WHERE user_id = ? AND status IN ('member','welcomed','contacted')").bind(s.user.id).first());
}

async function tellCallOffice(env: Env, subject: string, lines: string[]) {
  await sendMail(env, { to: adminEmail(env), subject, html: `<p>${lines.map(esc).join("<br>")}</p><p><a href="${siteUrl(env)}/admin/#calls">Open the Call Office</a></p>`,
    text: lines.join("\n") + `\n${siteUrl(env)}/admin/#calls`, template: "call_office" }).catch(() => {});
}

export function outreachRoutes(router: Router, env: Env): void {
  // ---------- public: the Evangelism page ----------
  router.get("/api/evangelism", async (req) => {
    const show = await canSeeLeaders(env, req);
    return json({ ok: true, whatsapp: await setting(env, "whatsapp_number"), email: await setting(env, "contact_email"), leaders: show ? await leaders(env) : null });
  });

  router.post("/api/evangelism/respond", async (req) => {
    const ip = clientIp(req);
    await rateLimit(env, "evangelism", ip, 8, 3600);
    const b = await readJson<Record<string, unknown>>(req);
    if (b.website) return json({ ok: true }, 201);
    const v = new Validator(b);
    const name = v.text("name", { required: true, max: 120, label: "Your name" });
    const phone = v.phone("phone", false);
    const email = b.email ? v.email("email", false) : null;
    const note = v.text("note", { max: 1000 });
    v.assert();
    if (!phone && !email) throw new HttpError(422, "Please leave a phone number or email so we can reach you.");
    const decision = (DECISIONS as readonly string[]).includes(String(b.decision)) ? String(b.decision) : "talk";
    await env.DB.prepare("INSERT INTO outreach_contacts (id, name, phone, email, notes, decision, source, ip_hash) VALUES (?,?,?,?,?,?,?,?)")
      .bind(uuid(), name, phone, email, note, decision, "web", await ipHash(ip)).run();
    await tellCallOffice(env, `Evangelism page: ${name} (${LABEL[decision]})`, [`${name} · ${LABEL[decision]}`, phone || "", email || "", note || ""].filter(Boolean));
    return json({ ok: true, message: decision === "prayed" ? "Welcome to God's family! Someone from the church will call you this week." : "Thank you! Someone from the church will be in touch soon." }, 201);
  });

  router.post("/api/discipleship", async (req) => {
    const ip = clientIp(req);
    await rateLimit(env, "discipleship", ip, 6, 3600);
    const b = await readJson<Record<string, unknown>>(req);
    if (b.website) return json({ ok: true }, 201);
    const s = await getSession(env, req);
    const v = new Validator(b);
    const name = v.text("name", { required: !s, max: 120, label: "Your name" }) || s?.user.name || s?.user.email || "";
    const phone = v.phone("phone", false);
    const email = (b.email ? v.email("email", false) : null) || s?.user.email || null;
    const note = v.text("note", { max: 600 });
    v.assert();
    if (!phone && !email) throw new HttpError(422, "Please leave a phone number or email.");
    const track = (TRACKS as readonly string[]).includes(String(b.track)) ? String(b.track) : "foundations";
    await env.DB.prepare("INSERT INTO discipleship_signups (id, user_id, name, email, phone, track, note, ip_hash) VALUES (?,?,?,?,?,?,?,?)")
      .bind(uuid(), s?.user.id ?? null, name, email, phone, track, note, await ipHash(ip)).run();
    await tellCallOffice(env, `Discipleship classes: ${name}`, [`${name} signed up for ${track}`, phone || "", email || "", note || ""].filter(Boolean));
    return json({ ok: true, message: "You're signed up! We'll let you know when the next class starts." }, 201);
  });

  // ---------- signed in: Go Ye (the evangelism team in the app) ----------
  router.get("/api/go", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in first.");
    const month = new Date().toISOString().slice(0, 7);
    const mine = await env.DB.prepare("SELECT id, name, area, decision, status, created_at FROM outreach_contacts WHERE brought_by = ? ORDER BY created_at DESC LIMIT 30").bind(s.user.id).all();
    const team = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(decision = 'prayed') AS saved FROM outreach_contacts WHERE substr(created_at, 1, 7) = ?").bind(month).first<{ n: number; saved: number | null }>();
    return json({ ok: true, mine: mine.results, team: { contacts: team?.n ?? 0, saved: team?.saved ?? 0 }, leaders: (await canSeeLeaders(env, req)) ? await leaders(env) : null,
      whatsapp: await setting(env, "whatsapp_number") });
  });

  router.post("/api/go/contacts", async (req) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in first.");
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    await rateLimit(env, "go-contact", s.user.id, 60, 3600);
    const b = await readJson<Record<string, unknown>>(req);
    const v = new Validator(b);
    const name = v.text("name", { required: true, max: 120, label: "Their name" });
    const phone = v.phone("phone", false);
    const area = v.text("area", { max: 120 });
    const note = v.text("note", { max: 1000 });
    v.assert();
    const decision = (DECISIONS as readonly string[]).includes(String(b.decision)) ? String(b.decision) : "interested";
    const by = s.user.given_name || s.user.name || s.user.email;
    await env.DB.prepare("INSERT INTO outreach_contacts (id, name, phone, area, notes, decision, source, brought_by, brought_by_name) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(uuid(), name, phone, area, note, decision, "team", s.user.id, by).run();
    return json({ ok: true, message: "Thank you! The Call Office will follow up. 🙌" }, 201);
  });

  // ---------- Call Office (permission "calls") ----------
  router.get("/api/admin/calls", async (req) => {
    await requireAdmin(env, req);
    const contacts = await env.DB.prepare(`SELECT * FROM outreach_contacts WHERE status != 'closed' ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'no_answer' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`).all();
    const brethren = await env.DB.prepare(
      `SELECT m.id, COALESCE(m.preferred_name, m.first_name) AS first, m.last_name AS last, m.phone, m.status, m.ref_code,
              (SELECT MAX(created_at) FROM care_calls c WHERE c.member_id = m.id) AS last_call,
              (SELECT outcome FROM care_calls c WHERE c.member_id = m.id ORDER BY created_at DESC LIMIT 1) AS last_outcome
         FROM members m WHERE m.status IN ('member','welcomed','contacted','new')
        ORDER BY last_call IS NOT NULL, last_call LIMIT 150`).all();
    const classes = await env.DB.prepare("SELECT * FROM discipleship_signups WHERE status != 'done' ORDER BY created_at DESC LIMIT 100").all();
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const done = await env.DB.prepare("SELECT COUNT(*) AS n FROM care_calls WHERE created_at >= ?").bind(weekAgo).first<{ n: number }>();
    return json({ ok: true, contacts: contacts.results, brethren: brethren.results, classes: classes.results, calls_this_week: done?.n ?? 0, labels: LABEL });
  });

  router.patch("/api/admin/calls/contacts/:id", async (req, { id }) => {
    const s = await requireAdmin(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const b = await readJson<{ status?: string; note?: string }>(req);
    if (!(CONTACT_STATUS as readonly string[]).includes(String(b.status))) throw new HttpError(422, "Choose how the call went.");
    const r = await env.DB.prepare("UPDATE outreach_contacts SET status = ?, last_note = COALESCE(?, last_note), called_by = ?, called_at = ? WHERE id = ?")
      .bind(b.status, String(b.note || "").trim().slice(0, 1000) || null, s.user.email, new Date().toISOString(), id).run();
    if (!r.meta.changes) throw new HttpError(404, "Not found.");
    return json({ ok: true });
  });

  router.post("/api/admin/calls/members/:id", async (req, { id }) => {
    const s = await requireAdmin(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const b = await readJson<{ outcome?: string; note?: string }>(req);
    if (!(OUTCOMES as readonly string[]).includes(String(b.outcome))) throw new HttpError(422, "Choose how the call went.");
    if (!(await env.DB.prepare("SELECT 1 FROM members WHERE id = ?").bind(id).first())) throw new HttpError(404, "Not found.");
    const note = String(b.note || "").trim().slice(0, 1000) || null;
    await env.DB.prepare("INSERT INTO care_calls (id, member_id, outcome, note, called_by) VALUES (?,?,?,?,?)").bind(uuid(), id, b.outcome, note, s.user.email).run();
    if (b.outcome === "needs_help") await tellCallOffice(env, "Call Office: someone needs help", [`A member needs help (logged by ${s.user.email}).`, note || ""]);
    return json({ ok: true });
  });

  router.patch("/api/admin/calls/classes/:id", async (req, { id }) => {
    await requireAdmin(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const b = await readJson<{ status?: string }>(req);
    if (!["new", "placed", "done"].includes(String(b.status))) throw new HttpError(422, "Unknown status.");
    await env.DB.prepare("UPDATE discipleship_signups SET status = ? WHERE id = ?").bind(b.status, id).run();
    return json({ ok: true });
  });
}
