#!/usr/bin/env node
// Production smoke test: read-only checks that the live site works and its protections are in place.
// No sign-in, no writes (the cross-site check is refused before anything happens).
// Usage: node tools/agents/smoke.mjs [base-url] [--json report.json]
// Exit code 0 = all good, 1 = something is broken (details printed and written to the report).
const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || "https://aogchurch-app.aogsccmedia.workers.dev").replace(/\/+$/, "");
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const UA = "Mozilla/5.0 (compatible; SCC-smoke-test/1.0; +https://aogsccyouth.com)";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); };

async function get(path, init = {}) {
  const t0 = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + path, { redirect: "manual", ...init, headers: { "user-agent": UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
      const text = init.method === "HEAD" ? "" : await res.text();
      return { status: res.status, headers: res.headers, text, ms: Date.now() - t0 };
    } catch (e) {
      if (attempt === 2) return { status: 0, headers: new Headers(), text: String(e), ms: Date.now() - t0 };
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}
const json = (r) => { try { return JSON.parse(r.text); } catch { return null; } };

// ---------------------------------------------------------------- pages
const PAGES = ["/", "/events", "/visit", "/about", "/join", "/me", "/freecreator", "/freecreator/app/", "/tools", "/prayer", "/help", "/privacy", "/offline"];
for (const p of PAGES) {
  const r = await get(p);
  check(`page ${p}`, r.status === 200 && /<html/i.test(r.text), `HTTP ${r.status} in ${r.ms} ms`);
  if (r.ms > 6000) check(`page ${p} speed`, false, `slow: ${r.ms} ms`);
}

// ---------------------------------------------------------------- the home page and everything it loads
const home = await get("/");
check("home has the church name", /Sandton City Church/i.test(home.text));
const h = home.headers;
check("header: Content-Security-Policy", /default-src 'self'/.test(h.get("content-security-policy") || ""), h.get("content-security-policy"));
check("header: Strict-Transport-Security", /max-age=\d{7,}/.test(h.get("strict-transport-security") || ""), h.get("strict-transport-security"));
check("header: X-Content-Type-Options", h.get("x-content-type-options") === "nosniff");
check("header: framing blocked", /SAMEORIGIN|DENY/i.test(h.get("x-frame-options") || "") || /frame-ancestors/.test(h.get("content-security-policy") || ""));
const assets = [...new Set([...home.text.matchAll(/(?:href|src)="(\/(?:css|js|assets|fonts)\/[^"#]+)"/g)].map((m) => m[1]))];
check("home references its assets", assets.length >= 5, `${assets.length} assets`);
for (const a of assets) { const r = await get(a, { method: "HEAD" }); check(`asset ${a}`, r.status === 200, `HTTP ${r.status}`); }

// ---------------------------------------------------------------- API
const health = await get("/api/health");
check("api health", health.status === 200 && json(health)?.ok === true, `HTTP ${health.status} ${health.text.slice(0, 80)}`);
check("api headers: nosniff", health.headers.get("x-content-type-options") === "nosniff");
const ev = await get("/api/events");
const events = json(ev)?.events;
check("api events list", ev.status === 200 && Array.isArray(events), `HTTP ${ev.status}`);
for (const e of (events || []).slice(0, 6)) {
  const d = await get(`/api/events/${encodeURIComponent(e.slug)}`);
  check(`event ${e.slug}`, d.status === 200 && json(d)?.event?.slug === e.slug, `HTTP ${d.status}`);
  const page = await get(`/event?e=${encodeURIComponent(e.slug)}`);
  check(`event page ${e.slug}`, page.status === 200 && page.text.includes(e.title.replace(/&/g, "&amp;").slice(0, 20)), `HTTP ${page.status}`);
  if (e.cover_url && e.cover_url.startsWith("/")) { const r = await get(e.cover_url, { method: "HEAD" }); check(`event cover ${e.slug}`, r.status === 200, `HTTP ${r.status} ${e.cover_url}`); }
  const vids = [e.cover_video, ...((json(d)?.event?.videos) || []).map((v) => v.src)].filter(Boolean);
  for (const v of vids) for (const f of ["-720.mp4", "-poster.jpg"]) { const r = await get(v + f, { method: "HEAD" }); check(`video ${v}${f}`, r.status === 200, `HTTP ${r.status}`); }
}
const me = await get("/api/auth/me");
check("signed-out session is empty", me.status === 200 && json(me)?.user === null, `HTTP ${me.status}`);
check("sitemap", (await get("/sitemap.xml")).status === 200);
check("robots.txt", (await get("/robots.txt")).status === 200);

// ---------------------------------------------------------------- protections (all read-only or refused before any work)
const adm = await get("/api/admin/stats");
check("admin API needs sign-in", adm.status === 401, `HTTP ${adm.status}`);
const lib = await get("/api/freecreator/lib");
check("FreeCreator church library needs sign-in", lib.status === 401, `HTTP ${lib.status}`);
const xs = await get("/api/contact", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: "{}" });
check("cross-site writes refused", xs.status === 403, `HTTP ${xs.status}`);
const tk = await get("/api/tickets/AAAAAAAAAAAAAAAA");
check("unknown ticket is 404", tk.status === 404, `HTTP ${tk.status}`);
const bad = await get("/api/events/%E0%A4%A");
check("broken address is a clean 400/404", bad.status === 400 || bad.status === 404, `HTTP ${bad.status}`);
const bible = await get("/api/freecreator/bible?ref=John%203:16");
check("FreeCreator scripture lookup", bible.status === 200 || bible.status === 503, `HTTP ${bible.status}`);

// ---------------------------------------------------------------- report
const failed = results.filter((r) => !r.ok);
const report = { base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, failures: failed, checks: results };
if (out) (await import("node:fs")).writeFileSync(out, JSON.stringify(report, null, 2));
for (const r of results) if (!r.ok) console.log(`✗ ${r.name}  ${r.detail}`);
console.log(`${report.passed}/${results.length} checks passed on ${BASE}`);
process.exit(failed.length ? 1 : 0);
