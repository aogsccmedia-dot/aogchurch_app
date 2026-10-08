import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { Validator, ageOn, formToRaw } from "../lib/validate.ts";
import { rateLimit, ipHash } from "../lib/ratelimit.ts";
import { b64, refCode, uuid } from "../lib/crypto.ts";
import { activeDriver, getFile } from "../lib/storage.ts";
import { readUpload, storeFiles, type PendingFile } from "../lib/uploads.ts";
import { getSession, isAdminEmail } from "../lib/auth.ts";
import { parseSchema, validateAnswers } from "../lib/forms.ts";
import { sendMail } from "../lib/email.ts";
import { confirmSubscription, subscribe, unsubscribe } from "../lib/newsletter.ts";
import { calendarUrl, formatWhen, icsFile, outlookUrl } from "../lib/time.ts";
import * as T from "../emails/templates.ts";
import {
  AVAILABILITY, GENDERS, HEARD_ABOUT, MEMBERSHIP_TYPES, MINISTRIES, OCCUPATION,
  PUBLIC_SETTINGS, SALVATION, YES_NO_WANT,
} from "../constants.ts";

const redirect = (url: string) => new Response(null, { status: 303, headers: { Location: url } });

interface EventRow {
  id: string; slug: string; title: string; category: string; description: string | null; starts_at: string; ends_at: string | null;
  location: string | null; is_published: number; rsvp_enabled: number; cover_attachment_id: string | null; form_schema: string;
  capacity: number | null; registration_closes_at: string | null; confirmation_message: string | null; collect_phone: number;
  cover_image: string | null; price_label: string | null;
}

async function eventCounts(env: Env, id: string) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(1 + guests), 0) AS people FROM event_registrations WHERE event_id = ? AND status = 'confirmed'",
  ).bind(id).first<{ n: number; people: number }>();
  return { registered: r?.n ?? 0, people: r?.people ?? 0 };
}

function publicEvent(e: EventRow, counts: { registered: number }) {
  const closed = !e.rsvp_enabled || (e.registration_closes_at ? e.registration_closes_at < new Date().toISOString() : false) || e.starts_at < new Date(Date.now() - 3 * 3600_000).toISOString();
  return {
    id: e.id, slug: e.slug, title: e.title, category: e.category, description: e.description, starts_at: e.starts_at, ends_at: e.ends_at,
    location: e.location, cover_url: e.cover_attachment_id ? `/api/media/${e.cover_attachment_id}` : e.cover_image || null, price_label: e.price_label,
    registration_open: !closed, capacity: e.capacity, spots_left: e.capacity ? Math.max(0, e.capacity - counts.registered) : null,
    collect_phone: !!e.collect_phone,
  };
}

export function publicRoutes(router: Router, env: Env): void {
  router.get("/api/health", async () => {
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    let storage = "none"; try { storage = activeDriver(env); } catch { /* none */ }
    return json({ ok: true, db: row?.ok === 1, storage, email: !!env.EMAIL, google: !!env.GOOGLE_CLIENT_ID });
  });

  router.get("/api/settings", async () => {
    const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${PUBLIC_SETTINGS.map(() => "?").join(",")})`)
      .bind(...PUBLIC_SETTINGS).all<{ key: string; value: string }>();
    const settings = Object.fromEntries(results.map((r) => [r.key, r.value]));
    return json({ ok: true, settings, google_client_id: env.GOOGLE_CLIENT_ID || null }, 200, { "Cache-Control": "public, max-age=60" });
  });

  // Public images (event covers only)
  router.get("/api/media/:id", async (_req, { id }) => {
    const att = await env.DB.prepare("SELECT storage_driver, storage_key, content_type FROM attachments WHERE id = ? AND owner_type = 'event' AND kind = 'image'")
      .bind(id).first<{ storage_driver: string; storage_key: string; content_type: string }>();
    if (!att) throw new HttpError(404, "Not found.");
    const obj = await getFile(env, att.storage_driver, att.storage_key);
    if (!obj) throw new HttpError(404, "Not found.");
    return new Response(obj.body, { headers: { "Content-Type": att.content_type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  });

  // ---------------- events
  router.get("/api/events", async () => {
    const { results } = await env.DB.prepare(
      `SELECT * FROM events WHERE is_published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at ASC LIMIT 24`,
    ).bind(new Date(Date.now() - 3 * 3600_000).toISOString()).all<EventRow>();
    const events = await Promise.all(results.map(async (e) => publicEvent(e, await eventCounts(env, e.id))));
    return json({ ok: true, events }, 200, { "Cache-Control": "public, max-age=30" });
  });

  router.get("/api/events/:slug", async (req, { slug }) => {
    const e = await env.DB.prepare("SELECT * FROM events WHERE (slug = ? OR id = ?) AND is_published = 1").bind(slug, slug).first<EventRow>();
    if (!e) throw new HttpError(404, "We couldn't find that event.");
    const session = await getSession(env, req);
    let mine = null;
    if (session) {
      mine = await env.DB.prepare("SELECT ref_code, status FROM event_registrations WHERE event_id = ? AND email = ? AND status != 'cancelled'")
        .bind(e.id, session.user.email).first();
    }
    return json({ ok: true, event: { ...publicEvent(e, await eventCounts(env, e.id)), form: parseSchema(e.form_schema), calendar_url: calendarUrl(e), outlook_url: outlookUrl(e),
      ics_url: `/api/events/${encodeURIComponent(e.slug)}/calendar.ics` }, mine });
  });

  router.get("/api/events/:slug/calendar.ics", async (_req, { slug }) => {
    const e = await env.DB.prepare("SELECT * FROM events WHERE (slug = ? OR id = ?) AND is_published = 1").bind(slug, slug).first<EventRow>();
    if (!e) throw new HttpError(404, "We couldn't find that event.");
    return new Response(icsFile({ ...e, url: `${siteUrl(env)}/event?e=${encodeURIComponent(e.slug)}` }), { headers: {
      "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${e.slug}.ics"`, "Cache-Control": "public, max-age=300" } });
  });

  router.post("/api/events/:slug/register", async (req, { slug }) => {
    const ip = clientIp(req);
    await rateLimit(env, "register", ip, 12, 3600);
    const e = await env.DB.prepare("SELECT * FROM events WHERE (slug = ? OR id = ?) AND is_published = 1").bind(slug, slug).first<EventRow>();
    if (!e) throw new HttpError(404, "We couldn't find that event.");
    const counts = await eventCounts(env, e.id);
    if (!publicEvent(e, counts).registration_open) throw new HttpError(409, "Registration for this event is closed.");
    const fd = await req.formData();
    if (fd.get("website")) return json({ ok: true, status: "confirmed", ref: "THANKS" }, 201);

    const session = await getSession(env, req);
    const v = new Validator(formToRaw(fd));
    const name = v.text("name", { required: true, max: 120, label: "Your name" });
    const email = session ? session.user.email : v.email("email", true);
    const phone = v.phone("phone", !!e.collect_phone);
    const guests = Math.max(0, Math.min(10, Number(fd.get("guests")) || 0));
    let answers: Record<string, unknown> = {};
    let fileAnswers: { field: string; file: File }[] = [];
    try { ({ answers, files: fileAnswers } = validateAnswers(parseSchema(e.form_schema), fd)); }
    catch (err) { if (err instanceof HttpError) Object.assign(v.errors, err.details as object); else throw err; }
    v.assert();

    const dupe = await env.DB.prepare("SELECT ref_code, status FROM event_registrations WHERE event_id = ? AND email = ? AND status != 'cancelled'")
      .bind(e.id, email).first<{ ref_code: string; status: string }>();
    if (dupe) return json({ ok: true, status: dupe.status, ref: dupe.ref_code, already: true });

    const status = e.capacity && counts.people + 1 + guests > e.capacity ? "waitlist" : "confirmed";
    const id = uuid();
    const ref = refCode().replace("SCCY", "EVT");
    const pending: PendingFile[] = [];
    for (const fa of fileAnswers) pending.push(await readUpload(env, fa.file, "answer", fa.field));
    const stored = pending.length ? await storeFiles(env, "registration", id, pending) : { stmts: [], rollback: async () => [] };
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO event_registrations (id, event_id, user_id, ref_code, name, email, phone, guests, answers, status, ip_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id, e.id, session?.user.id ?? null, ref, name, email, phone, guests, JSON.stringify(answers), status, await ipHash(ip)),
        ...stored.stmts,
      ]);
    } catch (err) { await stored.rollback(); throw err; }

    const m = T.eventConfirmation({ site: siteUrl(env) }, {
      name: name!.split(" ")[0], status, ref, title: e.title, when: formatWhen(e.starts_at, e.ends_at), location: e.location,
      message: e.confirmation_message, calendarUrl: calendarUrl(e), eventUrl: `${siteUrl(env)}/event?e=${encodeURIComponent(e.slug)}`,
      price: e.price_label, cover: e.cover_image ? `${siteUrl(env)}${e.cover_image}` : null, outlookUrl: outlookUrl(e),
      icsUrl: `${siteUrl(env)}/api/events/${encodeURIComponent(e.slug)}/calendar.ics`,
    });
    const eventUrl = `${siteUrl(env)}/event?e=${encodeURIComponent(e.slug)}`;
    await sendMail(env, { to: email!, toName: name!, ...m, template: "event_confirmation",
      attachments: status === "confirmed" ? [{ filename: `${e.slug}.ics`, type: "text/calendar", disposition: "attachment", content: b64(new TextEncoder().encode(icsFile({ ...e, url: eventUrl }))) }] : undefined });
    return json({ ok: true, status, ref, message: e.confirmation_message }, 201);
  });

  // ---------------- join (membership onboarding)
  router.post("/api/join", async (req) => {
    const ip = clientIp(req);
    await rateLimit(env, "join", ip, 6, 3600);
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) throw new HttpError(415, "Expected a form upload.");
    const fd = await req.formData();
    const raw = formToRaw(fd);
    if (raw.website) return json({ ok: true, ref: "SCCY-THANKS" }, 201);
    const session = await getSession(env, req);
    if (session && isAdminEmail(env, session.user.email)) throw new HttpError(400, "The admin account doesn't need to fill in the join form.");

    const v = new Validator(raw);
    const m = {
      membership_type: v.oneOf("membership_type", MEMBERSHIP_TYPES, { required: true, label: "Membership type" }),
      first_name: v.text("first_name", { required: true, max: 80, label: "First name" }),
      last_name: v.text("last_name", { required: true, max: 80, label: "Surname" }),
      preferred_name: v.text("preferred_name", { max: 80 }),
      date_of_birth: v.date("date_of_birth", { required: true, label: "Date of birth" }),
      gender: v.oneOf("gender", GENDERS),
      phone: v.phone("phone", true),
      whatsapp_same: v.bool("whatsapp_same"),
      whatsapp: null as string | null,
      email: session ? session.user.email : v.email("email", true),
      suburb: v.text("suburb", { max: 120 }),
      city: v.text("city", { max: 120 }),
      address: v.text("address", { max: 300 }),
      occupation_status: v.oneOf("occupation_status", OCCUPATION),
      institution: v.text("institution", { max: 160 }),
      grade_or_role: v.text("grade_or_role", { max: 120 }),
      salvation_status: v.oneOf("salvation_status", SALVATION),
      salvation_year: v.text("salvation_year", { max: 10 }),
      water_baptised: v.oneOf("water_baptised", YES_NO_WANT),
      spirit_baptised: v.oneOf("spirit_baptised", YES_NO_WANT),
      previous_church: v.text("previous_church", { max: 160 }),
      heard_about: v.oneOf("heard_about", HEARD_ABOUT),
      invited_by: v.text("invited_by", { max: 120 }),
      interests: v.list("interests", MINISTRIES),
      skills: v.text("skills", { max: 1000 }),
      availability: v.list("availability", AVAILABILITY),
      emergency_name: v.text("emergency_name", { required: true, max: 120, label: "Emergency contact name" }),
      emergency_relationship: v.text("emergency_relationship", { required: true, max: 60, label: "Relationship" }),
      emergency_phone: v.phone("emergency_phone", true, "Emergency contact number"),
      guardian_name: v.text("guardian_name", { max: 120 }),
      guardian_phone: v.phone("guardian_phone", false, "Guardian phone"),
      guardian_email: v.email("guardian_email", false),
      guardian_consent: v.bool("guardian_consent"),
      care_notes: v.text("care_notes", { max: 1500 }),
      prayer_request: v.text("prayer_request", { max: 2000 }),
      comm_whatsapp: v.bool("comm_whatsapp"),
      comm_email: v.bool("comm_email"),
      comm_sms: v.bool("comm_sms"),
      photo_consent: v.bool("photo_consent"),
      popia_consent: v.bool("popia_consent"),
      signature_name: v.text("signature_name", { required: true, max: 160, label: "Your full name (signature)" }),
      newsletter: v.bool("newsletter"),
    };
    m.whatsapp = m.whatsapp_same ? m.phone : v.phone("whatsapp", false, "WhatsApp number");
    let age: number | null = null;
    if (m.date_of_birth && !v.errors.date_of_birth) {
      age = ageOn(m.date_of_birth);
      if (age < 5 || age > 110) v.errors.date_of_birth = "Please check your date of birth.";
      else if (age < 18) {
        if (!m.guardian_name) v.errors.guardian_name = "A parent or guardian's name is required for under-18s.";
        if (!m.guardian_phone) v.errors.guardian_phone = "A parent or guardian's number is required for under-18s.";
        if (!m.guardian_consent) v.errors.guardian_consent = "Parent/guardian consent is required for under-18s.";
      }
    }
    if (m.membership_type === "transfer" && !m.previous_church) v.errors.previous_church = "Please tell us which church you're transferring from.";
    if (!m.popia_consent) v.errors.popia_consent = "We need your consent to store your details.";
    v.assert();

    if (session) {
      const existing = await env.DB.prepare("SELECT ref_code FROM members WHERE user_id = ?").bind(session.user.id).first<{ ref_code: string }>();
      if (existing) return json({ ok: true, ref: existing.ref_code, first_name: m.preferred_name || m.first_name, already: true });
    }

    const pending: PendingFile[] = [];
    const photo = fd.getAll("photo").filter((f): f is File => typeof f !== "string" && f.size > 0);
    const docs = fd.getAll("documents").filter((f): f is File => typeof f !== "string" && f.size > 0);
    if (photo.length > 1 || docs.length > 3) throw new HttpError(422, "Too many files attached.");
    for (const f of photo) pending.push(await readUpload(env, f, "photo"));
    for (const f of docs) pending.push(await readUpload(env, f, "document"));

    const id = uuid();
    const ref = refCode();
    const stored = pending.length ? await storeFiles(env, "member", id, pending) : { stmts: [], rollback: async () => [] };
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO members (id, ref_code, membership_type, first_name, last_name, preferred_name, date_of_birth, gender,
            phone, whatsapp_same, whatsapp, email, suburb, city, address, occupation_status, institution, grade_or_role,
            salvation_status, salvation_year, water_baptised, spirit_baptised, previous_church, heard_about, invited_by,
            interests, skills, availability, emergency_name, emergency_relationship, emergency_phone,
            guardian_name, guardian_phone, guardian_email, guardian_consent, care_notes, prayer_request,
            comm_whatsapp, comm_email, comm_sms, photo_consent, popia_consent, signature_name, ip_hash, user_agent, user_id)
           VALUES (${Array(46).fill("?").join(",")})`,
        ).bind(
          id, ref, m.membership_type, m.first_name, m.last_name, m.preferred_name, m.date_of_birth, m.gender,
          m.phone, m.whatsapp_same ? 1 : 0, m.whatsapp, m.email, m.suburb, m.city, m.address, m.occupation_status,
          m.institution, m.grade_or_role, m.salvation_status, m.salvation_year, m.water_baptised, m.spirit_baptised,
          m.previous_church, m.heard_about, m.invited_by, JSON.stringify(m.interests), m.skills, JSON.stringify(m.availability),
          m.emergency_name, m.emergency_relationship, m.emergency_phone, m.guardian_name, m.guardian_phone, m.guardian_email,
          m.guardian_consent ? 1 : 0, m.care_notes, m.prayer_request, m.comm_whatsapp ? 1 : 0, m.comm_email ? 1 : 0,
          m.comm_sms ? 1 : 0, m.photo_consent ? 1 : 0, m.popia_consent ? 1 : 0, m.signature_name,
          await ipHash(ip), (req.headers.get("user-agent") || "").slice(0, 300), session?.user.id ?? null,
        ),
        ...stored.stmts,
      ]);
    } catch (err) { await stored.rollback(); throw err; }

    const b = { site: siteUrl(env) };
    const first = m.preferred_name || m.first_name!;
    await sendMail(env, { to: m.email!, toName: `${m.first_name} ${m.last_name}`, ...T.joinWelcome(b, first, ref), template: "join_welcome" });
    await sendMail(env, { to: adminEmail(env), ...T.adminNewMember(b, {
      name: `${m.first_name} ${m.last_name}`, ref, phone: m.phone!, email: m.email!, age,
      type: m.membership_type!, interests: m.interests.join(", "),
    }), template: "admin_new_member" });
    if (m.newsletter && m.comm_email) {
      await subscribe(env, { email: m.email!, name: first, source: "join", userId: session?.user.id ?? null, verified: true });
    }
    return json({ ok: true, ref, first_name: first }, 201);
  });

  // ---------------- prayer & contact
  router.post("/api/prayer", async (req) => {
    const ip = clientIp(req);
    await rateLimit(env, "prayer", ip, 8, 3600);
    const body = await readJson(req);
    if (body.website) return json({ ok: true }, 201);
    const v = new Validator(body);
    const is_anonymous = v.bool("is_anonymous");
    const wants_contact = v.bool("wants_contact");
    const name = v.text("name", { required: !is_anonymous, max: 120, label: "Name" });
    const email = v.email("email", false);
    const phone = v.phone("phone", false);
    const request = v.text("request", { required: true, max: 3000, min: 5, label: "Prayer request" });
    if (wants_contact && !email && !phone) v.errors.phone = "Add a phone or email so we can reach you.";
    v.assert();
    await env.DB.prepare(
      `INSERT INTO prayer_requests (id, name, email, phone, request, is_anonymous, pastors_only, wants_contact, ip_hash) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(uuid(), is_anonymous ? null : name, email, phone, request, is_anonymous ? 1 : 0, v.bool("pastors_only") ? 1 : 0, wants_contact ? 1 : 0, await ipHash(ip)).run();
    if (email) await sendMail(env, { to: email, ...T.prayerReceived({ site: siteUrl(env) }, (!is_anonymous && name) ? name.split(" ")[0] : "Friend"), template: "prayer_received" });
    return json({ ok: true, message: "We've received your request and we're standing with you in prayer." }, 201);
  });

  router.post("/api/contact", async (req) => {
    const ip = clientIp(req);
    await rateLimit(env, "contact", ip, 6, 3600);
    const body = await readJson(req);
    if (body.website) return json({ ok: true }, 201);
    const v = new Validator(body);
    const name = v.text("name", { required: true, max: 120, label: "Name" });
    const email = v.email("email", true);
    const phone = v.phone("phone", false);
    const subject = v.text("subject", { max: 160 });
    const message = v.text("message", { required: true, max: 4000, min: 5, label: "Message" });
    v.assert();
    await env.DB.prepare("INSERT INTO contact_messages (id, name, email, phone, subject, message, ip_hash) VALUES (?,?,?,?,?,?,?)")
      .bind(uuid(), name, email, phone, subject, message, await ipHash(ip)).run();
    await sendMail(env, { to: email!, ...T.contactReceived({ site: siteUrl(env) }, name!.split(" ")[0]), template: "contact_received" });
    return json({ ok: true, message: "Thanks for reaching out — someone will get back to you soon." }, 201);
  });

  // ---------------- weekly letter
  router.post("/api/newsletter/subscribe", async (req) => {
    await rateLimit(env, "subscribe", clientIp(req), 6, 3600);
    const body = await readJson(req);
    if (body.website) return json({ ok: true, status: "pending" });
    const session = await getSession(env, req);
    const v = new Validator(body);
    const email = session ? session.user.email : v.email("email", true);
    const name = v.text("name", { max: 120 }) || session?.user.given_name || null;
    v.assert();
    const status = await subscribe(env, { email: email!, name, source: session ? "google" : "footer", userId: session?.user.id, verified: !!session });
    return json({ ok: true, status, message: status === "active"
      ? "You're in! Look out for our letter every Sunday afternoon."
      : "Almost there — check your inbox and tap the link to confirm." });
  });

  router.get("/api/newsletter/confirm", async (req) => {
    const token = new URL(req.url).searchParams.get("token") || "";
    const ok = token && await confirmSubscription(env, token);
    return redirect(`/?letter=${ok ? "confirmed" : "invalid"}#letter`);
  });

  const doUnsub = async (req: Request) => {
    const token = new URL(req.url).searchParams.get("token") || "";
    const ok = token && await unsubscribe(env, token);
    return { ok: !!ok };
  };
  router.get("/api/newsletter/unsubscribe", async (req) => redirect(`/?letter=${(await doUnsub(req)).ok ? "unsubscribed" : "invalid"}#letter`));
  router.post("/api/newsletter/unsubscribe", async (req) => json(await doUnsub(req))); // RFC 8058 one-click
}
