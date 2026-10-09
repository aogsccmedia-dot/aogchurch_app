/**
 * Tickets: public view (/ticket?c=CODE → /api/tickets/:code), QR + PDF downloads,
 * and the admin door check-in (scan once; copies show as "already used").
 */
import type { Env } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { getSession, requireAdmin } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { qrSvg } from "../lib/qr.ts";
import { ticketsPdf } from "../lib/pdf.ts";
import { formatWhen } from "../lib/time.ts";
import { notifyRegistration, type EventRow, type RegRow } from "../lib/registrations.ts";
import { normaliseCode, ticketPages, ticketUrl, type TicketRow } from "../lib/tickets.ts";

interface Joined extends TicketRow { title: string; slug: string; starts_at: string; ends_at: string | null; location: string | null; ref_code: string; reg_status: string }

async function lookup(env: Env, raw: string) {
  const code = normaliseCode(raw);
  if (code.length !== 16) throw new HttpError(404, "That doesn't look like a valid ticket code.");
  const t = await env.DB.prepare(
    `SELECT t.*, e.title, e.slug, e.starts_at, e.ends_at, e.location, r.ref_code, r.status AS reg_status
       FROM tickets t JOIN events e ON e.id = t.event_id JOIN event_registrations r ON r.id = t.registration_id WHERE t.code = ?`).bind(code).first<Joined>();
  if (!t) throw new HttpError(404, "Ticket not found. It may be fake or mistyped.");
  return t;
}
const state = (t: Joined) => (t.status !== "valid" || t.reg_status !== "confirmed" ? "void" : t.checked_in_at ? "used" : "valid");
const firstName = (n: string) => n.split(" ")[0];

export function ticketRoutes(router: Router, env: Env): void {
  // Public: what the ticket holder (or anyone holding the link) sees. Limited personal detail.
  router.get("/api/tickets/:code", async (req, { code }) => {
    await rateLimit(env, "ticket-view", clientIp(req), 120, 3600);
    const t = await lookup(env, code);
    const { results: siblings } = await env.DB.prepare("SELECT code, seq FROM tickets WHERE registration_id = ? AND status = 'valid' ORDER BY seq").bind(t.registration_id).all<{ code: string; seq: number }>();
    const s = await getSession(env, req);
    return json({ ok: true, is_admin: s?.kind === "admin", ticket: {
      code: t.code, seq: t.seq, quantity: t.quantity, holder: s?.kind === "admin" ? t.holder_name : `${firstName(t.holder_name)}${t.seq > 1 ? ` · guest ${t.seq - 1}` : ""}`,
      ref: t.ref_code, state: state(t), checked_in_at: t.checked_in_at,
      event: { title: t.title, slug: t.slug, when: formatWhen(t.starts_at, t.ends_at), location: t.location },
      url: ticketUrl(env, t.code), siblings,
    } });
  });
  router.get("/api/tickets/:code/qr.svg", async (req, { code }) => {
    await rateLimit(env, "ticket-view", clientIp(req), 120, 3600);
    const t = await lookup(env, code);
    return new Response(qrSvg(ticketUrl(env, t.code)), { headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=3600" } });
  });
  router.get("/api/tickets/:code/pdf", async (req, { code }) => {
    await rateLimit(env, "ticket-view", clientIp(req), 60, 3600);
    const t = await lookup(env, code);
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(t.event_id).first<EventRow>();
    const r = await env.DB.prepare("SELECT * FROM event_registrations WHERE id = ?").bind(t.registration_id).first<RegRow>();
    if (!e || !r || state(t) === "void") throw new HttpError(410, "This ticket is no longer valid.");
    const pdf = ticketsPdf(ticketPages(env, e, r, [t]));
    return new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="ticket-${t.code}.pdf"`, "cache-control": "private, no-store" } });
  });

  // ---------- admin: door check-in ----------
  const admin = async (req: Request) => {
    const s = await requireAdmin(env, req);
    if (req.method !== "GET" && req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header.");
    return s;
  };
  const adminView = (t: Joined) => ({
    code: t.code, seq: t.seq, quantity: t.quantity, holder: t.holder_name, email: t.holder_email, ref: t.ref_code, state: state(t),
    checked_in_at: t.checked_in_at, scan_count: t.scan_count, event: { id: t.event_id, title: t.title, when: formatWhen(t.starts_at, t.ends_at) },
  });
  router.get("/api/admin/tickets/:code", async (req, { code }) => { await admin(req); return json({ ok: true, ticket: adminView(await lookup(env, code)) }); });
  router.post("/api/admin/tickets/check-in", async (req) => {
    const s = await admin(req);
    const { code, event_id } = await readJson<{ code?: string; event_id?: string }>(req);
    const t = await lookup(env, code || "");
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE tickets SET scan_count = scan_count + 1, last_scan_at = ? WHERE id = ?").bind(now, t.id).run();
    const st = state(t);
    if (event_id && event_id !== t.event_id) return json({ ok: true, result: "wrong_event", ticket: adminView(t) });
    if (st === "void") return json({ ok: true, result: "void", ticket: adminView(t) });
    if (st === "used") return json({ ok: true, result: "already_used", ticket: adminView(t) });
    // Only the first scan wins (guards against two doors scanning a copy at the same moment).
    const r = await env.DB.prepare("UPDATE tickets SET checked_in_at = ?, checked_in_by = ? WHERE id = ? AND checked_in_at IS NULL").bind(now, s.user.email, t.id).run();
    if (!r.meta.changes) return json({ ok: true, result: "already_used", ticket: adminView(await lookup(env, t.code)) });
    await env.DB.prepare("UPDATE event_registrations SET checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ?").bind(now, t.registration_id).run();
    return json({ ok: true, result: "ok", ticket: adminView({ ...t, checked_in_at: now }) });
  });
  router.post("/api/admin/tickets/undo", async (req) => {
    await admin(req);
    const { code } = await readJson<{ code?: string }>(req);
    const t = await lookup(env, code || "");
    await env.DB.prepare("UPDATE tickets SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?").bind(t.id).run();
    return json({ ok: true });
  });
  router.get("/api/admin/events/:id/tickets", async (req, { id }) => {
    await admin(req);
    const { results } = await env.DB.prepare(
      `SELECT t.code, t.seq, t.quantity, t.holder_name, t.status, t.checked_in_at, r.ref_code FROM tickets t JOIN event_registrations r ON r.id = t.registration_id
        WHERE t.event_id = ? AND t.status = 'valid' AND r.status = 'confirmed' ORDER BY t.checked_in_at DESC, r.ref_code, t.seq`).bind(id).all();
    const inCount = results.filter((x) => (x as { checked_in_at: string | null }).checked_in_at).length;
    return json({ ok: true, tickets: results, total: results.length, checked_in: inCount });
  });
  router.post("/api/admin/registrations/:id/resend-tickets", async (req, { id }) => {
    await admin(req);
    const r = await env.DB.prepare("SELECT * FROM event_registrations WHERE id = ?").bind(id).first<RegRow>();
    if (!r || r.status !== "confirmed") throw new HttpError(409, "Only confirmed registrations have tickets.");
    const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(r.event_id).first<EventRow>();
    if (!e) throw new HttpError(404, "Event not found.");
    await notifyRegistration(env, e, r);
    return json({ ok: true, sent_to: r.email });
  });
}
