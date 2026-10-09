import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, json, readJson } from "../lib/http.ts";
import { randomToken, uuid } from "../lib/crypto.ts";
import { Validator } from "../lib/validate.ts";
import { getFile } from "../lib/storage.ts";
import { requireAdmin, type Session } from "../lib/auth.ts";
import { deleteOwnerFiles, readUpload, storeFiles } from "../lib/uploads.ts";
import { parseSchema, sanitizeSchema, slugify } from "../lib/forms.ts";
import { emailHealth, resendFailed, sendMail } from "../lib/email.ts";
import { SAMPLES } from "../emails/samples.ts";
import { CHECKIN_MONTHS, addMonths } from "../lib/membership.ts";
import { buildAnnouncement, processAnnouncements, renderAnnouncement, type AnnouncementRow } from "../lib/newsletter.ts";
import { calendarUrl, formatWhen, nextSundayAfternoon } from "../lib/time.ts";
import * as T from "../emails/templates.ts";
import { notifyRegistration, promoteWaitlist, type EventRow, type RegRow } from "../lib/registrations.ts";
import { ADMIN_ONLY_SETTINGS, COMPLAINT_STATUSES, EVENT_CATEGORIES, MEMBER_STATUSES, MESSAGE_STATUSES, PRAYER_STATUSES, PUBLIC_SETTINGS } from "../constants.ts";

type H = (req: Request, p: Record<string, string>, s: Session) => Promise<Response>;

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
  const guard = (h: H) => async (req: Request, p: Record<string, string>) => {
    const s = await requireAdmin(env, req);
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header.");
    return h(req, p, s);
  };

  // ---------- dashboard ----------
  router.get("/api/admin/stats", guard(async () => {
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
    ]);
    const n = (i: number) => (rs[i].results[0] as { n: number }).n;
    const interests = await env.DB.prepare("SELECT j.value AS slug, COUNT(*) AS n FROM members, json_each(members.interests) j GROUP BY j.value ORDER BY n DESC").all();
    const next = await env.DB.prepare("SELECT id, subject, status, scheduled_for FROM announcements WHERE status IN ('scheduled','sending') ORDER BY scheduled_for LIMIT 1").first();
    return json({ ok: true, stats: {
      members: n(0), new_members: n(1), this_week: n(2), new_prayers: n(3), new_messages: n(4), upcoming_events: n(5),
      subscribers: n(6), registrations_week: n(7), accounts: n(8), pending_payments: n(9), open_complaints: n(10),
    }, interests: interests.results, next_letter: next, email_enabled: !!env.EMAIL, email_health: await emailHealth(env), google_enabled: !!env.GOOGLE_CLIENT_ID });
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

  router.patch("/api/admin/members/:id", guard(async (req, { id }, s) => {
    const body = await readJson(req);
    const v = new Validator(body);
    const status = v.oneOf("status", MEMBER_STATUSES);
    const notes = "admin_notes" in body ? v.text("admin_notes", { max: 5000 }) : undefined;
    const assigned = "assigned_to" in body ? v.text("assigned_to", { max: 120 }) : undefined;
    v.assert();
    const sets: string[] = []; const args: unknown[] = [];
    if (status) {
      sets.push("status = ?"); args.push(status);
      if (status === "revoked") { sets.push("revoked_at = COALESCE(revoked_at, ?)", "next_checkin_at = NULL", "checkin_token_hash = NULL"); args.push(new Date().toISOString()); }
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
    await audit(env, s, "update", "member", id, { status, assigned });
    return json({ ok: true });
  }));

  router.delete("/api/admin/members/:id", guard(async (_req, { id }, s) => {
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
      `SELECT e.id, e.slug, e.title, e.category, e.starts_at, e.ends_at, e.location, e.is_published, e.rsvp_enabled, e.capacity, e.cover_attachment_id, e.cover_image, e.price_label, e.requires_pop,
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
    await env.DB.prepare(`INSERT INTO events (id, slug, title, category, description, starts_at, ends_at, location, is_published, rsvp_enabled,
        collect_phone, capacity, registration_closes_at, confirmation_message, form_schema, price_label, ticket_price, requires_pop, auto_approve, payment_instructions)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, slug, e.title, e.category, e.description, e.starts_at, e.ends_at, e.location, e.is_published, e.rsvp_enabled,
        e.collect_phone, e.capacity, e.registration_closes_at, e.confirmation_message, e.form_schema, e.price_label,
        e.ticket_price, e.requires_pop, e.auto_approve, e.payment_instructions).run();
    await audit(env, s, "create", "event", id);
    return json({ ok: true, id, slug }, 201);
  }));

  router.put("/api/admin/events/:id", guard(async (req, { id }, s) => {
    const e = readEvent(await readJson(req, 256 * 1024));
    const slug = await uniqueSlug(e.slug || e.title!, id);
    const r = await env.DB.prepare(`UPDATE events SET slug=?, title=?, category=?, description=?, starts_at=?, ends_at=?, location=?, is_published=?, rsvp_enabled=?,
        collect_phone=?, capacity=?, registration_closes_at=?, confirmation_message=?, form_schema=?, price_label=?, ticket_price=?, requires_pop=?,
        auto_approve=?, payment_instructions=?, updated_at=? WHERE id = ?`)
      .bind(slug, e.title, e.category, e.description, e.starts_at, e.ends_at, e.location, e.is_published, e.rsvp_enabled, e.collect_phone,
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
    await env.DB.prepare(`INSERT INTO events (id, slug, title, category, description, starts_at, ends_at, location, is_published, rsvp_enabled,
        collect_phone, capacity, registration_closes_at, confirmation_message, form_schema, cover_attachment_id, cover_image, price_label,
        ticket_price, requires_pop, auto_approve, payment_instructions) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(nid, slug, e.title, e.category, e.description, shift(e.starts_at), shift(e.ends_at), e.location, e.rsvp_enabled, e.collect_phone,
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
  router.patch("/api/admin/registrations/:id", guard(async (req, { id }, s) => {
    const body = await readJson(req);
    const reg = await env.DB.prepare("SELECT * FROM event_registrations WHERE id = ?").bind(id).first<RegRow>();
    if (!reg) throw new HttpError(404, "Registration not found.");
    const STATUSES = ["pending", "confirmed", "waitlist", "rejected", "cancelled"];
    const next = typeof body.status === "string" && STATUSES.includes(body.status) ? body.status : null;
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
    if (next && next !== reg.status) {
      await env.DB.prepare("UPDATE event_registrations SET status = ?, reviewed_at = ?, review_note = COALESCE(?, review_note) WHERE id = ?")
        .bind(next, new Date().toISOString(), note, id).run();
      const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(reg.event_id).first<EventRow>();
      if (e && (next === "confirmed" || next === "rejected") && body.notify !== false) await notifyRegistration(env, e, { ...reg, status: next }, { note });
      if (["cancelled", "rejected", "waitlist"].includes(next)) await promoteWaitlist(env, reg.event_id);
    }
    if (typeof body.checked_in === "boolean") {
      await env.DB.prepare("UPDATE event_registrations SET checked_in_at = ? WHERE id = ?").bind(body.checked_in ? new Date().toISOString() : null, id).run();
    }
    await audit(env, s, "update", "registration", id, { status: next, checked_in: body.checked_in });
    return json({ ok: true });
  }));

  // Approve every registration still awaiting approval for an event, in sign-up order.
  router.post("/api/admin/events/:id/approve-all", guard(async (_req, { id }, s) => {
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
    if (!e) throw new HttpError(404, "Event not found.");
    const { results } = await env.DB.prepare("SELECT * FROM event_registrations WHERE event_id = ? AND status = 'pending' ORDER BY created_at").bind(id).all<RegRow>();
    const now = new Date().toISOString();
    for (const r of results) {
      await env.DB.prepare("UPDATE event_registrations SET status = 'confirmed', reviewed_at = ? WHERE id = ?").bind(now, r.id).run();
      await notifyRegistration(env, e, { ...r, status: "confirmed" });
    }
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
    const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
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

  // ---------- complaints ----------
  router.get("/api/admin/complaints", guard(async (req) => {
    const status = new URL(req.url).searchParams.get("status");
    const where = status && (COMPLAINT_STATUSES as readonly string[]).includes(status) ? "WHERE c.status = ?" : "";
    const stmt = env.DB.prepare(`SELECT c.*, m.first_name, m.last_name, m.email, m.phone, m.ref_code AS member_ref FROM complaints c JOIN members m ON m.id = c.member_id ${where} ORDER BY CASE c.status WHEN 'received' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 200`);
    const { results } = await (where ? stmt.bind(status) : stmt).all();
    return json({ ok: true, complaints: results });
  }));
  router.patch("/api/admin/complaints/:id", guard(async (req, { id }, s) => {
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
    if (notify && c.email) await sendMail(env, { to: c.email, toName: `${c.first_name} ${c.last_name}`,
      ...T.complaintUpdate({ site: siteUrl(env) }, { name: c.preferred_name || c.first_name, ref: c.ref_code, subject: c.subject, status: status!, response: response ?? c.response }), template: "complaint_update" });
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
