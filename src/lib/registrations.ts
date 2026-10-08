import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { b64 } from "./crypto.ts";
import { sendMail } from "./email.ts";
import { calendarUrl, formatWhen, icsFile, outlookUrl } from "./time.ts";
import * as T from "../emails/templates.ts";

export interface EventRow {
  id: string; slug: string; title: string; category: string; description: string | null; starts_at: string; ends_at: string | null;
  location: string | null; is_published: number; rsvp_enabled: number; cover_attachment_id: string | null; form_schema: string;
  capacity: number | null; registration_closes_at: string | null; confirmation_message: string | null; collect_phone: number;
  cover_image: string | null; price_label: string | null; ticket_price: number | null; requires_pop: number; auto_approve: number;
  payment_instructions: string | null;
}
export interface RegRow { id: string; event_id: string; ref_code: string; name: string; email: string; guests: number; status: string; amount_due: number | null }

/** Statuses that hold a seat (count against capacity). */
export const HOLDS_SEAT = ["confirmed", "pending"];

export async function seatsTaken(env: Env, eventId: string): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(1 + guests), 0) AS n FROM event_registrations WHERE event_id = ? AND status IN ('confirmed','pending')",
  ).bind(eventId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function bankingDetails(env: Env, e: EventRow): Promise<string> {
  if (e.payment_instructions?.trim()) return e.payment_instructions.trim();
  const s = await env.DB.prepare("SELECT value FROM settings WHERE key = 'banking_details'").first<{ value: string }>();
  return s?.value?.trim() || "";
}

export const rands = (n: number | null | undefined) => (n ? `R${n.toLocaleString("en-ZA")}` : "");

/** Send the right email for a registration's current status. */
export async function notifyRegistration(env: Env, e: EventRow, r: RegRow, opts: { promoted?: boolean; note?: string | null } = {}) {
  const site = siteUrl(env);
  const eventUrl = `${site}/event?e=${encodeURIComponent(e.slug)}`;
  const first = r.name.split(" ")[0];
  const base = {
    name: first, ref: r.ref_code, title: e.title, when: formatWhen(e.starts_at, e.ends_at), location: e.location,
    eventUrl, price: e.price_label, cover: e.cover_image ? `${site}${e.cover_image}` : null,
  };
  if (r.status === "pending") {
    const m = T.eventPending({ site }, { ...base, amount: rands(r.amount_due), people: 1 + r.guests });
    return sendMail(env, { to: r.email, toName: r.name, ...m, template: "event_pending" });
  }
  if (r.status === "rejected") {
    const m = T.eventDeclined({ site }, { ...base, note: opts.note ?? null });
    return sendMail(env, { to: r.email, toName: r.name, ...m, template: "event_declined" });
  }
  if (r.status === "confirmed" || r.status === "waitlist") {
    const m = T.eventConfirmation({ site }, {
      ...base, status: r.status, approved: !!e.requires_pop && r.status === "confirmed" && !opts.promoted,
      message: opts.promoted ? "Good news — a spot opened up and it's yours!" : e.requires_pop && r.status === "confirmed" ? "Your payment has been approved. This email is your ticket — show your reference at the door." : e.confirmation_message,
      calendarUrl: calendarUrl(e), outlookUrl: outlookUrl(e), icsUrl: `${site}/api/events/${encodeURIComponent(e.slug)}/calendar.ics`,
    });
    return sendMail(env, { to: r.email, toName: r.name, ...m, template: r.status === "confirmed" ? "event_confirmation" : "event_waitlist",
      attachments: r.status === "confirmed"
        ? [{ filename: `${e.slug}.ics`, type: "text/calendar", disposition: "attachment", content: b64(new TextEncoder().encode(icsFile({ ...e, url: eventUrl }))) }]
        : undefined });
  }
  return false;
}

/** When seats free up, move the earliest waitlisted people in (to pending if the admin still has to approve). */
export async function promoteWaitlist(env: Env, eventId: string): Promise<number> {
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!e?.capacity) return 0;
  let promoted = 0;
  for (;;) {
    const used = await seatsTaken(env, eventId);
    const next = await env.DB.prepare("SELECT * FROM event_registrations WHERE event_id = ? AND status = 'waitlist' ORDER BY created_at LIMIT 1")
      .bind(eventId).first<RegRow>();
    if (!next || used + 1 + next.guests > e.capacity) break;
    const status = e.requires_pop && !e.auto_approve ? "pending" : "confirmed";
    await env.DB.prepare("UPDATE event_registrations SET status = ? WHERE id = ?").bind(status, next.id).run();
    await notifyRegistration(env, e, { ...next, status }, { promoted: true });
    promoted++;
  }
  return promoted;
}
