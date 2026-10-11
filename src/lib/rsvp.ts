/** "Are you coming?" for weekly services, from email links, WhatsApp buttons or the website. */
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { HttpError } from "./http.ts";
import { randomToken, sha256Hex, uuid } from "./crypto.ts";

/** Optional reasons (people only share if they're comfortable). Keep titles ≤ 24 chars for WhatsApp lists. */
export const RSVP_REASONS: [string, string][] = [
  ["work", "Work or studies"],
  ["family", "Family commitments"],
  ["unwell", "Not feeling well"],
  ["travel", "Travelling"],
  ["transport", "No transport"],
  ["other", "Something else"],
];
export const reasonLabel = (code: string | null | undefined) => RSVP_REASONS.find(([k]) => k === code)?.[1] ?? null;

export async function recordRsvp(env: Env, o: { service_id: string; date: string; contact: string; name?: string | null; response: "yes" | "no"; channel: "email" | "whatsapp" | "web"; reason_code?: string | null; reason?: string | null }) {
  const now = new Date().toISOString();
  const code = o.reason_code && RSVP_REASONS.some(([k]) => k === o.reason_code) ? o.reason_code : null;
  const reason = o.reason ? o.reason.trim().slice(0, 300) || null : null;
  await env.DB.prepare(
    `INSERT INTO service_rsvps (id, service_id, date, contact, name, response, reason_code, reason, channel, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (service_id, date, contact) DO UPDATE SET response = excluded.response, name = COALESCE(excluded.name, name), channel = excluded.channel,
       reason_code = CASE WHEN excluded.response = 'yes' THEN NULL ELSE COALESCE(excluded.reason_code, reason_code) END,
       reason = CASE WHEN excluded.response = 'yes' THEN NULL ELSE COALESCE(excluded.reason, reason) END, updated_at = excluded.updated_at`)
    .bind(uuid(), o.service_id, o.date, o.contact.toLowerCase(), o.name ?? null, o.response, o.response === "no" ? code : null, o.response === "no" ? reason : null, o.channel, now, now).run();
}

/** Add (or change) the reason on an existing "can't make it". */
export async function setRsvpReason(env: Env, service_id: string, date: string, contact: string, reason_code: string | null, reason: string | null) {
  const code = reason_code && RSVP_REASONS.some(([k]) => k === reason_code) ? reason_code : null;
  await env.DB.prepare("UPDATE service_rsvps SET reason_code = ?, reason = ?, updated_at = ? WHERE service_id = ? AND date = ? AND contact = ? AND response = 'no'")
    .bind(code, reason ? reason.trim().slice(0, 300) : null, new Date().toISOString(), service_id, date, contact.toLowerCase()).run();
}

/** Personal one-tap RSVP links for a reminder email. */
export async function rsvpLinks(env: Env, service_id: string, date: string, contact: string, name: string | null) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO rsvp_links (token_hash, service_id, date, contact, name) VALUES (?,?,?,?,?)")
    .bind(await sha256Hex(token), service_id, date, contact.toLowerCase(), name).run();
  const base = `${siteUrl(env)}/rsvp?t=${encodeURIComponent(token)}`;
  return { yes: `${base}&a=yes`, no: `${base}&a=no` };
}

export async function rsvpByToken(env: Env, token: string | null | undefined) {
  if (!token || token.length < 20 || token.length > 200) throw new HttpError(400, "This link isn't valid.");
  const link = await env.DB.prepare(
    `SELECT l.service_id, l.date, l.contact, l.name, ws.title, ws.start_time, ws.end_time FROM rsvp_links l JOIN weekly_services ws ON ws.id = l.service_id WHERE l.token_hash = ?`)
    .bind(await sha256Hex(token)).first<{ service_id: string; date: string; contact: string; name: string | null; title: string; start_time: string | null; end_time: string | null }>();
  if (!link) throw new HttpError(404, "This link has expired. Thanks anyway, and see you soon!");
  const current = await env.DB.prepare("SELECT response, reason_code, reason FROM service_rsvps WHERE service_id = ? AND date = ? AND contact = ?")
    .bind(link.service_id, link.date, link.contact).first<{ response: string; reason_code: string | null; reason: string | null }>();
  return { ...link, current };
}

/** Admin summary for one service date. */
export async function rsvpSummary(env: Env, service_id: string, date: string) {
  const { results } = await env.DB.prepare("SELECT name, contact, response, reason_code, reason, channel, updated_at FROM service_rsvps WHERE service_id = ? AND date = ? ORDER BY response DESC, updated_at DESC")
    .bind(service_id, date).all<{ name: string | null; contact: string; response: string; reason_code: string | null; reason: string | null; channel: string; updated_at: string }>();
  const reasons: Record<string, number> = {};
  for (const r of results) if (r.response === "no" && r.reason_code) reasons[reasonLabel(r.reason_code)!] = (reasons[reasonLabel(r.reason_code)!] || 0) + 1;
  return {
    coming: results.filter((r) => r.response === "yes").length, not_coming: results.filter((r) => r.response === "no").length, reasons,
    people: results.map((r) => ({ name: r.name || (r.contact.includes("@") ? r.contact.replace(/^(.).*(@.*)$/, "$1•••$2") : "+" + r.contact.replace(/^(\d{4}).*(\d{3})$/, "$1•••$2")),
      response: r.response, reason: r.reason_code ? reasonLabel(r.reason_code) + (r.reason ? `: ${r.reason}` : "") : r.reason, channel: r.channel, at: r.updated_at })),
  };
}
