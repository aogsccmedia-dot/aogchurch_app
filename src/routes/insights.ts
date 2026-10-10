/**
 * Insights for leaders: per-event dashboards (tickets sold, who actually came, money), the weekly services
 * manager (topics, posters, offering, attendance and growth), and the church board report.
 */
import type { Env } from "../env.ts";
import { HttpError, Router, json, readJson } from "../lib/http.ts";
import { requireAdmin, type Session } from "../lib/auth.ts";
import { uuid } from "../lib/crypto.ts";
import { readUpload, storeFiles, deleteOwnerFiles } from "../lib/uploads.ts";
import { DAYS, GROUP_KEYS, MINISTRY_GROUPS, groupLabel, isServiceDay, nextOccurrence, occurrences, saToday } from "../lib/groups.ts";

type Ctx = { waitUntil(p: Promise<unknown>): void };
type H = (req: Request, p: Record<string, string>, s: Session, ctx?: Ctx) => Promise<Response>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREQUENCIES = ["weekly", "twice_monthly", "monthly"];
/** Session metrics: [column, label]. Counts are whole numbers ≥ 0. */
export const SESSION_COUNTS: [string, string][] = [
  ["attendance", "Attendance"], ["first_time_visitors", "First-time visitors"], ["children", "Children"],
  ["salvations", "Salvations"], ["rededications", "Rededications"], ["spirit_baptisms", "Holy Spirit baptisms"],
  ["water_baptisms", "Water baptisms"], ["testimonies", "Testimonies & healings"], ["volunteers", "Volunteers serving"],
];
export const SESSION_MONEY: [string, string][] = [["offering_cents", "Offering"], ["tithes_cents", "Tithes"], ["other_income_cents", "Other income"]];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;   // no spreadsheet formulas
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const n = (v: unknown) => Number(v || 0);

/** Period from ?from=&to= (defaults: this calendar year so far). */
function period(url: URL, fallbackFrom?: string) {
  const today = saToday();
  const to = DATE.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : today;
  const from = DATE.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : fallbackFrom ?? `${today.slice(0, 4)}-01-01`;
  if (from > to) throw new HttpError(400, "The start date must be before the end date.");
  return { from, to };
}

// ---------------------------------------------------------------- events

async function eventSummaries(env: Env, from: string, to: string) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.slug, e.title, e.starts_at, e.ends_at, e.ministry_group, e.ticket_price, e.capacity, e.extra_income, e.extra_income_note, e.is_published,
      (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS bookings,
      (SELECT COALESCE(SUM(1 + r.guests), 0) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS people,
      (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'pending') AS pending,
      (SELECT COALESCE(SUM(r.amount_due), 0) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'pending') AS pending_value,
      (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'waitlist') AS waitlist,
      (SELECT COALESCE(SUM(r.amount_due), 0) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS ticket_income,
      (SELECT COUNT(*) FROM tickets t JOIN event_registrations r ON r.id = t.registration_id WHERE t.event_id = e.id AND t.status = 'valid' AND r.status = 'confirmed') AS tickets,
      (SELECT COUNT(*) FROM tickets t JOIN event_registrations r ON r.id = t.registration_id WHERE t.event_id = e.id AND t.status = 'valid' AND r.status = 'confirmed' AND t.checked_in_at IS NOT NULL) AS came
     FROM events e WHERE substr(e.starts_at, 1, 10) BETWEEN ? AND ? ORDER BY e.starts_at DESC LIMIT 500`)
    .bind(from, to).all<Record<string, unknown>>();
  const now = Date.now();
  return results.map((e) => {
    const sold = Math.max(n(e.tickets), n(e.people));
    const ended = new Date(String(e.ends_at || e.starts_at)).getTime() + 3 * 3600_000 < now;
    const came = n(e.came);
    return {
      id: e.id, slug: e.slug, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, group: e.ministry_group || "church", group_label: groupLabel(e.ministry_group as string),
      ticket_price: n(e.ticket_price), capacity: e.capacity, published: !!e.is_published, ended,
      bookings: n(e.bookings), sold, came, no_shows: ended ? Math.max(0, sold - came) : null, attendance_rate: sold ? Math.round((came / sold) * 100) : null,
      pending: n(e.pending), pending_value: n(e.pending_value), waitlist: n(e.waitlist),
      ticket_income: n(e.ticket_income), extra_income: n(e.extra_income), extra_income_note: e.extra_income_note ?? null,
      income: n(e.ticket_income) + n(e.extra_income),
    };
  });
}

// ---------------------------------------------------------------- weekly services

interface ServiceRow { id: string; day: number; title: string; start_time: string | null; end_time: string | null; note: string | null; ministry_group: string; frequency: string; active: number; sort: number }

const timeLabel = (s: Pick<ServiceRow, "start_time" | "end_time">) => (s.start_time ? (s.end_time ? `${s.start_time} – ${s.end_time}` : s.start_time) : "");

function readService(body: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const title = String(body.title ?? "").trim().slice(0, 120);
  if (!title) errors.title = "Give the service a name.";
  const day = Number(body.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) errors.day = "Choose the day.";
  const start_time = String(body.start_time ?? "").trim() || null, end_time = String(body.end_time ?? "").trim() || null;
  if (start_time && !TIME.test(start_time)) errors.start_time = "Use a time like 18:00.";
  if (end_time && !TIME.test(end_time)) errors.end_time = "Use a time like 20:00.";
  const ministry_group = String(body.ministry_group ?? "");
  if (!GROUP_KEYS.includes(ministry_group)) errors.ministry_group = "Choose the ministry group.";
  const frequency = FREQUENCIES.includes(String(body.frequency)) ? String(body.frequency) : "weekly";
  if (Object.keys(errors).length) throw new HttpError(422, "Please check the highlighted fields.", errors);
  return { title, day, start_time, end_time, note: String(body.note ?? "").trim().slice(0, 200) || null, ministry_group, frequency, active: body.active === false || body.active === "0" ? 0 : 1 };
}

/** Parse a service-session form (multipart). Money comes in as Rands ("1250.50"), stored as cents. */
function readSession(fd: FormData, service: ServiceRow) {
  const errors: Record<string, string> = {};
  const get = (k: string) => String(fd.get(k) ?? "").trim();
  const date = get("date");
  if (!DATE.test(date) || isNaN(Date.parse(date))) errors.date = "Choose the date of the service.";
  else if (!isServiceDay(date, service.day) && get("other_day") !== "1") errors.date = `${service.title} is on ${DAYS[service.day]}s. Tick “held on a different day” if it moved this time.`;
  const topic = get("topic").slice(0, 200);
  if (!topic) errors.topic = "What was the topic or theme?";
  const out: Record<string, string | number | null> = { date, topic, speaker: get("speaker").slice(0, 120) || null, scripture: get("scripture").slice(0, 160) || null, summary: get("summary").slice(0, 3000) || null, notes: get("notes").slice(0, 2000) || null };
  for (const [k, label] of SESSION_COUNTS) {
    const v = get(k);
    if (v === "") { out[k] = null; continue; }
    const num = Number(v);
    if (!Number.isInteger(num) || num < 0 || num > 100000) errors[k] = `${label}: enter a whole number.`; else out[k] = num;
  }
  for (const [k, label] of SESSION_MONEY) {
    const v = get(k.replace("_cents", "")).replace(/[R\s,]/gi, "");
    if (v === "") { out[k] = null; continue; }
    const num = Number(v);
    if (!isFinite(num) || num < 0 || num > 100_000_000) errors[k.replace("_cents", "")] = `${label}: enter an amount in Rands.`; else out[k] = Math.round(num * 100);
  }
  if (Object.keys(errors).length) throw new HttpError(422, "Please check the highlighted fields.", errors);
  return out;
}

// ---------------------------------------------------------------- report

async function boardReport(env: Env, from: string, to: string) {
  const events = await eventSummaries(env, from, to);
  const { results: sessions } = await env.DB.prepare(
    `SELECT ss.*, ws.title AS service_title, ws.day, ws.ministry_group FROM service_sessions ss JOIN weekly_services ws ON ws.id = ss.service_id
      WHERE ss.date BETWEEN ? AND ? ORDER BY ss.date`).bind(from, to).all<Record<string, unknown>>();

  const groups = new Map<string, Record<string, number>>();
  const g = (k: string) => { if (!groups.has(k)) groups.set(k, { events: 0, tickets: 0, came: 0, event_income: 0, sessions: 0, attendance: 0, service_income: 0, salvations: 0, first_time_visitors: 0 }); return groups.get(k)!; };
  for (const e of events) { const x = g(e.group); x.events++; x.tickets += e.sold; x.came += e.came; x.event_income += e.income; }
  const services = new Map<string, Record<string, unknown> & { totals: Record<string, number> }>();
  for (const s of sessions) {
    const x = g(String(s.ministry_group || "church"));
    x.sessions++; x.attendance += n(s.attendance); x.salvations += n(s.salvations); x.first_time_visitors += n(s.first_time_visitors);
    const money = (n(s.offering_cents) + n(s.tithes_cents) + n(s.other_income_cents)) / 100;
    x.service_income += money;
    const key = String(s.service_id);
    if (!services.has(key)) services.set(key, { id: key, title: s.service_title, day: DAYS[n(s.day)], group: s.ministry_group, group_label: groupLabel(s.ministry_group as string), totals: { sessions: 0, with_attendance: 0 } });
    const t = services.get(key)!.totals;
    t.sessions++;
    if (s.attendance != null) t.with_attendance++;
    for (const [k] of SESSION_COUNTS) t[k] = (t[k] || 0) + n(s[k]);
    for (const [k] of SESSION_MONEY) t[k] = (t[k] || 0) + n(s[k]);
  }
  const serviceList = [...services.values()].map((s) => ({ ...s, average_attendance: s.totals.with_attendance ? Math.round(s.totals.attendance / s.totals.with_attendance) : null }));
  const byGroup = [...groups.entries()].map(([k, v]) => ({ group: k, label: groupLabel(k), ...v, income: v.event_income + v.service_income }))
    .sort((a, b) => b.income - a.income || b.attendance - a.attendance);

  const sum = (k: string) => sessions.reduce((t, s) => t + n(s[k]), 0);
  const growth = Object.fromEntries(SESSION_COUNTS.map(([k]) => [k, sum(k)]));
  const money = { offering: sum("offering_cents") / 100, tithes: sum("tithes_cents") / 100, other: sum("other_income_cents") / 100 };
  const eventIncome = events.reduce((t, e) => t + e.income, 0);
  const one = async (sql: string, ...b: unknown[]) => n((await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n);
  const end = `${to}T23:59:59.999Z`, start = `${from}T00:00:00.000Z`;
  const membership = {
    joined: await one("SELECT COUNT(*) AS n FROM members WHERE created_at BETWEEN ? AND ?", start, end),
    verified_total: await one("SELECT COUNT(*) AS n FROM members WHERE status = 'member'"),
    active_total: await one("SELECT COUNT(*) AS n FROM members WHERE status != 'revoked'"),
    revoked: await one("SELECT COUNT(*) AS n FROM members WHERE revoked_at BETWEEN ? AND ?", start, end),
    subscribers: await one("SELECT COUNT(*) AS n FROM subscribers WHERE status = 'active'"),
  };
  const care = {
    prayer_requests: await one("SELECT COUNT(*) AS n FROM prayer_requests WHERE created_at BETWEEN ? AND ?", start, end),
    complaints: await one("SELECT COUNT(*) AS n FROM complaints WHERE created_at BETWEEN ? AND ?", start, end),
    complaints_resolved: await one("SELECT COUNT(*) AS n FROM complaints WHERE created_at BETWEEN ? AND ? AND status IN ('resolved','closed')", start, end),
  };
  const sold = events.reduce((t, e) => t + e.sold, 0), came = events.filter((e) => e.ended).reduce((t, e) => t + e.came, 0), soldEnded = events.filter((e) => e.ended).reduce((t, e) => t + e.sold, 0);
  return {
    period: { from, to }, generated_at: new Date().toISOString(),
    totals: {
      income: eventIncome + money.offering + money.tithes + money.other, event_income: eventIncome, service_income: money.offering + money.tithes + money.other,
      ...money, events: events.length, tickets_sold: sold, came, attendance_rate: soldEnded ? Math.round((came / soldEnded) * 100) : null,
      services_held: sessions.length, service_attendance: growth.attendance,
    },
    growth, membership, care, by_group: byGroup, services: serviceList, events,
    sessions: sessions.map((s) => ({ date: s.date, service: s.service_title, group_label: groupLabel(s.ministry_group as string), topic: s.topic, speaker: s.speaker, attendance: s.attendance, first_time_visitors: s.first_time_visitors, salvations: s.salvations, income: (n(s.offering_cents) + n(s.tithes_cents) + n(s.other_income_cents)) / 100 })),
  };
}

// ---------------------------------------------------------------- routes

export function insightsRoutes(router: Router, env: Env): void {
  const guard = (h: H) => async (req: Request, p: Record<string, string>, ctx?: Ctx) => {
    const s = await requireAdmin(env, req);
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header.");
    return h(req, p, s, ctx);
  };
  const audit = (s: Session, action: string, entity: string, id: string) =>
    env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?,?,?,?)").bind(s.user.id, action, entity, id).run();

  router.get("/api/admin/meta", guard(async () => json({ ok: true, groups: MINISTRY_GROUPS, days: DAYS, today: saToday() })));

  // ---- events
  router.get("/api/admin/insights/events", guard(async (req) => {
    const url = new URL(req.url);
    const { from, to } = period(url, `${Number(saToday().slice(0, 4)) - 1}-01-01`);
    const to2 = DATE.test(url.searchParams.get("to") || "") ? to : `${Number(saToday().slice(0, 4)) + 1}-12-31`;   // include upcoming events by default
    const events = await eventSummaries(env, from, to2);
    return json({ ok: true, from, to: to2, events });
  }));

  router.get("/api/admin/insights/events/:id", guard(async (_req, { id }) => {
    const [summary] = (await eventSummaries(env, "0000-01-01", "9999-12-31")).filter((e) => e.id === id);
    if (!summary) throw new HttpError(404, "Event not found.");
    const { results: regs } = await env.DB.prepare(
      `SELECT r.id, r.ref_code, r.name, r.email, r.phone, r.guests, r.status, r.amount_due, r.created_at, r.reviewed_at,
         (SELECT COUNT(*) FROM tickets t WHERE t.registration_id = r.id AND t.status = 'valid') AS tickets,
         (SELECT COUNT(*) FROM tickets t WHERE t.registration_id = r.id AND t.status = 'valid' AND t.checked_in_at IS NOT NULL) AS came,
         (SELECT MIN(t.checked_in_at) FROM tickets t WHERE t.registration_id = r.id AND t.checked_in_at IS NOT NULL) AS first_in
       FROM event_registrations r WHERE r.event_id = ? ORDER BY r.created_at`).bind(id).all();
    const { results: scans } = await env.DB.prepare(
      `SELECT t.checked_in_at, t.checked_in_by FROM tickets t JOIN event_registrations r ON r.id = t.registration_id
        WHERE t.event_id = ? AND t.checked_in_at IS NOT NULL AND t.status = 'valid' AND r.status = 'confirmed' ORDER BY t.checked_in_at`).bind(id).all<{ checked_in_at: string; checked_in_by: string | null }>();
    // Arrivals per 15 minutes (SAST) and per door/admin.
    const slot = (iso: string) => { const d = new Date(new Date(iso).getTime() + 2 * 3600_000); d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0); return d.toISOString().slice(11, 16); };
    const arrivals: Record<string, number> = {}, doors: Record<string, number> = {};
    for (const s of scans) { arrivals[slot(s.checked_in_at)] = (arrivals[slot(s.checked_in_at)] || 0) + 1; const who = (s.checked_in_by || "unknown").split("@")[0]; doors[who] = (doors[who] || 0) + 1; }
    // Bookings per day (SAST).
    const signups: Record<string, number> = {};
    for (const r of regs as { created_at: string; status: string }[]) if (r.status === "confirmed" || r.status === "pending") { const d = new Date(new Date(r.created_at).getTime() + 2 * 3600_000).toISOString().slice(0, 10); signups[d] = (signups[d] || 0) + 1; }
    return json({ ok: true, event: summary, registrations: regs, arrivals: Object.entries(arrivals).sort(), doors: Object.entries(doors).sort((a, b) => b[1] - a[1]), signups: Object.entries(signups).sort() });
  }));

  router.patch("/api/admin/events/:id/income", guard(async (req, { id }, s) => {
    const b = await readJson<{ extra_income?: unknown; extra_income_note?: unknown }>(req);
    const amount = Math.round(Number(String(b.extra_income ?? "0").replace(/[R\s,]/gi, "")));
    if (!isFinite(amount) || amount < 0 || amount > 100_000_000) throw new HttpError(422, "Enter an amount in Rands.", { extra_income: "Enter an amount in Rands." });
    const r = await env.DB.prepare("UPDATE events SET extra_income = ?, extra_income_note = ? WHERE id = ?").bind(amount, String(b.extra_income_note ?? "").trim().slice(0, 200) || null, id).run();
    if (!r.meta.changes) throw new HttpError(404, "Event not found.");
    await audit(s, "income", "event", id);
    return json({ ok: true });
  }));

  // ---- weekly services
  router.get("/api/admin/services", guard(async () => {
    const { results } = await env.DB.prepare("SELECT * FROM weekly_services ORDER BY active DESC, CASE day WHEN 0 THEN 7 ELSE day END, sort, title").all<ServiceRow>();
    const today = saToday();
    const { results: recent } = await env.DB.prepare(
      "SELECT id, service_id, date, topic, attendance, poster_attachment_id FROM service_sessions WHERE date BETWEEN ? AND ? ORDER BY date")
      .bind(occurrences(0, 5, 0, today)[0], occurrences(0, 0, 3, today).at(-1)).all<{ id: string; service_id: string; date: string; topic: string; attendance: number | null; poster_attachment_id: string | null }>();
    return json({
      ok: true, today,
      services: results.map((s) => ({
        ...s, day_label: DAYS[s.day], time: timeLabel(s), group_label: groupLabel(s.ministry_group),
        next_date: nextOccurrence(s.day, today), dates: occurrences(s.day, 4, 3, today),
        sessions: recent.filter((x) => x.service_id === s.id),
      })),
    });
  }));
  router.post("/api/admin/services", guard(async (req, _p, s) => {
    const v = readService(await readJson(req)); const id = uuid();
    await env.DB.prepare("INSERT INTO weekly_services (id, day, title, start_time, end_time, note, ministry_group, frequency, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, v.day, v.title, v.start_time, v.end_time, v.note, v.ministry_group, v.frequency, v.active, 100).run();
    await audit(s, "create", "weekly_service", id);
    return json({ ok: true, id }, 201);
  }));
  router.put("/api/admin/services/:id", guard(async (req, { id }, s) => {
    const v = readService(await readJson(req));
    const r = await env.DB.prepare("UPDATE weekly_services SET day=?, title=?, start_time=?, end_time=?, note=?, ministry_group=?, frequency=?, active=?, updated_at=? WHERE id = ?")
      .bind(v.day, v.title, v.start_time, v.end_time, v.note, v.ministry_group, v.frequency, v.active, new Date().toISOString(), id).run();
    if (!r.meta.changes) throw new HttpError(404, "Service not found.");
    await audit(s, "update", "weekly_service", id);
    return json({ ok: true });
  }));
  router.delete("/api/admin/services/:id", guard(async (_req, { id }, s) => {
    // Services with history are retired (kept for reports); empty ones are removed.
    const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM service_sessions WHERE service_id = ?").bind(id).first<{ n: number }>();
    if (n(used?.n)) await env.DB.prepare("UPDATE weekly_services SET active = 0, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    else await env.DB.prepare("DELETE FROM weekly_services WHERE id = ?").bind(id).run();
    await audit(s, n(used?.n) ? "retire" : "delete", "weekly_service", id);
    return json({ ok: true, retired: !!n(used?.n) });
  }));

  // ---- service sessions
  router.get("/api/admin/sessions", guard(async (req) => {
    const url = new URL(req.url);
    const { from, to } = period(url, occurrences(0, 12, 0)[0]);
    const svc = url.searchParams.get("service_id");
    const { results } = await env.DB.prepare(
      `SELECT ss.*, ws.title AS service_title, ws.ministry_group, ws.day FROM service_sessions ss JOIN weekly_services ws ON ws.id = ss.service_id
        WHERE ss.date BETWEEN ? AND ? ${svc ? "AND ss.service_id = ?" : ""} ORDER BY ss.date DESC LIMIT 300`)
      .bind(...(svc ? [from, to, svc] : [from, to])).all<Record<string, unknown>>();
    return json({ ok: true, from, to, sessions: results.map((x) => ({ ...x, group_label: groupLabel(x.ministry_group as string), poster_url: x.poster_attachment_id ? `/api/media/${x.poster_attachment_id}` : null })) });
  }));

  const saveSession = async (req: Request, s: Session, id: string | null) => {
    const fd = await req.formData();
    const existing = id ? await env.DB.prepare("SELECT * FROM service_sessions WHERE id = ?").bind(id).first<Record<string, unknown>>() : null;
    if (id && !existing) throw new HttpError(404, "Not found.");
    const serviceId = String(fd.get("service_id") || existing?.service_id || "");
    const service = await env.DB.prepare("SELECT * FROM weekly_services WHERE id = ?").bind(serviceId).first<ServiceRow>();
    if (!service) throw new HttpError(422, "Choose the service.", { service_id: "Choose the service." });
    const v = readSession(fd, service);
    const poster = fd.get("poster");
    const hasPoster = poster && typeof poster !== "string" && poster.size > 0;
    if (!hasPoster && !existing?.poster_attachment_id) throw new HttpError(422, "Please add the poster for this service.", { poster: "The poster image is required." });
    const clash = await env.DB.prepare("SELECT id FROM service_sessions WHERE service_id = ? AND date = ? AND id != ?").bind(serviceId, v.date, id ?? "").first();
    if (clash) throw new HttpError(409, "This service already has a record for that date. Edit that one instead.", { date: "Already recorded for this date." });
    const sid = id ?? uuid();
    let posterId = (existing?.poster_attachment_id as string | null) ?? null;
    const stmts: D1PreparedStatement[] = [];
    let rollback = async () => {};
    if (hasPoster) {
      const up = await readUpload(env, poster as File, "image", undefined, "poster");
      if (existing?.poster_attachment_id) stmts.push(await deleteOwnerFiles(env, "service_session", sid));
      const stored = await storeFiles(env, "service_session", sid, [up]);
      stmts.push(...stored.stmts); posterId = stored.ids[0]; rollback = async () => { await stored.rollback(); };
    }
    const cols = ["date", "topic", "speaker", "scripture", "summary", "notes", ...SESSION_COUNTS.map(([k]) => k), ...SESSION_MONEY.map(([k]) => k)];
    const now = new Date().toISOString();
    if (existing) stmts.push(env.DB.prepare(`UPDATE service_sessions SET ${cols.map((c) => `${c} = ?`).join(", ")}, poster_attachment_id = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(...cols.map((c) => v[c] ?? null), posterId, s.user.email, now, sid));
    else stmts.push(env.DB.prepare(`INSERT INTO service_sessions (id, service_id, ${cols.join(", ")}, poster_attachment_id, created_by, updated_by) VALUES (?, ?, ${cols.map(() => "?").join(", ")}, ?, ?, ?)`)
      .bind(sid, serviceId, ...cols.map((c) => v[c] ?? null), posterId, s.user.email, s.user.email));
    try { await env.DB.batch(stmts); } catch (e) { await rollback(); throw e; }
    await audit(s, existing ? "update" : "create", "service_session", sid);
    return json({ ok: true, id: sid, poster_url: posterId ? `/api/media/${posterId}` : null }, existing ? 200 : 201);
  };
  router.post("/api/admin/sessions", guard((req, _p, s) => saveSession(req, s, null)));
  router.put("/api/admin/sessions/:id", guard((req, { id }, s) => saveSession(req, s, id)));
  router.delete("/api/admin/sessions/:id", guard(async (_req, { id }, s) => {
    await env.DB.batch([await deleteOwnerFiles(env, "service_session", id), env.DB.prepare("DELETE FROM service_sessions WHERE id = ?").bind(id)]);
    await audit(s, "delete", "service_session", id);
    return json({ ok: true });
  }));

  // ---- board report
  router.get("/api/admin/report", guard(async (req) => {
    const { from, to } = period(new URL(req.url));
    return json({ ok: true, report: await boardReport(env, from, to) });
  }));
  router.get("/api/admin/report.csv", guard(async (req) => {
    const { from, to } = period(new URL(req.url));
    const r = await boardReport(env, from, to);
    const rows: unknown[][] = [];
    const add = (...cells: unknown[]) => rows.push(cells);
    add("AOG Sandton City Church · Board report", `${from} to ${to}`);
    add();
    add("Summary"); add("Total income (R)", r.totals.income); add("Event income (R)", r.totals.event_income); add("Offerings (R)", r.totals.offering); add("Tithes (R)", r.totals.tithes); add("Other service income (R)", r.totals.other);
    add("Events held", r.totals.events); add("Tickets sold", r.totals.tickets_sold); add("Ticket holders who came", r.totals.came); add("Services recorded", r.totals.services_held); add("Service attendance (total)", r.totals.service_attendance);
    for (const [k, label] of SESSION_COUNTS.slice(1)) add(label, r.growth[k]);
    add("New members joined", r.membership.joined); add("Verified members (now)", r.membership.verified_total); add("Memberships revoked", r.membership.revoked);
    add();
    add("By ministry group"); add("Group", "Events", "Tickets sold", "Came", "Event income (R)", "Services held", "Service attendance", "Service income (R)", "Salvations", "Total income (R)");
    for (const g of r.by_group) add(g.label, g.events, g.tickets, g.came, g.event_income, g.sessions, g.attendance, g.service_income, g.salvations, g.income);
    add();
    add("Events"); add("Date", "Event", "Group", "Tickets sold", "Came", "Attendance %", "Ticket income (R)", "Other income (R)", "Total (R)");
    for (const e of r.events) add(String(e.starts_at).slice(0, 10), e.title, e.group_label, e.sold, e.came, e.attendance_rate ?? "", e.ticket_income, e.extra_income, e.income);
    add();
    add("Weekly services"); add("Date", "Service", "Group", "Topic", "Speaker", "Attendance", "First-time visitors", "Salvations", "Income (R)");
    for (const s of r.sessions) add(s.date, s.service, s.group_label, s.topic, s.speaker ?? "", s.attendance ?? "", s.first_time_visitors ?? "", s.salvations ?? "", s.income);
    const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new Response("﻿" + body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="scc-board-report-${from}-to-${to}.csv"`, "Cache-Control": "no-store" } });
  }));
}

/** Public: the weekly services (grouped by day) and topics planned for the coming week. */
export async function publicWeekly(env: Env) {
  const { results } = await env.DB.prepare("SELECT * FROM weekly_services WHERE active = 1 ORDER BY CASE day WHEN 0 THEN 7 ELSE day END, sort, title").all<ServiceRow>();
  const today = saToday();
  const weekEnd = occurrences(0, 0, 1, today).at(-1)!;
  const { results: upcoming } = await env.DB.prepare(
    `SELECT ss.service_id, ss.date, ss.topic, ss.speaker, ss.poster_attachment_id FROM service_sessions ss JOIN weekly_services ws ON ws.id = ss.service_id
      WHERE ws.active = 1 AND ss.date BETWEEN ? AND ? ORDER BY ss.date`).bind(today, weekEnd).all<{ service_id: string; date: string; topic: string; speaker: string | null; poster_attachment_id: string | null }>();
  return results.map((s) => {
    const next = upcoming.find((u) => u.service_id === s.id && u.date >= today);
    return {
      id: s.id, day: DAYS[s.day], day_num: s.day, title: s.title, time: timeLabel(s), note: s.note, frequency: s.frequency, group_label: groupLabel(s.ministry_group),
      next: next ? { date: next.date, topic: next.topic, speaker: next.speaker, poster_url: next.poster_attachment_id ? `/api/media/${next.poster_attachment_id}` : null } : null,
    };
  });
}
