// Discipleship classes: verified pastors and the main admin schedule them (in person, or online in the church's own
// video room) and nobody else can change them. The page shows "Coming soon" until a pastor or the main admin opens them.
//
// The video room is peer to peer (WebRTC) between the people in the class; this Worker only passes the connection
// messages along, so no video ever goes through the server. With notes switched on (everyone in the room sees it),
// each person's own microphone is turned into text with Workers AI; when the class ends the notes are summarised and
// emailed as a PDF to everyone who joined online. Visitors (guest sign-in) can't join (CLAUDE.md rule 9).
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { canTeach, getSession, requireAdmin, type Session } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { uuid, b64 } from "../lib/crypto.ts";
import { sendMail } from "../lib/email.ts";
import { notesPdf } from "../lib/pdf.ts";
import * as T from "../emails/templates.ts";

type Ctx = { waitUntil(p: Promise<unknown>): void } | undefined;
const TRACKS: Record<string, string> = { foundations: "Foundations", baptism: "Baptism", growing: "Growing", serving: "Serving" };
const TZ = "Africa/Johannesburg";
const HERE_MS = 25_000;   // someone counts as "in the room" if their browser checked in within this time

export interface ClassRow {
  id: string; track: string; title: string; starts_at: string; minutes: number; mode: string; location: string | null; details: string | null;
  status: string; notes_on: number; summary: string | null; notes_sent: string | null; created_by: string; ended_at: string | null;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
/** "2026-11-05T18:00" typed in South Africa → ISO (SAST has no daylight saving). */
export function sastToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new HttpError(422, "Please choose the date and time.");
  const d = new Date(`${local}:00+02:00`);
  if (Number.isNaN(d.getTime())) throw new HttpError(422, "Please choose the date and time.");
  return d.toISOString();
}

async function status(env: Env): Promise<"soon" | "open"> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'discipleship_status'").first<{ value: string }>();
  return r?.value === "open" ? "open" : "soon";
}
async function getClass(env: Env, id: string): Promise<ClassRow> {
  const c = await env.DB.prepare("SELECT * FROM dc_classes WHERE id = ?").bind(id).first<ClassRow>();
  if (!c) throw new HttpError(404, "That class wasn't found.");
  return c;
}
async function signedUp(env: Env, s: Session): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM discipleship_signups WHERE user_id = ? OR lower(email) = lower(?) LIMIT 1").bind(s.user.id, s.user.email).first());
}
async function displayName(env: Env, s: Session): Promise<string> {
  const m = await env.DB.prepare("SELECT COALESCE(preferred_name, first_name) || ' ' || last_name AS n FROM members WHERE user_id = ? AND status != 'revoked' LIMIT 1").bind(s.user.id).first<{ n: string | null }>();
  return String(m?.n || s.user.name || s.user.given_name || s.user.email.split("@")[0]).trim().slice(0, 60);
}
/** Who may be in an online class: pastors, the main admin, and signed-in members who signed up for discipleship. */
async function mayJoin(env: Env, s: Session | null, c: ClassRow): Promise<boolean> {
  if (!s || s.visitor) return false;
  if (canTeach(s)) return true;
  if (c.mode !== "online" || c.status === "cancelled") return false;
  return signedUp(env, s);
}
const ok = (req: Request) => { if (!trustedWrite(req)) throw new HttpError(403, "Missing request header."); };
async function signedIn(env: Env, req: Request): Promise<Session> {
  const s = await getSession(env, req);
  if (!s) throw new HttpError(401, "Please sign in first.");
  if (s.visitor) throw new HttpError(403, "Discipleship classes are for church members. Join the church family first.");
  return s;
}
async function teacher(env: Env, req: Request): Promise<Session> {
  const s = await signedIn(env, req);
  if (!canTeach(s)) throw new HttpError(403, "Only pastors and the main admin can run discipleship classes.");
  return s;
}

/** STUN always; TURN too when the church adds a Cloudflare Realtime TURN key (for strict office or mobile networks). */
async function iceServers(env: Env) {
  const list: unknown[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: "POST", headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 6 * 3600 }),
      });
      if (r.ok) { const d = await r.json() as { iceServers?: unknown[] }; if (d.iceServers?.length) return d.iceServers; }
    } catch { /* STUN only */ }
  }
  return list;
}

function publicClass(c: ClassRow) {
  return { id: c.id, track: c.track, track_label: TRACKS[c.track] || c.track, title: c.title, starts_at: c.starts_at, when: when(c.starts_at), minutes: c.minutes,
    mode: c.mode, location: c.location, details: c.details, status: c.status, notes_on: !!c.notes_on, has_notes: !!c.summary };
}

async function people(env: Env, id: string) {
  const since = new Date(Date.now() - HERE_MS).toISOString();
  const { results } = await env.DB.prepare(`SELECT a.user_id AS id, a.name, EXISTS (SELECT 1 FROM pastors p WHERE p.user_id = a.user_id) AS pastor
      FROM dc_attendance a WHERE a.class_id = ? AND a.left_at IS NULL AND a.seen_at >= ? ORDER BY a.joined_at`).bind(id, since).all<{ id: string; name: string; pastor: number }>();
  return results.map((r) => ({ ...r, pastor: !!r.pastor }));
}

// ---------------------------------------------------------------- notes: speech to text and the end-of-class summary
async function transcribe(env: Env, wav: Uint8Array): Promise<string> {
  if (!env.AI) throw new HttpError(503, "Notes aren't available right now.");
  try {
    const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: b64(wav), language: "en", vad_filter: true }) as { text?: string };
    return String(out?.text || "").trim();
  } catch {
    const out = await env.AI.run("@cf/openai/whisper", { audio: [...wav] }) as { text?: string };
    return String(out?.text || "").trim();
  }
}

interface Summary { summary: string; points: string[]; scriptures: string[]; actions: string[]; questions: string[] }
const strList = (v: unknown, n = 8) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n).map((x) => x.slice(0, 300)) : []);

async function ask(env: Env, system: string, user: string): Promise<string> {
  const out = await env.AI!.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 1200, temperature: 0.2 }) as { response?: unknown };
  return typeof out?.response === "string" ? out.response : JSON.stringify(out?.response ?? "");
}
export async function summarise(env: Env, title: string, lines: string[]): Promise<Summary> {
  const empty: Summary = { summary: "", points: [], scriptures: [], actions: [], questions: [] };
  if (!env.AI || !lines.length) return empty;
  // Long classes: summarise in parts first, then bring the parts together.
  const parts: string[] = [];
  let cur = "";
  for (const l of lines) { if ((cur + l).length > 24_000 && cur) { parts.push(cur); cur = ""; } cur += l + "\n"; }
  if (cur) parts.push(cur);
  let material = parts[0];
  if (parts.length > 1) {
    const notes: string[] = [];
    for (const part of parts.slice(0, 6)) notes.push(await ask(env, "You take careful notes of a church discipleship class. Write the main teaching points, every Bible reference mentioned, and any practical steps, as short plain bullet points.", part).catch(() => ""));
    material = notes.join("\n");
  }
  const sys = `You write the notes for a Christian discipleship class at AOG Sandton City Church (Assemblies of God, South Africa). Use only what was said; never invent scriptures or teaching. South African English, warm and plain. Reply with JSON only:
{"summary":"3-5 sentences","points":["key teaching points"],"scriptures":["Bible references mentioned, e.g. John 3:16"],"actions":["practical steps for the week"],"questions":["questions to reflect on"]}`;
  const raw = await ask(env, sys, `Class: ${title}\n\n${material.slice(0, 26_000)}`).catch(() => "");
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    return { summary: String(j.summary || "").trim().slice(0, 1500), points: strList(j.points, 10), scriptures: strList(j.scriptures, 12), actions: strList(j.actions, 6), questions: strList(j.questions, 5) };
  } catch { return { ...empty, summary: raw.trim().slice(0, 1500) }; }
}

async function teacherName(env: Env, c: ClassRow): Promise<string> {
  const t = await env.DB.prepare(`SELECT COALESCE(p.title || ' ', '') || COALESCE(m.preferred_name, m.first_name, u.given_name, u.name, 'the pastor') AS n
      FROM users u LEFT JOIN pastors p ON p.user_id = u.id LEFT JOIN members m ON m.user_id = u.id WHERE u.id = ?`).bind(c.created_by).first<{ n: string }>();
  return t?.n?.trim() || "the pastor";
}
export async function buildNotes(env: Env, c: ClassRow) {
  const { results: said } = await env.DB.prepare("SELECT name, said_at, text FROM dc_transcript WHERE class_id = ? ORDER BY said_at").bind(c.id).all<{ name: string; said_at: string; text: string }>();
  const { results: att } = await env.DB.prepare("SELECT name FROM dc_attendance WHERE class_id = ? ORDER BY joined_at").bind(c.id).all<{ name: string }>();
  let s: Summary;
  try { s = c.summary ? JSON.parse(c.summary) as Summary : await summarise(env, c.title, said.map((t) => `${t.name}: ${t.text}`)); }
  catch { s = { summary: "", points: [], scriptures: [], actions: [], questions: [] }; }
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const pdf = notesPdf({ title: c.title, when: when(c.starts_at), teacher: await teacherName(env, c), attendees: att.map((a) => a.name), ...s,
    transcript: said.map((t) => ({ name: t.name, time: time(t.said_at), text: t.text })) });
  return { summary: s, pdf, said: said.length };
}

/** After an online class: summarise, make the PDF and email it to everyone who joined (once). */
export async function sendNotes(env: Env, id: string): Promise<number> {
  const c = await getClass(env, id);
  if (c.notes_sent) return 0;
  const { summary, pdf, said } = await buildNotes(env, c);
  if (!said) return 0;
  await env.DB.prepare("UPDATE dc_classes SET summary = ?, notes_sent = ? WHERE id = ? AND notes_sent IS NULL").bind(JSON.stringify(summary), new Date().toISOString(), id).run();
  const { results } = await env.DB.prepare(`SELECT DISTINCT u.email, COALESCE(u.given_name, a.name) AS first FROM dc_attendance a JOIN users u ON u.id = a.user_id
      WHERE a.class_id = ? AND COALESCE(u.visitor, 0) = 0`).bind(id).all<{ email: string; first: string }>();
  const attachment = { filename: `class-notes-${c.starts_at.slice(0, 10)}.pdf`, type: "application/pdf", disposition: "attachment" as const, content: b64(pdf) };
  const teacherN = await teacherName(env, c);
  let n = 0;
  for (const r of results) {
    const mail = T.classNotes({ site: siteUrl(env) }, { name: String(r.first || "friend").split(" ")[0], title: c.title, when: when(c.starts_at), teacher: teacherN, summary: summary.summary, url: `${siteUrl(env)}/class?id=${c.id}` });
    if (await sendMail(env, { to: r.email, ...mail, attachments: [attachment], template: "class_notes" })) n++;
  }
  return n;
}

export function classRoutes(router: Router, env: Env): void {
  // ---------- the public page: "Coming soon", or the upcoming classes ----------
  router.get("/api/classes", async (req) => {
    const s = await getSession(env, req);
    const st = await status(env);
    const teach = canTeach(s);
    const show = st === "open" || teach;
    const { results } = show ? await env.DB.prepare(`SELECT * FROM dc_classes WHERE status != 'cancelled' AND (status != 'ended' OR ended_at >= ?)
        ORDER BY starts_at LIMIT 30`).bind(new Date(Date.now() - 14 * 86400_000).toISOString()).all<ClassRow>() : { results: [] as ClassRow[] };
    const joined = s && !s.visitor ? new Set((await env.DB.prepare("SELECT class_id FROM dc_attendance WHERE user_id = ?").bind(s.user.id).all<{ class_id: string }>()).results.map((r) => r.class_id)) : new Set<string>();
    const up = s && !s.visitor ? teach || await signedUp(env, s) : false;
    return json({ ok: true, status: st, can_teach: teach, signed_up: up,
      classes: results.map((c) => ({ ...publicClass(c), joined: joined.has(c.id), can_join: c.mode === "online" && (teach || (up && c.status === "live")) })) });
  });

  router.get("/api/classes/:id", async (req, { id }) => {
    const s = await getSession(env, req);
    const c = await getClass(env, id);
    if (c.status === "cancelled" && !canTeach(s)) throw new HttpError(404, "That class was cancelled.");
    const may = await mayJoin(env, s, c);
    // While classes are "coming soon", only pastors and members who signed up can open a class link.
    if ((await status(env)) === "soon" && !may) throw new HttpError(404, "Discipleship classes are coming soon.");
    const joined = s ? !!(await env.DB.prepare("SELECT 1 FROM dc_attendance WHERE class_id = ? AND user_id = ?").bind(id, s.user.id).first()) : false;
    return json({ ok: true, class: publicClass(c), signed_in: !!s && !s.visitor, may_join: may, is_teacher: canTeach(s), joined, notes_pdf: !!c.summary && (joined || canTeach(s)) });
  });

  // ---------- the video room ----------
  router.post("/api/classes/:id/join", async (req, { id }) => {
    ok(req);
    const s = await signedIn(env, req);
    const c = await getClass(env, id);
    if (c.mode !== "online") throw new HttpError(422, "This class meets in person.");
    if (c.status === "cancelled" || c.status === "ended") throw new HttpError(409, "This class has finished.");
    if (!(await mayJoin(env, s, c))) throw new HttpError(403, "Sign up for discipleship classes first, then you can join online classes.");
    const teach = canTeach(s);
    if (c.status !== "live") {
      if (!teach) throw new HttpError(409, "The class hasn't started yet. The pastor opens the room a few minutes before.");
      await env.DB.prepare("UPDATE dc_classes SET status = 'live' WHERE id = ?").bind(id).run();
    }
    const name = await displayName(env, s);
    await env.DB.prepare(`INSERT INTO dc_attendance (class_id, user_id, name) VALUES (?,?,?)
        ON CONFLICT (class_id, user_id) DO UPDATE SET seen_at = excluded.seen_at, left_at = NULL, name = excluded.name`).bind(id, s.user.id, name).run();
    // Old connection messages for me (from an earlier tab) would only confuse the new connection.
    await env.DB.prepare("DELETE FROM dc_signals WHERE class_id = ?1 AND (to_id = ?2 OR from_id = ?2)").bind(id, s.user.id).run();
    const fresh = await getClass(env, id);
    return json({ ok: true, me: { id: s.user.id, name, teacher: teach, pastor: !!s.pastor }, ice: await iceServers(env), people: (await people(env, id)).filter((p) => p.id !== s.user.id), class: publicClass(fresh) });
  });

  router.get("/api/classes/:id/poll", async (req, { id }) => {
    const s = await signedIn(env, req);
    const now = new Date();
    // Check in (only writes when the last check-in is older than 8 seconds).
    const r = await env.DB.prepare("UPDATE dc_attendance SET seen_at = ? WHERE class_id = ? AND user_id = ? AND left_at IS NULL AND seen_at < ?")
      .bind(now.toISOString(), id, s.user.id, new Date(now.getTime() - 8000).toISOString()).run();
    void r;
    const c0 = await getClass(env, id);
    if (c0.status === "ended" || c0.status === "cancelled") return json({ ok: true, status: "ended", notes_on: false, people: [], signals: [] });
    const inRoom = await env.DB.prepare("SELECT 1 FROM dc_attendance WHERE class_id = ? AND user_id = ? AND left_at IS NULL").bind(id, s.user.id).first();
    if (!inRoom) throw new HttpError(409, "You've left the class.");
    const { results: sig } = await env.DB.prepare("SELECT id, from_id AS 'from', kind, body FROM dc_signals WHERE class_id = ? AND to_id = ? ORDER BY created_at LIMIT 20").bind(id, s.user.id).all<{ id: string; from: string; kind: string; body: string }>();
    if (sig.length) await env.DB.batch(sig.map((x) => env.DB.prepare("DELETE FROM dc_signals WHERE id = ?").bind(x.id)));
    return json({ ok: true, status: c0.status, notes_on: !!c0.notes_on, people: (await people(env, id)).filter((p) => p.id !== s.user.id), signals: sig });
  });

  router.post("/api/classes/:id/signal", async (req, { id }) => {
    ok(req);
    const s = await signedIn(env, req);
    const b = await readJson<{ to?: string; kind?: string; sdp?: string }>(req);
    const kind = b.kind === "answer" ? "answer" : b.kind === "offer" ? "offer" : null;
    const sdp = String(b.sdp || "");
    if (!kind || !sdp.startsWith("v=0") || sdp.length > 30_000) throw new HttpError(422, "That didn't look like a video connection.");
    // Both people must be in the room right now.
    const since = new Date(Date.now() - HERE_MS).toISOString();
    const { results } = await env.DB.prepare("SELECT user_id FROM dc_attendance WHERE class_id = ? AND user_id IN (?, ?) AND left_at IS NULL AND seen_at >= ?").bind(id, s.user.id, String(b.to || ""), since).all();
    if (results.length !== 2) throw new HttpError(409, "They've left the class.");
    await rateLimit(env, "dc-signal", s.user.id, 120, 60);
    await env.DB.prepare("INSERT INTO dc_signals (id, class_id, from_id, to_id, kind, body) VALUES (?,?,?,?,?,?)").bind(uuid(), id, s.user.id, String(b.to), kind, sdp).run();
    return json({ ok: true });
  });

  router.post("/api/classes/:id/leave", async (req, { id }) => {
    ok(req);
    const s = await signedIn(env, req);
    await env.DB.prepare("UPDATE dc_attendance SET left_at = ? WHERE class_id = ? AND user_id = ?").bind(new Date().toISOString(), id, s.user.id).run();
    return json({ ok: true });
  });

  // ---------- notes ----------
  router.post("/api/classes/:id/notes", async (req, { id }) => {
    ok(req);
    await teacher(env, req);
    const b = await readJson<{ on?: boolean }>(req);
    const c = await getClass(env, id);
    if (c.status !== "live") throw new HttpError(409, "Notes can only be switched on while the class is live.");
    await env.DB.prepare("UPDATE dc_classes SET notes_on = ? WHERE id = ?").bind(b.on ? 1 : 0, id).run();
    return json({ ok: true, notes_on: !!b.on });
  });

  // A short recording (16 kHz mono WAV) of the sender's own microphone while notes are on.
  router.post("/api/classes/:id/notes/chunk", async (req, { id }) => {
    ok(req);
    const s = await signedIn(env, req);
    const c = await getClass(env, id);
    if (c.status !== "live" || !c.notes_on) return json({ ok: true, skipped: true });
    const a = await env.DB.prepare("SELECT name FROM dc_attendance WHERE class_id = ? AND user_id = ? AND left_at IS NULL").bind(id, s.user.id).first<{ name: string }>();
    if (!a) throw new HttpError(403, "Join the class first.");
    await rateLimit(env, "dc-notes", s.user.id, 8, 60);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length < 44 || buf.length > 1_600_000 || String.fromCharCode(...buf.slice(0, 4)) !== "RIFF") throw new HttpError(422, "That recording couldn't be read.");
    const at = Number(req.headers.get("x-said-at")) || Date.now();
    const said = new Date(Math.min(Date.now(), Math.max(Date.now() - 10 * 60_000, at))).toISOString();
    const text = await transcribe(env, buf).catch(() => "");
    // Whisper sometimes "hears" these in silence; they aren't worth keeping.
    if (!text || /^(thank you\.?|thanks for watching!?|you|\.+|bye\.?)$/i.test(text)) return json({ ok: true, text: "" });
    await env.DB.prepare("INSERT INTO dc_transcript (id, class_id, user_id, name, said_at, text) VALUES (?,?,?,?,?,?)").bind(uuid(), id, s.user.id, a.name, said, text.slice(0, 4000)).run();
    return json({ ok: true, text });
  });

  router.post("/api/classes/:id/end", async (req, { id }, ctx?: Ctx) => {
    ok(req);
    await teacher(env, req);
    const c = await getClass(env, id);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE dc_classes SET status = 'ended', notes_on = 0, ended_at = COALESCE(ended_at, ?) WHERE id = ?").bind(now, id),
      env.DB.prepare("UPDATE dc_attendance SET left_at = COALESCE(left_at, ?) WHERE class_id = ?").bind(now, id),
      env.DB.prepare("DELETE FROM dc_signals WHERE class_id = ?").bind(id),
    ]);
    const has = await env.DB.prepare("SELECT COUNT(*) AS n FROM dc_transcript WHERE class_id = ?").bind(id).first<{ n: number }>();
    if (has?.n && !c.notes_sent) {
      const job = sendNotes(env, id).catch((e) => console.error("class notes", e));
      if (typeof ctx?.waitUntil === "function") ctx.waitUntil(job); else await job;
    }
    return json({ ok: true, notes: !!has?.n });
  });

  router.get("/api/classes/:id/notes.pdf", async (req, { id }) => {
    const s = await signedIn(env, req);
    const c = await getClass(env, id);
    const joined = await env.DB.prepare("SELECT 1 FROM dc_attendance WHERE class_id = ? AND user_id = ?").bind(id, s.user.id).first();
    if (!joined && !canTeach(s)) throw new HttpError(403, "Class notes are only for the people who joined the class.");
    if (!c.summary) throw new HttpError(404, "The notes for this class aren't ready yet.");
    const { pdf } = await buildNotes(env, c);
    return new Response(pdf as unknown as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="class-notes-${c.starts_at.slice(0, 10)}.pdf"`, "Cache-Control": "private, no-store" } });
  });

  // ---------- managing classes: verified pastors and the main admin only ----------
  const manage = async (req: Request): Promise<Session> => {
    const s = await requireAdmin(env, req);   // pastors carry the "discipleship" part automatically
    if (!canTeach(s)) throw new HttpError(403, "Only pastors and the main admin can manage discipleship classes.");
    if (req.method !== "GET" && !trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    return s;
  };
  router.get("/api/admin/discipleship", async (req) => {
    await manage(req);
    const { results: classes } = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM dc_attendance a WHERE a.class_id = c.id) AS joined,
        (SELECT COUNT(*) FROM dc_transcript t WHERE t.class_id = c.id) AS said FROM dc_classes c ORDER BY c.starts_at DESC LIMIT 60`).all<ClassRow & { joined: number; said: number }>();
    const { results: signups } = await env.DB.prepare("SELECT id, name, email, phone, track, note, status, created_at FROM discipleship_signups ORDER BY created_at DESC LIMIT 200").all();
    return json({ ok: true, status: await status(env), tracks: TRACKS, classes: classes.map((c) => ({ ...publicClass(c), joined: c.joined, said: c.said, notes_sent: c.notes_sent })), signups });
  });
  router.put("/api/admin/discipleship/status", async (req) => {
    const s = await manage(req);
    const b = await readJson<{ status?: string }>(req);
    const v = b.status === "open" ? "open" : "soon";
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('discipleship_status', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(v).run();
    void s;
    return json({ ok: true, status: v });
  });
  const readClass = async (req: Request) => {
    const b = await readJson<Record<string, unknown>>(req);
    const title = String(b.title || "").trim().slice(0, 120);
    if (!title) throw new HttpError(422, "Give the class a title.");
    const track = TRACKS[String(b.track)] ? String(b.track) : "foundations";
    const mode = b.mode === "in_person" ? "in_person" : "online";
    const minutes = Math.min(240, Math.max(15, Number(b.minutes) || 60));
    const location = mode === "in_person" ? String(b.location || "").trim().slice(0, 160) || "Sandton City Church" : null;
    return { title, track, mode, minutes, location, details: String(b.details || "").trim().slice(0, 1000) || null, starts_at: sastToIso(String(b.starts_local || "")) };
  };
  router.post("/api/admin/discipleship/classes", async (req) => {
    const s = await manage(req);
    const c = await readClass(req);
    const id = uuid();
    await env.DB.prepare("INSERT INTO dc_classes (id, track, title, starts_at, minutes, mode, location, details, created_by) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, c.track, c.title, c.starts_at, c.minutes, c.mode, c.location, c.details, s.user.id).run();
    return json({ ok: true, id }, 201);
  });
  router.patch("/api/admin/discipleship/classes/:id", async (req, { id }) => {
    const s = await manage(req);
    const old = await getClass(env, id);
    if (old.status === "ended") throw new HttpError(409, "That class has already happened.");
    const c = await readClass(req);
    await env.DB.prepare("UPDATE dc_classes SET track = ?, title = ?, starts_at = ?, minutes = ?, mode = ?, location = ?, details = ?, updated_by = ? WHERE id = ?")
      .bind(c.track, c.title, c.starts_at, c.minutes, c.mode, c.location, c.details, s.user.id, id).run();
    return json({ ok: true });
  });
  router.delete("/api/admin/discipleship/classes/:id", async (req, { id }) => {
    await manage(req);
    const c = await getClass(env, id);
    if (c.status === "ended") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM dc_transcript WHERE class_id = ?").bind(id), env.DB.prepare("DELETE FROM dc_attendance WHERE class_id = ?").bind(id),
        env.DB.prepare("DELETE FROM dc_signals WHERE class_id = ?").bind(id), env.DB.prepare("DELETE FROM dc_classes WHERE id = ?").bind(id),
      ]);
      return json({ ok: true, deleted: true });
    }
    await env.DB.prepare("UPDATE dc_classes SET status = 'cancelled', notes_on = 0 WHERE id = ?").bind(id).run();
    return json({ ok: true, cancelled: true });
  });
  // Send the notes again (e.g. after notes were switched on late): resend to everyone who joined.
  router.post("/api/admin/discipleship/classes/:id/notes", async (req, { id }) => {
    await manage(req);
    const c = await getClass(env, id);
    if (c.status !== "ended") throw new HttpError(409, "End the class first.");
    await env.DB.prepare("UPDATE dc_classes SET notes_sent = NULL, summary = NULL WHERE id = ?").bind(id).run();
    return json({ ok: true, sent: await sendNotes(env, id) });
  });

  // ---------- verified pastors: the main admin only, members only ----------
  router.get("/api/admin/pastors", async (req) => {
    const s = await requireAdmin(env, req);
    if (s.role !== "super") throw new HttpError(403, "Only the main church admin can do this.");
    const { results } = await env.DB.prepare(`SELECT p.user_id, p.title, p.created_at, u.email, u.picture, COALESCE(m.preferred_name || ' ' || m.last_name, m.first_name || ' ' || m.last_name, u.name, u.email) AS name
        FROM pastors p JOIN users u ON u.id = p.user_id LEFT JOIN members m ON m.user_id = u.id GROUP BY p.user_id ORDER BY name`).all();
    return json({ ok: true, pastors: results });
  });
  router.post("/api/admin/pastors", async (req) => {
    const s = await requireAdmin(env, req);
    if (s.role !== "super") throw new HttpError(403, "Only the main church admin can verify pastors.");
    ok(req);
    const b = await readJson<{ user_id?: string; title?: string }>(req);
    const u = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(String(b.user_id || "")).first<{ id: string; email: string }>();
    if (!u) throw new HttpError(404, "That person needs to sign in on the website once first.");
    if (u.email.toLowerCase() === s.user.email.toLowerCase()) throw new HttpError(422, "The main admin account can't be a pastor. Use the pastor's own account.");
    const member = await env.DB.prepare("SELECT 1 FROM members WHERE (user_id = ? OR lower(email) = lower(?)) AND status != 'revoked' LIMIT 1").bind(u.id, u.email).first();
    if (!member) throw new HttpError(422, "Only registered members can be verified as pastors. Ask them to join the church first.");
    const title = String(b.title || "Pastor").trim().slice(0, 40) || "Pastor";
    await env.DB.prepare("INSERT INTO pastors (user_id, title, verified_by) VALUES (?,?,?) ON CONFLICT (user_id) DO UPDATE SET title = excluded.title").bind(u.id, title, s.user.email).run();
    return json({ ok: true });
  });
  router.delete("/api/admin/pastors/:userId", async (req, { userId }) => {
    const s = await requireAdmin(env, req);
    if (s.role !== "super") throw new HttpError(403, "Only the main church admin can do this.");
    ok(req);
    await env.DB.prepare("DELETE FROM pastors WHERE user_id = ?").bind(userId).run();
    return json({ ok: true });
  });
}
