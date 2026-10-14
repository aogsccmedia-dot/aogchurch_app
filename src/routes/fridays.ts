// Friday youth services: capture each Friday's attendance and the money that came in, from 16 October 2026.
// Records live in service_sessions (the Friday youth service), so they also appear in Weekly services and Reports.
import type { Env } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { requireAdmin } from "../lib/auth.ts";
import { saToday } from "../lib/groups.ts";
import { sendMail } from "../lib/email.ts";
import { siteUrl } from "../env.ts";

export const FRIDAYS_FROM = "2026-10-16";
export const FRIDAY_SERVICE = "svc-fri-youth";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isFriday = (d: string) => new Date(d + "T12:00:00Z").getUTCDay() === 5;

/** Every Friday from the start date up to (and including) the next Friday to come. */
export function fridayDates(today = saToday(), from = FRIDAYS_FROM): string[] {
  const out: string[] = [];
  let d = from;
  let next = today;
  while (!isFriday(next)) next = addDays(next, 1);
  const last = next > from ? next : from;
  while (d <= last) { out.push(d); d = addDays(d, 7); }
  return out;
}

type Row = { id: string; date: string; status: string; attendance: number | null; first_time_visitors: number | null; salvations: number | null;
  offering_cents: number | null; tithes_cents: number | null; other_income_cents: number | null; notes: string | null; cancel_reason: string | null; updated_by: string | null; updated_at: string };

export function fridayRoutes(router: Router, env: Env): void {
  router.get("/api/admin/fridays", async (req) => {
    await requireAdmin(env, req);
    const today = saToday();
    const dates = fridayDates(today);
    const { results } = await env.DB.prepare(
      `SELECT id, date, status, attendance, first_time_visitors, salvations, offering_cents, tithes_cents, other_income_cents, notes, cancel_reason, updated_by, updated_at
         FROM service_sessions WHERE service_id = ? AND date >= ? ORDER BY date`).bind(FRIDAY_SERVICE, FRIDAYS_FROM).all<Row>();
    const byDate = new Map(results.map((r) => [r.date, r]));
    const fridays = dates.map((date) => {
      const r = byDate.get(date);
      const money = r ? (r.offering_cents || 0) + (r.tithes_cents || 0) + (r.other_income_cents || 0) : null;
      const status = r ? (r.status === "cancelled" ? "cancelled" : "captured") : date > today ? "upcoming" : date === today ? "today" : "missing";
      return { date, status, attendance: r?.attendance ?? null, first_timers: r?.first_time_visitors ?? null, salvations: r?.salvations ?? null,
        amount: money == null ? null : money / 100, notes: r?.notes ?? "", cancel_reason: r?.cancel_reason ?? "", updated_by: r?.updated_by ?? null, updated_at: r?.updated_at ?? null };
    }).reverse();
    const held = fridays.filter((f) => f.status === "captured");
    const att = held.map((f) => f.attendance || 0);
    const money = held.reduce((n, f) => n + (f.amount || 0), 0);
    return json({ ok: true, from: FRIDAYS_FROM, today, fridays, totals: {
      held: held.length, missing: fridays.filter((f) => f.status === "missing").length,
      attendance: att.reduce((a, b) => a + b, 0), average: att.length ? Math.round(att.reduce((a, b) => a + b, 0) / att.length) : 0,
      best: att.length ? Math.max(...att) : 0, money: Math.round(money * 100) / 100, first_timers: held.reduce((n, f) => n + (f.first_timers || 0), 0),
    } });
  });

  router.put("/api/admin/fridays/:date", async (req, { date }) => {
    const s = await requireAdmin(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    if (!DATE.test(date) || !isFriday(date)) throw new HttpError(400, "That isn't a Friday.");
    if (date < FRIDAYS_FROM) throw new HttpError(400, "Friday records start on 16 October 2026.");
    if (date > saToday()) throw new HttpError(400, "You can capture a Friday on the night or afterwards.");
    const b = await readJson<{ attendance?: number | string; first_timers?: number | string; salvations?: number | string; amount?: number | string; notes?: string; cancelled?: boolean; cancel_reason?: string }>(req);
    const int = (v: unknown, max = 100000) => { if (v === "" || v == null) return null; const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(422, "Numbers must be 0 or more."); return n; };
    const cancelled = !!b.cancelled;
    const attendance = cancelled ? null : int(b.attendance);
    if (!cancelled && attendance == null) throw new HttpError(422, "How many people came?");
    const amountCents = cancelled ? null : (() => { if (b.amount === "" || b.amount == null) return 0; const n = Number(String(b.amount).replace(/[^\d.,-]/g, "").replace(",", ".")); if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(422, "Check the amount."); return Math.round(n * 100); })();
    const reason = String(b.cancel_reason || "").trim().slice(0, 200);
    if (cancelled && !reason) throw new HttpError(422, "Say why there was no service.");
    const notes = String(b.notes || "").trim().slice(0, 1000) || null;
    const who = s.user.given_name || s.user.name || s.user.email;
    const existing = await env.DB.prepare("SELECT id, tithes_cents, other_income_cents FROM service_sessions WHERE service_id = ? AND date = ?").bind(FRIDAY_SERVICE, date)
      .first<{ id: string; tithes_cents: number | null; other_income_cents: number | null }>();
    // The Friday form captures one final total. Anything already split out as tithes/other stays, and offering is the rest.
    const offering = amountCents == null ? null : Math.max(0, amountCents - (existing?.tithes_cents || 0) - (existing?.other_income_cents || 0));
    const now = new Date().toISOString();
    if (existing) {
      await env.DB.prepare(`UPDATE service_sessions SET status = ?, cancel_reason = ?, attendance = ?, first_time_visitors = ?, salvations = ?, offering_cents = ?, notes = COALESCE(?, notes), updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(cancelled ? "cancelled" : "held", cancelled ? reason : null, attendance, cancelled ? null : int(b.first_timers), cancelled ? null : int(b.salvations), offering, notes, who, now, existing.id).run();
    } else {
      await env.DB.prepare(`INSERT INTO service_sessions (id, service_id, date, topic, status, cancel_reason, attendance, first_time_visitors, salvations, offering_cents, notes, source, created_by, updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`fri-${date}`, FRIDAY_SERVICE, date, "Youth service", cancelled ? "cancelled" : "held", cancelled ? reason : null,
        attendance, cancelled ? null : int(b.first_timers), cancelled ? null : int(b.salvations), offering, notes, "friday", who, who).run();
    }
    await env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?,?,?,?)").bind(s.user.id, "friday_capture", "service_session", date).run();
    return json({ ok: true });
  });
}

/** Friday 21:30 (SAST): if tonight's numbers aren't in yet, remind the youth leaders who capture Fridays (once). */
export async function processFridayReminder(env: Env, now = new Date()): Promise<number> {
  const sa = new Date(now.getTime() + 2 * 3600_000);
  if (sa.getUTCDay() !== 5 || sa.getUTCHours() < 21 || (sa.getUTCHours() === 21 && sa.getUTCMinutes() < 30)) return 0;
  const date = sa.toISOString().slice(0, 10);
  if (date < FRIDAYS_FROM) return 0;
  const key = `friday_reminded:${date}`;
  if (await env.DB.prepare("SELECT 1 FROM settings WHERE key = ?").bind(key).first()) return 0;
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')").bind(key).run();
  if (await env.DB.prepare("SELECT 1 FROM service_sessions WHERE service_id = ? AND date = ?").bind(FRIDAY_SERVICE, date).first()) return 0;
  const { results } = await env.DB.prepare("SELECT u.email, COALESCE(NULLIF(u.given_name, ''), u.name, 'there') AS name, r.perms FROM admin_roles r JOIN users u ON u.id = r.user_id WHERE r.role = 'youth_leader'").all<{ email: string; name: string; perms: string | null }>();
  const site = siteUrl(env);
  let n = 0;
  for (const r of results) {
    let perms: string[] = [];
    try { perms = JSON.parse(r.perms || "null") || ["fridays", "scan", "reports"]; } catch { perms = ["fridays"]; }
    if (!perms.includes("fridays")) continue;
    const ok = await sendMail(env, { to: r.email, subject: "Tonight's youth service: add the numbers 🙌",
      html: `<p>Hi ${r.name.replace(/[<>&]/g, "")},</p><p>Please capture tonight's youth service: how many came and the final amount. It takes a minute.</p><p><a href="${site}/admin#fridays">Capture tonight</a></p>`,
      text: `Hi ${r.name}, please capture tonight's youth service (attendance and final amount): ${site}/admin#fridays`, template: "friday_reminder" });
    if (ok) n++;
  }
  return n;
}
