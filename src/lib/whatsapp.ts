/**
 * WhatsApp via the official WhatsApp Business Platform (Meta Cloud API).
 * Switched on only when WHATSAPP_TOKEN + WHATSAPP_PHONE_ID are set; everything else keeps working without it.
 *
 * - Service reminders: an approved template with two quick-reply buttons ("I'm coming" / "Can't make it").
 * - "Can't make it" → a short list asking why, only if they're comfortable (or "Prefer not to say").
 * - Welcome on joining (approved template).
 * - Replies: STOP / START, and a helper for service times, directions, events, joining and prayer
 *   (built-in answers; Claude answers free-form questions when ANTHROPIC_API_KEY is set).
 * - Only people who agreed to WhatsApp contact on the join form are messaged; STOP is honoured immediately.
 */
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { hex, uuid } from "./crypto.ts";
import { RSVP_REASONS, recordRsvp, reasonLabel, setRsvpReason } from "./rsvp.ts";

const GRAPH = "https://graph.facebook.com/v21.0";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ADDRESS = "17 Humber Street, Woodmead, Sandton";
const MAPS = "https://maps.google.com/?q=17+Humber+Street+Woodmead+Sandton";

export const whatsappEnabled = (env: Env) => !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);

/** South African and international numbers → WhatsApp's digits-only format (27821234567). */
export function waNumber(raw: string | null | undefined): string | null {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 10) d = "27" + d.slice(1);
  d = d.replace(/\D/g, "");
  if (d.startsWith("27") && d.length !== 11) return null;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

async function log(env: Env, direction: "in" | "out", phone: string, kind: string, summary: string, status: string, error: string | null = null) {
  await env.DB.prepare("INSERT INTO whatsapp_log (direction, phone, kind, summary, status, error) VALUES (?,?,?,?,?,?)")
    .bind(direction, phone, kind, summary.slice(0, 300), status, error ? error.slice(0, 500) : null).run().catch(() => {});
}

async function send(env: Env, to: string, kind: string, summary: string, message: Record<string, unknown>): Promise<boolean> {
  if (!whatsappEnabled(env)) return false;
  try {
    const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...message }),
    });
    if (!res.ok) { await log(env, "out", to, kind, summary, "failed", `${res.status} ${(await res.text()).slice(0, 400)}`); return false; }
    await log(env, "out", to, kind, summary, "sent");
    return true;
  } catch (e) { await log(env, "out", to, kind, summary, "failed", String(e)); return false; }
}

export const sendText = (env: Env, to: string, body: string) => send(env, to, "text", body, { type: "text", text: { body, preview_url: true } });
export const sendButtons = (env: Env, to: string, body: string, buttons: { id: string; title: string }[]) =>
  send(env, to, "buttons", body, { type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } } });
export const sendList = (env: Env, to: string, body: string, button: string, rows: { id: string; title: string }[]) =>
  send(env, to, "list", body, { type: "interactive", interactive: { type: "list", body: { text: body }, action: { button: button.slice(0, 20), sections: [{ title: "Choose one", rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24) })) }] } } });

/** Approved template with body parameters and (optional) quick-reply button payloads. */
export function sendTemplate(env: Env, to: string, name: string, params: string[], quickReplies: string[] = []) {
  const components: Record<string, unknown>[] = [];
  if (params.length) components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 900) })) });
  quickReplies.forEach((payload, index) => components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] }));
  return send(env, to, "template", `${name}: ${params.join(" · ")}`, { type: "template", template: { name, language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" }, components } });
}

async function optedOut(env: Env, phone: string) {
  return !!(await env.DB.prepare("SELECT 1 FROM whatsapp_contacts WHERE phone = ? AND opted_out = 1").bind(phone).first());
}
async function touch(env: Env, phone: string, fields: { name?: string | null; opted_out?: number; pending?: string | null; inbound?: boolean }) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO whatsapp_contacts (phone, name, opted_out, pending, last_inbound_at, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT (phone) DO UPDATE SET name = COALESCE(excluded.name, name), opted_out = COALESCE(?, opted_out),
        pending = CASE WHEN ? = 1 THEN excluded.pending ELSE pending END, last_inbound_at = COALESCE(excluded.last_inbound_at, last_inbound_at), updated_at = excluded.updated_at`)
    .bind(phone, fields.name ?? null, fields.opted_out ?? 0, fields.pending ?? null, fields.inbound ? now : null, now,
      fields.opted_out ?? null, "pending" in fields ? 1 : 0).run();
}

// ---------------------------------------------------------------- outgoing: reminders & welcome

interface Svc { id: string; day: number; title: string; start_time: string | null; end_time: string | null }

/** Members who agreed to WhatsApp contact (and haven't said STOP or turned reminders off). */
export async function whatsappRecipients(env: Env): Promise<{ phone: string; name: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(whatsapp, ''), phone) AS number, COALESCE(preferred_name, first_name) AS name FROM members
      WHERE status != 'revoked' AND comm_whatsapp = 1 AND service_reminders = 1`).all<{ number: string; name: string }>();
  const seen = new Set<string>(), out: { phone: string; name: string }[] = [];
  for (const r of results) { const p = waNumber(r.number); if (p && !seen.has(p)) { seen.add(p); out.push({ phone: p, name: r.name }); } }
  if (!out.length) return out;
  const { results: off } = await env.DB.prepare("SELECT phone FROM whatsapp_contacts WHERE opted_out = 1").all<{ phone: string }>();
  const blocked = new Set(off.map((o) => o.phone));
  return out.filter((r) => !blocked.has(r.phone));
}

/** Service reminder template: {{1}} name, {{2}} service, {{3}} when, {{4}} this week's topic. Buttons carry the RSVP. */
export async function sendWhatsappReminders(env: Env, s: Svc, date: string, tonight: boolean, topic: string | null): Promise<number> {
  if (!whatsappEnabled(env)) return 0;
  const when = `${tonight ? "tonight" : "tomorrow"}${s.start_time ? ` at ${s.start_time}` : ""}`;
  let sent = 0;
  for (const r of await whatsappRecipients(env)) {
    const ok = await sendTemplate(env, r.phone, env.WHATSAPP_REMINDER_TEMPLATE || "service_reminder",
      [r.name || "friend", s.title, when, topic || "come as you are"], [`rsvp|yes|${s.id}|${date}`, `rsvp|no|${s.id}|${date}`]);
    if (ok) { sent++; await touch(env, r.phone, { name: r.name }); }
  }
  return sent;
}

/** Welcome template on joining: {{1}} first name, {{2}} reference. */
export async function sendWhatsappWelcome(env: Env, m: { whatsapp?: string | null; phone?: string | null; comm_whatsapp?: number | boolean | null; first_name: string; preferred_name?: string | null; ref_code: string }) {
  if (!whatsappEnabled(env) || !m.comm_whatsapp) return false;
  const phone = waNumber(m.whatsapp || m.phone);
  if (!phone || await optedOut(env, phone)) return false;
  const ok = await sendTemplate(env, phone, env.WHATSAPP_WELCOME_TEMPLATE || "member_welcome", [m.preferred_name || m.first_name, m.ref_code]);
  if (ok) await touch(env, phone, { name: m.preferred_name || m.first_name });
  return ok;
}

// ---------------------------------------------------------------- incoming: webhook

/** Meta signs every webhook call: X-Hub-Signature-256 = sha256=HMAC(app secret, raw body). */
export async function validSignature(env: Env, raw: string, header: string | null): Promise<boolean> {
  if (!env.WHATSAPP_APP_SECRET || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WHATSAPP_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const given = header.slice(7);
  if (given.length !== mac.length) return false;
  let diff = 0; for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

interface Inbound { from: string; type: string; text?: { body: string }; button?: { payload: string; text: string }; interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } } }

export async function handleWebhook(env: Env, body: { entry?: { changes?: { value?: { messages?: Inbound[]; contacts?: { wa_id: string; profile?: { name?: string } }[] } }[] }[] }) {
  for (const entry of body.entry || []) for (const change of entry.changes || []) {
    const v = change.value || {};
    for (const msg of v.messages || []) {
      const name = v.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
      await handleMessage(env, msg, name).catch((e) => log(env, "in", msg.from, "error", String(e), "failed"));
    }
  }
}

async function serviceLabel(env: Env, id: string) {
  return env.DB.prepare("SELECT title, start_time FROM weekly_services WHERE id = ?").bind(id).first<{ title: string; start_time: string | null }>();
}

async function handleMessage(env: Env, msg: Inbound, name: string | null) {
  const phone = msg.from;
  const payload = msg.button?.payload || msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "";
  const text = (msg.text?.body || msg.button?.text || "").trim();
  await log(env, "in", phone, msg.type, payload || text, "received");
  await touch(env, phone, { name, inbound: true });

  // RSVP buttons from the reminder.
  if (payload.startsWith("rsvp|")) {
    const [, answer, serviceId, date] = payload.split("|");
    const svc = await serviceLabel(env, serviceId);
    if (!svc || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (answer === "yes") {
      await recordRsvp(env, { service_id: serviceId, date, contact: phone, name, response: "yes", channel: "whatsapp" });
      await touch(env, phone, { pending: null });
      return sendText(env, phone, `Wonderful! See you at ${svc.title}${svc.start_time ? ` at ${svc.start_time}` : ""} 🙌\n${ADDRESS}`);
    }
    await recordRsvp(env, { service_id: serviceId, date, contact: phone, name, response: "no", channel: "whatsapp" });
    await touch(env, phone, { pending: `reason|${serviceId}|${date}` });
    return sendList(env, phone, "Thanks for letting us know, we'll miss you! If you're comfortable sharing, what's keeping you away? (Totally optional.)", "Choose a reason",
      [...RSVP_REASONS.map(([k, l]) => ({ id: `reason|${k}|${serviceId}|${date}`, title: l })), { id: `reason|skip|${serviceId}|${date}`, title: "Prefer not to say" }]);
  }
  if (payload.startsWith("reason|")) {
    const [, code, serviceId, date] = payload.split("|");
    if (code !== "skip") await setRsvpReason(env, serviceId, date, phone, code, null);
    await touch(env, phone, { pending: code === "other" ? `reasontext|${serviceId}|${date}` : null });
    if (code === "other") return sendText(env, phone, "Thank you. If you'd like to, type a few words (or reply SKIP).");
    return sendText(env, phone, code === "unwell" ? "Thank you for telling us. We're praying for you to feel better soon 🙏" : "Thank you for letting us know. We'll be praying for you, and we'd love to see you next time 💛");
  }

  // Plain text.
  const lower = text.toLowerCase();
  if (/^(stop|unsubscribe|opt ?out)\b/.test(lower)) {
    await touch(env, phone, { opted_out: 1, pending: null });
    return sendText(env, phone, "You won't get WhatsApp messages from us any more. Reply START anytime to turn them back on. God bless you 🙏");
  }
  if (/^(start|subscribe)\b/.test(lower)) {
    await touch(env, phone, { opted_out: 0 });
    return sendText(env, phone, "Welcome back! You'll get our service reminders on WhatsApp again 💛");
  }
  const contact = await env.DB.prepare("SELECT pending FROM whatsapp_contacts WHERE phone = ?").bind(phone).first<{ pending: string | null }>();
  if (contact?.pending?.startsWith("reasontext|")) {
    const [, serviceId, date] = contact.pending.split("|");
    if (!/^skip$/i.test(text)) await setRsvpReason(env, serviceId, date, phone, "other", text);
    await touch(env, phone, { pending: null });
    return sendText(env, phone, "Thank you for sharing. We'll keep you in our prayers 🙏");
  }
  if (!text) return;
  return sendText(env, phone, await helpAnswer(env, text, name));
}

// ---------------------------------------------------------------- helper answers

async function churchFacts(env: Env) {
  const { results: svcs } = await env.DB.prepare("SELECT day, title, start_time, end_time FROM weekly_services WHERE active = 1 ORDER BY CASE day WHEN 0 THEN 7 ELSE day END, sort").all<Svc>();
  const { results: events } = await env.DB.prepare("SELECT title, slug, starts_at FROM events WHERE is_published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at LIMIT 3")
    .bind(new Date().toISOString()).all<{ title: string; slug: string; starts_at: string }>();
  const site = siteUrl(env);
  const services = svcs.map((s) => `• ${DAYS[s.day]}: ${s.title}${s.start_time ? ` (${s.start_time}${s.end_time ? `–${s.end_time}` : ""})` : ""}`).join("\n");
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }).format(new Date(iso));
  const evs = events.map((e) => `• ${e.title}, ${fmt(e.starts_at)}\n  ${site}/event?e=${encodeURIComponent(e.slug)}`).join("\n");
  return { site, services, evs };
}

export async function helpAnswer(env: Env, text: string, name: string | null): Promise<string> {
  const f = await churchFacts(env);
  const t = text.toLowerCase();
  const hi = name ? `Hi ${name.split(" ")[0]}! ` : "Hi! ";
  if (/(time|when|service|sunday|friday|tonight|today|schedule)/.test(t)) return `${hi}Here are our weekly services at ${ADDRESS}:\n${f.services}\n\nEveryone is welcome 💛`;
  if (/(where|address|location|direction|map|park)/.test(t)) return `${hi}We're at ${ADDRESS}.\nDirections: ${MAPS}`;
  if (/(event|ticket|worship night|camp|register)/.test(t)) return f.evs ? `${hi}Coming up:\n${f.evs}` : `${hi}No events are open right now. See ${f.site}/events`;
  if (/(join|member|sign ?up|register)/.test(t)) return `${hi}We'd love to welcome you! Joining takes about five minutes: ${f.site}/join`;
  if (/(pray|prayer)/.test(t)) return `${hi}We'd be honoured to pray with you. Share your request here and our prayer team will stand with you: ${f.site}/prayer`;
  if (env.ANTHROPIC_API_KEY) {
    const ai = await askClaude(env, text, f).catch(() => null);
    if (ai) return ai;
  }
  return `${hi}I can help with service times, directions, events, joining the church and prayer. Just ask! For anything else, a leader will reply to you here soon.\n\nReply STOP to stop WhatsApp messages.`;
}

/** Optional: short, grounded answers from Claude for questions the built-in answers don't cover. */
async function askClaude(env: Env, question: string, f: { site: string; services: string; evs: string }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-5-5", max_tokens: 300,
      system: `You are the friendly WhatsApp helper for AOG Sandton City Church (Assemblies of God), ${ADDRESS}. Website: ${f.site}.
Weekly services:\n${f.services}\nUpcoming events:\n${f.evs || "none listed"}\n
Answer in 1–4 short sentences, warm and plain, no markdown. Only use the facts above; if you don't know, say a leader will reply soon. Never ask for passwords, ID numbers or bank details. For prayer requests, point to ${f.site}/prayer. For pastoral or urgent needs, say a leader will reach out.`,
      messages: [{ role: "user", content: question.slice(0, 1000) }],
    }),
  });
  if (!res.ok) return null;
  const j = await res.json() as { content?: { type: string; text?: string }[] };
  return j.content?.find((c) => c.type === "text")?.text?.trim() || null;
}

export { reasonLabel, uuid };
