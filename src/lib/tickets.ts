/**
 * Ticket generator: one ticket per person on a confirmed registration (1 + guests), each with an
 * unguessable code and QR. Tickets are emailed as a PDF (one page each) and can be checked in once.
 */
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { formatWhen } from "./time.ts";
import { ticketsPdf, type TicketPage } from "./pdf.ts";
import type { EventRow, RegRow } from "./registrations.ts";

export interface TicketRow { id: string; code: string; registration_id: string; event_id: string; seq: number; quantity: number; holder_name: string; holder_email: string; status: string; checked_in_at: string | null; checked_in_by: string | null; scan_count: number; created_at: string }

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 16 characters ≈ 80 bits of randomness: can't be guessed. */
export function ticketCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => ALPHABET[b % 32]).join("");
}
export const ticketUrl = (env: Env, code: string) => `${siteUrl(env)}/ticket?c=${code}`;
export const normaliseCode = (s: string) => String(s || "").replace(/^.*[?&]c=/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

/** Make sure a confirmed registration has exactly (1 + guests) valid tickets. Returns them in order. */
export async function ensureTickets(env: Env, r: RegRow): Promise<TicketRow[]> {
  const qty = 1 + (r.guests || 0);
  const { results: existing } = await env.DB.prepare("SELECT * FROM tickets WHERE registration_id = ? AND status = 'valid' ORDER BY seq").bind(r.id).all<TicketRow>();
  if (existing.length === qty) return existing;
  // Quantity changed (or first time): void any old ones that aren't checked in, then issue a fresh set.
  if (existing.length) await env.DB.prepare("UPDATE tickets SET status = 'void' WHERE registration_id = ? AND checked_in_at IS NULL").bind(r.id).run();
  const keep = existing.filter((t) => t.checked_in_at);
  const stmts = [];
  for (let seq = keep.length + 1; seq <= qty; seq++) {
    stmts.push(env.DB.prepare("INSERT INTO tickets (id, code, registration_id, event_id, seq, quantity, holder_name, holder_email) VALUES (?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), ticketCode(), r.id, r.event_id, seq, qty, r.name, r.email));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const { results } = await env.DB.prepare("SELECT * FROM tickets WHERE registration_id = ? AND status = 'valid' ORDER BY seq").bind(r.id).all<TicketRow>();
  return results;
}

export async function voidTickets(env: Env, registrationId: string) {
  await env.DB.prepare("UPDATE tickets SET status = 'void' WHERE registration_id = ?").bind(registrationId).run();
}

export function ticketPages(env: Env, e: EventRow, r: RegRow, tickets: TicketRow[]): TicketPage[] {
  return tickets.map((t) => ({
    eventTitle: e.title, when: formatWhen(e.starts_at, e.ends_at), location: e.location || "17 Humber Street, Woodmead, Sandton",
    holder: t.seq === 1 ? r.name : `${r.name} (guest ${t.seq - 1})`, seq: t.seq, quantity: t.quantity, ref: r.ref_code, code: t.code,
    url: ticketUrl(env, t.code), price: e.ticket_price ? `R${e.ticket_price} per person` : null,
  }));
}

export async function ticketsAttachment(env: Env, e: EventRow, r: RegRow) {
  const tickets = await ensureTickets(env, r);
  const pdf = ticketsPdf(ticketPages(env, e, r, tickets));
  let bin = "";
  for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
  return { tickets, attachment: { filename: `tickets-${e.slug}-${r.ref_code}.pdf`, type: "application/pdf", disposition: "attachment" as const, content: btoa(bin) } };
}
