/**
 * "Ask SCC" agents. A concierge reads each question and hands it to one specialist agent. Every agent answers from
 * the church's own data (events, services, programme, the member's tickets…) and returns:
 *   - a short plain answer,
 *   - cards (events with "add to calendar" links), and
 *   - next actions and suggested questions.
 * The built-in answers always work. When the AI rollout includes this member, an open-weight model on Cloudflare
 * Workers AI rewrites the answer more naturally, using ONLY the facts the agent found (see assistant.ts).
 */
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { calendarUrl, outlookUrl, TZ } from "./time.ts";

export const PROMPT_VERSION = "ask-scc-2026-10-15-rag";
const ADDRESS = "17 Humber Street, Woodmead, Sandton";
const MAPS = "https://maps.google.com/?q=17+Humber+Street+Woodmead+Sandton";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type AgentId = "concierge" | "whatson" | "store" | "about" | "events" | "services" | "programme" | "visit" | "tickets" | "prayer" | "votes" | "join" | "calendar";
export const AGENTS: Record<AgentId, { label: string; blurb: string }> = {
  concierge: { label: "Concierge", blurb: "Finds the right helper for you" },
  whatson: { label: "What's on", blurb: "This week or this month at church" },
  store: { label: "Store", blurb: "Books by our brethren" },
  about: { label: "Our story", blurb: "Who we are and the welcome pack" },
  events: { label: "Events", blurb: "What's coming up and tickets" },
  services: { label: "Services", blurb: "Weekly service times" },
  programme: { label: "Programme", blurb: "The church year, month by month" },
  calendar: { label: "Calendar", blurb: "Add church dates to your calendar" },
  tickets: { label: "My tickets", blurb: "Your registrations" },
  visit: { label: "Visit", blurb: "Address, directions and contact" },
  prayer: { label: "Prayer", blurb: "Share a request" },
  votes: { label: "Voting", blurb: "Open votes for members" },
  join: { label: "Membership", blurb: "Joining the church" },
};

export type Card = { kind: "event"; title: string; when: string; where: string | null; price: string | null; url: string; google: string; outlook: string; ics: string }
  | { kind: "info"; title: string; lines: string[] };
export type Action = { label: string; href: string; primary?: boolean };
export type Reply = { agent: AgentId; text: string; facts: string; cards: Card[]; actions: Action[]; suggestions: string[]; personal?: boolean };
export type Who = { userId: string; email: string; name: string | null; member: boolean } | null;

// ---------------------------------------------------------------- routing

const RULES: [AgentId, RegExp][] = [
  ["whatson", /\b((this|next) (week|weekend|month)|what'?s (on|happening)|happening (at church|this|next)|today at church|tonight at church|in (january|february|march|april|may|june|july|august|september|october|november|december))\b/],
  ["about", /\b(welcome pack|history|our story|who are (you|we)|azusa|bhengu|back to god|assemblies of god|what is aog|aog is not|founder|founded)\b/],
  ["store", /\b(store|shop|books|bookshop|bookstore|buy (a |the )?book|purchase)\b/],
  ["calendar", /\b(calendar|calender|remind|subscribe|sync|ical|ics|outlook|google cal|add (it|this|them|that) to)\b/],
  ["tickets", /\b(my (ticket|tickets|booking|bookings|registration|registrations|ref)|(do|did) i (have|get|register|book)( a| my| any)? ?(ticket|tickets|booking|place|seat)?|have i got (a |my |any )?(ticket|tickets)|am i (registered|booked)|qr)\b/],
  ["votes", /\b(vote|votes|voting|poll|nominat|award)\b/],
  ["prayer", /\b(pray|prayer|praying|intercede)\b/],
  ["join", /\b(join|joining|member|membership|become part|sign me up)\b/],
  ["visit", /\b(where|address|location|directions?|map|park(ing)?|get there|contact|phone|email|whatsapp|instagram|youtube)\b/],
  ["programme", /\b(programme|program|month|year|conference|camp|retreat|calendar of|plan for|november|december|january|february|march|april|may|june|july|august|september|october)\b/],
  ["services", /\b(service|services|sunday|monday|tuesday|wednesday|thursday|friday|saturday|tonight|today|tomorrow|time|times|start|youth service|cell|choir|prayer meeting)\b/],
  ["events", /\b(event|events|ticket|tickets|coming up|upcoming|what'?s on|happening|worship night|concert|register|book|rsvp|weekend|this week|next week)\b/],
];

/** Pick the agent for a question. `last` lets short follow-ups ("add it to my calendar", "when is it?") stay on topic. */
export function route(text: string, last?: AgentId | null): AgentId {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ")} `;
  if (/\b(hi|hello|hey|morning|evening|help|what can you do)\b/.test(t) && t.trim().split(/\s+/).length <= 4) return "concierge";
  for (const [id, re] of RULES) if (re.test(t)) return id;
  if (last && last !== "concierge" && /\b(it|that|this|them|when|where|how much|price|cost)\b/.test(t)) return last;
  return "concierge";
}

// ---------------------------------------------------------------- data helpers

type Ev = { id: string; slug: string; title: string; starts_at: string; ends_at: string | null; location: string | null; description: string | null; price_label: string | null; registration_open: number | null };
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso));

function eventCard(env: Env, e: Ev): Card {
  const site = siteUrl(env);
  return { kind: "event", title: e.title, when: fmtDate(e.starts_at), where: e.location, price: e.price_label || null, url: `/event?e=${encodeURIComponent(e.slug)}`,
    google: calendarUrl(e), outlook: outlookUrl(e), ics: `${site}/api/events/${encodeURIComponent(e.slug)}/calendar.ics` };
}

async function upcomingEvents(env: Env, limit = 6): Promise<Ev[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, starts_at, ends_at, location, description, price_label,
            (rsvp_enabled = 1 AND (registration_closes_at IS NULL OR registration_closes_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AS registration_open FROM events
      WHERE is_published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at LIMIT ?`).bind(new Date().toISOString(), limit).all<Ev>();
  return results;
}

type Svc = { id: string; day: number; title: string; start_time: string | null; end_time: string | null; note: string | null; frequency: string | null };
async function services(env: Env): Promise<Svc[]> {
  return (await env.DB.prepare("SELECT id, day, title, start_time, end_time, note, frequency FROM weekly_services WHERE active = 1 ORDER BY CASE day WHEN 0 THEN 7 ELSE day END, sort").all<Svc>()).results;
}
const svcLine = (s: Svc) => `${DAYS[s.day]}: ${s.title}${s.start_time ? `, ${s.start_time}${s.end_time ? `–${s.end_time}` : ""}` : ""}${s.frequency === "twice_monthly" ? " (twice a month)" : ""}`;

function saNow() { return new Date(Date.now() + 2 * 3600_000); }
function dayAsked(t: string): number | null {
  if (/\b(today|tonight)\b/.test(t)) return saNow().getUTCDay();
  if (/\btomorrow\b/.test(t)) return (saNow().getUTCDay() + 1) % 7;
  const i = DAYS.findIndex((d) => t.includes(d.toLowerCase()));
  return i >= 0 ? i : null;
}

async function settings(env: Env, keys: string[]) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value])) as Record<string, string>;
}

const facts = (lines: string[]) => lines.filter(Boolean).join("\n");

// ---------------------------------------------------------------- the agents

type Run = (env: Env, text: string, who: Who) => Promise<Reply>;

const concierge: Run = async (env, _t, who) => {
  const evs = await upcomingEvents(env, 2);
  const hi = who?.name ? `Hi ${who.name.split(" ")[0]}!` : "Hi!";
  const next = evs[0] ? ` Next up is ${evs[0].title} on ${fmtDate(evs[0].starts_at)}.` : "";
  return { agent: "concierge", text: `${hi} I'm the SCC concierge. Ask me about events, service times, the church programme, your tickets, prayer or voting, and I'll pass you to the right helper.${next}`,
    facts: facts([`Upcoming: ${evs.map((e) => `${e.title} (${fmtDate(e.starts_at)})`).join("; ") || "none listed"}`]),
    cards: evs.map((e) => eventCard(env, e)), actions: [],
    suggestions: ["What's happening this week?", "What's on this month?", "When is the youth service?", "Add church dates to my calendar"] };
};

const events: Run = async (env, t) => {
  let evs = await upcomingEvents(env, 8);
  const q = t.toLowerCase();
  const named = evs.filter((e) => q.split(/\W+/).filter((w) => w.length > 3).some((w) => e.title.toLowerCase().includes(w)));
  if (named.length) evs = named;
  if (/\bthis week(end)?\b/.test(q)) { const end = Date.now() + 7 * 86400_000; evs = evs.filter((e) => Date.parse(e.starts_at) < end); }
  evs = evs.slice(0, 4);
  if (!evs.length) return { agent: "events", text: "There are no events open right now. New ones appear on your Home first.", facts: "No upcoming events.", cards: [], actions: [{ label: "Coming up", href: "/me#upcoming" }], suggestions: ["When is the youth service?", "Show the church programme"] };
  const list = evs.map((e) => `${e.title}: ${fmtDate(e.starts_at)}${e.location ? `, ${e.location}` : ""}${e.price_label ? `, ${e.price_label}` : ""}${e.registration_open ? ", tickets open" : ""}`);
  return { agent: "events", text: evs.length === 1 ? `${evs[0].title} is on ${fmtDate(evs[0].starts_at)}. Tap Get Ticket, or add it to your calendar.` : `Here's what's coming up. Tap one to get your ticket, or add it to your calendar.`,
    facts: facts(list), cards: evs.map((e) => eventCard(env, e)),
    actions: [{ label: "Get Ticket", href: `/event?e=${encodeURIComponent(evs[0].slug)}`, primary: true }, { label: "Everything coming up", href: "/me#upcoming" }],
    suggestions: ["Add these to my calendar", "Do I have a ticket?", "Where is it?"] };
};

const servicesAgent: Run = async (env, t) => {
  const all = await services(env);
  const d = dayAsked(t.toLowerCase());
  const pick = d == null ? all : all.filter((s) => s.day === d);
  const youth = /youth|young/.test(t.toLowerCase()) ? all.filter((s) => /youth/i.test(s.title)) : [];
  const show = youth.length ? youth : pick.length ? pick : all;
  const text = d != null && !pick.length && !youth.length ? `There's no service on ${DAYS[d]}. Here's the week:` : show.length === 1 ? `${svcLine(show[0])}, at ${ADDRESS}. Everyone is welcome.` : `Our weekly services at ${ADDRESS}:`;
  return { agent: "services", text, facts: facts([...show.map(svcLine), `Address: ${ADDRESS}`]),
    cards: [{ kind: "info", title: "Weekly services", lines: show.map(svcLine) }],
    actions: [{ label: "Directions", href: MAPS }, { label: "Add services to my calendar", href: "#calendar", primary: true }],
    suggestions: ["Add church dates to my calendar", "What's coming up?", "Where do I park?"] };
};

const programme: Run = async (env, _t, who) => {
  const from = saNow().toISOString().slice(0, 10);
  const audiences = who?.member ? ["public", "members"] : ["public"];
  const { results } = await env.DB.prepare(`SELECT start_date, end_date, time_label, title, venue FROM church_programme WHERE start_date >= ? AND audience IN (${audiences.map(() => "?").join(",")}) ORDER BY start_date LIMIT 8`)
    .bind(from, ...audiences).all<{ start_date: string; end_date: string | null; time_label: string | null; title: string; venue: string | null }>();
  const d = (x: string) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(x + "T12:00:00Z"));
  const lines = results.map((r) => `${d(r.start_date)}${r.end_date && r.end_date !== r.start_date ? `–${d(r.end_date)}` : ""}: ${r.title}${r.time_label ? `, ${r.time_label}` : ""}${r.venue ? ` (${r.venue})` : ""}`);
  return { agent: "programme", text: lines.length ? "Next on the church programme:" : "Nothing else is on the programme yet.", facts: facts(lines),
    cards: lines.length ? [{ kind: "info", title: "Church programme", lines }] : [], actions: [{ label: "Add to my calendar", href: "#calendar", primary: true }],
    suggestions: ["What's coming up?", "Add church dates to my calendar"] };
};

const calendar: Run = async (env) => {
  const site = siteUrl(env);
  const feed = `${site}/api/calendar/church.ics`;
  const webcal = feed.replace(/^https?:/, "webcal:");
  const evs = await upcomingEvents(env, 3);
  return { agent: "calendar", text: "Plug the church calendar into yours once and every service and event appears by itself, and updates when plans change. Or add single events below.",
    facts: facts([`Calendar feed: ${feed}`, ...evs.map((e) => `${e.title}: ${fmtDate(e.starts_at)}`)]),
    cards: evs.map((e) => eventCard(env, e)),
    actions: [
      { label: "Google Calendar", href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`, primary: true },
      { label: "iPhone / Apple", href: webcal },
      { label: "Outlook", href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent("Sandton City Church")}` },
    ],
    suggestions: ["What's coming up?", "When is the youth service?"] };
};

const tickets: Run = async (env, _t, who) => {
  if (!who) return { agent: "tickets", text: "Sign in and I'll show your tickets.", facts: "", cards: [], actions: [{ label: "Sign in", href: "/me", primary: true }], suggestions: ["What's coming up?"], personal: true };
  const { results } = await env.DB.prepare(
    `SELECT r.ref_code, r.status, e.title, e.slug, e.starts_at, e.ends_at, e.location, e.description, e.id, e.price_label, 0 AS registration_open,
            (SELECT code FROM tickets t WHERE t.registration_id = r.id AND t.status = 'valid' ORDER BY seq LIMIT 1) AS ticket_code
       FROM event_registrations r JOIN events e ON e.id = r.event_id
      WHERE (r.user_id = ? OR lower(r.email) = lower(?)) AND r.status NOT IN ('cancelled','rejected') AND COALESCE(e.ends_at, e.starts_at) >= ?
      ORDER BY e.starts_at LIMIT 5`).bind(who.userId, who.email, new Date().toISOString())
    .all<Ev & { ref_code: string; status: string; ticket_code: string | null }>();
  if (!results.length) return { agent: "tickets", text: "You don't have tickets for anything coming up yet.", facts: "No upcoming tickets.", cards: [], actions: [{ label: "See what's coming up", href: "/me#upcoming", primary: true }], suggestions: ["What's coming up?"], personal: true };
  const label = (s: string) => s === "pending_payment" || s === "pending" ? "waiting for payment approval" : s === "waitlist" ? "on the waitlist" : "confirmed";
  return { agent: "tickets", text: results.length === 1 ? `You're ${label(results[0].status)} for ${results[0].title} (${fmtDate(results[0].starts_at)}).` : `You have ${results.length} upcoming registrations:`,
    facts: facts(results.map((r) => `${r.title}, ${fmtDate(r.starts_at)}: ${label(r.status)}, ref ${r.ref_code}`)),
    cards: results.map((r) => eventCard(env, r)),
    actions: results.filter((r) => r.ticket_code).slice(0, 2).map((r, i): Action => ({ label: results.length > 1 ? `Show ticket: ${r.title}` : "Show my ticket", href: `/ticket?c=${encodeURIComponent(r.ticket_code!)}`, primary: i === 0 })).concat([{ label: "My profile", href: "/me" } as Action]),
    suggestions: ["Add it to my calendar", "Where is it?"], personal: true };
};

const visit: Run = async (env) => {
  const s = await settings(env, ["address", "map_url", "contact_email", "whatsapp_number", "instagram_url", "youtube_url"]);
  const addr = s.address || ADDRESS;
  const lines = [`Address: ${addr}`, s.contact_email ? `Email: ${s.contact_email}` : "", s.whatsapp_number ? `WhatsApp: ${s.whatsapp_number}` : ""].filter(Boolean);
  return { agent: "visit", text: `We're at ${addr}. There's parking on site, and someone at the door will help you find a seat.`, facts: facts(lines),
    cards: [{ kind: "info", title: "Find us", lines }], actions: [{ label: "Directions", href: s.map_url || MAPS, primary: true }],
    suggestions: ["When is the Sunday service?", "What's coming up?"] };
};

const prayer: Run = async () => ({
  agent: "prayer", text: "We'd be honoured to pray with you. Share your request on the prayer page; you choose whether it's private for the prayer team or shared on the prayer wall.",
  facts: "Prayer requests go through the prayer page. Pastoral or urgent needs: a leader will reach out.", cards: [],
  actions: [{ label: "Share a prayer request", href: "/prayer", primary: true }], suggestions: ["When is the prayer meeting?"],
});

const votes: Run = async (env, _t, who) => {
  if (!who?.member) return { agent: "votes", text: "Voting is for confirmed church members. Once you're confirmed, votes show here.", facts: "", cards: [], actions: [{ label: "Membership", href: "/join" }], suggestions: ["How do I join?"] };
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(`SELECT p.id, p.title, p.event_name, (SELECT MIN(opens_at) FROM poll_rounds r WHERE r.poll_id = p.id AND r.closes_at >= ?) AS next_open,
      (SELECT MAX(closes_at) FROM poll_rounds r WHERE r.poll_id = p.id) AS last_close FROM polls p WHERE p.status = 'open' AND p.completed_at IS NULL ORDER BY p.opens_at LIMIT 5`).bind(now).all<{ id: string; title: string; event_name: string | null; next_open: string | null; last_close: string }>();
  const live = results.filter((r) => r.next_open);
  if (!live.length) return { agent: "votes", text: `There's no vote planned at the moment${new Date().getUTCFullYear() === 2026 ? " in 2026" : ""}. When one is set up, you'll get an email and it shows here.`, facts: "No votes planned.", cards: [], actions: [{ label: "Voting page", href: "/vote" }], suggestions: ["What's happening this week?"] };
  const lines = live.map((r) => `${r.title}${r.event_name ? ` (${r.event_name})` : ""}: ${r.next_open! <= now ? "voting now" : `opens ${fmtDate(r.next_open!)}`}`);
  return { agent: "votes", text: "Here's what's coming up for voting. Pray, then vote on the voting page; your vote is secret.", facts: facts(lines),
    cards: [{ kind: "info", title: "Votes", lines }], actions: [{ label: "Open voting", href: "/vote", primary: true }], suggestions: ["What's happening this week?"] };
};

const store: Run = async () => ({
  agent: "store", text: "The AOG Store, with books written by our brethren, is coming soon. The shelves are empty for now; we'll let everyone know when the first books arrive.",
  facts: "Store: coming soon, no books yet.", cards: [], actions: [{ label: "Visit the store", href: "/store", primary: true }], suggestions: ["What's happening this week?"],
});

const join: Run = async (env, _t, who) => {
  if (who?.member) return { agent: "join", text: "You're already a confirmed member. Welcome home!", facts: "The person is a confirmed member.", cards: [], actions: [{ label: "My profile", href: "/me" }], suggestions: ["What's coming up?"] };
  return { agent: "join", text: "We'd love to welcome you. Joining takes about five minutes, then our team confirms your membership and introduces you to a leader.", facts: "Join at /join. Takes about five minutes. The team confirms membership.",
    cards: [], actions: [{ label: "Join the church", href: "/join", primary: true }], suggestions: ["When is the Sunday service?"] };
};

/** "What's happening this week / this month?" — events, weekly services and programme dates together. */
const whatson: Run = async (env, t) => {
  const q = t.toLowerCase();
  const sa = saNow();
  const today = sa.toISOString().slice(0, 10);
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const named = MONTHS.findIndex((m) => q.includes(m));
  let from = today, to: string, label: string;
  const add = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  if (named >= 0) {
    const y = sa.getUTCFullYear() + (named < sa.getUTCMonth() ? 1 : 0);
    from = `${y}-${String(named + 1).padStart(2, "0")}-01`; if (from < today) from = today;
    to = new Date(Date.UTC(y, named + 1, 0)).toISOString().slice(0, 10); label = `in ${MONTHS[named][0].toUpperCase()}${MONTHS[named].slice(1)}`;
  } else if (/\bnext month\b/.test(q)) {
    from = new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    to = new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth() + 2, 0)).toISOString().slice(0, 10); label = "next month";
  } else if (/\bmonth\b/.test(q)) { to = new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); label = "this month"; }
  else if (/\bnext week\b/.test(q)) { const dow = (sa.getUTCDay() + 6) % 7; from = add(today, 7 - dow); to = add(from, 6); label = "next week"; }
  else if (/\b(today|tonight)\b/.test(q)) { to = today; label = "today"; }
  else if (/\bweekend\b/.test(q)) { const toSat = (6 - sa.getUTCDay() + 7) % 7; from = add(today, Math.max(0, toSat - 1)); to = add(today, toSat + 1); label = "this weekend"; }
  else { to = add(today, 6); label = "this week"; }
  const startIso = new Date(from + "T00:00:00+02:00").toISOString(), endIso = new Date(to + "T23:59:59+02:00").toISOString();
  const { results: evs } = await env.DB.prepare(
    `SELECT id, slug, title, starts_at, ends_at, location, description, price_label,
            (rsvp_enabled = 1 AND (registration_closes_at IS NULL OR registration_closes_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AS registration_open
       FROM events WHERE is_published = 1 AND starts_at BETWEEN ? AND ? ORDER BY starts_at LIMIT 8`).bind(startIso, endIso).all<Ev>();
  const { results: prog } = await env.DB.prepare("SELECT start_date, title, venue FROM church_programme WHERE audience = 'public' AND start_date BETWEEN ? AND ? ORDER BY start_date LIMIT 12")
    .bind(from, to).all<{ start_date: string; title: string; venue: string | null }>();
  const svcs = await services(env);
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  const days: number[] = []; for (let i = 0; i < Math.min(span, 7); i++) days.push(new Date(add(from, i) + "T12:00:00Z").getUTCDay());
  const weekly = span <= 7 ? svcs.filter((s) => days.includes(s.day)) : [];
  const d = (x: string) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(x + "T12:00:00Z"));
  const progLines = prog.map((p) => `${d(p.start_date)}: ${p.title}${p.venue ? ` (${p.venue})` : ""}`);
  const lines = [...evs.map((e) => `${fmtDate(e.starts_at)}: ${e.title}${e.price_label ? `, ${e.price_label}` : ""}`), ...progLines, ...weekly.map(svcLine)];
  const count = evs.length + prog.length;
  const text = count || weekly.length
    ? `Here's what's on ${label}${count ? `: ${count} ${count === 1 ? "event" : "events and dates"}` : ""}${weekly.length ? `${count ? ", plus" : ":"} our weekly services` : ""}.`
    : `Nothing special is planned ${label} yet, but our weekly services carry on as usual.`;
  const cards: Card[] = evs.map((e) => eventCard(env, e));
  if (progLines.length) cards.push({ kind: "info", title: "On the church programme", lines: progLines });
  if (weekly.length) cards.push({ kind: "info", title: "Weekly services", lines: weekly.map(svcLine) });
  return { agent: "whatson", text, facts: facts([`Period: ${label} (${from} to ${to})`, ...lines]), cards,
    actions: [{ label: "Add church dates to my calendar", href: "#calendar", primary: true }, { label: "Everything coming up", href: "/me#upcoming" }],
    suggestions: label === "this week" ? ["What's on this month?", "When is the youth service?"] : ["What's happening this week?", "Do I have a ticket?"] };
};

const about: Run = async () => ({
  agent: "about", text: "We're part of the Assemblies of God family. Our story runs from the Azusa Street revival in 1906 to Nicholas Bhengu and the Back to God crusades, and on to the birth of AOG Sandton City Church. It's all in the welcome pack.",
  facts: "1906 Azusa Street revival (William J. Seymour). 1908 AOG missionaries reach South Africa. 1914 AOG formed in Hot Springs, USA. Nicholas Bhengu (1909–1985): Back to God crusades from the 1940s, Back to God Crusade 1950. AOG Sandton City Church: born from a vision for a city church in Sandton.",
  cards: [], actions: [{ label: "Open the welcome pack", href: "/welcome-pack", primary: true }], suggestions: ["When is the Sunday service?", "How do I join?"],
});

const RUN: Record<AgentId, Run> = { concierge, whatson, store, about, events, services: servicesAgent, programme, calendar, tickets, visit, prayer, votes, join };
export const runAgent = (id: AgentId, env: Env, text: string, who: Who) => RUN[id](env, text, who);

// ---------------------------------------------------------------- the church calendar feed (subscribe once)

const gcal = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Weekly services (repeating), published events and public programme dates in one calendar people can subscribe to. */
export async function churchCalendar(env: Env): Promise<string> {
  const site = siteUrl(env);
  const stamp = gcal(new Date().toISOString());
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AOG Sandton City Church//Church calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Sandton City Church", "X-WR-TIMEZONE:Africa/Johannesburg", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  const sa = saNow();
  for (const s of await services(env)) {
    if (s.frequency && s.frequency !== "weekly") continue;   // only services that really happen every week
    const [h, m] = (s.start_time || "18:00").split(":").map(Number);
    const [eh, em] = (s.end_time || `${h + 2}:${String(m).padStart(2, "0")}`).split(":").map(Number);
    const d = new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth(), sa.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + ((s.day - d.getUTCDay() + 7) % 7));
    const start = new Date(d.getTime() + (h - 2) * 3600_000 + m * 60_000), end = new Date(d.getTime() + (eh - 2) * 3600_000 + em * 60_000);
    out.push("BEGIN:VEVENT", `UID:svc-${s.id}@aogsccyouth.com`, `DTSTAMP:${stamp}`, `DTSTART:${gcal(start.toISOString())}`, `DTEND:${gcal(end.toISOString())}`, "RRULE:FREQ=WEEKLY",
      `SUMMARY:${icsEsc(s.title)}`, `LOCATION:${icsEsc(ADDRESS)}`, `DESCRIPTION:${icsEsc(`${s.note ? s.note + "\n" : ""}${site}/events`)}`, "END:VEVENT");
  }
  for (const e of await upcomingEvents(env, 30)) {
    const end = e.ends_at || new Date(Date.parse(e.starts_at) + 2 * 3600_000).toISOString();
    out.push("BEGIN:VEVENT", `UID:${e.id}@aogsccyouth.com`, `DTSTAMP:${stamp}`, `DTSTART:${gcal(new Date(e.starts_at).toISOString())}`, `DTEND:${gcal(new Date(end).toISOString())}`,
      `SUMMARY:${icsEsc(e.title)}`, `LOCATION:${icsEsc(e.location || ADDRESS)}`, `URL:${site}/event?e=${encodeURIComponent(e.slug)}`,
      `DESCRIPTION:${icsEsc(`${(e.description || "").slice(0, 400)}\n\nTickets: ${site}/event?e=${encodeURIComponent(e.slug)}`)}`, "END:VEVENT");
  }
  const { results: prog } = await env.DB.prepare("SELECT id, start_date, end_date, title, venue FROM church_programme WHERE audience = 'public' AND start_date >= ? ORDER BY start_date LIMIT 120")
    .bind(sa.toISOString().slice(0, 10)).all<{ id: string; start_date: string; end_date: string | null; title: string; venue: string | null }>();
  for (const p of prog) {
    const endDay = new Date((p.end_date || p.start_date) + "T12:00:00Z"); endDay.setUTCDate(endDay.getUTCDate() + 1);
    out.push("BEGIN:VEVENT", `UID:prog-${p.id}@aogsccyouth.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${p.start_date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${endDay.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${icsEsc(p.title)}`, ...(p.venue ? [`LOCATION:${icsEsc(p.venue)}`] : []), "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  out.push("END:VCALENDAR");
  return out.map((l) => l.length <= 74 ? l : l.match(/.{1,73}/g)!.join("\r\n ")).join("\r\n") + "\r\n";
}
