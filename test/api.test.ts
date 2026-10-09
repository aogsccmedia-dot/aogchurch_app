import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { makeEnv, runCron } from "./support/server.ts";
import { __setJwksForTests } from "../src/lib/auth.ts";

type Env = Awaited<ReturnType<typeof makeEnv>>;
let env: Env;
let ip = 1;
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const PDF = new TextEncoder().encode("%PDF-1.4\n%test\n");
const JSONH = { "Content-Type": "application/json" };

function call(path: string, init: RequestInit & { ip?: string } = {}, e: Env = env) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? `10.0.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`);
  return worker.fetch(new Request("https://aogsccyouth.com" + path, { ...init, headers }), e as never, {} as never);
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}, e: Env = env) =>
  call(path, { method: "POST", headers: { ...JSONH, ...headers }, body: JSON.stringify(body) }, e);
const cookieOf = (r: Response) => (r.headers.get("set-cookie") || "").split(";")[0];
const mails = (to?: string) => env.EMAIL.outbox.filter((m) => !to || JSON.stringify(m.to).includes(to));
const lastCode = () => /code is (\d{6})/.exec(mails("aogsccmedia@gmail.com").at(-1)!.text!)![1];

// ---------- Google test signer ----------
let privateKey: CryptoKey;
const b64u = (b: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof b === "string" ? b : new Uint8Array(b)).toString("base64url");
async function googleToken(claims: Record<string, unknown>) {
  const header = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...claims }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64u(sig)}`;
}

function joinForm(over: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    membership_type: "new_member", first_name: "Naledi", last_name: "Dlamini", date_of_birth: "2000-02-14",
    phone: "082 555 1234", whatsapp_same: "1", email: "Naledi@Example.com", emergency_name: "Sipho Dlamini",
    emergency_relationship: "Brother", emergency_phone: "0835551111", popia_consent: "1", signature_name: "Naledi Dlamini",
    comm_email: "1", newsletter: "1",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== "") fd.append(k, v);
  fd.append("interests", "worship"); fd.append("interests", "youth"); fd.append("interests", "not_real");
  return fd;
}

async function adminCookie(): Promise<string> {
  const r1 = await post("/api/auth/admin/request-code", { email: "aogsccmedia@gmail.com" });
  const { challenge } = await r1.json() as { challenge: string };
  const r2 = await post("/api/auth/admin/verify", { challenge, code: lastCode() });
  assert.equal(r2.status, 200);
  return cookieOf(r2);
}
const A = (cookie: string) => ({ cookie, "x-scc-admin": "1" });

before(async () => {
  env = await makeEnv();
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  privateKey = kp.privateKey;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey) as { n: string; e: string };
  __setJwksForTests([{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }]);
});

describe("site & public forms", () => {
  test("health", async () => {
    const j = await (await call("/api/health")).json() as Record<string, unknown>;
    assert.deepEqual(j, { ok: true, db: true, storage: "kv", email: true, google: false });
  });
  test("pages served; unknown API 404; www → apex", async () => {
    assert.match(await (await call("/")).text(), /bound<\/em> in fellowship/);
    assert.equal((await call("/event")).status, 200);
    assert.equal((await call("/api/nope")).status, 404);
    const r = await worker.fetch(new Request("https://www.aogsccyouth.com/join"), env as never, {} as never);
    assert.equal(r.headers.get("location"), "https://aogsccyouth.com/join");
  });
  test("join: validation, under-18 guardian rules, transfer rule", async () => {
    const fd = new FormData(); fd.append("first_name", "A");
    assert.equal((await call("/api/join", { method: "POST", body: fd })).status, 422);
    const minor = await call("/api/join", { method: "POST", body: joinForm({ date_of_birth: `${new Date().getUTCFullYear() - 15}-01-01` }) });
    const j = await minor.json() as { details: Record<string, string> };
    assert.ok(j.details.guardian_name && j.details.guardian_consent);
    assert.equal((await call("/api/join", { method: "POST", body: joinForm({ membership_type: "transfer" }) })).status, 422);
  });
  test("join: success stores files, emails welcome + admin, subscribes to the letter", async () => {
    const fd = joinForm();
    fd.append("photo", new File([PNG], "me.png", { type: "image/png" }));
    fd.append("documents", new File([PDF], "letter.pdf", { type: "application/pdf" }));
    const r = await call("/api/join", { method: "POST", body: fd });
    assert.equal(r.status, 201);
    const { ref } = await r.json() as { ref: string };
    const row = env.DB._db.prepare("SELECT * FROM members WHERE ref_code = ?").get(ref) as Record<string, string>;
    assert.equal(row.phone, "+27825551234");
    assert.deepEqual(JSON.parse(row.interests), ["worship", "youth"]);
    assert.equal((env.DB._db.prepare("SELECT COUNT(*) n FROM attachments WHERE owner_id = ?").get(row.id) as { n: number }).n, 2);
    assert.ok(mails("naledi@example.com").some((m) => m.subject.startsWith("Welcome to the family")));
    assert.ok(mails("aogsccmedia@gmail.com").some((m) => m.subject.includes("New member sign-up")));
    const sub = env.DB._db.prepare("SELECT status FROM subscribers WHERE email = ?").get("naledi@example.com") as { status: string };
    assert.equal(sub.status, "active");
  });
  test("join: disguised file rejected; honeypot ignored; rate limited", async () => {
    const fd = joinForm(); fd.append("documents", new File([new TextEncoder().encode("MZ")], "x.pdf", { type: "application/pdf" }));
    assert.equal((await call("/api/join", { method: "POST", body: fd })).status, 415);
    const n0 = (env.DB._db.prepare("SELECT COUNT(*) n FROM members").get() as { n: number }).n;
    assert.equal((await call("/api/join", { method: "POST", body: joinForm({ website: "x" }) })).status, 201);
    assert.equal((env.DB._db.prepare("SELECT COUNT(*) n FROM members").get() as { n: number }).n, n0);
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await call("/api/join", { method: "POST", body: new FormData(), ip: "9.9.9.9" })).status;
    assert.equal(last, 429);
  });
  test("prayer request gets a caring email; contact needs email", async () => {
    assert.equal((await post("/api/prayer", { request: "Please pray for my exams", name: "Kea", email: "kea@example.com" })).status, 201);
    assert.ok(mails("kea@example.com").some((m) => m.subject === "We're praying with you"));
    assert.equal((await post("/api/contact", { name: "X", message: "Hello there" })).status, 422);
  });
  test("cross-origin POST blocked", async () => {
    assert.equal((await post("/api/contact", {}, { origin: "https://evil.example" })).status, 403);
  });
});

describe("weekly letter subscriptions", () => {
  test("double opt-in → confirm → welcome → unsubscribe (one-click works cross-site)", async () => {
    const r = await post("/api/newsletter/subscribe", { email: "Thandi@Example.com", name: "Thandi" });
    assert.equal((await r.json() as { status: string }).status, "pending");
    const confirm = mails("thandi@example.com").at(-1)!;
    assert.match(confirm.subject, /confirm/i);
    const token = /token=([\w-]+)/.exec(confirm.text!)![1];
    const c = await call(`/api/newsletter/confirm?token=${token}`);
    assert.equal(c.status, 303);
    assert.equal(c.headers.get("location"), "/?letter=confirmed#letter");
    assert.match(mails("thandi@example.com").at(-1)!.subject, /You're in/);
    const u = await call(`/api/newsletter/unsubscribe?token=${token}`, { method: "POST", headers: { origin: "https://mail.google.com" } });
    assert.equal(u.status, 200);
    assert.equal((env.DB._db.prepare("SELECT status FROM subscribers WHERE email = ?").get("thandi@example.com") as { status: string }).status, "unsubscribed");
  });
});

describe("accounts & admin access", () => {
  test("admin cannot be reached without the emailed code", async () => {
    assert.equal((await call("/api/admin/stats")).status, 401);
    const r = await post("/api/auth/admin/request-code", { email: "aogsccmedia@gmail.com" });
    const { challenge } = await r.json() as { challenge: string };
    assert.match(mails("aogsccmedia@gmail.com").at(-1)!.subject, /sign-in code/);
    const bad = await post("/api/auth/admin/verify", { challenge, code: "000000" === lastCode() ? "111111" : "000000" });
    assert.equal(bad.status, 400);
    const good = await post("/api/auth/admin/verify", { challenge, code: lastCode() });
    assert.equal(good.status, 200);
    assert.match(good.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
    const reuse = await post("/api/auth/admin/verify", { challenge, code: lastCode() });
    assert.equal(reuse.status, 400, "codes are single-use");
    assert.equal((await call("/api/admin/stats", { headers: { cookie: cookieOf(good) } })).status, 200);
  });
  test("other emails never receive admin codes", async () => {
    const before = env.EMAIL.outbox.length;
    const r = await post("/api/auth/admin/request-code", { email: "someone@else.com" });
    assert.equal(r.status, 200);
    assert.equal(env.EMAIL.outbox.length, before);
  });
  test("admin writes need the CSRF header", async () => {
    const cookie = await adminCookie();
    assert.equal((await post("/api/admin/events", { title: "X", starts_at: "2030-01-01T10:00:00Z" }, { cookie })).status, 403);
  });
  test("Google sign-in: members get a session; the admin must still enter a code", async () => {
    const g = await makeEnv({ GOOGLE_CLIENT_ID: CLIENT_ID });
    const tok = await googleToken({ sub: "g-1", email: "lindiwe@gmail.com", name: "Lindiwe Khumalo", given_name: "Lindiwe", family_name: "Khumalo" });
    const r = await post("/api/auth/google", { credential: tok }, {}, g);
    assert.equal(r.status, 200);
    const me = await (await call("/api/auth/me", { headers: { cookie: cookieOf(r) } }, g)).json() as { user: { email: string }; is_admin: boolean };
    assert.equal(me.user.email, "lindiwe@gmail.com");
    assert.equal(me.is_admin, false);
    assert.equal((await call("/api/admin/stats", { headers: { cookie: cookieOf(r) } }, g)).status, 401);

    const wrongAud = await googleToken({ sub: "g-2", email: "x@gmail.com", aud: "someone-else" });
    assert.equal((await post("/api/auth/google", { credential: wrongAud }, {}, g)).status, 401);

    const adminTok = await googleToken({ sub: "g-admin", email: "aogsccmedia@gmail.com", name: "SCC Media" });
    const a = await post("/api/auth/google", { credential: adminTok }, {}, g);
    const aj = await a.json() as { needs_code: boolean; challenge: string };
    assert.equal(aj.needs_code, true);
    assert.equal((await call("/api/admin/stats", { headers: { cookie: cookieOf(a) } }, g)).status, 401, "Google alone is not enough");
    // With Google configured, codes can't be requested without signing in with Google first.
    assert.equal((await post("/api/auth/admin/request-code", { email: "aogsccmedia@gmail.com" }, {}, g)).status, 403);
    const code = /code is (\d{6})/.exec(g.EMAIL.outbox.at(-1)!.text!)![1];
    const v = await post("/api/auth/admin/verify", { challenge: aj.challenge, code }, { cookie: cookieOf(a) }, g);
    assert.equal(v.status, 200);
    assert.equal((await call("/api/admin/stats", { headers: { cookie: cookieOf(v) } }, g)).status, 200);
    // The admin never has to fill in the join form.
    const j = await call("/api/join", { method: "POST", body: joinForm({ email: "aogsccmedia@gmail.com" }), headers: { cookie: cookieOf(v) } }, g);
    assert.equal(j.status, 400);
  });
});

describe("events & form builder", () => {
  let cookie = "";
  let id = "", slug = "";
  before(async () => { cookie = await adminCookie(); });

  test("admin builds an event with a custom form", async () => {
    const r = await post("/api/admin/events", {
      title: "Youth Camp 2030", starts_at: "2030-07-01T08:00:00Z", ends_at: "2030-07-03T14:00:00Z", location: "Magaliesberg",
      is_published: true, rsvp_enabled: true, collect_phone: true, capacity: 2, confirmation_message: "Pack a sleeping bag!", price_label: "R99 per person",
      form_schema: [
        { type: "statement", label: "Camp fee is R500, payable on arrival." },
        { id: "size", type: "select", label: "T-shirt size", required: true, options: ["S", "M", "L"] },
        { id: "diet", type: "checkbox", label: "Dietary needs", options: ["Vegetarian", "Halaal", "Gluten-free"] },
        { id: "consent", type: "yes_no", label: "Parent consent received?", required: true },
        { id: "doc", type: "file", label: "Indemnity form" },
      ],
    }, A(cookie));
    assert.equal(r.status, 201);
    ({ id, slug } = await r.json() as { id: string; slug: string });
    assert.equal(slug, "youth-camp-2030");
    const bad = await post("/api/admin/events", { title: "X", starts_at: "2030-01-01T10:00:00Z", form_schema: [{ type: "select", label: "Pick", options: [] }] }, A(cookie));
    assert.equal(bad.status, 422);
  });

  test("public page shows the form; required answers enforced", async () => {
    const list = await (await call("/api/events")).json() as { events: { slug: string; spots_left: number }[] };
    const listed = list.events.find((e) => e.slug === slug)! as { spots_left: number; price_label?: string };
    assert.equal(listed.spots_left, 2);
    assert.equal(listed.price_label, "R99 per person");
    const ev = await (await call(`/api/events/${slug}`)).json() as { event: { form: { id: string }[]; calendar_url: string } };
    assert.equal(ev.event.form.length, 5);
    assert.match(ev.event.calendar_url, /calendar\.google\.com/);
    const fd = new FormData(); fd.append("name", "Sam"); fd.append("email", "sam@example.com"); fd.append("phone", "0821234567");
    const r = await call(`/api/events/${slug}/register`, { method: "POST", body: fd });
    assert.equal(r.status, 422);
    const j = await r.json() as { details: Record<string, string> };
    assert.ok(j.details.f_size && j.details.f_consent);
  });

  test("registration → confirmation email; capacity → waitlist; cancel → promotion", async () => {
    const reg = (name: string, email: string, guests = "0") => {
      const fd = new FormData();
      Object.entries({ name, email, phone: "0821234567", guests, f_size: "M", f_consent: "Yes" }).forEach(([k, v]) => fd.append(k, v));
      fd.append("f_diet", "Vegetarian"); fd.append("f_diet", "Halaal");
      fd.append("f_doc", new File([PDF], "indemnity.pdf", { type: "application/pdf" }));
      return call(`/api/events/${slug}/register`, { method: "POST", body: fd });
    };
    const a = await (await reg("Amahle Zulu", "amahle@example.com")).json() as { status: string; ref: string };
    assert.equal(a.status, "confirmed");
    const conf = mails("amahle@example.com").at(-1)! as { subject: string; attachments?: { filename: string; type: string }[]; html?: string };
    assert.ok(conf.subject.startsWith("You're registered"));
    assert.equal(conf.attachments?.[0].type, "text/calendar", "calendar invite attached");
    assert.ok(conf.html!.includes("Apple / iPhone") && conf.html!.includes("R99 per person"));
    const ics = await call(`/api/events/${slug}/calendar.ics`);
    assert.equal(ics.headers.get("content-type"), "text/calendar; charset=utf-8");
    const body = await ics.text();
    assert.ok(body.includes("DTSTART:20300701T080000Z") && body.includes("SUMMARY:Youth Camp 2030"));
    const dup = await (await reg("Amahle Zulu", "amahle@example.com")).json() as { already: boolean };
    assert.equal(dup.already, true);
    const b = await (await reg("Bongani Nkosi", "bongani@example.com", "1")).json() as { status: string };
    assert.equal(b.status, "waitlist", "1 + 1 guest exceeds the remaining capacity");
    assert.match(mails("bongani@example.com").at(-1)!.subject, /waitlist/);

    const { registrations } = await (await call(`/api/admin/events/${id}/registrations`, { headers: { cookie } })).json() as { registrations: { id: string; email: string; answers: Record<string, unknown>; files: unknown[] }[] };
    const amahle = registrations.find((r) => r.email === "amahle@example.com")!;
    assert.deepEqual(amahle.answers.diet, ["Vegetarian", "Halaal"]);
    assert.equal(amahle.files.length, 1);
    await call(`/api/admin/registrations/${amahle.id}`, { method: "PATCH", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ status: "cancelled" }) });
    assert.match(mails("bongani@example.com").at(-1)!.subject, /You're registered/, "waitlisted person promoted & emailed");

    const csv = await (await call(`/api/admin/events/${id}/registrations.csv`, { headers: { cookie } })).text();
    assert.ok(csv.includes("T-shirt size") && csv.includes("Vegetarian; Halaal"));
  });

  test("duplicate for next week keeps the form as a draft", async () => {
    const r = await post(`/api/admin/events/${id}/duplicate`, { days: 7 }, A(cookie));
    const { id: nid } = await r.json() as { id: string };
    const { event } = await (await call(`/api/admin/events/${nid}`, { headers: { cookie } })).json() as { event: { starts_at: string; is_published: number; form_schema: unknown[] } };
    assert.equal(event.starts_at, "2030-07-08T08:00:00.000Z");
    assert.equal(event.is_published, 0);
    assert.equal(event.form_schema.length, 5);
  });
});

describe("paid events: EFT + proof of payment + admin approval", () => {
  let cookie = "", id = "", slug = "";
  before(async () => { cookie = await adminCookie(); });
  const reg = (name: string, email: string, pop: boolean, guests = "0") => {
    const fd = new FormData();
    Object.entries({ name, email, phone: "0821234567", guests }).forEach(([k, v]) => fd.append(k, v));
    if (pop) fd.append("pop", new File([PDF], "pop.pdf", { type: "application/pdf" }));
    return call(`/api/events/${slug}/register`, { method: "POST", body: fd });
  };

  test("paid event without banking details can't take payments yet", async () => {
    const r = await post("/api/admin/events", { title: "Worship Night", starts_at: "2030-11-27T16:30:00Z", is_published: true, rsvp_enabled: true,
      collect_phone: true, ticket_price: 150, requires_pop: true, auto_approve: false, capacity: 4 }, A(cookie));
    ({ id, slug } = await r.json() as { id: string; slug: string });
    const ev = await (await call(`/api/events/${slug}`)).json() as { event: { price_label: string; ticket_price: number; requires_pop: boolean; payment_instructions: string } };
    assert.equal(ev.event.price_label, "R150 per person");
    assert.equal(ev.event.ticket_price, 150);
    assert.equal(ev.event.requires_pop, true);
    assert.equal(ev.event.payment_instructions, "");
    assert.equal((await reg("Early Bird", "early@example.com", true)).status, 409);
  });

  test("POP is required; registration waits for approval and holds the seat", async () => {
    await call("/api/admin/settings", { method: "PUT", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ banking_details: "AOG Sandton City Church\nFNB · 123456789\nRef: your name" }) });
    const ev = await (await call(`/api/events/${slug}`)).json() as { event: { payment_instructions: string } };
    assert.match(ev.event.payment_instructions, /FNB/);
    const noPop = await reg("Sipho Ndlovu", "sipho@example.com", false);
    assert.equal(noPop.status, 422);
    assert.ok((await noPop.json() as { details: Record<string, string> }).details.pop);

    const r = await (await reg("Sipho Ndlovu", "sipho@example.com", true, "1")).json() as { status: string; amount_due: number };
    assert.equal(r.status, "pending");
    assert.equal(r.amount_due, 300);
    assert.match(mails("sipho@example.com").at(-1)!.subject, /received your details/);
    assert.match(mails("aogsccmedia@gmail.com").at(-1)!.subject, /Payment to approve: Sipho Ndlovu/);
    const list = await (await call("/api/events")).json() as { events: { slug: string; spots_left: number }[] };
    assert.equal(list.events.find((e) => e.slug === slug)!.spots_left, 2, "pending registrations hold their seats");
  });

  test("approve one-by-one, decline with a note, and approve all", async () => {
    await reg("Lindo Mthembu", "lindo@example.com", true);
    await reg("Zama Khumalo", "zama@example.com", true); // capacity 4: 2 + 1 + 1 = full
    const w = await (await reg("Late Comer", "late@example.com", true)).json() as { status: string };
    assert.equal(w.status, "waitlist");

    const { registrations } = await (await call(`/api/admin/events/${id}/registrations`, { headers: { cookie } })).json() as { registrations: { id: string; email: string; pop_attachment_id: string }[] };
    const byEmail = (e: string) => registrations.find((r) => r.email === e)!;
    const pop = await call(`/api/admin/files/${byEmail("sipho@example.com").pop_attachment_id}`, { headers: { cookie } });
    assert.equal(pop.status, 200);

    const patch = (rid: string, body: unknown) => call(`/api/admin/registrations/${rid}`, { method: "PATCH", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify(body) });
    await patch(byEmail("sipho@example.com").id, { status: "confirmed" });
    const ticket = mails("sipho@example.com").at(-1)! as { subject: string; attachments?: { type: string }[]; html?: string };
    assert.match(ticket.subject, /Congratulations/);
    assert.equal(ticket.attachments?.[0].type, "text/calendar");
    assert.ok(ticket.html!.includes("Your payment has been approved"));

    await patch(byEmail("lindo@example.com").id, { status: "rejected", note: "The amount on the POP was R100, not R150." });
    const declined = mails("lindo@example.com").at(-1)!;
    assert.match(declined.subject, /About your registration/);
    assert.ok(declined.html!.includes("R100, not R150"));
    // Declining freed a seat → the waitlisted person moves up to "awaiting approval".
    assert.match(mails("late@example.com").at(-1)!.subject, /received your details/);

    const all = await (await post(`/api/admin/events/${id}/approve-all`, {}, A(cookie))).json() as { approved: number };
    assert.equal(all.approved, 2);
    assert.match(mails("zama@example.com").at(-1)!.subject, /Congratulations/);
    assert.match(mails("late@example.com").at(-1)!.subject, /Congratulations/);
    // A declined person can register again.
    assert.equal((await reg("Lindo Mthembu", "lindo@example.com", true)).status, 201);
    const csv = await (await call(`/api/admin/events/${id}/registrations.csv`, { headers: { cookie } })).text();
    assert.ok(csv.includes("Amount (R)") && csv.includes("Proof of payment") && csv.includes("300"));
  });
});

describe("weekly announcement letter", () => {
  test("compose → test → schedule → cron delivers to active subscribers only", async () => {
    const cookie = await adminCookie();
    await post("/api/admin/subscribers", { email: "member1@example.com", name: "Lerato Mokoena" }, A(cookie));
    await post("/api/admin/subscribers", { email: "member2@example.com" }, A(cookie));
    const r = await post("/api/admin/announcements", {
      subject: "This week at church", heading: "A new week", body: "Hello family!\n\nSee you Sunday.",
      scripture_text: "The Lord is my shepherd.", scripture_ref: "Psalm 23:1", include_events: true,
      services: [{ title: "Sunday Family Service", when: "Sunday · 09:30", location: "Main hall" }],
    }, A(cookie));
    const { id } = await r.json() as { id: string };
    const preview = await (await call(`/api/admin/announcements/${id}/preview`, { headers: { cookie } })).text();
    assert.ok(preview.includes("Sunday Family Service") && preview.includes("Psalm 23:1") && preview.includes("logo-192.png"));
    assert.equal((await post(`/api/admin/announcements/${id}/test`, {}, A(cookie))).status, 200);
    assert.match(mails("aogsccmedia@gmail.com").at(-1)!.subject, /^\[Test\]/);

    const s = await post(`/api/admin/announcements/${id}/schedule`, {}, A(cookie));
    const { scheduled_for } = await s.json() as { scheduled_for: string };
    const d = new Date(scheduled_for);
    assert.equal(d.getUTCDay(), 0); assert.equal(d.getUTCHours(), 12, "Sunday 14:00 SAST");

    await runCron(env, Date.now());  // not due yet
    assert.equal(mails("member1@example.com").filter((m) => m.subject === "This week at church").length, 0);
    await runCron(env, d.getTime() + 60_000);
    const got = mails("member1@example.com").filter((m) => m.subject === "This week at church");
    assert.equal(got.length, 1);
    assert.ok(got[0].html!.includes("Dear Lerato"));
    assert.ok(got[0].headers!["List-Unsubscribe"].includes("/api/newsletter/unsubscribe?token="));
    assert.equal(mails("thandi@example.com").filter((m) => m.subject === "This week at church").length, 0, "unsubscribed people are skipped");
    const { announcement } = await (await call(`/api/admin/announcements/${id}`, { headers: { cookie } })).json() as { announcement: { status: string; sent_count: number } };
    assert.equal(announcement.status, "sent");
    assert.ok(announcement.sent_count >= 3);
    assert.equal((await call(`/api/admin/announcements/${id}`, { method: "PUT", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ subject: "x", heading: "x", body: "x" }) })).status, 409);
  });
});

describe("email delivery tools & consent", () => {
  test("every template previews and test-sends; failed emails are kept and can be resent", async () => {
    const cookie = await adminCookie();
    const A = (c: string) => ({ cookie: c, "x-scc-admin": "1" });
    const { templates } = await (await call("/api/admin/email-templates", { headers: { cookie } })).json() as { templates: { key: string }[] };
    assert.ok(templates.length >= 14);
    for (const t of templates) {
      const html = await (await call(`/api/admin/email-templates/${t.key}/preview`, { headers: { cookie } })).text();
      assert.ok(html.includes("logo-192.png"), `${t.key} has the logo`);
    }
    assert.equal((await post("/api/admin/email-templates/event_approved/test", {}, A(cookie))).status, 200);
    assert.match(mails("aogsccmedia@gmail.com").at(-1)!.subject, /^\[Test\] Congratulations/);

    // Simulate Cloudflare refusing recipients (domain not onboarded for sending yet).
    const realSend = env.EMAIL.send;
    env.EMAIL.send = async () => { throw Object.assign(new Error("destination address is not a verified address"), { code: "E_RECIPIENT_NOT_ALLOWED" }); };
    await post("/api/prayer", { name: "Retry Me", email: "retry@example.com", request: "Please pray" });
    const h1 = await (await call("/api/admin/email-health", { headers: { cookie } })).json() as { health: { needs_setup: boolean; resendable: number } };
    assert.equal(h1.health.needs_setup, true);
    assert.ok(h1.health.resendable >= 1);
    env.EMAIL.send = realSend;
    const r = await (await post("/api/admin/email-log/resend", {}, A(cookie))).json() as { sent: number };
    assert.ok(r.sent >= 1);
    assert.ok(mails("retry@example.com").length >= 1, "resent once delivery works");
    const h2 = await (await call("/api/admin/email-health", { headers: { cookie } })).json() as { health: { needs_setup: boolean; resendable: number } };
    assert.equal(h2.health.needs_setup, false);
    assert.equal(h2.health.resendable, 0);
  });

  test("cookie consent is recorded anonymously", async () => {
    assert.equal((await post("/api/consent", { visitor_id: "abc12345-visitor", functional: true, version: "2026-10" })).status, 200);
    assert.equal((await post("/api/consent", { visitor_id: "x", functional: true })).status, 422);
  });
});

describe("membership check-ins (every 4 months)", () => {
  test("check-in email → still a member; revoke from the email; reminder after 14 days", async () => {
    const join = async (email: string, first: string) => {
      const r = await call("/api/join", { method: "POST", body: joinForm({ email, first_name: first }) });
      assert.equal(r.status, 201, await r.clone().text());
      return (await r.json() as { ref: string }).ref;
    };
    const refA = await join("stay@example.com", "Sipho");
    const refB = await join("leave@example.com", "Zanele");
    const refC = await join("quiet@example.com", "Lwazi");
    const row = (ref: string) => env.DB._db.prepare("SELECT * FROM members WHERE ref_code = ?").get(ref) as Record<string, string | null>;
    const created = new Date(row(refA).created_at!);
    const firstCheckin = new Date(row(refA).next_checkin_at!);
    const months = (firstCheckin.getUTCFullYear() - created.getUTCFullYear()) * 12 + firstCheckin.getUTCMonth() - created.getUTCMonth();
    assert.equal(months, 4, "first check-in is 4 months after joining");

    // Nothing before it's due; then one email each at 10:00 SAST on the due day.
    await runCron(env, created.getTime() + 86400_000);
    assert.equal(mails("stay@example.com").filter((m) => /still part of the family/.test(m.subject)).length, 0);
    const due = new Date(firstCheckin); due.setUTCHours(8, 0, 0, 0); due.setUTCDate(due.getUTCDate() + 1);
    await runCron(env, due.getTime());
    await runCron(env, due.getTime() + 600_000);   // no duplicates on the next run
    const checkin = mails("stay@example.com").filter((m) => /still part of the family/.test(m.subject));
    assert.equal(checkin.length, 1);
    const link = (html: string, a: string) => new URL(new RegExp(`href="([^"]+a=${a})"`).exec(html)![1].replace(/&amp;/g, "&"));
    const tokenA = link(checkin[0].html!, "stay").searchParams.get("t")!;

    // "Still a member" → confirmed, next check-in moves 4 months on, link can't be reused.
    const ok = await post("/api/membership/confirm", { token: tokenA });
    assert.equal(ok.status, 200);
    assert.ok(row(refA).last_confirmed_at);
    assert.ok(new Date(row(refA).next_checkin_at!) > new Date(Date.now() + 100 * 86400_000), "next check-in ~4 months after confirming");
    assert.equal((await post("/api/membership/confirm", { token: tokenA })).status, 404);

    // Revoke from the email (with a reason) → status revoked, member + admin emailed.
    const mailB = mails("leave@example.com").filter((m) => /still part of the family/.test(m.subject)).at(-1)!;
    const tokenB = link(mailB.html!, "revoke").searchParams.get("t")!;
    assert.equal((await post("/api/membership/lookup", { token: tokenB })).status, 200);
    assert.equal((await post("/api/membership/revoke", { token: tokenB, reason: "Moved to Cape Town" })).status, 200);
    assert.equal(row(refB).status, "revoked");
    assert.match(row(refB).admin_notes || "", /Moved to Cape Town/);
    assert.ok(mails("leave@example.com").some((m) => m.subject === "Your membership has been revoked"));
    assert.ok(mails("aogsccmedia@gmail.com").some((m) => m.subject === "Membership revoked: Zanele Dlamini" || m.subject.startsWith("Membership revoked: Zanele")));

    // No answer → one reminder after 14 days, then nothing more.
    await runCron(env, due.getTime() + 15 * 86400_000);
    await runCron(env, due.getTime() + 16 * 86400_000);
    assert.equal(mails("quiet@example.com").filter((m) => /reminder/.test(m.subject)).length, 1);
    assert.equal(mails("leave@example.com").filter((m) => /reminder/.test(m.subject)).length, 0, "revoked members aren't chased");
  });
});
