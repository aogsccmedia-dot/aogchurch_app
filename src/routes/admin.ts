import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { randomToken, uuid } from "../lib/crypto.ts";
import { Validator } from "../lib/validate.ts";
import { getFile } from "../lib/storage.ts";
import { ADMIN_DEFAULT, isAdminEmail, parsePerms, requireAdmin, YOUTH_DEFAULT, YOUTH_PERMS, type Session } from "../lib/auth.ts";
import { deleteOwnerFiles, readUpload, storeFiles } from "../lib/uploads.ts";
import { parseSchema, sanitizeSchema, slugify } from "../lib/forms.ts";
import { emailHealth, resendFailed, sendMail } from "../lib/email.ts";
import { SAMPLES } from "../emails/samples.ts";
import { ensureTickets, voidTickets } from "../lib/tickets.ts";
import { CONTACT_METHODS, assignLeader, backfillLeaders, leaders, logContact, reassignFrom } from "../lib/leaders.ts";
import { GROUP_KEYS } from "../lib/groups.ts";
import { CHECKIN_MONTHS, addMonths } from "../lib/membership.ts";
import { buildAnnouncement, processAnnouncements, renderAnnouncement, type AnnouncementRow } from "../lib/newsletter.ts";
import { calendarUrl, formatWhen, nextSundayAfternoon } from "../lib/time.ts";
import * as T from "../emails/templates.ts";
import { notifyRegistration, promoteWaitlist, type EventRow, type RegRow } from "../lib/registrations.ts";
import { ADMIN_ONLY_SETTINGS, COMPLAINT_STATUSES, EVENT_CATEGORIES, MEMBER_STATUSES, MESSAGE_STATUSES, PRAYER_STATUSES, PUBLIC_SETTINGS } from "../constants.ts";

type Ctx = { waitUntil(p: Promise<unknown>): void };
type H = (req: Request, p: Record<string, string>, s: Session, ctx?: Ctx) => Promise<Response>;
/** Run slow work (emails, PDFs) after responding, so admin buttons react instantly. */
/** Permission keys → plain words (used in role emails and the portal). */
export const permLabels = (perms: string[]) => perms.map((k) => YOUTH_PERMS.find(([x]) => x === k)?.[1] || k);
const later = (ctx: Ctx | undefined, job: Promise<unknown>) => { const safeJob = job.catch((e) => console.error("background job failed", e)); if (ctx?.waitUntil) ctx.waitUntil(safeJob); else return safeJob; };

async function audit(env: Env, s: Session, action: string, entity?: string, entityId?: string, detail?: unknown) {
  await env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)")
    .bind(s.user.id, action, entity ?? null, entityId ?? null, detail ? JSON.stringify(detail).slice(0, 2000) : null).run();
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(name: string, header: string[], rows: unknown[][]) {
  return new Response("﻿" + [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}

function pageParams(url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return { limit, offset: (page - 1) * limit, page };
}

export { promoteWaitlist };

export function adminRoutes(router: Router, env: Env): void {
  const guard = (h: H) => async (req: Request, p: Record<string, string>, ctx?: Ctx) => {
    const s = await requireAdmin(env, req);
    if (req.method !== "GET" && req.method !== "HEAD" && !trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    return h(req, p, s, ctx);
  };
  const superOnly = (h: H) => guard(async (req, p, s, ctx) => {
    if (s.role !== "super") throw new HttpError(403, "Only the main church admin can do this.");
    return h(req, p, s, ctx);
  });
  /** Team members without full Events access may only act on youth events (ministry group "youth"). */
  const youthOnly = (s: Session) => s.role !== "super" && !(s.perms || []).includes("events");
  const checkEventScope = (s: Session, e: { ministry_group?: string | null } | null) => {
    if (youthOnly(s) && e?.ministry_group !== "youth") throw new HttpError(403, "You can only manage tickets for youth events.");
  };

  // ---------- dashboard ----------
  router.get("/api/admin/stats", guard(async (_req, _p, sess) => {
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const now = new Date().toISOString();
    const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
    const rs = await env.DB.batch([
      q("SELECT COUNT(*) AS n FROM members"),
      q("SELECT COUNT(*) AS n FROM members WHERE status = 'new'"),
      q("SELECT COUNT(*) AS n FROM members WHERE created_at >= ?", weekAgo),
      q("SELECT COUNT(*) AS n FROM prayer_requests WHERE status = 'new'"),
      q("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
      q("SELECT COUNT(*) AS n FROM events WHERE starts_at >= ?", now),
      q("SELECT COUNT(*) AS n FROM subscribers WHERE status = 'active'"),
      q("SELECT COUNT(*) AS n FROM event_registrations WHERE created_at >= ? AND status != 'cancelled'", weekAgo),
      q("SELECT COUNT(*) AS n FROM users"),
      q("SELECT COUNT(*) AS n FROM event_registrations WHERE status = 'pending'"),
      q("SELECT COUNT(*) AS n FROM complaints WHERE status IN ('received','in_review')"),
      q("SELECT COUNT(*) AS n FROM prayer_wall WHERE status = 'pending'"),
    ]);
    const n = (i: number) => (rs[i].results[0] as { n: number }).n;
    const interests = await env.DB.prepare("SELECT j.value AS slug, COUNT(*) AS n FROM members, json_each(members.interests) j GROUP BY j.value ORDER BY n DESC").all();
    const next = await env.DB.prepare("SELECT id, subject, status, scheduled_for FROM announcements WHERE status IN ('scheduled','sending') ORDER BY scheduled_for LIMIT 1").first();
    // "Needs attention": newest open complaints, new prayer requests and new messages in one feed.
    const { results: attention } = await env.DB.prepare(`SELECT * FROM (
        SELECT 'complaint' AS kind, c.id, c.subject AS title, m.first_name || ' ' || m.last_name AS who, c.created_at, c.confidential AS flag FROM complaints c JOIN members m ON m.id = c.member_id WHERE c.status IN ('received','in_review')
        UNION ALL SELECT 'prayer', id, substr(request, 1, 140), CASE WHEN is_anonymous THEN 'Anonymous' ELSE COALESCE(name, 'Someone') END, created_at, pastors_only FROM prayer_requests WHERE status = 'new'
        UNION ALL SELECT 'wall', id, substr(request, 1, 140), COALESCE(display_name, 'Someone'), created_at, 0 FROM prayer_wall WHERE status = 'pending'
        UNION ALL SELECT 'message', id, COALESCE(subject, substr(message, 1, 100)), name, created_at, 0 FROM contact_messages WHERE status = 'new'
      ) ORDER BY created_at DESC LIMIT 12`).all();
    // The main admin sees access requests first, with Approve / Decline right there.
    const access = sess.role === "super"
      ? (await env.DB.prepare("SELECT id, email, name, current_role, wants, note, created_at FROM access_requests WHERE status = 'pending' ORDER BY created_at").all<Record<string, unknown>>()).results
          .map((r) => ({ ...r, wants: (JSON.parse(String(r.wants || "[]")) as string[]).map((k) => k === "admin" ? "Admin role" : permLabels([k])[0]) }))
      : [];
    return json({ ok: true, access, stats: {
      members: n(0), new_members: n(1), this_week: n(2), new_prayers: n(3), new_messages: n(4), upcoming_events: n(5),
      subscribers: n(6), registrations_week: n(7), accounts: n(8), pending_payments: n(9), open_complaints: n(10), wall_pending: n(11), access_requests: access.length,
    }, interests: interests.results, next_letter: next,
      // The team only sees items they can act on (complaints and messages stay with the main admin).
      attention: sess.role === "super" ? attention : (attention as { kind: string }[]).filter((x) => (x.kind === "prayer" || x.kind === "wall") && (sess.perms || []).includes("prayer")),
      email_enabled: !!env.EMAIL, email_health: await emailHealth(env), google_enabled: !!env.GOOGLE_CLIENT_ID });
  }));

  // ---------- members ----------
  router.get("/api/admin/members", guard(async (req) => {
    const url = new URL(req.url);
    const { limit, offset, page } = pageParams(url);
    const qs = (url.searchParams.get("q") || "").trim();
    const status = url.searchParams.get("status") || "";
    const where: string[] = []; const args: unknown[] = [];
    if (qs) { where.push("(first_name LIKE ? OR last_name LIKE ? OR preferred_name LIKE ? OR email LIKE ? OR phone LIKE ? OR ref_code LIKE ?)"); const l = `%${qs}%`; args.push(l, l, l, l, l, l); }
    if (status && (MEMBER_STATUSES as readonly string[]).includes(status)) { where.push("status = ?"); args.push(status); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows, count] = await env.DB.batch([
      env.DB.prepare(`SELECT id, ref_code, status, membership_type, first_name, last_name, preferred_name, email, phone, date_of_birth, suburb, interests, created_at
        FROM members ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM members ${w}`).bind(...args),
    ]);
    return json({ ok: true, members: rows.results, total: (count.results[0] as { n: number }).n, page, limit });
  }));

  router.get("/api/admin/members/:id", guard(async (_req, { id }, s) => {
    const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first();
    if (!member) throw new HttpError(404, "Member not found.");
    const atts = await env.DB.prepare("SELECT id, kind, filename, content_type, size_bytes, created_at FROM attachments WHERE owner_type = 'member' AND owner_id = ?").bind(id).all();
    await audit(env, s, "view", "member", id);
    return json({ ok: true, member, attachments: atts.results });
  }));

  router.patch("/api/admin/members/:id", guard(async (req, { id }, s, ctx) => {
    const body = await readJson(req);
    const v = new Validator(body);
    const status = v.oneOf("status", MEMBER_STATUSES);
    const notes = "admin_notes" in body ? v.text("admin_notes", { max: 5000 }) : undefined;
    const assigned = "assigned_to" in body ? v.text("assigned_to", { max: 120 }) : undefined;
    v.assert();
    const sets: string[] = []; const args: unknown[] = [];
    const prev = status ? await env.DB.prepare("SELECT status, first_name, preferred_name, last_name, email, ref_code, leader_user_id, user_id FROM members WHERE id = ?").bind(id)
      .first<{ status: string; first_name: string; preferred_name: string | null; last_name: string; email: string | null; ref_code: string; leader_user_id: string | null; user_id: string | null }>() : null;
    if (status) {
      sets.push("status = ?"); args.push(status);
      if (status === "revoked") {
        sets.push("revoked_at = COALESCE(revoked_at, ?)", "next_checkin_at = NULL", "checkin_token_hash = NULL"); args.push(new Date().toISOString());
        await env.DB.prepare("DELETE FROM admin_roles WHERE user_id IN (SELECT user_id FROM members WHERE id = ? AND user_id IS NOT NULL) OR lower(email) = lower(?)").bind(id, prev?.email || "").run();
      }
      else { // restoring someone: resume check-ins four months from now
        sets.push("revoked_at = NULL", "next_checkin_at = COALESCE(next_checkin_at, ?)"); args.push(addMonths(new Date(), CHECKIN_MONTHS).toISOString());
      }
    }
    if (notes !== undefined) { sets.push("admin_notes = ?"); args.push(notes); }
    if (assigned !== undefined) { sets.push("assigned_to = ?"); args.push(assigned); }
    if (!sets.length) throw new HttpError(400, "Nothing to update.");
    sets.push("updated_at = ?"); args.push(new Date().toISOString());
    const res = await env.DB.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
    if (!res.meta.changes) throw new HttpError(404, "Member not found.");
    if (status === "member" && prev && prev.status !== "member") {
      // Newly confirmed: a leader from the admin team is assigned (fairly), then the member hears who it is.
      await later(ctx, (async () => {
        const leader = prev.leader_user_id ? null : await assignLeader(env, id).catch((e) => { console.error("assign leader", e); return null; });
        const leaderName = leader?.name ?? (await env.DB.prepare("SELECT assigned_to FROM members WHERE id = ?").bind(id).first<{ assigned_to: string | null }>())?.assigned_to ?? null;
        if (prev.email) await sendMail(env, { to: prev.email, toName: `${prev.first_name} ${prev.last_name}`, ...T.memberVerified({ site: siteUrl(env) }, { name: prev.preferred_name || prev.first_name, ref: prev.ref_code, leader: leaderName }), template: "member_verified" });
      })());
    }
    if (status === "revoked" && prev?.user_id) await later(ctx, reassignFrom(env, prev.user_id, null));
    await audit(env, s, "update", "member", id, { status, assigned });
    return json({ ok: true });
  }));

  router.delete("/api/admin/members/:id", superOnly(async (_req, { id }, s) => {
    const gone = await env.DB.prepare("SELECT user_id, email FROM members WHERE id = ?").bind(id).first<{ user_id: string | null; email: string | null }>();
    if (gone) await env.DB.prepare("DELETE FROM admin_roles WHERE user_id = ? OR lower(email) = lower(?)").bind(gone.user_id || "", gone.email || "").run();
    await env.DB.batch([await deleteOwnerFiles(env, "member", id), env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id)]);
    await audit(env, s, "delete", "member", id);
    return json({ ok: true });
  }));

  router.get("/api/admin/export/members.csv", guard(async (_req, _p, s) => {
    const { results } = await env.DB.prepare("SELECT * FROM members ORDER BY created_at DESC").all<Record<string, unknown>>();
    const cols = results.length ? Object.keys(results[0]).filter((c) => !["ip_hash", "user_agent"].includes(c)) : ["id"];
    await audit(env, s, "export", "members", undefined, { rows: results.length });
    return csv("scc-members", cols, results.map((r) => cols.map((c) => r[c])));
  }));

  router.get("/api/admin/files/:id", guard(async (req, { id }, s) => {
    const att = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(id)
      .first<{ storage_driver: string; storage_key: string; filename: string; content_type: string }>();
    if (!att) throw new HttpError(404, "File not found.");
    const obj = await getFile(env, att.storage_driver, att.storage_key);
    if (!obj) throw new HttpError(404, "File is missing from storage.");
    await audit(env, s, "file_view", "attachment", id);
    const inline = (att.content_type.startsWith("image/") || att.content_type === "application/pdf") && !new URL(req.url).searchParams.has("download");
    return new Response(obj.body, { headers: {
      "Content-Type": att.content_type, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${att.filename}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    } });
  }));

  // ---------- prayer & messages ----------
  router.get("/api/admin/prayers", guard(async (req) => {
    const url = new URL(req.url);
    const { limit, offset, page } = pageParams(url);
    const st = url.searchParams.get("status");
    const w = st && (PRAYER_STATUSES as readonly string[]).includes(st) ? "WHERE status = ?" : "";
    const args = w ? [st] : [];
    const [rows, count] = await env.DB.batch([
      env.DB.prepare(`SELECT * FROM prayer_requests ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM prayer_requests ${w}`).bind(...args),
    ]);
    return json({ ok: true, prayers: rows.results, total: (count.results[0] as { n: number }).n, page, limit });
  }));
  router.patch("/api/admin/prayers/:id", guard(async (req, { id }, s) => {
    const v = new Validator(await readJson(req));
    const status = v.oneOf("status", PRAYER_STATUSES, { required: true });
    v.assert();
    await env.DB.prepare("UPDATE prayer_requests SET status = ? WHERE id = ?").bind(status, id).run();
    await audit(env, s, "update", "prayer", id, { status });
    return json({ ok: true });
  }));
  router.get("/api/admin/messages", guard(async (req) => {
    const { limit, offset, page } = pageParams(new URL(req.url));
    const [rows, count] = await env.DB.batch([
      env.DB.prepare("SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(limit, offset),
      env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages"),
    ]);
    return json({ ok: true, messages: rows.results, total: (count.results[0] as { n: number }).n, page, limit });
  }));
  router.patch("/api/admin/messages/:id", guard(async (req, { id }, s) => {
    const v = new Validator(await readJson(req));
    const status = v.oneOf("status", MESSAGE_STATUSES, { required: true });
    v.assert();
    await env.DB.prepare("UPDATE contact_messages SET status = ? WHERE id = ?").bind(status, id).run();
    await audit(env, s, "update", "message", id, { status });
    return json({ ok: true });
  }));

  // ---------- events + form builder ----------
  async function uniqueSlug(base: string, exceptId?: string) {
    let slug = slugify(base); let i = 1;
    while (await env.DB.prepare("SELECT 1 FROM events WHERE slug = ? AND id != ?").bind(slug, exceptId ?? "").first()) slug = `${slugify(base)}-${++i}`;
    return slug;
  }
  function readEvent(body: Record<string, unknown>) {
    const v = new Validator(body);
    const e = {
      title: v.text("title", { required: true, max: 140, label: "Title" }),
      slug: v.text("slug", { max: 60 }),
      category: v.oneOf("category", EVENT_CATEGORIES) || "other",
      ministry_group: v.oneOf("ministry_group", GROUP_KEYS, { required: true, label: "Ministry group" }) || "church",
      description: v.text("description", { max: 5000 }),
      starts_at: v.text("starts_at", { required: true, max: 40, label: "Start" }),
      ends_at: v.text("ends_at", { max: 40 }),
      location: v.text("location", { max: 200 }),
      is_published: v.bool("is_published") ? 1 : 0,
      rsvp_enabled: v.bool("rsvp_enabled") ? 1 : 0,
      collect_phone: v.bool("collect_phone") ? 1 : 0,
      capacity: body.capacity === "" || body.capacity == null ? null : Math.max(1, Math.floor(Number(body.capacity)) || 0) || null,
      registration_closes_at: v.text("registration_closes_at", { max: 40 }),
      confirmation_message: v.text("confirmation_message", { max: 1000 }),
      price_label: v.text("price_label", { max: 60 }),
      ticket_price: body.ticket_price === "" || body.ticket_price == null ? null : Math.max(0, Math.round(Number(body.ticket_price))) || null,
      requires_pop: v.bool("requires_pop") ? 1 : 0,
      auto_approve: v.bool("auto_approve") ? 1 : 0,
      payment_instructions: v.text("payment_instructions", { max: 2000 }),
      form_schema: "[]",
    };
    for (const k of ["starts_at", "ends_at", "registration_closes_at"] as const) {
      if (e[k] && isNaN(Date.parse(e[k]!))) v.errors[k] = "Invalid date/time.";
    }
    v.assert();
    if (e.ticket_price) e.price_label = `R${e.ticket_price} per person`;
    if (!e.ticket_price && e.price_label && /^R?\s*\d/.test(e.price_label)) e.ticket_price = Number(e.price_label.replace(/[^\d]/g, "")) || null;
    e.form_schema = JSON.stringify(sanitizeSchema(body.form_schema ?? []));
    e.starts_at = new Date(e.starts_at!).toISOString();
    if (e.ends_at) e.ends_at = new Date(e.ends_at).toISOString();
    if (e.registration_closes_at) e.registration_closes_at = new Date(e.registration_closes_at).toISOString();
    return e;
  }

  router.get("/api/admin/events", guard(async () => {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.slug, e.title, e.category, e.ministry_group, e.starts_at, e.ends_at, e.location, e.is_published, e.rsvp_enabled, e.capacity, e.cover_attachment_id, e.cover_image, e.price_label, e.requires_pop,
        (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS confirmed,
        (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'waitlist') AS waitlist,
        (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'pending') AS pending,
        (SELECT COALESCE(SUM(1 + guests),0) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS headcount
       FROM events e ORDER BY e.starts_at DESC LIMIT 300`).all();
    return json({ ok: true, events: results });
  }));

  router.get("/api/admin/events/:id", guard(async (_req, { id }) => {
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!e) throw new HttpError(404, "Event not found.");
    return json({ ok: true, event: { ...e, form_schema: parseSchema(e.form_schema as string) } });
  }));

  router.post("/api/admin/events", guard(async (req, _p, s) => {
    const e = readEvent(await readJson(req, 256 * 1024));
    const id = uuid();
    const slug = await uniqueSlug(e.slug || e.title!);
    await env.DB.prepare(`INSERT INTO events (id, slug, title, category, ministry_group, description, starts_at, ends_at, location, is_published, rsvp_enabled,
        collect_phone, capacity, registration_closes_at, confirmation_message, form_schema, price_label, ticket_price, requires_pop, auto_approve, payment_instructions)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, slug, e.title, e.category, e.ministry_group, e.description, e.starts_at, e.ends_at, e.location, e.is_published, e.rsvp_enabled,
        e.collect_phone, e.capacity, e.registration_closes_at, e.confirmation_message, e.form_schema, e.price_label,
        e.ticket_price, e.requires_pop, e.auto_approve, e.payment_instructions).run();
    await audit(env, s, "create", "event", id);
    return json({ ok: true, id, slug }, 201);
  }));

  router.put("/api/admin/events/:id", guard(async (req, { id }, s) => {
    const e = readEvent(await readJson(req, 256 * 1024));
    const slug = await uniqueSlug(e.slug || e.title!, id);
    const r = await env.DB.prepare(`UPDATE events SET slug=?, title=?, category=?, ministry_group=?, description=?, starts_at=?, ends_at=?, location=?, is_published=?, rsvp_enabled=?,
        collect_phone=?, capacity=?, registration_closes_at=?, confirmation_message=?, form_schema=?, price_label=?, ticket_price=?, requires_pop=?,
        auto_approve=?, payment_instructions=?, updated_at=? WHERE id = ?`)
      .bind(slug, e.title, e.category, e.ministry_group, e.description, e.starts_at, e.ends_at, e.location, e.is_published, e.rsvp_enabled, e.collect_phone,
        e.capacity, e.registration_closes_at, e.confirmation_message, e.form_schema, e.price_label, e.ticket_price, e.requires_pop,
        e.auto_approve, e.payment_instructions, new Date().toISOString(), id).run();
    if (!r.meta.changes) throw new HttpError(404, "Event not found.");
    await promoteWaitlist(env, id);
    await audit(env, s, "update", "event", id);
    return json({ ok: true, slug });
  }));

  // Duplicate (e.g. next week's service) — shifts dates by `days` (default 7) and keeps the form.
  router.post("/api/admin/events/:id/duplicate", guard(async (req, { id }, s) => {
    const { days = 7 } = await readJson<{ days?: number }>(req);
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<Record<string, string | number | null>>();
    if (!e) throw new HttpError(404, "Event not found.");
    const shift = (iso: string | number | null) => (iso ? new Date(new Date(String(iso)).getTime() + Number(days) * 86400_000).toISOString() : null);
    const nid = uuid();
    const slug = await uniqueSlug(`${e.title}-${String(shift(e.starts_at)).slice(0, 10)}`);
    await env.DB.prepare(`INSERT INTO events (id, slug, title, category, ministry_group, description, starts_at, ends_at, location, is_published, rsvp_enabled,
        collect_phone, capacity, registration_closes_at, confirmation_message, form_schema, cover_attachment_id, cover_image, price_label,
        ticket_price, requires_pop, auto_approve, payment_instructions) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(nid, slug, e.title, e.category, e.ministry_group, e.description, shift(e.starts_at), shift(e.ends_at), e.location, e.rsvp_enabled, e.collect_phone,
        e.capacity, shift(e.registration_closes_at), e.confirmation_message, e.form_schema, e.cover_attachment_id, e.cover_image, e.price_label,
        e.ticket_price, e.requires_pop, e.auto_approve, e.payment_instructions).run();
    await audit(env, s, "duplicate", "event", nid, { from: id });
    return json({ ok: true, id: nid, slug }, 201);
  }));

  router.delete("/api/admin/events/:id", guard(async (_req, { id }, s) => {
    const { results: regs } = await env.DB.prepare("SELECT id FROM event_registrations WHERE event_id = ?").bind(id).all<{ id: string }>();
    const stmts = [];
    for (const r of regs) stmts.push(await deleteOwnerFiles(env, "registration", r.id));
    const cover = await env.DB.prepare("SELECT cover_attachment_id FROM events WHERE id = ?").bind(id).first<{ cover_attachment_id: string | null }>();
    const shared = cover?.cover_attachment_id
      ? await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE cover_attachment_id = ?").bind(cover.cover_attachment_id).first<{ n: number }>() : null;
    if (cover?.cover_attachment_id && (shared?.n ?? 0) <= 1) stmts.push(await deleteOwnerFiles(env, "event", id));
    await env.DB.batch([...stmts, env.DB.prepare("DELETE FROM event_registrations WHERE event_id = ?").bind(id), env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id)]);
    await audit(env, s, "delete", "event", id);
    return json({ ok: true });
  }));

  router.post("/api/admin/events/:id/cover", guard(async (req, { id }, s) => {
    const fd = await req.formData();
    const file = fd.get("cover");
    if (!file || typeof file === "string") throw new HttpError(400, "Choose an image.");
    const up = await readUpload(env, file, "image");
    const old = await env.DB.prepare("SELECT cover_attachment_id FROM events WHERE id = ?").bind(id).first<{ cover_attachment_id: string | null }>();
    if (!old) throw new HttpError(404, "Event not found.");
    const stored = await storeFiles(env, "event", id, [up]);
    await env.DB.batch([...stored.stmts, env.DB.prepare("UPDATE events SET cover_attachment_id = ? WHERE id = ?").bind(stored.ids[0], id)]);
    await audit(env, s, "cover", "event", id);
    return json({ ok: true, cover_url: `/api/media/${stored.ids[0]}` });
  }));

  router.get("/api/admin/events/:id/registrations", guard(async (_req, { id }) => {
    const { results } = await env.DB.prepare("SELECT * FROM event_registrations WHERE event_id = ? ORDER BY created_at").bind(id).all<Record<string, unknown>>();
    const { results: files } = await env.DB.prepare(
      "SELECT a.id, a.owner_id, a.kind, a.filename FROM attachments a JOIN event_registrations r ON r.id = a.owner_id WHERE a.owner_type = 'registration' AND r.event_id = ?",
    ).bind(id).all<{ id: string; owner_id: string; kind: string; filename: string }>();
    return json({ ok: true, registrations: results.map((r) => ({ ...r, answers: JSON.parse(String(r.answers || "{}")), files: files.filter((f) => f.owner_id === r.id) })) });
  }));

  /**
   * Change a registration's status. Approving (→ confirmed) emails the ticket + calendar invite;
   * declining (→ rejected) emails a kind note. Freed seats go to the waitlist automatically.
   */
  router.patch("/api/admin/registrations/:id", guard(async (req, { id }, s, ctx) => {
    const body = await readJson(req);
    const reg = await env.DB.prepare("SELECT * FROM event_registrations WHERE id = ?").bind(id).first<RegRow>();
    if (!reg) throw new HttpError(404, "Registration not found.");
    if (youthOnly(s)) checkEventScope(s, await env.DB.prepare("SELECT ministry_group FROM events WHERE id = ?").bind(reg.event_id).first<{ ministry_group: string }>());
    const STATUSES = ["pending", "confirmed", "waitlist", "rejected", "cancelled"];
    const next = typeof body.status === "string" && STATUSES.includes(body.status) ? body.status : null;
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
    if (next && next !== reg.status) {
      await env.DB.prepare("UPDATE event_registrations SET status = ?, reviewed_at = ?, review_note = COALESCE(?, review_note) WHERE id = ?")
        .bind(next, new Date().toISOString(), note, id).run();
      const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(reg.event_id).first<EventRow>();
      // Tickets exist the moment it's approved (so the door can scan straight away); the email + PDF go out in the background.
      if (next === "confirmed") await ensureTickets(env, { ...reg, status: next });
      else await voidTickets(env, reg.id);
      if (e && (next === "confirmed" || next === "rejected") && body.notify !== false) await later(ctx, notifyRegistration(env, e, { ...reg, status: next }, { note }));
      if (["cancelled", "rejected", "waitlist"].includes(next)) await later(ctx, promoteWaitlist(env, reg.event_id));
    }
    if (typeof body.checked_in === "boolean") {
      await env.DB.prepare("UPDATE event_registrations SET checked_in_at = ? WHERE id = ?").bind(body.checked_in ? new Date().toISOString() : null, id).run();
    }
    await audit(env, s, "update", "registration", id, { status: next, checked_in: body.checked_in });
    return json({ ok: true });
  }));

  // Everything waiting for approval, across all events, in one list (newest first).
  router.get("/api/admin/approvals", guard(async (_req, _p, s) => {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.name, r.email, r.phone, r.guests, r.amount_due, r.ref_code, r.created_at, r.pop_attachment_id, r.event_id,
              e.title AS event_title, e.starts_at, e.ministry_group, a.content_type AS pop_type
         FROM event_registrations r JOIN events e ON e.id = r.event_id LEFT JOIN attachments a ON a.id = r.pop_attachment_id
        WHERE r.status = 'pending' ${youthOnly(s) ? "AND e.ministry_group = 'youth'" : ""} ORDER BY r.created_at DESC LIMIT 200`).all();
    return json({ ok: true, approvals: results, scope: youthOnly(s) ? "youth" : "all" });
  }));

  // Tell everyone holding a ticket (confirmed, awaiting approval or waitlisted) about a change to the event.
  router.post("/api/admin/events/:id/notify", guard(async (req, { id }, s, ctx) => {
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
    if (!e) throw new HttpError(404, "Event not found.");
    checkEventScope(s, e as { ministry_group?: string });
    const b = await readJson<{ message?: string; include_waitlist?: boolean }>(req);
    const message = String(b.message || "").trim().slice(0, 2000);
    if (message.length < 5) throw new HttpError(422, "Write what changed, e.g. “We now start at 19:00”.");
    const statuses = b.include_waitlist === false ? ["confirmed", "pending"] : ["confirmed", "pending", "waitlist"];
    const { results } = await env.DB.prepare(`SELECT name, email FROM event_registrations WHERE event_id = ? AND status IN (${statuses.map(() => "?").join(",")})`).bind(id, ...statuses).all<{ name: string; email: string }>();
    const seen = new Set<string>(), to = results.filter((r) => r.email && !seen.has(r.email.toLowerCase()) && seen.add(r.email.toLowerCase()));
    if (!to.length) throw new HttpError(409, "Nobody has a ticket for this event yet.");
    const site = siteUrl(env);
    const when = formatWhen(e.starts_at, e.ends_at);
    await later(ctx, (async () => {
      for (const r of to) {
        await sendMail(env, { to: r.email, toName: r.name, ...T.eventUpdate({ site }, { name: (r.name || "").split(" ")[0] || "friend", title: e.title, when, location: e.location, message, url: `${site}/event?e=${encodeURIComponent(e.slug || e.id)}`, from: s.user.given_name || s.user.name || "The church team" }), template: "event_update" });
      }
    })());
    await audit(env, s, "notify_ticket_holders", "event", id, { count: to.length });
    return json({ ok: true, sent: to.length });
  }));

  // Approve every registration still awaiting approval for an event, in sign-up order.
  router.post("/api/admin/events/:id/approve-all", guard(async (_req, { id }, s, ctx) => {
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
    if (!e) throw new HttpError(404, "Event not found.");
    const { results } = await env.DB.prepare("SELECT * FROM event_registrations WHERE event_id = ? AND status = 'pending' ORDER BY created_at").bind(id).all<RegRow>();
    const now = new Date().toISOString();
    for (const r of results) {
      await env.DB.prepare("UPDATE event_registrations SET status = 'confirmed', reviewed_at = ? WHERE id = ?").bind(now, r.id).run();
      await ensureTickets(env, { ...r, status: "confirmed" });
    }
    // Emails (with PDF tickets) are sent one after another in the background.
    await later(ctx, (async () => { for (const r of results) await notifyRegistration(env, e, { ...r, status: "confirmed" }); })());
    await audit(env, s, "approve_all", "event", id, { count: results.length });
    return json({ ok: true, approved: results.length });
  }));

  router.get("/api/admin/events/:id/registrations.csv", guard(async (_req, { id }) => {
    const e = await env.DB.prepare("SELECT slug, form_schema FROM events WHERE id = ?").bind(id).first<{ slug: string; form_schema: string }>();
    if (!e) throw new HttpError(404, "Event not found.");
    const fields = parseSchema(e.form_schema).filter((f) => f.type !== "statement");
    const { results } = await env.DB.prepare("SELECT * FROM event_registrations WHERE event_id = ? ORDER BY created_at").bind(id).all<Record<string, string>>();
    const header = ["Ref", "Status", "Name", "Email", "Phone", "Guests", "Amount (R)", "Proof of payment", "Reviewed", "Checked in", "Registered", ...fields.map((f) => f.label)];
    const rows = results.map((r) => {
      const a = JSON.parse(r.answers || "{}") as Record<string, unknown>;
      return [r.ref_code, r.status, r.name, r.email, r.phone, r.guests, r.amount_due, r.pop_attachment_id ? `${siteUrl(env)}/api/admin/files/${r.pop_attachment_id}` : "", r.reviewed_at, r.checked_in_at, r.created_at, ...fields.map((f) => Array.isArray(a[f.id]) ? (a[f.id] as string[]).join("; ") : a[f.id])];
    });
    return csv(`registrations-${e.slug}`, header, rows);
  }));

  // ---------- settings ----------
  router.get("/api/admin/settings", guard(async () => {
    // Server-only secrets (push signing keys, webhook secret) never leave the server.
    const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key NOT IN ('vapid_keys', 'github_webhook_secret')").all<{ key: string; value: string }>();
    return json({ ok: true, settings: Object.fromEntries(results.map((r) => [r.key, r.value])) });
  }));
  router.put("/api/admin/settings", guard(async (req, _p, s) => {
    const body = await readJson(req);
    const now = new Date().toISOString();
    const stmts = [...PUBLIC_SETTINGS, ...ADMIN_ONLY_SETTINGS].filter((k) => k in body).map((k) => env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(k, String(body[k] ?? "").slice(0, 2000), now));
    if (stmts.length) await env.DB.batch(stmts);
    await audit(env, s, "update", "settings");
    return json({ ok: true });
  }));

  // ---------- subscribers ----------
  router.get("/api/admin/subscribers", guard(async (req) => {
    const url = new URL(req.url);
    const { limit, offset, page } = pageParams(url);
    const qs = (url.searchParams.get("q") || "").trim();
    const w = qs ? "WHERE email LIKE ? OR name LIKE ?" : "";
    const args = qs ? [`%${qs}%`, `%${qs}%`] : [];
    const [rows, count, counts] = await env.DB.batch([
      env.DB.prepare(`SELECT id, email, name, status, source, created_at, confirmed_at FROM subscribers ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM subscribers ${w}`).bind(...args),
      env.DB.prepare("SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status"),
    ]);
    return json({ ok: true, subscribers: rows.results, total: (count.results[0] as { n: number }).n, page, limit,
      by_status: Object.fromEntries((counts.results as { status: string; n: number }[]).map((r) => [r.status, r.n])) });
  }));
  router.post("/api/admin/subscribers", guard(async (req, _p, s) => {
    const v = new Validator(await readJson(req));
    const email = v.email("email", true);
    const name = v.text("name", { max: 120 });
    v.assert();
    await env.DB.prepare(`INSERT INTO subscribers (id, email, name, status, token, source, confirmed_at) VALUES (?,?,?,'active',?,'admin',?)
      ON CONFLICT(email) DO UPDATE SET status = 'active', name = COALESCE(excluded.name, subscribers.name), unsubscribed_at = NULL`)
      .bind(uuid(), email, name, randomToken(24), new Date().toISOString()).run();
    await audit(env, s, "create", "subscriber", email!);
    return json({ ok: true }, 201);
  }));
  router.delete("/api/admin/subscribers/:id", guard(async (_req, { id }, s) => {
    await env.DB.prepare("DELETE FROM subscribers WHERE id = ?").bind(id).run();
    await audit(env, s, "delete", "subscriber", id);
    return json({ ok: true });
  }));
  router.get("/api/admin/export/subscribers.csv", guard(async () => {
    const { results } = await env.DB.prepare("SELECT email, name, status, source, created_at, confirmed_at FROM subscribers ORDER BY created_at").all<Record<string, unknown>>();
    return csv("scc-subscribers", ["Email", "Name", "Status", "Source", "Created", "Confirmed"], results.map((r) => Object.values(r)));
  }));

  // ---------- announcement letters ----------
  function readAnnouncement(body: Record<string, unknown>) {
    const v = new Validator(body);
    const a = {
      subject: v.text("subject", { required: true, max: 160, label: "Subject" }),
      preheader: v.text("preheader", { max: 200 }),
      heading: v.text("heading", { required: true, max: 160, label: "Heading" }),
      body: v.text("body", { required: true, max: 8000, label: "Message" }),
      scripture_text: v.text("scripture_text", { max: 600 }),
      scripture_ref: v.text("scripture_ref", { max: 80 }),
      include_events: v.bool("include_events") ? 1 : 0,
      cta_label: v.text("cta_label", { max: 60 }),
      cta_url: v.text("cta_url", { max: 300 }),
      services: "[]",
    };
    if (a.cta_url && !/^https?:\/\//.test(a.cta_url)) v.errors.cta_url = "Link must start with https://";
    const services = (Array.isArray(body.services) ? body.services : []).slice(0, 12).map((x) => {
      const o = x as Record<string, unknown>;
      return { title: String(o.title || "").slice(0, 120), when: String(o.when || "").slice(0, 120), location: String(o.location || "").slice(0, 160), note: String(o.note || "").slice(0, 300) };
    }).filter((x) => x.title);
    a.services = JSON.stringify(services);
    v.assert();
    return a;
  }

  router.get("/api/admin/announcements", guard(async () => {
    const { results } = await env.DB.prepare("SELECT id, subject, heading, status, scheduled_for, sent_at, recipients, sent_count, failed_count, updated_at FROM announcements ORDER BY COALESCE(scheduled_for, created_at) DESC LIMIT 100").all();
    return json({ ok: true, announcements: results, next_sunday: nextSundayAfternoon().toISOString() });
  }));
  router.get("/api/admin/announcements/:id", guard(async (_req, { id }) => {
    const a = await env.DB.prepare("SELECT * FROM announcements WHERE id = ?").bind(id).first<AnnouncementRow>();
    if (!a) throw new HttpError(404, "Letter not found.");
    return json({ ok: true, announcement: { ...a, services: JSON.parse(a.services || "[]") } });
  }));
  router.post("/api/admin/announcements", guard(async (req, _p, s) => {
    const a = readAnnouncement(await readJson(req));
    const id = uuid();
    await env.DB.prepare(`INSERT INTO announcements (id, subject, preheader, heading, body, scripture_text, scripture_ref, services, include_events, cta_label, cta_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id, a.subject, a.preheader, a.heading, a.body, a.scripture_text, a.scripture_ref, a.services, a.include_events, a.cta_label, a.cta_url).run();
    await audit(env, s, "create", "announcement", id);
    return json({ ok: true, id }, 201);
  }));
  router.put("/api/admin/announcements/:id", guard(async (req, { id }, s) => {
    const a = readAnnouncement(await readJson(req));
    const r = await env.DB.prepare(`UPDATE announcements SET subject=?, preheader=?, heading=?, body=?, scripture_text=?, scripture_ref=?, services=?, include_events=?,
      cta_label=?, cta_url=?, updated_at=? WHERE id = ? AND status IN ('draft','scheduled')`)
      .bind(a.subject, a.preheader, a.heading, a.body, a.scripture_text, a.scripture_ref, a.services, a.include_events, a.cta_label, a.cta_url, new Date().toISOString(), id).run();
    if (!r.meta.changes) throw new HttpError(409, "This letter has already been sent and can't be edited.");
    await audit(env, s, "update", "announcement", id);
    return json({ ok: true });
  }));
  router.delete("/api/admin/announcements/:id", guard(async (_req, { id }, s) => {
    const r = await env.DB.prepare("DELETE FROM announcements WHERE id = ? AND status IN ('draft','scheduled','cancelled')").bind(id).run();
    if (!r.meta.changes) throw new HttpError(409, "Sent letters are kept for your records.");
    await audit(env, s, "delete", "announcement", id);
    return json({ ok: true });
  }));
  router.get("/api/admin/announcements/:id/preview", guard(async (_req, { id }) => {
    const a = await env.DB.prepare("SELECT * FROM announcements WHERE id = ?").bind(id).first<AnnouncementRow>();
    if (!a) throw new HttpError(404, "Letter not found.");
    const when = a.scheduled_for ? new Date(a.scheduled_for) : nextSundayAfternoon();
    const m = renderAnnouncement(env, await buildAnnouncement(env, a, when), "Friend", "preview");
    return new Response(m.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'" } });
  }));
  router.post("/api/admin/announcements/:id/test", guard(async (_req, { id }) => {
    const a = await env.DB.prepare("SELECT * FROM announcements WHERE id = ?").bind(id).first<AnnouncementRow>();
    if (!a) throw new HttpError(404, "Letter not found.");
    const m = renderAnnouncement(env, await buildAnnouncement(env, a, a.scheduled_for ? new Date(a.scheduled_for) : nextSundayAfternoon()), "Friend", "test");
    const ok = await sendMail(env, { to: adminEmail(env), ...m, subject: `[Test] ${m.subject}`, template: "announcement_test" });
    if (!ok) throw new HttpError(503, "Couldn't send the test. Is Email Sending enabled for the domain?");
    return json({ ok: true, sent_to: adminEmail(env) });
  }));
  router.post("/api/admin/announcements/:id/schedule", guard(async (req, { id }, s) => {
    const { when, now } = await readJson<{ when?: string; now?: boolean }>(req);
    const at = now ? new Date() : when ? new Date(when) : nextSundayAfternoon();
    if (isNaN(at.getTime())) throw new HttpError(422, "Invalid date.");
    const r = await env.DB.prepare("UPDATE announcements SET status = 'scheduled', scheduled_for = ?, updated_at = ? WHERE id = ? AND status IN ('draft','scheduled','cancelled')")
      .bind(at.toISOString(), new Date().toISOString(), id).run();
    if (!r.meta.changes) throw new HttpError(409, "This letter can't be scheduled.");
    await audit(env, s, now ? "send_now" : "schedule", "announcement", id, { at: at.toISOString() });
    if (now) await processAnnouncements(env);
    return json({ ok: true, scheduled_for: at.toISOString() });
  }));
  router.post("/api/admin/announcements/:id/cancel", guard(async (_req, { id }, s) => {
    const r = await env.DB.prepare("UPDATE announcements SET status = 'draft', scheduled_for = NULL WHERE id = ? AND status = 'scheduled'").bind(id).run();
    if (!r.meta.changes) throw new HttpError(409, "Only scheduled letters can be unscheduled.");
    await audit(env, s, "unschedule", "announcement", id);
    return json({ ok: true });
  }));

  // ---------- team: delegated admins (super admin only) ----------
  router.get("/api/admin/team", superOnly(async (req) => {
    const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
    const { results: admins } = await env.DB.prepare(
      `SELECT a.user_id, a.email, a.created_at, a.role, a.perms, u.name, u.picture, m.ref_code, m.status FROM admin_roles a JOIN users u ON u.id = a.user_id
         LEFT JOIN members m ON m.user_id = a.user_id OR m.email = a.email GROUP BY a.user_id ORDER BY a.created_at`).all();
    const like = `%${q}%`;
    const { results: people } = await env.DB.prepare(
      `SELECT u.id AS user_id, u.email, u.name, u.picture, m.ref_code, m.status, m.first_name, m.last_name,
              EXISTS (SELECT 1 FROM admin_roles a WHERE a.user_id = u.id) AS is_admin
         FROM users u LEFT JOIN members m ON (m.user_id = u.id OR m.email = u.email) AND m.status != 'revoked'
        WHERE lower(u.email) != ? AND (? = '' OR lower(u.email) LIKE ? OR lower(COALESCE(u.name, '')) LIKE ? OR lower(COALESCE(m.first_name || ' ' || m.last_name, '')) LIKE ?)
        GROUP BY u.id ORDER BY (m.ref_code IS NULL), u.name LIMIT 50`).bind(adminEmail(env), q, like, like, like).all();
    return json({ ok: true, admins: admins.map((a) => ({ ...a, perms: parsePerms(a.perms as string | null, a.role === "youth_leader" ? YOUTH_DEFAULT : ADMIN_DEFAULT) })), people, perms: YOUTH_PERMS, youth_default: YOUTH_DEFAULT, admin_default: ADMIN_DEFAULT });
  }));
  // Change someone's role (Admin ⇄ Youth leader) or a youth leader's permissions. Main admin only.
  router.patch("/api/admin/team/:userId", superOnly(async (req, { userId }, s) => {
    const b = await readJson<{ role?: string; perms?: string[] }>(req);
    const row = await env.DB.prepare("SELECT role, perms FROM admin_roles WHERE user_id = ?").bind(userId).first<{ role: string; perms: string | null }>();
    if (!row) throw new HttpError(404, "Not on the team.");
    const role = b.role === "youth_leader" || b.role === "admin" ? b.role : row.role;
    const dflt = role === "youth_leader" ? YOUTH_DEFAULT : ADMIN_DEFAULT;
    // New role without a list → that role's starting set. Same role → the ticked list (or what they had).
    const list = Array.isArray(b.perms) ? b.perms : role !== row.role ? dflt : parsePerms(row.perms, dflt);
    const perms = JSON.stringify(parsePerms(JSON.stringify(list), dflt));
    await env.DB.prepare("UPDATE admin_roles SET role = ?, perms = ? WHERE user_id = ?").bind(role, perms, userId).run();
    await audit(env, s, "change_role", "user", userId, { role, perms });
    if (row.role === "admin" && role === "youth_leader") await reassignFrom(env, userId, null);   // youth leaders don't look after members
    const u = await env.DB.prepare("SELECT email, name, given_name FROM users WHERE id = ?").bind(userId).first<{ email: string; name: string | null; given_name: string | null }>();
    const before = row.role, beforePerms = (row as { perms?: string | null }).perms ?? null;
    if (u && (before !== role || beforePerms !== perms)) {
      const can = permLabels(JSON.parse(perms));
      await sendMail(env, { to: u.email, ...T.roleChanged({ site: siteUrl(env) }, { name: u.given_name || (u.name || "").split(" ")[0] || "friend", role: role === "youth_leader" ? "Youth leader" : "Admin", can, up: before === "youth_leader" && role === "admin" }), template: "role_changed" });
    }
    return json({ ok: true, role, perms: JSON.parse(perms) });
  }));
  router.post("/api/admin/team", superOnly(async (req, _p, s, ctx) => {
    const { user_id, role: wantRole, perms: wantPerms } = await readJson<{ user_id?: string; role?: string; perms?: string[] }>(req);
    const role = wantRole === "youth_leader" ? "youth_leader" : "admin";
    const dflt = role === "youth_leader" ? YOUTH_DEFAULT : ADMIN_DEFAULT;
    const perms = parsePerms(JSON.stringify(Array.isArray(wantPerms) ? wantPerms : dflt), dflt);
    const u = await env.DB.prepare("SELECT id, email, name, given_name FROM users WHERE id = ?").bind(user_id || "").first<{ id: string; email: string; name: string | null; given_name: string | null }>();
    if (!u) throw new HttpError(404, "That person needs to sign in with Google on the website once before they can be made an admin.");
    const member = await env.DB.prepare("SELECT status FROM members WHERE (user_id = ? OR email = ?) AND status != 'revoked' LIMIT 1").bind(u.id, u.email).first<{ status: string }>();
    if (!member) throw new HttpError(422, "Only registered members can be given admin access. Ask them to join the church first.");
    if (isAdminEmail(env, u.email)) throw new HttpError(422, "That's the main admin account already.");
    if (await env.DB.prepare("SELECT 1 FROM admin_roles WHERE user_id = ?").bind(u.id).first()) return json({ ok: true, already: true });
    await env.DB.prepare("INSERT OR IGNORE INTO admin_roles (user_id, email, granted_by, role, perms) VALUES (?, ?, ?, ?, ?)").bind(u.id, u.email.toLowerCase(), s.user.email, role, JSON.stringify(perms)).run();
    await audit(env, s, role === "youth_leader" ? "grant_youth_leader" : "grant_admin", "user", u.id, { email: u.email });
    const first = u.given_name || (u.name || "").split(" ")[0] || "friend";
    const mail = role === "youth_leader"
      ? T.youthLeaderGranted({ site: siteUrl(env) }, { name: first, can: permLabels(perms) })
      : T.adminGranted({ site: siteUrl(env) }, { name: first, can: permLabels(perms) });
    await later(ctx, sendMail(env, { to: u.email, toName: u.name || undefined, ...mail, template: role === "youth_leader" ? "youth_leader_granted" : "admin_granted" }));
    return json({ ok: true });
  }));
  router.delete("/api/admin/team/:userId", superOnly(async (_req, { userId }, s, ctx) => {
    const old = await env.DB.prepare("SELECT r.role, u.email, u.name, u.given_name FROM admin_roles r JOIN users u ON u.id = r.user_id WHERE r.user_id = ?").bind(userId).first<{ role: string; email: string; name: string | null; given_name: string | null }>();
    const r = await env.DB.prepare("DELETE FROM admin_roles WHERE user_id = ?").bind(userId).run();
    if (!r.meta.changes) throw new HttpError(404, "Not an admin.");
    // Their sign-in stays; it's simply a member's sign-in again from the next click.
    await audit(env, s, "revoke_admin", "user", userId);
    if (old) await later(ctx, sendMail(env, { to: old.email, ...T.roleRemoved({ site: siteUrl(env) }, { name: old.given_name || (old.name || "").split(" ")[0] || "friend", role: old.role === "youth_leader" ? "Youth leader" : "Admin" }), template: "role_removed" }));
    // Their people are shared out fairly among the remaining leaders.
    const moved = await reassignFrom(env, userId, null);
    return json({ ok: true, reassigned: moved });
  }));
  // ---- Asking for more access: anyone on the team asks; only the main admin decides.
  router.get("/api/admin/access-requests", guard(async (_req, _p, s) => {
    const mine = s.role !== "super";
    const { results } = await env.DB.prepare(`SELECT id, user_id, email, name, current_role, wants, note, status, decided_by, decided_at, created_at FROM access_requests
      ${mine ? "WHERE user_id = ?" : "WHERE status = 'pending' OR created_at >= ?"} ORDER BY created_at DESC LIMIT 50`).bind(mine ? s.user.id : new Date(Date.now() - 30 * 86400_000).toISOString()).all<Record<string, unknown>>();
    return json({ ok: true, requests: results.map((r) => ({ ...r, wants: JSON.parse(String(r.wants || "[]")) })), options: [...YOUTH_PERMS.map(([k, l]) => ({ key: k, label: l })), ...(s.role === "youth" ? [{ key: "admin", label: "Admin role (can look after members)" }] : [])] });
  }));
  router.post("/api/admin/access-requests", guard(async (req, _p, s, ctx) => {
    if (s.role === "super") throw new HttpError(400, "You already have full access.");
    const b = await readJson<{ wants?: string[]; note?: string }>(req);
    const valid = new Set([...YOUTH_PERMS.map(([k]) => k as string), "admin"]);
    const wants = [...new Set((b.wants || []).map(String).filter((k) => valid.has(k)))];
    const have = s.perms || [];
    const missing = wants.filter((k) => k === "admin" ? s.role === "youth" : !have.includes(k));
    if (!missing.length) throw new HttpError(422, "Choose something you don't have yet.");
    if (await env.DB.prepare("SELECT 1 FROM access_requests WHERE user_id = ? AND status = 'pending'").bind(s.user.id).first()) throw new HttpError(409, "You already have a request waiting. The main admin will reply soon.");
    const id = uuid(), note = String(b.note || "").trim().slice(0, 600) || null;
    const name = s.user.given_name || s.user.name || s.user.email;
    await env.DB.prepare("INSERT INTO access_requests (id, user_id, email, name, current_role, wants, note) VALUES (?,?,?,?,?,?,?)").bind(id, s.user.id, s.user.email, name, s.role === "youth" ? "youth_leader" : "admin", JSON.stringify(missing), note).run();
    const labels = missing.map((k) => k === "admin" ? "Admin role" : permLabels([k])[0]);
    await later(ctx, sendMail(env, { to: adminEmail(env), ...T.accessRequested({ site: siteUrl(env) }, { name, email: s.user.email, role: s.role === "youth" ? "Youth leader" : "Admin", wants: labels, note: note || "" }), template: "access_request" }));
    return json({ ok: true, id });
  }));
  router.patch("/api/admin/access-requests/:id", superOnly(async (req, { id }, s, ctx) => {
    const { decision } = await readJson<{ decision?: string }>(req);
    if (decision !== "approve" && decision !== "decline") throw new HttpError(400, "Approve or decline.");
    const r = await env.DB.prepare("SELECT * FROM access_requests WHERE id = ? AND status = 'pending'").bind(id).first<{ user_id: string; email: string; name: string; wants: string }>();
    if (!r) throw new HttpError(404, "That request has already been answered.");
    const wants = JSON.parse(r.wants || "[]") as string[];
    const role = await env.DB.prepare("SELECT role, perms FROM admin_roles WHERE user_id = ?").bind(r.user_id).first<{ role: string; perms: string | null }>();
    let nowRole = role?.role === "youth_leader" ? "Youth leader" : "Admin", can: string[] = permLabels(parsePerms(role?.perms, role?.role === "youth_leader" ? YOUTH_DEFAULT : ADMIN_DEFAULT));
    if (decision === "approve") {
      if (!role) throw new HttpError(409, "They're no longer on the team.");
      const asAdmin = wants.includes("admin") || role.role === "admin";
      const perms = parsePerms(JSON.stringify([...parsePerms(role.perms, role.role === "youth_leader" ? YOUTH_DEFAULT : ADMIN_DEFAULT), ...wants.filter((k) => k !== "admin")]));
      await env.DB.prepare("UPDATE admin_roles SET role = ?, perms = ? WHERE user_id = ?").bind(asAdmin ? "admin" : "youth_leader", JSON.stringify(perms), r.user_id).run();
      nowRole = asAdmin ? "Admin" : "Youth leader"; can = permLabels(perms);
    }
    await env.DB.prepare("UPDATE access_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?").bind(decision === "approve" ? "approved" : "declined", s.user.email, new Date().toISOString(), id).run();
    await audit(env, s, `access_${decision}`, "user", r.user_id, { wants });
    await later(ctx, sendMail(env, { to: r.email, ...T.accessDecision({ site: siteUrl(env) }, { name: (r.name || "").split(" ")[0] || "friend", approved: decision === "approve", wants: wants.map((k) => k === "admin" ? "Admin role" : permLabels([k])[0]), role: nowRole, can }), template: "access_decision" }));
    return json({ ok: true });
  }));

  // ---- Leader care: "My people" (everyone sees their own; the main admin sees all), handovers and contact log
  router.get("/api/admin/people", guard(async (req, _p, s) => {
    const all = s.role === "super" && new URL(req.url).searchParams.get("all") === "1";
    const { results } = await env.DB.prepare(
      `SELECT m.id, m.ref_code, m.first_name, m.last_name, m.preferred_name, m.phone, m.whatsapp, m.email, m.leader_user_id, m.leader_assigned_at,
          m.followup_status, m.followup_method, m.followup_at, m.followup_asks, m.last_contact_at, m.assigned_to,
          (SELECT COUNT(*) FROM member_contacts c WHERE c.member_id = m.id) AS contacts
       FROM members m WHERE m.status = 'member' AND ${all ? "1 = 1" : "m.leader_user_id = ?"} ORDER BY CASE m.followup_status WHEN 'met' THEN 1 ELSE 0 END, m.leader_assigned_at DESC LIMIT 500`)
      .bind(...(all ? [] : [s.user.id])).all();
    return json({ ok: true, people: results, leaders: await leaders(env), me: s.user.id, methods: CONTACT_METHODS,
      unassigned: (await env.DB.prepare(`SELECT COUNT(*) AS n FROM members m WHERE m.status = 'member' AND m.leader_user_id IS NULL
        AND NOT (m.user_id IS NOT NULL AND m.user_id IN (SELECT user_id FROM admin_roles) OR lower(COALESCE(m.email, '')) IN (SELECT lower(email) FROM admin_roles)) AND lower(COALESCE(m.email, '')) != lower(?)`).bind(adminEmail(env)).first<{ n: number }>())?.n ?? 0 });
  }));
  router.get("/api/admin/people/:id/contacts", guard(async (_req, { id }) => {
    const { results } = await env.DB.prepare(
      `SELECT c.method, c.note, c.created_at, COALESCE(NULLIF(u.given_name, ''), u.name, u.email) AS leader FROM member_contacts c LEFT JOIN users u ON u.id = c.leader_user_id
        WHERE c.member_id = ? ORDER BY c.created_at DESC LIMIT 50`).bind(id).all();
    return json({ ok: true, contacts: results });
  }));
  router.post("/api/admin/people/:id/contact", guard(async (req, { id }, s) => {
    const { method, note } = await readJson<{ method?: string; note?: string }>(req);
    await logContact(env, id, s.user.id, method || "", note ?? null);
    await audit(env, s, "contact", "member", id, { method });
    return json({ ok: true });
  }));
  router.post("/api/admin/people/:id/handover", guard(async (req, { id }, s, ctx) => {
    const { to } = await readJson<{ to?: string }>(req);
    if (!to) throw new HttpError(422, "Choose who to hand over to.");
    const job = assignLeader(env, id, { toUserId: to, handedBy: s.user.given_name || s.user.name || "A leader" });
    const leader = await job;
    await audit(env, s, "handover", "member", id, { to });
    return json({ ok: true, leader: leader?.name ?? null });
  }));
  router.post("/api/admin/people/assign-unassigned", superOnly(async (_req, _p, s) => {
    let n = 0; for (let i = 0; i < 10; i++) { const k = await backfillLeaders(env); n += k; if (k < 20) break; }
    await audit(env, s, "assign_unassigned", "member", "", { count: n });
    return json({ ok: true, assigned: n });
  }));

  router.get("/api/admin/whoami", guard(async (_req, _p, s) => json({ ok: true, email: s.user.email, name: s.user.name, role: s.role ?? "super", perms: s.role === "super" ? null : s.perms, all_perms: YOUTH_PERMS })));

  // ---------- complaints ----------
  router.get("/api/admin/complaints", guard(async (req) => {
    const status = new URL(req.url).searchParams.get("status");
    const where = status && (COMPLAINT_STATUSES as readonly string[]).includes(status) ? "WHERE c.status = ?" : "";
    const stmt = env.DB.prepare(`SELECT c.*, m.first_name, m.last_name, m.email, m.phone, m.ref_code AS member_ref FROM complaints c JOIN members m ON m.id = c.member_id ${where} ORDER BY CASE c.status WHEN 'received' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 200`);
    const { results } = await (where ? stmt.bind(status) : stmt).all();
    return json({ ok: true, complaints: results });
  }));
  router.patch("/api/admin/complaints/:id", guard(async (req, { id }, s, ctx) => {
    const body = await readJson(req);
    const v = new Validator(body);
    const status = v.oneOf("status", COMPLAINT_STATUSES, { required: true, label: "Status" });
    const response = v.text("response", { max: 5000 });
    const notify = body.notify !== false;
    v.assert();
    const c = await env.DB.prepare("SELECT c.*, m.first_name, m.last_name, m.preferred_name, m.email FROM complaints c JOIN members m ON m.id = c.member_id WHERE c.id = ?").bind(id)
      .first<{ ref_code: string; subject: string; first_name: string; last_name: string; preferred_name: string | null; email: string | null; response: string | null }>();
    if (!c) throw new HttpError(404, "Complaint not found.");
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE complaints SET status = ?, response = COALESCE(?, response), responded_at = CASE WHEN ? IS NOT NULL THEN ? ELSE responded_at END, updated_at = ? WHERE id = ?")
      .bind(status, response, response, now, now, id).run();
    await audit(env, s, "complaint_update", "complaint", id, { status });
    if (notify && c.email) await later(ctx, sendMail(env, { to: c.email, toName: `${c.first_name} ${c.last_name}`,
      ...T.complaintUpdate({ site: siteUrl(env) }, { name: c.preferred_name || c.first_name, ref: c.ref_code, subject: c.subject, status: status!, response: response ?? c.response }), template: "complaint_update" }));
    return json({ ok: true });
  }));

  router.get("/api/admin/email-log", guard(async () => {
    const { results } = await env.DB.prepare("SELECT id, to_email, template, subject, status, error, created_at FROM email_log ORDER BY id DESC LIMIT 100").all();
    return json({ ok: true, log: results, health: await emailHealth(env) });
  }));
  router.get("/api/admin/email-health", guard(async () => json({ ok: true, health: await emailHealth(env) })));
  router.post("/api/admin/email-log/resend", guard(async (_req, _p, s) => {
    const r = await resendFailed(env);
    await audit(env, s, "resend_failed_emails", "email_log", undefined, r);
    return json({ ok: true, ...r });
  }));

  // Every email template with sample data: preview + send a test to the admin.
  router.get("/api/admin/email-templates", guard(async () =>
    json({ ok: true, templates: SAMPLES.map(({ key, group, when, render }) => ({ key, group, when, subject: render(siteUrl(env)).subject })) })));
  router.get("/api/admin/email-templates/:key/preview", guard(async (_req, { key }) => {
    const t = SAMPLES.find((x) => x.key === key);
    if (!t) throw new HttpError(404, "Unknown template.");
    return new Response(t.render(siteUrl(env)).html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com" } });
  }));
  router.post("/api/admin/email-templates/:key/test", guard(async (_req, { key }) => {
    const t = SAMPLES.find((x) => x.key === key);
    if (!t) throw new HttpError(404, "Unknown template.");
    const m = t.render(siteUrl(env));
    const ok = await sendMail(env, { to: adminEmail(env), ...m, subject: `[Test] ${m.subject}`, template: `test_${key}` });
    if (!ok) throw new HttpError(503, "Cloudflare didn't accept the test email. Check Admin → Email log for the reason.");
    return json({ ok: true, sent_to: adminEmail(env) });
  }));
}
