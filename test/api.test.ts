import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { makeEnv, runCron } from "./support/server.ts";
import { __setJwksForTests, permFor } from "../src/lib/auth.ts";

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

const ADMIN_PW = "Sandton-Youth-2026!";
/** The main admin signs in with email + password (the first time proves the email once with a code). */
async function adminCookie(e: Env = env): Promise<string> {
  const li = await post("/api/auth/password/login", { email: "aogsccmedia@gmail.com", password: ADMIN_PW }, {}, e);
  if (li.status === 200) return cookieOf(li);
  const su = await (await post("/api/auth/password/signup", { name: "SCC Media", email: "aogsccmedia@gmail.com", password: ADMIN_PW }, {}, e)).json() as { needs_code: boolean; challenge: string };
  assert.equal(su.needs_code, true, "the admin email must be proven once");
  const code = /(\d{6})/.exec((e as typeof env).EMAIL.outbox.at(-1)!.text!)![1];
  const r = await post("/api/auth/password/confirm", { challenge: su.challenge, code }, {}, e);
  assert.equal(r.status, 200);
  return cookieOf(r);
}
const A = (cookie: string) => ({ cookie, "x-scc-admin": "1" });
/** The main admin through Google: straight in, no codes. */
async function superCookie(g: Env & { EMAIL: { outbox: { text?: string }[] } }, sub = "g-admin"): Promise<string> {
  const a = await post("/api/auth/google", { credential: await googleToken({ sub, email: "aogsccmedia@gmail.com", name: "SCC Media" }) }, {}, g);
  assert.equal(a.status, 200);
  return cookieOf(a);
}

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
  test("admin needs a real sign-in; no codes for the main admin, codes only to prove an email or reset a password", async () => {
    assert.equal((await call("/api/admin/stats")).status, 401);
    const c = await adminCookie();
    assert.match(mails("aogsccmedia@gmail.com").at(-1)!.subject, /verification code/);
    assert.equal((await call("/api/admin/stats", { headers: { cookie: c } })).status, 200);
    const before = env.EMAIL.outbox.length;
    const again = await post("/api/auth/password/login", { email: "AOGSCCmedia@gmail.com", password: ADMIN_PW });
    assert.equal(again.status, 200);
    assert.equal(env.EMAIL.outbox.length, before, "no code on a normal sign-in");
    assert.equal((await post("/api/auth/password/login", { email: "aogsccmedia@gmail.com", password: "wrong-password" })).status, 401);
    assert.equal((await post("/api/auth/admin/request-code", { email: "aogsccmedia@gmail.com" })).status, 404, "the old admin code is gone");
  });
  test("email + password: sign up, sign in, forgot password, and no taking over known emails", async () => {
    const e = await makeEnv();
    assert.equal((await post("/api/auth/password/signup", { name: "Zola", email: "zola@example.com", password: "short" }, {}, e)).status, 422);
    assert.equal((await post("/api/auth/password/signup", { name: "Zola", email: "zola@example.com", password: "password" }, {}, e)).status, 422);
    const su = await post("/api/auth/password/signup", { name: "Zola Mokoena", email: "Zola@Example.com", password: "praise-him-always" }, {}, e);
    assert.equal(su.status, 200);
    const me = await (await call("/api/auth/me", { headers: { cookie: cookieOf(su) } }, e)).json() as { user: { email: string; given_name: string }; is_admin: boolean };
    assert.equal(me.user.email, "zola@example.com"); assert.equal(me.user.given_name, "Zola"); assert.equal(me.is_admin, false);
    assert.equal((await post("/api/auth/password/signup", { name: "Zola", email: "zola@example.com", password: "another-pass-1" }, {}, e)).status, 409);
    assert.equal((await post("/api/auth/password/login", { email: "zola@example.com", password: "praise-him-always" }, {}, e)).status, 200);
    // Forgot password: same answer for unknown emails, a code for real ones.
    const n = e.EMAIL.outbox.length;
    assert.equal((await post("/api/auth/password/forgot", { email: "nobody@example.com" }, {}, e)).status, 200);
    assert.equal(e.EMAIL.outbox.length, n, "no email to strangers");
    const f = await (await post("/api/auth/password/forgot", { email: "zola@example.com" }, {}, e)).json() as { challenge: string };
    const code = /(\d{6})/.exec(e.EMAIL.outbox.at(-1)!.text!)![1];
    assert.equal((await post("/api/auth/password/confirm", { challenge: f.challenge, code, password: "123" }, {}, e)).status, 422);
    assert.equal((await post("/api/auth/password/confirm", { challenge: f.challenge, code, password: "a-brand-new-one" }, {}, e)).status, 200);
    assert.equal((await post("/api/auth/password/login", { email: "zola@example.com", password: "praise-him-always" }, {}, e)).status, 401);
    assert.equal((await post("/api/auth/password/login", { email: "zola@example.com", password: "a-brand-new-one" }, {}, e)).status, 200);
    // An email the church already knows (a newsletter subscriber) must be proven before an account is made.
    e.DB._db.prepare("INSERT INTO subscribers (id, email, status, token) VALUES ('s-k', 'known@example.com', 'active', 'tok-k')").run();
    const k = await (await post("/api/auth/password/signup", { name: "Known", email: "known@example.com", password: "my-own-pass-1" }, {}, e)).json() as { needs_code: boolean };
    assert.equal(k.needs_code, true);
    assert.equal(e.DB._db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'known@example.com'").get().n, 0);
  });
  test("signing in with Google removes a password set on an unproven email", async () => {
    const g = await makeEnv({ GOOGLE_CLIENT_ID: CLIENT_ID });
    assert.equal((await post("/api/auth/password/signup", { name: "Not Me", email: "real@gmail.com", password: "squatter-pass-1" }, {}, g)).status, 200);
    assert.equal((await post("/api/auth/google", { credential: await googleToken({ sub: "g-real", email: "real@gmail.com", name: "Real Person" }) }, {}, g)).status, 200);
    assert.equal((await post("/api/auth/password/login", { email: "real@gmail.com", password: "squatter-pass-1" }, {}, g)).status, 401);
    // A Google account can add a password, after proving the email with a code.
    const add = await (await post("/api/auth/password/signup", { name: "Real Person", email: "real@gmail.com", password: "my-real-pass-1" }, {}, g)).json() as { needs_code: boolean; challenge: string };
    assert.equal(add.needs_code, true);
    const code = /(\d{6})/.exec(g.EMAIL.outbox.at(-1)!.text!)![1];
    assert.equal((await post("/api/auth/password/confirm", { challenge: add.challenge, code }, {}, g)).status, 200);
    assert.equal((await post("/api/auth/password/login", { email: "real@gmail.com", password: "my-real-pass-1" }, {}, g)).status, 200);
  });
  test("admin writes need the CSRF header", async () => {
    const cookie = await adminCookie();
    assert.equal((await post("/api/admin/events", { title: "X", starts_at: "2030-01-01T10:00:00Z" }, { cookie })).status, 403);
  });
  test("Google sign-in: members get a session; the main admin goes straight in", async () => {
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
    const v = await post("/api/auth/google", { credential: adminTok }, {}, g);
    assert.equal(v.status, 200);
    assert.equal((await call("/api/admin/stats", { headers: { cookie: cookieOf(v) } }, g)).status, 200, "the main admin goes straight in");
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
      title: "Youth Camp 2030", ministry_group: "youth", starts_at: "2030-07-01T08:00:00Z", ends_at: "2030-07-03T14:00:00Z", location: "Magaliesberg",
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
    const bad = await post("/api/admin/events", { title: "X", ministry_group: "church", starts_at: "2030-01-01T10:00:00Z", form_schema: [{ type: "select", label: "Pick", options: [] }] }, A(cookie));
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
    assert.ok(conf.attachments?.some((a) => a.type === "text/calendar"), "calendar invite attached");
    assert.ok(conf.attachments?.some((a) => a.type === "application/pdf"), "PDF tickets attached");
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
    const r = await post("/api/admin/events", { title: "Worship Night", ministry_group: "youth", starts_at: "2030-11-27T16:30:00Z", is_published: true, rsvp_enabled: true,
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
    assert.match(mails("aogsccmedia@gmail.com").at(-1)!.subject, /Approve: Sipho Ndlovu/);
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
    assert.ok(ticket.attachments?.some((a) => a.type === "text/calendar"));
    assert.ok(ticket.attachments?.some((a) => a.type === "application/pdf"), "tickets PDF attached on approval");
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
    // Offboarding: a reason must be one of the list; "Other" needs their own words.
    assert.equal((await post("/api/membership/revoke", { token: tokenB, reason_code: "bogus" })).status, 400);
    assert.equal((await post("/api/membership/revoke", { token: tokenB, reason_code: "other", reason: "  " })).status, 400);
    assert.equal(row(refB).status !== "revoked", true, "invalid answers don't revoke");
    assert.equal((await post("/api/membership/revoke", { token: tokenB, reason_code: "other", reason: "Moved to Cape Town" })).status, 200);
    assert.equal(row(refB).status, "revoked");
    assert.match(row(refB).admin_notes || "", /Moved to Cape Town/);
    const bye = mails("leave@example.com").find((m) => /sorry to see you go/i.test(m.subject));
    assert.ok(bye, "farewell email sent");
    assert.match(bye!.html!, /keep you in our prayers/); assert.match(bye!.html!, /\/prayer/); assert.match(bye!.html!, /\/join/);
    assert.ok(mails("aogsccmedia@gmail.com").some((m) => m.subject === "Membership revoked: Zanele Dlamini" || m.subject.startsWith("Membership revoked: Zanele")));

    // No answer → one reminder after 14 days, then nothing more.
    await runCron(env, due.getTime() + 15 * 86400_000);
    await runCron(env, due.getTime() + 16 * 86400_000);
    assert.equal(mails("quiet@example.com").filter((m) => /reminder/.test(m.subject)).length, 1);
    assert.equal(mails("leave@example.com").filter((m) => /reminder/.test(m.subject)).length, 0, "revoked members aren't chased");
  });
});

describe("complaints (approved members only)", () => {
  test("member must be approved; complaint emailed; admin replies and the member is updated", async () => {
    const g = await makeEnv({ GOOGLE_CLIENT_ID: CLIENT_ID });
    const out = (to: string) => g.EMAIL.outbox.filter((m) => JSON.stringify(m.to).includes(to));
    assert.equal((await call("/api/join", { method: "POST", body: joinForm({ email: "bongi@gmail.com", first_name: "Bongi" }) }, g)).status, 201);
    const tok = await googleToken({ sub: "g-bongi", email: "bongi@gmail.com", name: "Bongi Dlamini", given_name: "Bongi" });
    const session = cookieOf(await post("/api/auth/google", { credential: tok }, {}, g));
    const complaint = { category: "facilities", subject: "Parking at 09:30", details: "The gate was locked for twenty minutes and nobody could get in." };

    // Not approved yet → not allowed.
    const before = await (await call("/api/me/complaints", { headers: { cookie: session } }, g)).json() as { eligible: boolean };
    assert.equal(before.eligible, false);
    assert.equal((await post("/api/me/complaints", complaint, { cookie: session }, g)).status, 403);

    // Approved by a leader → can raise one; validation applies.
    g.DB._db.prepare("UPDATE members SET status = 'member' WHERE email = ?").run("bongi@gmail.com");
    assert.equal((await post("/api/me/complaints", { ...complaint, details: "short" }, { cookie: session }, g)).status, 422);
    const r = await post("/api/me/complaints", complaint, { cookie: session }, g);
    assert.equal(r.status, 201);
    const { ref } = await r.json() as { ref: string };
    assert.match(ref, /^CMP-/);
    assert.ok(out("bongi@gmail.com").some((m) => m.subject.includes(ref)));
    assert.ok(out("aogsccmedia@gmail.com").some((m) => m.subject.startsWith(`New complaint ${ref}`)));

    // Admin (Google + code) sees it and replies → member emailed, status visible on profile.
    const admin = await superCookie(g);
    const { complaints } = await (await call("/api/admin/complaints", { headers: { cookie: admin } }, g)).json() as { complaints: { id: string; ref_code: string }[] };
    const c = complaints.find((x) => x.ref_code === ref)!;
    const stats = await (await call("/api/admin/stats", { headers: { cookie: admin } }, g)).json() as { stats: { open_complaints: number } };
    assert.equal(stats.stats.open_complaints, 1);
    const upd = await call(`/api/admin/complaints/${c.id}`, { method: "PATCH", headers: { ...A(admin), ...JSONH }, body: JSON.stringify({ status: "resolved", response: "Sorry! Two extra marshals from this Sunday." }) }, g);
    assert.equal(upd.status, 200);
    assert.ok(out("bongi@gmail.com").some((m) => m.subject.includes("Resolved")));
    const mine = await (await call("/api/me/complaints", { headers: { cookie: session } }, g)).json() as { complaints: { status: string; response: string }[] };
    assert.equal(mine.complaints[0].status, "resolved");
    assert.match(mine.complaints[0].response, /marshals/);
  });
});

describe("Daily Word & Prayer Wall", () => {
  test("daily word: same verse for everyone, check-in builds a streak and a community count", async () => {
    const g = await makeEnv({ GOOGLE_CLIENT_ID: CLIENT_ID });
    const anon = await (await call("/api/word/today", {}, g)).json() as { word: { ref: string; text: string; read_url: string }; me: null; readers_today: number };
    assert.ok(anon.word.text.length > 20 && anon.word.read_url.startsWith("https://www.bible.com/"));
    assert.equal(anon.me, null);
    assert.equal((await post("/api/word/today", {}, {}, g)).status, 401);
    const s = cookieOf(await post("/api/auth/google", { credential: await googleToken({ sub: "g-w1", email: "reader@gmail.com", given_name: "Kago" }) }, {}, g));
    const r1 = await (await post("/api/word/today", {}, { cookie: s }, g)).json() as { me: { done: boolean; streak: number; last7: { done: boolean }[] }; readers_today: number };
    assert.equal(r1.me.done, true); assert.equal(r1.me.streak, 1); assert.equal(r1.readers_today, 1);
    assert.equal(r1.me.last7.at(-1)!.done, true);
    // Twice in one day doesn't double count; a streak continues from yesterday.
    await post("/api/word/today", {}, { cookie: s }, g);
    const uid = (g.DB._db.prepare("SELECT id FROM users WHERE email = ?").get("reader@gmail.com") as { id: string }).id;
    const { saDay } = await import("../src/lib/word.ts");
    for (const n of [1, 2]) g.DB._db.prepare("INSERT INTO word_checkins (user_id, day) VALUES (?, ?)").run(uid, saDay(new Date(Date.now() - n * 86400_000)));
    const r2 = await (await call("/api/word/today", { headers: { cookie: s } }, g)).json() as { me: { streak: number }; readers_today: number };
    assert.equal(r2.me.streak, 3); assert.equal(r2.readers_today, 1);
  });

  test("prayer wall: approved before public, one 'I prayed' per person, owner marks answered", async () => {
    const g = await makeEnv({ GOOGLE_CLIENT_ID: CLIENT_ID });
    const sign = async (sub: string, email: string, given: string) => cookieOf(await post("/api/auth/google", { credential: await googleToken({ sub, email, given_name: given }) }, {}, g));
    const amo = await sign("g-a", "amo@gmail.com", "Amo"), ben = await sign("g-b", "ben@gmail.com", "Ben");
    assert.equal((await post("/api/wall", { request: "short" }, { cookie: amo }, g)).status, 422);
    const created = await post("/api/wall", { request: "Please pray for my matric exams next week.", show_name: true }, { cookie: amo }, g);
    assert.equal(created.status, 201);
    const { id } = await created.json() as { id: string };
    let wall = await (await call("/api/wall", { headers: { cookie: ben } }, g)).json() as { posts: { id: string }[] };
    assert.equal(wall.posts.length, 0, "not public until a leader approves");
    assert.equal((await post(`/api/wall/${id}/pray`, {}, { cookie: ben }, g)).status, 404);

    // Admin approves.
    const admin = await superCookie(g);
    const stats = await (await call("/api/admin/stats", { headers: { cookie: admin } }, g)).json() as { stats: { wall_pending: number }; attention: { kind: string }[] };
    assert.equal(stats.stats.wall_pending, 1);
    assert.ok(stats.attention.some((x) => x.kind === "wall"));
    assert.equal((await call(`/api/admin/wall/${id}`, { method: "PATCH", headers: { ...A(admin), ...JSONH }, body: JSON.stringify({ status: "approved" }) }, g)).status, 200);

    wall = await (await call("/api/wall", { headers: { cookie: ben } }, g)).json() as { posts: { id: string; display_name: string; prayed: number }[] };
    assert.equal(wall.posts[0].display_name, "Amo");
    const p1 = await (await post(`/api/wall/${id}/pray`, {}, { cookie: ben }, g)).json() as { prayed_count: number };
    const p2 = await (await post(`/api/wall/${id}/pray`, {}, { cookie: ben }, g)).json() as { prayed_count: number };
    assert.equal(p1.prayed_count, 1); assert.equal(p2.prayed_count, 1, "one prayer tap per person");
    assert.equal((await post(`/api/wall/${id}/pray`, {}, {}, g)).status, 401);
    assert.equal((await post(`/api/wall/${id}/answered`, { note: "Passed!" }, { cookie: ben }, g)).status, 404, "only the owner");
    assert.equal((await post(`/api/wall/${id}/answered`, { note: "Passed with distinction!" }, { cookie: amo }, g)).status, 200);
    const after = await (await call("/api/wall", {}, g)).json() as { posts: { answered: number; answered_note: string }[]; prayers_total: number };
    assert.equal(after.posts[0].answered, 1); assert.match(after.posts[0].answered_note, /distinction/); assert.equal(after.prayers_total, 1);
  });
});

describe("tickets: generator, PDF, door check-in", () => {
  test("approved booking for 3 → 3 unique QR tickets in one PDF; each scans once; copies are caught", async () => {
    const cookie = await adminCookie();
    const ev = await post("/api/admin/events", { title: "Ticketed Night", category: "night", ministry_group: "youth", starts_at: new Date(Date.now() + 9 * 86400_000).toISOString(),
      location: "Main hall", is_published: true, rsvp_enabled: true, form_schema: [] }, A(cookie));
    const { id: eventId, slug } = await ev.json() as { id: string; slug: string };
    const fd = new FormData(); fd.append("name", "Neo Mokoena"); fd.append("email", "neo@example.com"); fd.append("guests", "2");
    const reg = await call(`/api/events/${slug}/register`, { method: "POST", body: fd });
    assert.equal(reg.status, 201, await reg.clone().text());
    const mail = mails("neo@example.com").at(-1)! as { attachments?: { type: string; content: string; filename: string }[]; html?: string };
    const pdfAtt = mail.attachments!.find((a) => a.type === "application/pdf")!;
    const pdf = Buffer.from(pdfAtt.content, "base64").toString("latin1");
    assert.ok(pdf.startsWith("%PDF-1.4") && pdf.includes("/Count 3"), "one page per ticket");
    assert.match(mail.html!, /Your 3 tickets/);

    const rows = env.DB._db.prepare("SELECT code FROM tickets WHERE event_id = ? ORDER BY seq").all(eventId) as { code: string }[];
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((r) => r.code)).size, 3, "unique codes");
    assert.ok(rows.every((r) => /^[A-Z2-9]{16}$/.test(r.code)));

    // Public view shows limited info; QR + PDF downloads work.
    const pub = await (await call(`/api/tickets/${rows[0].code}`)).json() as { ticket: { holder: string; state: string; siblings: unknown[] } };
    assert.equal(pub.ticket.holder, "Neo"); assert.equal(pub.ticket.state, "valid"); assert.equal(pub.ticket.siblings.length, 3);
    assert.match(await (await call(`/api/tickets/${rows[0].code}/qr.svg`)).text(), /^<svg/);
    assert.equal((await call(`/api/tickets/${rows[1].code}/pdf`)).headers.get("content-type"), "application/pdf");
    assert.equal((await call("/api/tickets/AAAAAAAAAAAAAAAA")).status, 404, "fake codes are rejected");

    // The email carries a private "Download my tickets (PDF)" link that works without signing in.
    const href = /href="([^"]*\/api\/bookings\/[^"]+)"/.exec(mail.html!)![1].replace(/&amp;/g, "&");
    const link = new URL(href).pathname + new URL(href).search;
    const dl = await call(link);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("content-type"), "application/pdf");
    assert.match(dl.headers.get("content-disposition") || "", /attachment; filename="tickets-/);
    assert.ok(Buffer.from(await dl.arrayBuffer()).toString("latin1").includes("/Count 3"));
    assert.equal((await call(link.replace(/k=[A-Z0-9]+/, "k=WRONGKEYWRONGKEYWRONGKEY"))).status, 404, "wrong key refused");

    // Admins can check people in, but never open someone else's QR code or PDF.
    const adminView = await (await call(`/api/tickets/${rows[0].code}`, { headers: { cookie } })).json() as { admin_view: boolean; ticket: { holder: string; siblings?: unknown } };
    assert.equal(adminView.admin_view, true); assert.equal(adminView.ticket.holder, "Neo Mokoena"); assert.equal(adminView.ticket.siblings, undefined);
    assert.equal((await call(`/api/tickets/${rows[0].code}/pdf`, { headers: { cookie } })).status, 403);
    assert.equal((await call(`/api/tickets/${rows[0].code}/qr.svg`, { headers: { cookie } })).status, 403);
    const list = await (await call(`/api/admin/events/${eventId}/tickets`, { headers: { cookie } })).json() as { tickets: Record<string, unknown>[] };
    assert.ok(list.tickets.every((t) => !("code" in t)), "admin lists never expose ticket codes");

    // Door: first scan admits, a copy is flagged, wrong event is flagged, non-admins can't check in.
    const scan = async (code: string, event_id?: string) => { const res = await post("/api/admin/tickets/check-in", { code, event_id }, A(cookie)); const j = await res.json() as { result: string; ticket: { holder: string }; error?: string }; if (!j.result) console.log("SCAN", res.status, j); return j; };
    const checkedMails = () => mails("neo@example.com").filter((m) => /checked in/i.test(m.subject));
    const first = await scan(`https://aogsccyouth.com/ticket?c=${rows[0].code}`, eventId);
    assert.equal(first.result, "ok"); assert.equal(first.ticket.holder, "Neo Mokoena");
    assert.equal(checkedMails().length, 1, "the holder is emailed when their ticket is scanned in");
    assert.equal((await scan(rows[0].code, eventId)).result, "already_used");
    assert.equal(checkedMails().length, 1, "a rejected copy sends no second email");
    assert.equal((await scan(rows[1].code, "some-other-event")).result, "wrong_event");
    assert.equal((await post("/api/admin/tickets/check-in", { code: rows[1].code })).status, 401);
    const stats = await (await call(`/api/admin/events/${eventId}/tickets`, { headers: { cookie } })).json() as { total: number; checked_in: number };
    assert.equal(stats.total, 3); assert.equal(stats.checked_in, 1);

    // Cancelling voids the remaining tickets.
    const regRow = env.DB._db.prepare("SELECT id FROM event_registrations WHERE email = ? AND event_id = ?").get("neo@example.com", eventId) as { id: string };
    await call(`/api/admin/registrations/${regRow.id}`, { method: "PATCH", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ status: "cancelled" }) });
    assert.equal((await scan(rows[2].code, eventId)).result, "void");
  });
});

describe("delegated admins (team & roles)", () => {
  test("main admin grants a member admin; their own sign-in becomes admin at once; can approve but not delete; removal is immediate", async () => {
    const g = await makeEnv({ GOOGLE_CLIENT_ID: CLIENT_ID });
    const signIn = async (sub: string, email: string, given: string) => post("/api/auth/google", { credential: await googleToken({ sub, email, given_name: given, name: `${given} T` }) }, {}, g);
    // A registered member with a Google account.
    assert.equal((await call("/api/join", { method: "POST", body: joinForm({ email: "lebo@gmail.com", first_name: "Lebo" }) }, g)).status, 201);
    const leboUser = cookieOf(await signIn("g-lebo", "lebo@gmail.com", "Lebo"));
    assert.equal((await call("/api/admin/stats", { headers: { cookie: leboUser } }, g)).status, 401, "no role yet");

    // Main admin signs in (Google + code) and grants the role.
    const sup = await superCookie(g);
    const team = await (await call("/api/admin/team?q=lebo", { headers: { cookie: sup } }, g)).json() as { people: { user_id: string; email: string }[] };
    const lebo = team.people.find((p) => p.email === "lebo@gmail.com")!;
    assert.equal((await call("/api/admin/team", { method: "POST", headers: { ...A(sup), ...JSONH }, body: JSON.stringify({ user_id: lebo.user_id }) }, g)).status, 200);
    const role0 = g.DB._db.prepare("SELECT perms FROM admin_roles WHERE user_id = ?").get(lebo.user_id) as { perms: string };
    assert.deepEqual(JSON.parse(role0.perms), ["reports", "services"], "new admins start with reports and weekly services only");
    // Not yet allowed to verify members…
    const mid0 = (g.DB._db.prepare("SELECT id FROM members WHERE email = ?").get("lebo@gmail.com") as { id: string }).id;
    assert.equal((await call(`/api/admin/members/${mid0}`, { method: "PATCH", headers: { ...A(leboUser), ...JSONH }, body: JSON.stringify({ status: "member" }) }, g)).status, 403, "only what's ticked");
    // …until the main admin ticks Members.
    assert.equal((await call(`/api/admin/team/${lebo.user_id}`, { method: "PATCH", headers: { ...A(sup), ...JSONH }, body: JSON.stringify({ perms: ["reports", "services", "members"] }) }, g)).status, 200);
    assert.ok(g.EMAIL.outbox.some((m) => JSON.stringify(m.to).includes("lebo@gmail.com") && /admin team/.test(m.subject) && /leaders of AOG Sandton City Church/.test(m.html || "") && /Reports/.test(m.html || "")));

    // Lebo: the same sign-in now has admin powers, no switching and no code.
    const me = await (await call("/api/auth/me", { headers: { cookie: leboUser } }, g)).json() as { can_admin: boolean; is_admin: boolean };
    assert.equal(me.can_admin, true); assert.equal(me.is_admin, true);
    const staff = leboUser;
    const who = await (await call("/api/admin/whoami", { headers: { cookie: staff } }, g)).json() as { role: string };
    assert.equal(who.role, "staff");
    assert.equal((await call("/api/admin/stats", { headers: { cookie: staff } }, g)).status, 200, "can use the dashboard");
    assert.equal((await call("/api/admin/team", { headers: { cookie: staff } }, g)).status, 403, "can't manage roles");
    const mid = (g.DB._db.prepare("SELECT id FROM members WHERE email = ?").get("lebo@gmail.com") as { id: string }).id;
    assert.equal((await call(`/api/admin/members/${mid}`, { method: "DELETE", headers: A(staff) }, g)).status, 403, "can't delete people");
    assert.equal((await call(`/api/admin/members/${mid}`, { method: "PATCH", headers: { ...A(staff), ...JSONH }, body: JSON.stringify({ status: "member" }) }, g)).status, 200, "can verify members");

    // Removing the role takes effect straight away.
    assert.equal((await call(`/api/admin/team/${lebo.user_id}`, { method: "DELETE", headers: A(sup) }, g)).status, 200);
    assert.equal((await call("/api/admin/stats", { headers: { cookie: staff } }, g)).status, 401);
    // Re-granting is safe (idempotent), and revoking the membership removes admin access automatically.
    const grant = () => call("/api/admin/team", { method: "POST", headers: { ...A(sup), ...JSONH }, body: JSON.stringify({ user_id: lebo.user_id }) }, g);
    assert.equal((await grant()).status, 200);
    assert.equal(((await (await grant()).json()) as { already?: boolean }).already, true);
    assert.equal((await call(`/api/admin/members/${mid}`, { method: "PATCH", headers: { ...A(sup), ...JSONH }, body: JSON.stringify({ status: "revoked" }) }, g)).status, 200);
    assert.equal((g.DB._db.prepare("SELECT COUNT(*) n FROM admin_roles").get() as { n: number }).n, 0, "no membership → no admin role");
  });
});

describe("church programme", () => {
  test("public sees the SCC calendar; members also see the Sub-Region; board meetings stay with leaders; admin can add", async () => {
    const g = await makeEnv({ GOOGLE_CLIENT_ID: CLIENT_ID });
    const pub = await (await call("/api/programme?from=2026-01-01&limit=300", {}, g)).json() as { items: { audience: string; source: string; title: string }[]; weekly: { day: string; title: string; time: string }[]; member: boolean };
    assert.equal(pub.member, false);
    assert.equal(pub.weekly.length, 8, "weekly services come from the database (Thursday's three ministries are separate)");
    assert.ok(pub.weekly.some((w) => w.day === "Monday" && w.title === "Prayer" && w.time === "18:00 – 20:00"), "Monday prayer is 18:00 – 20:00");
    assert.ok(!pub.weekly.some((w) => w.day === "Saturday"), "Saturday is a rest day");
    assert.ok(pub.items.length > 50 && pub.items.every((i) => i.audience === "public"), "only public items");
    assert.ok(!pub.items.some((i) => /Board Meeting/i.test(i.title)), "board meetings hidden");
    assert.equal((await call("/api/join", { method: "POST", body: joinForm({ email: "member@gmail.com" }) }, g)).status, 201);
    const s = cookieOf(await post("/api/auth/google", { credential: await googleToken({ sub: "g-m", email: "member@gmail.com", given_name: "M" }) }, {}, g));
    const mem = await (await call("/api/programme?from=2026-01-01&limit=300", { headers: { cookie: s } }, g)).json() as { member: boolean; items: { audience: string; source: string }[] };
    assert.equal(mem.member, true);
    assert.ok(mem.items.some((i) => i.source === "germiston" && i.audience === "members"));
    assert.ok(!mem.items.some((i) => i.audience === "leaders"));
  });
});

describe("door, insights, weekly services and the board report", () => {
  let cookie = "", eventId = "", slug = "";
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const lastWeekday = (day: number) => { const d = new Date(); d.setUTCHours(12); while (d.getUTCDay() !== day) d.setUTCDate(d.getUTCDate() - 1); if (ymd(d) === ymd(new Date())) d.setUTCDate(d.getUTCDate() - 7); return ymd(d); };
  before(async () => { cookie = await adminCookie(); });

  test("approvals respond with tickets already issued; every ticket admits exactly once across doors; retries are safe", async () => {
    await call("/api/admin/settings", { method: "PUT", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ banking_details: "Capitec · 1623526815" }) });
    const ev = await post("/api/admin/events", { title: "Insights Night", ministry_group: "youth", starts_at: new Date(Date.now() + 2 * 86400_000).toISOString(),
      is_published: true, rsvp_enabled: true, ticket_price: 150, requires_pop: true, auto_approve: false, form_schema: [] }, A(cookie));
    assert.equal(ev.status, 201, await ev.clone().text());
    ({ id: eventId, slug } = await ev.json() as { id: string; slug: string });
    // An event without a ministry group is refused.
    assert.equal((await post("/api/admin/events", { title: "No group", starts_at: "2030-01-01T10:00:00Z" }, A(cookie))).status, 422);

    const fd = new FormData(); Object.entries({ name: "Lerato Dube", email: "lerato@example.com", phone: "0821234567", guests: "1" }).forEach(([k, v]) => fd.append(k, v));
    fd.append("pop", new File([PDF], "pop.pdf", { type: "application/pdf" }));
    assert.equal((await call(`/api/events/${slug}/register`, { method: "POST", body: fd })).status, 201);
    const regId = (env.DB._db.prepare("SELECT id FROM event_registrations WHERE event_id = ?").get(eventId) as { id: string }).id;
    const ap = await call(`/api/admin/registrations/${regId}`, { method: "PATCH", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ status: "confirmed" }) });
    assert.equal(ap.status, 200);
    const codes = env.DB._db.prepare("SELECT code FROM tickets WHERE event_id = ? AND status = 'valid' ORDER BY seq").all(eventId) as { code: string }[];
    assert.equal(codes.length, 2, "tickets exist as soon as the approval returns");

    // Two doors scan the same ticket at the same moment: exactly one admits.
    const scan = (code: string, scan_id: string) => post("/api/admin/tickets/check-in", { code, event_id: eventId, scan_id }, A(cookie)).then((r) => r.json() as Promise<{ result: string; repeat?: boolean }>);
    const [a, b] = await Promise.all([scan(codes[0].code, "door-a-0000001"), scan(codes[0].code, "door-b-0000001")]);
    assert.deepEqual([a.result, b.result].sort(), ["already_used", "ok"]);
    const winner = a.result === "ok" ? "door-a-0000001" : "door-b-0000001";
    // The winning door's retry (lost response) still reads "Checked in" and sends no second email.
    const before = mails("lerato@example.com").filter((m) => /checked in/i.test(m.subject)).length;
    const retry = await scan(codes[0].code, winner);
    assert.equal(retry.result, "ok"); assert.equal(retry.repeat, true);
    assert.equal(mails("lerato@example.com").filter((m) => /checked in/i.test(m.subject)).length, before);
    assert.equal((await scan(codes[0].code, "door-c-0000001")).result, "already_used");
    // Only the main admin may re-open a used ticket.
    assert.equal(env.DB._db.prepare("SELECT checked_in_at IS NOT NULL AS used FROM tickets WHERE code = ?").get(codes[0].code).used, 1);
  });

  test("the main admin stays signed in as admin without any codes", async () => {
    const c = await adminCookie();
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(c.split("=")[1]).digest("hex");
    env.DB._db.prepare("UPDATE sessions SET admin_until = ? WHERE token_hash = ?").run(new Date(Date.now() - 1000).toISOString(), hash);
    assert.equal((await call("/api/admin/stats", { headers: { cookie: c } })).status, 200);
  });

  test("event insights: sold, came, no-shows, money incl. other income", async () => {
    const upcoming = await (await call(`/api/admin/insights/events/${eventId}`, { headers: { cookie } })).json() as { event: Record<string, unknown> };
    assert.equal(upcoming.event.no_shows, null, "no-shows only count once the event is over");
    env.DB._db.prepare("UPDATE events SET starts_at = ? WHERE id = ?").run(new Date(Date.now() - 6 * 3600_000).toISOString(), eventId);   // the night has happened
    assert.equal((await call(`/api/admin/events/${eventId}/income`, { method: "PATCH", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ extra_income: "R 500", extra_income_note: "Cash at the door" }) })).status, 200);
    const r = await (await call(`/api/admin/insights/events/${eventId}`, { headers: { cookie } })).json() as { event: Record<string, number | string | boolean>; registrations: unknown[]; arrivals: [string, number][] };
    assert.equal(r.event.sold, 2); assert.equal(r.event.came, 1); assert.equal(r.event.no_shows, 1); assert.equal(r.event.attendance_rate, 50);
    assert.equal(r.event.ticket_income, 300); assert.equal(r.event.extra_income, 500); assert.equal(r.event.income, 800);
    assert.equal(r.event.group_label, "Youth Ministry");
    assert.equal(r.arrivals.reduce((t, [, n]) => t + n, 0), 1);
    const list = await (await call("/api/admin/insights/events", { headers: { cookie } })).json() as { events: { id: string }[] };
    assert.ok(list.events.some((e) => e.id === eventId));
    assert.equal((await call(`/api/admin/insights/events/${eventId}`)).status, 401, "admins only");
  });

  test("weekly services: simple record (topic, MC, word of the day, attendance, visitors, money in Rands), poster optional, right weekday, one per date", async () => {
    const svc = await (await call("/api/admin/services", { headers: { cookie } })).json() as { services: { id: string; day: number; next_date: string; dates: string[] }[] };
    const youth = svc.services.find((s) => s.id === "svc-fri-youth")!;
    assert.ok(youth.dates.every((d) => new Date(d + "T12:00:00Z").getUTCDay() === 5), "dates follow the service's weekday");
    const form = (o: Record<string, string>, poster = true) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.append(k, v)); if (poster) f.append("poster", new File([PNG], "poster.png", { type: "image/png" })); return f; };
    const send = (f: FormData, method = "POST", path = "/api/admin/sessions") => call(path, { method, headers: A(cookie), body: f });
    const plan = { mc: "Thabo", scripture: "Hebrews 11:1" };
    const results = { attendance: "84", first_time_visitors: "6", money: "5250.50", salvations: "3" };
    const friday = lastWeekday(5);
    const bad = await send(form({ service_id: youth.id, date: friday, topic: "Bold faith" }));
    assert.equal(bad.status, 422);
    const det = (await bad.json() as { details: Record<string, string> }).details;
    for (const k of ["mc", "scripture", "attendance", "first_time_visitors", "money"]) assert.ok(det[k], `${k} is required`);
    for (const k of ["poster", "speaker", "summary", "notes", "salvations", "rededications"]) assert.ok(!det[k], `${k} is optional`);
    assert.equal((await send(form({ service_id: youth.id, date: friday, topic: "Bold faith", ...plan, ...results, money: "R1250" }))).status, 422, "money is numbers only");
    assert.equal((await send(form({ service_id: youth.id, date: friday, topic: "Bold faith", ...plan, ...results, money: "$40" }))).status, 422, "Rands only");
    assert.equal((await send(form({ service_id: youth.id, date: lastWeekday(3), topic: "Bold faith", ...plan, ...results }))).status, 422, "must be on the service's day");
    const ok = await send(form({ service_id: youth.id, date: friday, topic: "Bold faith", ...plan, ...results }, false));
    assert.equal(ok.status, 201, await ok.clone().text());
    const { id } = await ok.json() as { id: string };
    assert.equal((await send(form({ service_id: youth.id, date: friday, topic: "Again", ...plan, ...results }))).status, 409, "one record per service per date");
    assert.equal((await send(form({ date: friday, topic: "Bold faith", ...plan, ...results, attendance: "90" }), "PUT", `/api/admin/sessions/${id}`)).status, 200);
    const row = env.DB._db.prepare("SELECT attendance, offering_cents, salvations, poster_attachment_id FROM service_sessions WHERE id = ?").get(id) as Record<string, unknown>;
    assert.equal(row.attendance, 90); assert.equal(row.offering_cents, 525050); assert.equal(row.salvations, 3);
    assert.ok(row.poster_attachment_id);
    // A coming service can be planned ahead (numbers on the day). It shows on the website with its poster.
    assert.equal((await send(form({ service_id: youth.id, date: youth.next_date, topic: "Next week's word", ...plan }))).status, 201);
    const pub = await (await call("/api/programme")).json() as { weekly: { id: string; next: { topic: string; poster_url: string } | null }[] };
    const y = pub.weekly.find((w) => w.id === youth.id)!;
    assert.equal(y.next?.topic, "Next week's word");
    assert.equal((await call(y.next!.poster_url)).status, 200, "poster is public");
    // MC picker: church members' and team names.
    const ppl = await (await call("/api/admin/sessions/people", { headers: { cookie } })).json() as { people: string[] };
    assert.ok(Array.isArray(ppl.people));
    // Anyone on the team can record a service; managing the list, reminders and deleting stay with Weekly services access.
    assert.equal(permFor("GET", "/api/admin/services"), "*"); assert.equal(permFor("POST", "/api/admin/sessions"), "*"); assert.equal(permFor("PUT", "/api/admin/sessions/x"), "*"); assert.equal(permFor("GET", "/api/admin/sessions/people"), "*");
    assert.equal(permFor("DELETE", "/api/admin/sessions/x"), "services"); assert.equal(permFor("POST", "/api/admin/services"), "services"); assert.equal(permFor("POST", "/api/admin/services/x/remind"), "services");
    // Admins can add a service; it needs a ministry group.
    assert.equal((await post("/api/admin/services", { title: "Men's breakfast", day: 6, start_time: "08:00" }, A(cookie))).status, 422);
    assert.equal((await post("/api/admin/services", { title: "Men's breakfast", day: 6, start_time: "08:00", end_time: "10:00", ministry_group: "fathers", frequency: "monthly" }, A(cookie))).status, 201);
  });

  test("board report: money per event and ministry, services, growth, membership; CSV download", async () => {
    const from = `${new Date().getUTCFullYear() - 1}-01-01`, to = ymd(new Date(Date.now() + 86400_000));
    const { report: r } = await (await call(`/api/admin/report?from=${from}&to=${to}`, { headers: { cookie } })).json() as { report: { totals: Record<string, number>; by_group: { group: string; income: number; event_income: number; service_income: number }[]; growth: Record<string, number> } };
    const youth = r.by_group.find((g) => g.group === "youth")!;
    assert.ok(youth.event_income >= 800, "youth event income includes Insights Night");
    assert.ok(youth.service_income >= 5250.5, "offering + tithes from the youth service (plus imported history)");
    assert.ok(r.growth.salvations >= 3 && r.growth.first_time_visitors >= 6);
    assert.ok(Math.abs(r.totals.income - (r.totals.event_income + r.totals.offering + r.totals.tithes + r.totals.other)) < 0.001);
    const csv = await call(`/api/admin/report.csv?from=${from}&to=${to}`, { headers: { cookie } });
    assert.equal(csv.status, 200);
    const text = await csv.text();
    assert.match(text, /Board report/); assert.match(text, /Youth Ministry/); assert.match(text, /Insights Night/);
    assert.equal((await call(`/api/admin/report?from=${to}&to=${from}`, { headers: { cookie } })).status, 400, "from must be before to");
  });

  test("youth report: the spreadsheet history reads correctly (incl. the R1 945,20 the sheet left out)", async () => {
    const { report: r } = await (await call("/api/admin/reports/ministry?group=youth&year=2026", { headers: { cookie } })).json() as { report: { totals: Record<string, number>; months: { month: string; offerings: number; out: number }[]; best: { attendance: number; topic: string }; imported: boolean; sessions: { status: string; source: string | null }[] } };
    const imported = r.sessions.filter((x) => x.source === "spreadsheet");
    assert.equal(imported.filter((x) => x.status === "held").length, 16);
    assert.equal(imported.filter((x) => x.status === "cancelled").length, 10);
    const feb = r.months.find((m) => m.month === "02")!;
    assert.ok(Math.abs(feb.offerings - 3749.2) < 0.001, "Feb Fridays incl. R1 945,20 (the 2 Jan monthly counts in January)");
    assert.equal(feb.out, 2950);
    assert.ok(r.best.attendance >= 70, "best night (70 at the Youth Monthly, unless a bigger one was recorded since)");
    assert.ok(r.totals.out >= 8950 && r.imported);
    assert.equal((await call("/api/admin/reports/ministry?group=youth&year=2026")).status, 401, "admins only");
  });

  test("service reminders: due at the right time, sent once, skip 'no service', one-tap stop that keeps the letter", async () => {
    const { dueDate, processServiceReminders } = await import("../src/lib/reminders.ts");
    // Friday 18:00 youth service → 09:00 SAST on the Friday; Sunday 08:45 → 17:00 SAST on the Saturday.
    const fri0900 = new Date("2026-10-16T07:05:00Z"), fri0800 = new Date("2026-10-16T06:00:00Z"), sat1700 = new Date("2026-10-17T15:10:00Z");
    const youth = { id: "svc-fri-youth", day: 5, title: "Youth service", start_time: "18:00", end_time: "20:00", frequency: "weekly" };
    const sunday = { id: "svc-sun-main", day: 0, title: "Main service", start_time: "08:45", end_time: "11:00", frequency: "weekly" };
    assert.deepEqual(dueDate(youth, fri0900), { date: "2026-10-16", tonight: true });
    assert.equal(dueDate(youth, fri0800), null);
    assert.deepEqual(dueDate(sunday, sat1700), { date: "2026-10-18", tonight: false });
    assert.equal(dueDate(sunday, fri0900), null);

    // Switch reminders on for the youth service; a member + a letter subscriber get it once.
    env.DB._db.prepare("UPDATE weekly_services SET reminders = 1 WHERE id = 'svc-fri-youth'").run();
    env.DB._db.prepare("INSERT OR IGNORE INTO subscribers (id, email, name, status, token) VALUES ('sub-rem', 'reader@example.com', 'Reader', 'active', 'tok-reader-rem')").run();
    const before = mails().filter((m) => m.template === "service_reminder" || /Tonight: Youth service/.test(m.subject)).length;
    await processServiceReminders(env, fri0900);
    const sent = mails().filter((m) => /Tonight: Youth service/.test(m.subject));
    assert.ok(sent.length - before >= 2, "letter subscribers and members are reminded");
    await processServiceReminders(env, new Date("2026-10-16T07:20:00Z"));
    assert.equal(mails().filter((m) => /Tonight: Youth service/.test(m.subject)).length, sent.length, "only once per service date");

    // One tap from the email stops reminders only.
    const mail = mails("reader@example.com").filter((m) => /Tonight: Youth service/.test(m.subject)).at(-1)!;
    const t = /reminders\?t=([^"&<\s]+)/.exec(mail.html!)![1];
    const look = await (await post("/api/reminders/lookup", { t: decodeURIComponent(t) })).json() as { on: boolean; email: string };
    assert.equal(look.on, true); assert.ok(!look.email.includes("reader@"), "email is masked");
    assert.equal((await call(`/api/reminders/stop?t=${t}`, { method: "POST" })).status, 200, "mail-app one-click works");
    const row = env.DB._db.prepare("SELECT status, service_reminders FROM subscribers WHERE email = 'reader@example.com'").get() as { status: string; service_reminders: number };
    assert.equal(row.service_reminders, 0); assert.equal(row.status, "active", "still on the weekly letter");
    // A 'no service' Friday sends nothing.
    env.DB._db.prepare("INSERT OR REPLACE INTO service_sessions (id, service_id, date, status, topic, cancel_reason) VALUES ('ns-1', 'svc-fri-youth', '2026-10-23', 'cancelled', 'No youth service', 'Youth Quarterly')").run();
    const n = mails().length;
    await processServiceReminders(env, new Date("2026-10-23T07:05:00Z"));
    assert.equal(mails().length, n);
    env.DB._db.prepare("UPDATE weekly_services SET reminders = 0 WHERE id = 'svc-fri-youth'").run();
  });

  test("leader care: confirmed members are shared out fairly; next-day check-in; 'not yet' snoozes; 'yes' logs how; handover; leaving the team reassigns", async () => {
    const { processFollowups } = await import("../src/lib/leaders.ts");
    // Two delegated admins (leaders).
    for (const [id, email, name] of [["u-lead-a", "lead.a@example.com", "Ayanda"], ["u-lead-b", "lead.b@example.com", "Bongi"]]) {
      env.DB._db.prepare("INSERT OR IGNORE INTO users (id, email, name, given_name) VALUES (?,?,?,?)").run(id, email, name, name);
      env.DB._db.prepare("INSERT OR IGNORE INTO admin_roles (user_id, email, granted_by) VALUES (?,?,?)").run(id, email, "aogsccmedia@gmail.com");
    }
    const joinAndConfirm = async (email: string, first: string) => {
      const r = await call("/api/join", { method: "POST", body: joinForm({ email, first_name: first, signature_name: `${first} Test` }) });
      assert.equal(r.status, 201, await r.clone().text());
      const id = (env.DB._db.prepare("SELECT id FROM members WHERE email = ?").get(email) as { id: string }).id;
      // Joining alone assigns nobody.
      assert.equal((env.DB._db.prepare("SELECT leader_user_id FROM members WHERE id = ?").get(id) as { leader_user_id: string | null }).leader_user_id, null);
      const welcome = mails(email).find((m) => /Welcome to the family/.test(m.subject))!;
      assert.doesNotMatch(welcome.html!, /reach out to you personally within the week/, "no leader promise before confirmation");
      assert.equal((await call(`/api/admin/members/${id}`, { method: "PATCH", headers: { ...A(cookie), ...JSONH }, body: JSON.stringify({ status: "member" }) })).status, 200);
      return id;
    };
    const ids = [await joinAndConfirm("care1@example.com", "Care1"), await joinAndConfirm("care2@example.com", "Care2"), await joinAndConfirm("care3@example.com", "Care3"), await joinAndConfirm("care4@example.com", "Care4")];
    const rows = ids.map((id) => env.DB._db.prepare("SELECT leader_user_id, assigned_to, followup_status, followup_next_ask_at FROM members WHERE id = ?").get(id) as Record<string, string>);
    const counts = (uid: string) => (env.DB._db.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'member' AND leader_user_id = ?").get(uid) as { n: number }).n;
    assert.ok(rows.every((r) => r.leader_user_id && r.followup_status === "pending"));
    assert.ok(Math.abs(counts("u-lead-a") - counts("u-lead-b")) <= 1, "shared out fairly");
    // Member hears who their leader is; the leader gets an introduction.
    const verified = mails("care1@example.com").find((m) => /officially a member/.test(m.subject))!;
    assert.match(verified.html!, new RegExp(rows[0].assigned_to));
    const leaderEmail = rows[0].leader_user_id === "u-lead-a" ? "lead.a@example.com" : "lead.b@example.com";
    assert.ok(mails(leaderEmail).some((m) => /Please welcome Care1/.test(m.subject)));

    // Nothing before a day has passed; then the check-in goes out once.
    const askAt = new Date(rows[0].followup_next_ask_at);
    await processFollowups(env, new Date(askAt.getTime() - 60_000));
    assert.ok(!mails(leaderEmail).some((m) => /connected with Care1/.test(m.subject)));
    await processFollowups(env, new Date(askAt.getTime() + 60_000));
    const ask = mails(leaderEmail).filter((m) => /connected with Care1/.test(m.subject));
    assert.equal(ask.length, 1);
    await processFollowups(env, new Date(askAt.getTime() + 120_000));
    assert.equal(mails(leaderEmail).filter((m) => /connected with Care1/.test(m.subject)).length, 1, "not twice in a row");
    const t = decodeURIComponent(/followup\?t=([^"&<\s]+)/.exec(ask[0].html!)![1]);
    // "Not yet" → asked again later; "Yes" → how.
    assert.equal(((await (await post("/api/followup", { t, met: false, days: 7 })).json()) as { days: number }).days, 7);
    assert.equal((env.DB._db.prepare("SELECT followup_status FROM members WHERE id = ?").get(ids[0]) as { followup_status: string }).followup_status, "not_yet");
    assert.equal((await post("/api/followup", { t, met: true, method: "whatsapp", note: "Lovely chat" })).status, 200);
    const done = env.DB._db.prepare("SELECT followup_status, followup_method, last_contact_at FROM members WHERE id = ?").get(ids[0]) as Record<string, string>;
    assert.equal(done.followup_status, "met"); assert.equal(done.followup_method, "whatsapp"); assert.ok(done.last_contact_at);
    assert.equal((env.DB._db.prepare("SELECT COUNT(*) AS n FROM member_contacts WHERE member_id = ?").get(ids[0]) as { n: number }).n, 1);

    // Handover to the other leader.
    const other = rows[1].leader_user_id === "u-lead-a" ? "u-lead-b" : "u-lead-a";
    assert.equal((await post(`/api/admin/people/${ids[1]}/handover`, { to: other }, A(cookie))).status, 200);
    assert.equal((env.DB._db.prepare("SELECT leader_user_id FROM members WHERE id = ?").get(ids[1]) as { leader_user_id: string }).leader_user_id, other);
    // A leader leaves the team → their people move to the remaining leader.
    assert.equal((await call("/api/admin/team/u-lead-a", { method: "DELETE", headers: A(cookie) })).status, 200);
    assert.equal(counts("u-lead-a"), 0);
    assert.ok(ids.every((id) => (env.DB._db.prepare("SELECT leader_user_id FROM members WHERE id = ?").get(id) as { leader_user_id: string }).leader_user_id === "u-lead-b"));
  });

  test("RSVP from the reminder email: one tap to answer, optional reason, visible to admins", async () => {
    const { rsvpLinks } = await import("../src/lib/rsvp.ts");
    const links = await rsvpLinks(env, "svc-fri-youth", "2026-10-16", "guest@example.com", "Guest");
    const tok = decodeURIComponent(new URL(links.no).searchParams.get("t")!);
    const look = await (await post("/api/rsvp/lookup", { t: tok })).json() as { service: string; response: string | null };
    assert.equal(look.service, "Youth service"); assert.equal(look.response, null);
    assert.equal((await post("/api/rsvp", { t: tok, response: "no", reason_code: "work" })).status, 200);
    const sum = await (await call("/api/admin/rsvps?service_id=svc-fri-youth&date=2026-10-16", { headers: { cookie } })).json() as { coming: number; not_coming: number; reasons: Record<string, number> };
    assert.equal(sum.not_coming, 1); assert.equal(sum.reasons["Work or studies"], 1);
    assert.equal((await post("/api/rsvp", { t: tok, response: "yes" })).status, 200);
    const sum2 = await (await call("/api/admin/rsvps?service_id=svc-fri-youth&date=2026-10-16", { headers: { cookie } })).json() as { coming: number; not_coming: number };
    assert.equal(sum2.coming, 1); assert.equal(sum2.not_coming, 0, "changing your mind updates the answer");
    assert.equal((await call("/api/whatsapp/webhook", { method: "POST", body: "{}" })).status, 401, "WhatsApp webhook rejects unsigned calls");
  });

  test("leader catch-up: confirmed non-admin members without a leader get one and are told who; admins never get a leader", async () => {
    const { backfillLeaders } = await import("../src/lib/leaders.ts");
    env.DB._db.prepare("INSERT OR IGNORE INTO users (id, email, name, given_name) VALUES ('u-lead-c', 'lead.c@example.com', 'Chipo', 'Chipo')").run();
    env.DB._db.prepare("INSERT OR IGNORE INTO admin_roles (user_id, email, granted_by) VALUES ('u-lead-c', 'lead.c@example.com', 'x')").run();
    const add = (id: string, email: string, first: string, uid: string | null) => env.DB._db.prepare(
      "INSERT INTO members (id, ref_code, status, membership_type, first_name, last_name, date_of_birth, phone, email, signature_name, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, `SCCY-T-${id}`, "member", "new_member", first, "Test", "1999-01-01", "0820000000", email, first, uid);
    add("old-1", "old.member@example.com", "Lerato", null);          // confirmed before leaders existed
    add("adm-1", "lead.c@example.com", "Chipo", "u-lead-c");          // an admin who is also a member
    const n = await backfillLeaders(env);
    assert.ok(n >= 1);
    const old = env.DB._db.prepare("SELECT leader_user_id, assigned_to FROM members WHERE id = 'old-1'").get() as { leader_user_id: string; assigned_to: string };
    assert.ok(old.leader_user_id && old.leader_user_id !== "u-lead-c" || old.leader_user_id === "u-lead-c");
    const intro = mails("old.member@example.com").find((m) => /meet your leader/i.test(m.subject))!;
    assert.ok(intro, "member is told who their leader is"); assert.match(intro.html!, new RegExp(old.assigned_to));
    assert.equal((env.DB._db.prepare("SELECT leader_user_id FROM members WHERE id = 'adm-1'").get() as { leader_user_id: string | null }).leader_user_id, null, "admins don't get a leader");
    assert.equal(await backfillLeaders(env), 0, "nothing twice");
  });
});

describe("presenter beta & code changes", () => {
  test("beta: email + password account, 20 places only, feedback needs a real beta key", async () => {
    const start = await post("/api/auth/password/start", { email: "tester.a@example.com", password: "longenough1", name: "Tester A" });
    const { challenge } = await start.json() as { challenge: string };
    const code = /(\d{6}) is your verification code/.exec(mails("tester.a@example.com").at(-1)!.subject)![1];
    const v = await post("/api/auth/password/verify", { challenge, code });
    assert.equal(v.status, 200);
    const cookie = cookieOf(v);
    // Fill the other 19 places directly, then try to take a 21st.
    for (let i = 0; i < 19; i++) {
      env.DB._db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(`bt-${i}`, `bt${i}@example.com`);
      env.DB._db.prepare("INSERT INTO beta_testers (id, user_id, email, slot, beta_key) VALUES (?,?,?,?,?)").run(`t-${i}`, `bt-${i}`, `bt${i}@example.com`, i + 1, `SCC-TEST-${String(i).padStart(4, "0")}`);
    }
    const j = await post("/api/presenter/join", { church: "Test" }, { cookie });
    assert.equal(j.status, 200);
    const { tester } = await j.json() as { tester: { slot: number; beta_key: string } };
    assert.equal(tester.slot, 20);
    env.DB._db.prepare("INSERT INTO users (id, email, google_sub) VALUES ('late', 'late@example.com', 'g-late')").run();
    const lateLogin = await post("/api/auth/password/start", { email: "late@example.com", password: "longenough1" });
    const lc = (await lateLogin.json() as { challenge: string }).challenge;
    const lcode = /(\d{6}) is your verification code/.exec(mails("late@example.com").at(-1)!.subject)![1];
    const lateCookie = cookieOf(await post("/api/auth/password/verify", { challenge: lc, code: lcode }));
    assert.equal((await post("/api/presenter/join", {}, { cookie: lateCookie })).status, 409, "no 21st tester");
    assert.equal((await post("/api/presenter/feedback", { key: "SCC-NOPE-NOPE", overall: 5 })).status, 403);
    assert.equal((await post("/api/presenter/feedback", { key: tester.beta_key, overall: 4, good: "Easy", source: "app" })).status, 200);
    assert.ok(mails("aogsccmedia@gmail.com").some((m) => /FreeCreator beta feedback/.test(m.subject)));
    // Downloads stay off until the beta opens on 1 February 2027: no link to GitHub, just "coming soon".
    const st = await (await call("/api/presenter/status", { headers: { cookie } })).json() as { downloads_open: boolean; opens: string; release: unknown };
    assert.equal(st.downloads_open, false); assert.equal(st.opens, "2027-02-01"); assert.equal(st.release, null);
    const dl = await call("/api/presenter/download/windows", { headers: { cookie }, redirect: "manual" });
    assert.match(dl.headers.get("location") || "", /msg=soon/);
  });

  test("GitHub alerts need a valid signature; a new pull request emails the main admin", async () => {
    const body = JSON.stringify({ action: "opened", repository: { full_name: "aogsccmedia-dot/scc-presenter" }, pull_request: { number: 7, title: "Better slides", user: { login: "helper" }, html_url: "https://github.com/x/pull/7", draft: false, head: { label: "helper:fix" }, base: { ref: "main" }, additions: 3, deletions: 1, changed_files: 1 } });
    const bad = await call("/api/hooks/github", { method: "POST", headers: { "x-github-event": "pull_request", "x-hub-signature-256": "sha256=00" }, body });
    assert.equal(bad.status, 401);
    const secret = (env.DB._db.prepare("SELECT value FROM settings WHERE key = 'github_webhook_secret'").get() as { value: string }).value;
    const { createHmac } = await import("node:crypto");
    const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    const ok = await call("/api/hooks/github", { method: "POST", headers: { "x-github-event": "pull_request", "x-hub-signature-256": sig }, body });
    assert.equal(ok.status, 200);
    assert.ok(mails("aogsccmedia@gmail.com").some((m) => /New change to review: “Better slides”/.test(m.subject)));
    const { checksSummary } = await import("../src/routes/code.ts");
    assert.equal(checksSummary([{ status: "completed", conclusion: "success" }]), "passed");
    assert.equal(checksSummary([{ status: "completed", conclusion: "failure" }]), "failed");
    assert.equal(checksSummary([{ status: "in_progress", conclusion: null }]), "running");
  });
});

describe("youth leaders, Fridays and voting", () => {
  const YOUTH = "youthtoken-eeeeeeeeeeeeeeeeeeeeeeeeeeee";
  before(async () => {
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256").update(YOUTH).digest("hex");
    env.DB._db.prepare("INSERT OR IGNORE INTO users (id, email, name, given_name) VALUES ('u-yl', 'yl@example.com', 'Youth Lead', 'Youth')").run();
    env.DB._db.prepare("INSERT OR IGNORE INTO admin_roles (user_id, email, role, granted_by, perms) VALUES ('u-yl', 'yl@example.com', 'youth_leader', 'x', '[\"fridays\",\"scan\",\"reports\"]')").run();
    env.DB._db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, kind, expires_at, admin_until) VALUES (?, 'u-yl', 'admin', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')").run(h);
  });
  const yl = (path: string, init: RequestInit = {}) => call(path, { ...init, headers: { ...(init.headers as Record<string, string> || {}), cookie: `scc_session=${YOUTH}`, "x-scc-admin": "1", ...JSONH } });

  test("youth leaders only reach what they're allowed", async () => {
    assert.equal((await yl("/api/admin/fridays")).status, 200);
    assert.equal((await yl("/api/admin/report?from=2026-01-01&to=2026-12-31")).status, 200);
    assert.equal((await yl("/api/admin/members")).status, 403);
    assert.equal((await yl("/api/admin/stats")).status, 200, "the overview counts are fine for the team");
    assert.equal((await yl("/api/admin/team")).status, 403);
    const who = await (await yl("/api/admin/whoami")).json() as { role: string; perms: string[] };
    assert.equal(who.role, "youth"); assert.deepEqual(who.perms, ["fridays", "scan", "reports"]);
  });

  test("Friday capture: attendance and final amount", async () => {
    const { fridayDates } = await import("../src/routes/fridays.ts");
    assert.equal(fridayDates("2026-10-13")[0], "2026-10-16");
    assert.deepEqual(fridayDates("2026-10-31"), ["2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"]);
    const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
    if (today >= "2026-10-16") {
      const fri = fridayDates(today).filter((d) => d <= today).at(-1)!;
      const r = await yl(`/api/admin/fridays/${fri}`, { method: "PUT", body: JSON.stringify({ attendance: 57, amount: "1 234,50" }) });
      assert.equal(r.status, 200);
      const list = await (await yl("/api/admin/fridays")).json() as { fridays: { date: string; attendance: number; amount: number }[] };
      const row = list.fridays.find((f) => f.date === fri)!;
      assert.equal(row.attendance, 57); assert.equal(row.amount, 1234.5);
    }
    assert.equal((await yl("/api/admin/fridays/2026-10-17", { method: "PUT", body: JSON.stringify({ attendance: 3 }) })).status, 400, "not a Friday");
  });

  test("elections: roles and rounds; only members vote; only members saved 5+ years can be chosen; finalists; appointments; reminders", async () => {
    const { schedule, pollState, topWithTies, processElections } = await import("../src/routes/votes.ts");
    const plan = schedule("2027-02-01", 2, 7, 7);
    assert.deepEqual(plan.map((r) => [r.opens, r.closes]), [["2027-02-01", "2027-02-07"], ["2027-02-15", "2027-02-21"]]);
    assert.equal(topWithTies([{ member_id: "a", votes: 5 }, { member_id: "b", votes: 3 }, { member_id: "c", votes: 3 }, { member_id: "d", votes: 1 }], 2).length, 3, "ties go through");
    const db = env.DB._db;
    const addMember = (id: string, uid: string, email: string, first: string, saved: string | null, year: string | null) => {
      db.prepare("INSERT OR IGNORE INTO users (id, email, name, given_name) VALUES (?,?,?,?)").run(uid, email, first, first);
      db.prepare("INSERT INTO members (id, ref_code, status, membership_type, first_name, last_name, date_of_birth, phone, email, signature_name, user_id, salvation_status, salvation_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, `SCCY-V-${id}`, "member", "new_member", first, "Voter", "1990-01-01", "0820000000", email, first, uid, saved, year);
    };
    addMember("vm-1", "vu-1", "v1@example.com", "Ayanda", "saved", "2010");
    addMember("vm-2", "vu-2", "v2@example.com", "Bongi", "saved", "2015");
    addMember("vm-3", "vu-3", "v3@example.com", "Chris", "saved", String(new Date().getUTCFullYear() - 1));   // saved last year: can vote, can't be chosen
    addMember("vm-4", "vu-4", "v4@example.com", "Dineo", "exploring", null);
    const { createHash } = await import("node:crypto");
    const sess = (uid: string) => { const t = `vote-${uid}-xxxxxxxxxxxxxxxxxxxxxxxx`; db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)").run(createHash("sha256").update(t).digest("hex"), uid, "user", "2099-01-01T00:00:00Z"); return `scc_session=${t}`; };
    const c1 = sess("vu-1"), c3 = sess("vu-3"), c4 = sess("vu-4");
    const sup = await adminCookie();
    // Setting up asks for the roles and what they mean.
    const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
    const bad = await call("/api/admin/votes", { method: "POST", headers: { ...A(sup), ...JSONH }, body: JSON.stringify({ title: "Youth committee", first_day: today, roles: [{ name: "Chair" }] }) });
    assert.equal(bad.status, 422, "each role needs a short description");
    const el = await (await call("/api/admin/votes/eligible?years=5", { headers: A(sup) })).json() as { eligible: { id: string }[] };
    assert.deepEqual(el.eligible.map((x) => x.id).filter((x) => x.startsWith("vm-")).sort(), ["vm-1", "vm-2"]);
    const made = await call("/api/admin/votes", { method: "POST", headers: { ...A(sup), ...JSONH }, body: JSON.stringify({ title: "Youth committee", event_name: "Youth AGM", first_day: today, rounds: 2, round_days: 2, gap_days: 1, runoff: 2,
      roles: [{ name: "Chairperson", description: "Leads the youth committee." }, { name: "Secretary", description: "Keeps minutes and records." }] }) });
    assert.equal(made.status, 200);
    const { id: pid } = await made.json() as { id: string };
    const view = await (await call(`/api/votes/${pid}`, { headers: { cookie: c3 } })).json() as { poll: { state: string; round: number }; roles: { id: string; name: string; candidates: { id: string }[] }[] };
    assert.equal(view.poll.state, "open"); assert.equal(view.poll.round, 1);
    const chair = view.roles[0].id, sec = view.roles[1].id;
    assert.deepEqual(view.roles[0].candidates.map((c) => c.id).filter((x) => x.startsWith("vm-")).sort(), ["vm-1", "vm-2"], "only members saved 5+ years");
    assert.equal((await post(`/api/votes/${pid}`, { role_id: chair, member_id: "vm-3" }, { cookie: c1 })).status, 422, "saved under 5 years can't be chosen");
    assert.equal((await post(`/api/votes/${pid}`, { role_id: chair, member_id: "vm-1" }, { cookie: c1 })).status, 422, "not for yourself");
    assert.equal((await post(`/api/votes/${pid}`, { role_id: chair, member_id: "vm-2" }, { cookie: c1 })).status, 200);
    assert.equal((await post(`/api/votes/${pid}`, { role_id: chair, member_id: "vm-2" }, { cookie: c1 })).status, 409, "once per role per round");
    assert.equal((await post(`/api/votes/${pid}`, { role_id: sec, member_id: "vm-1" }, { cookie: c3 })).status, 200, "new believers can still vote");
    assert.equal((await post(`/api/votes/${pid}`, { role_id: chair, member_id: "vm-1" }, { cookie: c4 })).status, 200);
    assert.equal((await call(`/api/votes/${pid}`)).status, 401, "sign-in needed");
    // Move time: round 1 closes → finalists; round 2 closes → appointed.
    db.prepare("UPDATE poll_rounds SET opens_at = '2020-01-01T00:00:00Z', closes_at = '2020-01-02T00:00:00Z' WHERE poll_id = ? AND round = 1").run(pid);
    db.prepare("UPDATE poll_rounds SET opens_at = '2020-01-03T00:00:00Z', closes_at = '2099-01-01T00:00:00Z' WHERE poll_id = ? AND round = 2").run(pid);
    const r2 = await (await call(`/api/votes/${pid}`, { headers: { cookie: c3 } })).json() as { poll: { round: number }; roles: { candidates: { id: string }[] }[] };
    assert.equal(r2.poll.round, 2);
    assert.deepEqual(r2.roles[0].candidates.map((c) => c.id).sort(), ["vm-1", "vm-2"], "round 2: the top from round 1");
    assert.equal((await post(`/api/votes/${pid}`, { role_id: chair, member_id: "vm-2" }, { cookie: c3 })).status, 200);
    db.prepare("UPDATE poll_rounds SET closes_at = '2020-01-04T00:00:00Z' WHERE poll_id = ? AND round = 2").run(pid);
    const before = env.EMAIL.outbox.length;
    await processElections(env);
    const done = await (await call(`/api/votes/${pid}`, { headers: { cookie: c3 } })).json() as { poll: { state: string }; roles: { appointed: { id: string }[] }[] };
    assert.equal(done.poll.state, "complete");
    assert.deepEqual(done.roles[0].appointed.map((x) => x.id), ["vm-2"]);
    assert.ok(env.EMAIL.outbox.slice(before).some((m) => /You've been chosen: Chairperson/.test(m.subject)));
    assert.equal(pollState({ status: "open" }, [{ round: 1, opens_at: "2099-01-01T00:00:00Z", closes_at: "2099-01-05T00:00:00Z" }]).state, "upcoming");
  });

  test("elections: a prayer reminder every two weeks before voting, and an email when a round opens", async () => {
    const { processElections } = await import("../src/routes/votes.ts");
    const db = env.DB._db;
    db.prepare("INSERT INTO polls (id, title, opens_at, closes_at, status, rounds, round_days, gap_days, runoff) VALUES ('pr-1','Elders 2027','2099-02-01T00:00:00Z','2099-02-07T00:00:00Z','open',1,7,7,3)").run();
    db.prepare("INSERT INTO poll_roles (id, poll_id, name, description, seats, sort) VALUES ('pr-r1','pr-1','Elder','Serves the church in prayer and care.',2,0)").run();
    db.prepare("INSERT INTO poll_rounds (poll_id, round, opens_at, closes_at) VALUES ('pr-1',1,'2099-02-01T00:00:00Z','2099-02-07T00:00:00Z')").run();
    const noon = new Date("2026-11-02T10:00:00Z");   // 12:00 SAST
    const n1 = await processElections(env, noon);
    assert.ok(n1 > 0, "first reminder goes out");
    assert.equal(await processElections(env, new Date("2026-11-09T10:00:00Z")), 0, "not again after one week");
    assert.ok(await processElections(env, new Date("2026-11-16T10:00:00Z")) > 0, "again after two weeks");
    assert.ok(env.EMAIL.outbox.some((m) => /Please pray: Elders 2027/.test(m.subject)));
  });
});

describe("Ask SCC, youth tickets, event updates, prayer list and access requests", () => {
  const db = () => env.DB._db;
  let member = "", youth = "";
  before(async () => {
    const { createHash } = await import("node:crypto");
    const sess = (uid: string) => { const t = `ask-${uid}-xxxxxxxxxxxxxxxxxxxxxxxx`; db().prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)").run(createHash("sha256").update(t).digest("hex"), uid, "user", "2099-01-01T00:00:00Z"); return `scc_session=${t}`; };
    db().prepare("INSERT OR IGNORE INTO users (id, email, name, given_name) VALUES ('ask-u', 'asker@example.com', 'Naledi M', 'Naledi')").run();
    db().prepare("INSERT OR IGNORE INTO members (id, ref_code, status, membership_type, first_name, last_name, date_of_birth, phone, email, signature_name, user_id) VALUES ('ask-m','SCCY-ASK','member','new_member','Naledi','M','1999-01-01','0820000000','asker@example.com','Naledi','ask-u')").run();
    db().prepare("INSERT OR IGNORE INTO users (id, email, name, given_name) VALUES ('ask-yl', 'leader@example.com', 'Kabelo Y', 'Kabelo')").run();
    db().prepare("INSERT OR REPLACE INTO admin_roles (user_id, email, role, granted_by, perms) VALUES ('ask-yl', 'leader@example.com', 'youth_leader', 'x', '[\"fridays\",\"scan\",\"reports\",\"youth_tickets\"]')").run();
    member = sess("ask-u"); youth = sess("ask-yl");
    const soon = new Date(Date.now() + 5 * 86400_000).toISOString();
    db().prepare("INSERT OR REPLACE INTO events (id, slug, title, starts_at, location, is_published, ministry_group) VALUES ('ev-youth','youth-night','Youth Night',?, 'Main hall', 1, 'youth')").run(soon);
    db().prepare("INSERT OR REPLACE INTO events (id, slug, title, starts_at, location, is_published, ministry_group) VALUES ('ev-men','mens-breakfast','Mens Breakfast',?, 'Hall', 1, 'church')").run(soon);
    for (const [id, ev, email, st] of [["r-y1", "ev-youth", "a@example.com", "pending"], ["r-y2", "ev-youth", "b@example.com", "confirmed"], ["r-m1", "ev-men", "c@example.com", "pending"]]) {
      db().prepare("INSERT OR REPLACE INTO event_registrations (id, event_id, ref_code, name, email, guests, answers, status) VALUES (?,?,?,?,?,0,'{}',?)").run(id, ev, `REF-${id}`, `Person ${id}`, email, st);
    }
  });
  const H = (cookie: string) => ({ cookie, "x-scc-admin": "1", ...JSONH });

  test("the concierge sends each question to the right agent (eval set)", async () => {
    const { route } = await import("../src/lib/agents.ts");
    const cases: [string, string][] = [
      ["What's coming up this weekend?", "whatson"], ["What's happening this week at church?", "whatson"], ["what's on this month", "whatson"], ["Show me the next events", "events"], ["When is the youth service?", "services"], ["what time does church start on sunday", "services"],
      ["Add it to my calendar", "calendar"], ["Do I have a ticket?", "tickets"], ["Where is the church?", "visit"], ["I need prayer", "prayer"],
      ["Are there any votes open?", "votes"], ["How do I become a member?", "join"], ["hi", "concierge"], ["What's on the programme in November?", "whatson"], ["Show the church programme", "programme"],
    ];
    for (const [q, want] of cases) assert.equal(route(q), want, q);
    const wk = await (await post("/api/assistant/chat", { message: "What's happening this week?" }, { cookie: member })).json() as { reply: { agent: string; cards: { title: string }[] } };
    assert.equal(wk.reply.agent, "whatson"); assert.ok(wk.reply.cards.some((c) => c.title === "Youth Night"), "pulls this week's events");
    assert.equal(route("how much is it?", "events"), "events", "follow-ups stay with the last helper");
  });

  test("messages: members write to leaders (not to each other), leaders reply, the other person is emailed", async () => {
    const W = (cookie: string) => ({ cookie, "x-scc-admin": "1" });
    db().prepare("INSERT OR IGNORE INTO users (id, email, name, given_name) VALUES ('msg-other', 'other@example.com', 'Other M', 'Other')").run();
    const l = await (await call("/api/chat/leaders", { headers: { cookie: member } })).json() as { leaders: { id: string; name: string }[] };
    assert.ok(l.leaders.some((x) => x.id === "ask-yl"), "the youth leader can be messaged");
    assert.equal((await post("/api/chat/start", { to: "msg-other" }, W(member))).status, 403, "members can't message other members");
    const before = env.EMAIL.outbox.length;
    const { id } = await (await post("/api/chat/start", { to: "ask-yl" }, W(member))).json() as { id: string };
    assert.equal((await post(`/api/chat/${id}`, { body: "Hello leader" }, W(member))).status, 200);
    assert.ok(env.EMAIL.outbox.slice(before).some((m) => JSON.stringify(m.to).includes("leader@example.com") && /New message from/.test(m.subject)), "leader emailed");
    const inbox = await (await call("/api/chat", { headers: { cookie: youth } })).json() as { unread: number; threads: { id: string }[] };
    assert.equal(inbox.unread, 1);
    assert.equal((await post(`/api/chat/${id}`, { body: "Hi! Happy to help." }, W(youth))).status, 200);
    const t = await (await call(`/api/chat/${id}`, { headers: { cookie: member } })).json() as { messages: { body: string; mine: boolean }[] };
    assert.deepEqual(t.messages.map((m) => [m.body, m.mine]), [["Hello leader", true], ["Hi! Happy to help.", false]]);
    assert.equal((await call(`/api/chat/${id}`, { headers: { cookie: "scc_session=nobody" } })).status, 401);
  });

  test("smart chat streams the answer as it's written; quick questions use the fast model", async () => {
    const calls: { model: string; stream: boolean }[] = [];
    const e = env as unknown as { AI?: unknown };
    e.AI = { run: async (model: string, input: Record<string, unknown>) => {
      calls.push({ model, stream: !!input.stream });
      if (input.text) return { data: (input.text as string[]).map(() => Array(8).fill(0.1)) };
      if (!input.stream) return { response: "Two." };
      const enc = new TextEncoder();
      return new ReadableStream({ start(c) { for (const t of ["1 + 1 ", "is **2**."]) c.enqueue(enc.encode(`data: ${JSON.stringify({ response: t })}\n\n`)); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
    } };
    try {
      const r = await post("/api/assistant/chat", { message: "What is 1+1?", stream: true }, { cookie: member });
      assert.match(r.headers.get("content-type") || "", /event-stream/);
      const body = await r.text();
      assert.match(body, /event: meta/); assert.match(body, /event: t\ndata: \{"t":"1 \+ 1 "\}/);
      const done = JSON.parse(/event: done\ndata: (.*)/.exec(body)![1]) as { text: string };
      assert.equal(done.text, "1 + 1 is 2.");
      assert.ok(calls.some((c) => c.stream && /8b/.test(c.model)), "simple question → fast model");
      assert.ok(!calls.some((c) => !c.stream && !c.model.includes("bge")) , "no extra non-stream call");
      calls.length = 0;
      await post("/api/assistant/chat", { message: "Explain the meaning of grace in Ephesians 2", stream: true }, { cookie: member }).then((x) => x.text());
      assert.ok(calls.some((c) => c.stream && /70b/.test(c.model)), "deeper question → big model");
    } finally { delete e.AI; }
  });

  test("chat: sign-in required, built-in answers with event cards and calendar links; AI text is cleaned; rollout buckets are stable", async () => {
    assert.equal((await post("/api/assistant/chat", { message: "hi" })).status, 401);
    const r = await post("/api/assistant/chat", { message: "What's coming up?" }, { cookie: member });
    assert.equal(r.status, 200);
    const d = await r.json() as { id: string; reply: { agent: string; cards: { kind: string; title: string; google: string; ics: string }[] } };
    assert.equal(d.reply.agent, "events");
    const yn = d.reply.cards.find((c) => c.title === "Youth Night")!;
    assert.match(yn.google, /calendar\.google\.com/); assert.match(yn.ics, /calendar\.ics$/);
    assert.equal((await post("/api/assistant/feedback", { id: d.id, rating: 1 }, { cookie: member })).status, 200);
    const tk = await (await post("/api/assistant/chat", { message: "Do I have a ticket?" }, { cookie: member })).json() as { reply: { agent: string } };
    assert.equal(tk.reply.agent, "tickets");
    const { cleanAi, bucket } = await import("../src/routes/assistant.ts");
    assert.equal(cleanAi("**See** [the page](https://evil.example) at https://x.y now"), "See the page at  now");
    assert.equal(bucket("user-1"), bucket("user-1"));
    const cal = await call("/api/calendar/church.ics");
    const ics = await cal.text();
    assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /RRULE:FREQ=WEEKLY/); assert.match(ics, /Youth Night/);
  });

  test("youth leaders approve tickets for youth events only, and can tell ticket holders about a change", async () => {
    const ap = await (await call("/api/admin/approvals", { headers: H(youth) })).json() as { approvals: { id: string }[]; scope: string };
    assert.equal(ap.scope, "youth"); assert.deepEqual(ap.approvals.map((a) => a.id), ["r-y1"]);
    assert.equal((await call("/api/admin/registrations/r-m1", { method: "PATCH", headers: H(youth), body: JSON.stringify({ status: "confirmed" }) })).status, 403);
    assert.equal((await call("/api/admin/registrations/r-y1", { method: "PATCH", headers: H(youth), body: JSON.stringify({ status: "confirmed", notify: false }) })).status, 200);
    const before = env.EMAIL.outbox.length;
    const n = await call("/api/admin/events/ev-youth/notify", { method: "POST", headers: H(youth), body: JSON.stringify({ message: "We now start at 19:00." }) });
    assert.equal(n.status, 200); assert.equal((await n.json() as { sent: number }).sent, 2);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(env.EMAIL.outbox.slice(before).some((m) => /Update: Youth Night/.test(m.subject) && /19:00/.test(m.html || "")));
    assert.equal((await call("/api/admin/events/ev-men/notify", { method: "POST", headers: H(youth), body: JSON.stringify({ message: "Changed venue" }) })).status, 403);
  });

  test("team members ask for more access; the main admin approves and they get it straight away", async () => {
    const r = await call("/api/admin/access-requests", { method: "POST", headers: H(youth), body: JSON.stringify({ wants: ["events"], note: "Camp registrations" }) });
    assert.equal(r.status, 200);
    assert.equal((await call("/api/admin/access-requests", { method: "POST", headers: H(youth), body: JSON.stringify({ wants: ["votes"] }) })).status, 409, "one request at a time");
    const { id } = await r.json() as { id: string };
    const sup = await adminCookie();
    assert.equal((await call(`/api/admin/access-requests/${id}`, { method: "PATCH", headers: H(youth), body: JSON.stringify({ decision: "approve" }) })).status, 403);
    assert.equal((await call(`/api/admin/access-requests/${id}`, { method: "PATCH", headers: H(sup), body: JSON.stringify({ decision: "approve" }) })).status, 200);
    const who = await (await call("/api/admin/whoami", { headers: H(youth) })).json() as { perms: string[] };
    assert.ok(who.perms.includes("events"));
  });

  test("weekly prayer list: nothing when the wall is empty; otherwise members get it once, and can stop it", async () => {
    const { processPrayerWeekly } = await import("../src/lib/prayer-weekly.ts");
    const monday = new Date("2026-10-19T06:00:00Z");   // 08:00 SAST
    db().prepare("DELETE FROM prayer_wall").run();
    assert.equal(await processPrayerWeekly(env, monday), 0, "empty wall → no email");
    db().prepare("INSERT INTO prayer_wall (id, user_id, display_name, request, status) VALUES ('pw-1','ask-u','Naledi','Peace for my family','approved')").run();
    const sent = await processPrayerWeekly(env, monday);
    assert.ok(sent >= 1);
    assert.ok(env.EMAIL.outbox.some((m) => JSON.stringify(m.to).includes("asker@example.com") && /pray/i.test(m.subject) && /Peace for my family/.test(m.html || "")));
    assert.equal(await processPrayerWeekly(env, new Date("2026-10-19T07:00:00Z")), 0, "once a week");
    const tok = (db().prepare("SELECT token FROM prayer_weekly WHERE email = 'asker@example.com'").get() as { token: string }).token;
    assert.equal((await call(`/api/prayer/weekly/stop?token=${tok}`, { redirect: "manual" })).status, 303);
    assert.equal((db().prepare("SELECT opted_out FROM prayer_weekly WHERE email = 'asker@example.com'").get() as { opted_out: number }).opted_out, 1);
  });
});

describe("what's new email", () => {
  test("goes once to each member who allows email and to the team; never to the main admin", async () => {
    const { processWhatsNew } = await import("../src/lib/whats-new.ts");
    const e = await makeEnv();
    e.DB._db.prepare("INSERT OR IGNORE INTO whats_new_mail (email, name, leader) VALUES ('leader@example.com', 'Thabo', 1), ('member@example.com', 'Naledi', 0), ('aogsccmedia@gmail.com', 'Admin', 1)").run();
    const before = e.EMAIL.outbox.length;
    await processWhatsNew(e); await processWhatsNew(e);
    const out = e.EMAIL.outbox.slice(before) as { to: string; subject: string }[];
    assert.equal(out.filter((m) => m.to === "leader@example.com").length, 1);
    assert.match(out.find((m) => m.to === "leader@example.com")!.subject, /record your weekly service/i);
    assert.equal(out.filter((m) => m.to === "member@example.com").length, 1);
    assert.equal(out.filter((m) => m.to === "aogsccmedia@gmail.com").length, 0);
  });
});

describe("word art", () => {
  test("the AI's art plan is checked: real verse words, safe palette, known scene; falls back without AI", async () => {
    const { artPlan } = await import("../src/lib/word-art.ts");
    const { wordFor } = await import("../src/lib/word.ts");
    const day = "2026-10-15", w = wordFor(day), word = w.text.split(/\s+/)[2].replace(/[^A-Za-z']/g, "");
    const store = new Map<string, string>();
    const kv = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } };
    const fake = (resp: unknown) => ({ DB: env.DB, FILES_KV: kv, AI: { run: async () => ({ response: resp }) } }) as unknown as Env;
    const good = await artPlan(fake(JSON.stringify({ highlight: word, tagline: "Made new", palette: ["#111111", "#5a3fd0", "#f3b4d6", "#ffd27a"], scene: "sunrise" })), day);
    assert.equal(good.highlight, word); assert.equal(good.tagline, "Made new"); assert.equal(good.scene, "sunrise"); assert.equal(good.ai, true);
    assert.equal(good.bg, `/api/word/art-bg?d=${day}`);
    store.clear();
    const bad = await artPlan(fake({ highlight: "words not in the verse at all", tagline: "visit https://spam.example", palette: ["red", "blue"], scene: "explosions" }), "2026-10-15");
    assert.notEqual(bad.highlight, "words not in the verse at all"); assert.equal(bad.tagline, null); assert.equal(bad.palette.length, 4); assert.ok(bad.palette.every((c: string) => /^#[0-9a-f]{6}$/i.test(c)));
    assert.notEqual(bad.scene, "explosions");
    const none = await artPlan({ DB: env.DB } as unknown as Env, "2026-10-16");
    assert.equal(none.ai, false); assert.equal(none.bg, null);
    const r = await call("/api/word/art"); assert.equal(r.status, 200);
  });
});
