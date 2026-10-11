// SCC Presenter (desktop app) beta: email + password accounts, the first 20 testers, downloads and feedback.
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { createLoginCode, consumeLoginCode, createSession, getSession, requireAdmin, upsertUser } from "../lib/auth.ts";
import { hashPassword, verifyPassword, uuid } from "../lib/crypto.ts";
import { sendMail } from "../lib/email.ts";
import * as T from "../emails/templates.ts";

export const BETA = { slots: 20, ends: "2026-12-31", endsAt: "2027-01-01T00:00:00+02:00", fullRelease: "2027-01-31" };
const REPO = "aogsccmedia-dot/scc-presenter";
const ASSETS = { windows: "SCC-Presenter-Setup.exe", mac: "SCC-Presenter.dmg" } as const;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

export const betaOpen = (now = Date.now()) => now < Date.parse(BETA.endsAt);

type Release = { version: string; published_at: string; windows: boolean; mac: boolean } | null;

/** Latest published build on GitHub (cached for 5 minutes at the edge). */
export async function latestRelease(): Promise<Release> {
  const cacheKey = new Request("https://cache.internal/presenter-release-v1");
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit.json();
  let rel: Release = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, { headers: { accept: "application/vnd.github+json", "user-agent": "aogsccyouth.com" } });
    if (res.ok) {
      const list = await res.json() as { draft: boolean; tag_name: string; published_at: string; assets: { name: string }[] }[];
      const r = list.find((x) => !x.draft && x.assets.some((a) => a.name === ASSETS.windows || a.name === ASSETS.mac));
      if (r) rel = { version: r.tag_name.replace(/^v/, ""), published_at: r.published_at, windows: r.assets.some((a) => a.name === ASSETS.windows), mac: r.assets.some((a) => a.name === ASSETS.mac) };
    }
  } catch { /* fall through to the feed below */ }
  if (!rel) {
    // The GitHub API limits anonymous calls; the public releases feed doesn't. Releases are only published after
    // the Windows and Mac installers have both been installed and opened in testing, so both files are there.
    try {
      const feed = await fetch(`https://github.com/${REPO}/releases.atom`, { headers: { "user-agent": "aogsccyouth.com" } });
      const tag = feed.ok ? /\/releases\/tag\/v([\w.-]+)/.exec(await feed.text())?.[1] : null;
      if (tag) rel = { version: tag, published_at: "", windows: true, mac: true };
    } catch { /* GitHub unreachable: show "being prepared" */ }
  }
  await cache?.put(cacheKey, new Response(JSON.stringify(rel), { headers: { "cache-control": `max-age=${rel ? 300 : 60}`, "content-type": "application/json" } })).catch(() => {});
  return rel;
}

function betaKey(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", u = new Uint8Array(8);
  crypto.getRandomValues(u);
  const s = [...u].map((n) => A[n % A.length]).join("");
  return `SCC-${s.slice(0, 4)}-${s.slice(4)}`;
}
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const stars = (v: unknown) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : null; };

type Tester = { id: string; user_id: string; email: string; name: string | null; slot: number; beta_key: string; downloads: number; os: string | null; created_at: string };

export function presenterRoutes(router: Router, env: Env): void {
  const brand = { site: siteUrl(env) };
  const taken = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM beta_testers").first<{ n: number }>())?.n ?? 0;
  const testerFor = (userId: string) => env.DB.prepare("SELECT * FROM beta_testers WHERE user_id = ?").bind(userId).first<Tester>();

  // ---------------- email + password accounts (email is confirmed with a 6-digit code first)
  router.post("/api/auth/password/start", async (req) => {
    await rateLimit(env, "pwstart", clientIp(req), 6, 900);
    const b = await readJson<{ email?: string; password?: string; name?: string }>(req);
    const email = clip(b.email, 254).toLowerCase(), password = String(b.password || ""), name = clip(b.name, 80);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (password.length < 8) throw new HttpError(400, "Use a password of at least 8 characters.");
    if (password.length > 200) throw new HttpError(400, "That password is too long.");
    const { id, code } = await createLoginCode(env, email, null);
    await env.DB.prepare("DELETE FROM password_pending WHERE email = ? OR expires_at < ?").bind(email, new Date().toISOString()).run();
    await env.DB.prepare("INSERT INTO password_pending (challenge, email, name, hash, expires_at) VALUES (?,?,?,?,?)")
      .bind(id, email, name || null, await hashPassword(password), new Date(Date.now() + 10 * 60_000).toISOString()).run();
    const sent = await sendMail(env, { to: email, ...T.accountCode(brand, code), template: "account_code" });
    if (!sent && env.ENVIRONMENT !== "development") throw new HttpError(503, "We couldn't send the email right now. Please try again in a minute.");
    return json({ ok: true, challenge: id });
  });

  router.post("/api/auth/password/verify", async (req) => {
    await rateLimit(env, "pwverify", clientIp(req), 12, 900);
    const { challenge, code } = await readJson<{ challenge?: string; code?: string }>(req);
    if (!challenge || !code) throw new HttpError(400, "Enter the 6-digit code from your email.");
    const r = await consumeLoginCode(env, challenge, code);
    const pending = await env.DB.prepare("SELECT * FROM password_pending WHERE challenge = ?").bind(challenge).first<{ email: string; name: string | null; hash: string }>();
    if (!pending || pending.email.toLowerCase() !== r.email.toLowerCase()) throw new HttpError(400, "That code has expired. Please start again.");
    const [given, ...rest] = (pending.name || "").split(/\s+/);
    const user = await upsertUser(env, { email: r.email, name: pending.name, given_name: given || null, family_name: rest.join(" ") || null });
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").bind(pending.hash, now, user.id),
      env.DB.prepare("DELETE FROM password_pending WHERE challenge = ?").bind(challenge),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND kind = 'user'").bind(user.id),   // a new password signs out other devices
    ]);
    return json({ ok: true, user }, 200, { "Set-Cookie": await createSession(env, req, user.id, "user") });
  });

  router.post("/api/auth/password/login", async (req) => {
    await rateLimit(env, "pwlogin", clientIp(req), 10, 900);
    const b = await readJson<{ email?: string; password?: string }>(req);
    const email = clip(b.email, 254).toLowerCase();
    const row = await env.DB.prepare("SELECT id, password_hash, email_verified_at FROM users WHERE email = ?").bind(email).first<{ id: string; password_hash: string | null; email_verified_at: string | null }>();
    const ok = !!row?.password_hash && await verifyPassword(String(b.password || ""), row.password_hash);
    if (!ok || !row) throw new HttpError(401, "That email and password don't match. You can reset your password below.");
    if (!row.email_verified_at) throw new HttpError(403, "Please confirm your email first.");
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
    const user = await env.DB.prepare("SELECT id, email, name, given_name, family_name, picture FROM users WHERE id = ?").bind(row.id).first();
    return json({ ok: true, user }, 200, { "Set-Cookie": await createSession(env, req, row.id, "user") });
  });

  // ---------------- beta status, joining and downloads
  router.get("/api/presenter/status", async (req) => {
    const s = await getSession(env, req);
    const me = s ? await testerFor(s.user.id) : null;
    const n = await taken();
    return json({ ok: true, slots: BETA.slots, taken: n, left: Math.max(0, BETA.slots - n), open: betaOpen() && n < BETA.slots, ended: !betaOpen(),
      ends: BETA.ends, full_release: BETA.fullRelease, release: await latestRelease(), signed_in: !!s, user: s ? { email: s.user.email, name: s.user.given_name || s.user.name } : null,
      tester: me ? { slot: me.slot, beta_key: me.beta_key, downloads: me.downloads } : null });
  });

  router.post("/api/presenter/join", async (req) => {
    await rateLimit(env, "betajoin", clientIp(req), 6, 900);
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in first.");
    if (!betaOpen()) throw new HttpError(410, "The beta has ended. The full release arrives on 31 January 2027.");
    const existing = await testerFor(s.user.id);
    if (existing) return json({ ok: true, tester: { slot: existing.slot, beta_key: existing.beta_key, downloads: existing.downloads } });
    const verified = await env.DB.prepare("SELECT email_verified_at, google_sub FROM users WHERE id = ?").bind(s.user.id).first<{ email_verified_at: string | null; google_sub: string | null }>();
    if (!verified?.email_verified_at && !verified?.google_sub) throw new HttpError(403, "Please confirm your email first.");
    const b = await readJson<{ church?: string; role?: string; os?: string }>(req);
    const name = s.user.given_name || s.user.name || s.user.email.split("@")[0];
    // The slot number is unique and limited to 1–20 in the database, so two people can never get the same place
    // and nobody can get a 21st, even if they press Join at the same moment.
    for (let attempt = 0; attempt < 4; attempt++) {
      const n = await taken();
      if (n >= BETA.slots) throw new HttpError(409, "All 20 beta places have been taken. The full release arrives on 31 January 2027.");
      const id = uuid(), key = betaKey();
      try {
        const r = await env.DB.prepare(`INSERT INTO beta_testers (id, user_id, email, name, slot, beta_key, church, role, os)
          SELECT ?,?,?,?, (SELECT COALESCE(MAX(slot), 0) + 1 FROM beta_testers), ?,?,?,? WHERE (SELECT COUNT(*) FROM beta_testers) < ?`)
          .bind(id, s.user.id, s.user.email, name, key, clip(b.church, 120) || null, clip(b.role, 80) || null, clip(b.os, 20) || null, BETA.slots).run();
        if (!r.meta.changes) throw new HttpError(409, "All 20 beta places have been taken. The full release arrives on 31 January 2027.");
      } catch (e) {
        if (e instanceof HttpError) throw e;
        const again = await testerFor(s.user.id);
        if (again) return json({ ok: true, tester: { slot: again.slot, beta_key: again.beta_key, downloads: again.downloads } });
        continue;   // somebody took that slot a moment earlier: try the next one
      }
      const t = await testerFor(s.user.id);
      if (!t) throw new HttpError(409, "All 20 beta places have been taken.");
      await sendMail(env, { to: t.email, ...T.presenterWelcome(brand, { name, slot: t.slot, key: t.beta_key }), template: "presenter_welcome" });
      await sendMail(env, { to: adminEmail(env), subject: `New SCC Presenter beta tester #${t.slot}: ${name}`, html: `<p>${T.esc(name)} &lt;${T.esc(t.email)}&gt; joined the SCC Presenter beta as tester #${t.slot}.</p><p><a href="${brand.site}/admin#report">Open the admin portal</a></p>`, text: `${name} <${t.email}> joined the SCC Presenter beta as tester #${t.slot}.\nChurch: ${clip(b.church, 120) || "-"}\nRole: ${clip(b.role, 80) || "-"}\n\n${brand.site}/admin#report`, template: "presenter_admin" });
      return json({ ok: true, tester: { slot: t.slot, beta_key: t.beta_key, downloads: 0 } });
    }
    throw new HttpError(409, "All 20 beta places have been taken.");
  });

  router.get("/api/presenter/download/:os", async (req, { os }) => {
    if (os !== "windows" && os !== "mac") throw new HttpError(404, "Not found");
    const s = await getSession(env, req);
    const back = (msg: string) => Response.redirect(`${brand.site}/presenter?msg=${encodeURIComponent(msg)}`, 302);
    if (!s) return back("signin");
    const t = await testerFor(s.user.id);
    if (!t) return back("join");
    if (!betaOpen()) return back("ended");
    const rel = await latestRelease();
    if (!rel || !rel[os]) return back("preparing");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO beta_downloads (tester_id, os, version) VALUES (?,?,?)").bind(t.id, os, rel.version),
      env.DB.prepare("UPDATE beta_testers SET downloads = downloads + 1, last_download_at = ?, os = COALESCE(os, ?) WHERE id = ?").bind(new Date().toISOString(), os, t.id),
    ]);
    return Response.redirect(`https://github.com/${REPO}/releases/download/v${rel.version}/${ASSETS[os]}`, 302);
  });

  // ---------------- feedback: from the app (beta key) or the website (signed-in tester)
  router.post("/api/presenter/feedback", async (req) => {
    await rateLimit(env, "betafb", clientIp(req), 12, 3600);
    const b = await readJson<Record<string, unknown>>(req, 48 * 1024);
    let t: Tester | null = null;
    const key = clip(b.key, 20).toUpperCase();
    if (key) t = await env.DB.prepare("SELECT * FROM beta_testers WHERE beta_key = ?").bind(key).first<Tester>();
    else { const s = await getSession(env, req); if (s) t = await testerFor(s.user.id); }
    if (!t) throw new HttpError(403, key ? "That beta key isn't right. Check the key on the download page." : "Only beta testers can send feedback.");
    const used = Array.isArray(b.used) ? (b.used as unknown[]).map((x) => clip(x, 40)).slice(0, 20) : [];
    const system = b.system && typeof b.system === "object" ? JSON.stringify(b.system).slice(0, 4000) : null;
    const f = { overall: stars(b.overall), ease: stars(b.ease), install: clip(b.install_ok, 10), good: clip(b.good, 3000), problems: clip(b.problems, 4000), missing: clip(b.missing, 3000), recommend: clip(b.recommend, 10) };
    if (!f.overall && !f.good && !f.problems && !f.missing) throw new HttpError(400, "Please add a rating or a few words.");
    const source = b.source === "app" ? "app" : "web";
    await env.DB.prepare(`INSERT INTO beta_feedback (id, tester_id, source, overall, ease, install_ok, used, good, problems, missing, recommend, system, version, platform)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(uuid(), t.id, source, f.overall, f.ease, f.install || null, JSON.stringify(used), f.good, f.problems, f.missing, f.recommend || null, system, clip(b.version, 20) || null, clip(b.platform, 20) || null).run();
    await sendMail(env, { to: adminEmail(env), ...T.presenterFeedbackAdmin(brand, { tester: `${t.name || t.email}`, slot: t.slot, overall: f.overall, ease: f.ease, good: f.good, problems: f.problems, missing: f.missing, recommend: f.recommend, install: f.install, source }), template: "presenter_feedback" });
    return json({ ok: true });
  });

  // ---------------- admin: testers and their feedback
  router.get("/api/admin/presenter", async (req) => {
    await requireAdmin(env, req);
    const [testers, feedback, downloads] = await Promise.all([
      env.DB.prepare("SELECT id, name, email, slot, church, role, os, downloads, last_download_at, created_at, (SELECT COUNT(*) FROM beta_feedback f WHERE f.tester_id = t.id) AS feedback FROM beta_testers t ORDER BY slot").all(),
      env.DB.prepare("SELECT f.*, t.name, t.email, t.slot FROM beta_feedback f JOIN beta_testers t ON t.id = f.tester_id ORDER BY f.created_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT os, COUNT(*) AS n FROM beta_downloads GROUP BY os").all(),
    ]);
    return json({ ok: true, beta: BETA, release: await latestRelease(), testers: testers.results, feedback: feedback.results, downloads: downloads.results });
  });
}
