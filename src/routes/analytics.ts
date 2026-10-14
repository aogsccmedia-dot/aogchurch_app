// First-party analytics for the main admin: page views, taps, where people come from, devices, and how many come back.
// No third parties, no ads. Visitor/session ids are only sent by the browser when the person allowed "remember on this device".
import type { Env } from "../env.ts";
import { Router, clientIp, json, readJson } from "../lib/http.ts";
import { getSession, requireSuper } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|facebookexternalhit|whatsapp\/|curl|wget|python|node-fetch/i;
const clip = (v: unknown, n: number) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
const okId = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);

function device(ua: string) {
  const tablet = /ipad|tablet|(android(?!.*mobile))/i.test(ua);
  const phone = !tablet && /mobi|iphone|android/i.test(ua);
  const browser = /edg\//i.test(ua) ? "Edge" : /samsungbrowser/i.test(ua) ? "Samsung Internet" : /opr\/|opera/i.test(ua) ? "Opera" : /firefox|fxios/i.test(ua) ? "Firefox"
    : /crios|chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Other";
  const os = /iphone|ipad|ipod/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "macOS" : /cros/i.test(ua) ? "ChromeOS" : /linux/i.test(ua) ? "Linux" : "Other";
  return { device: tablet ? "Tablet" : phone ? "Phone" : "Computer", browser, os };
}
function sourceOf(ref: string | null, utm: string | null, host: string): string {
  if (utm) return utm.toLowerCase();
  if (!ref) return "Direct";
  let h = ref;
  try { h = new URL(ref.includes("://") ? ref : "https://" + ref).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  if (h === host || h.endsWith("." + host)) return "Direct";
  if (/google\./.test(h)) return "Google"; if (/bing\./.test(h)) return "Bing";
  if (/facebook|fb\.com|m\.facebook/.test(h)) return "Facebook"; if (/instagram/.test(h)) return "Instagram";
  if (/whatsapp|wa\.me/.test(h)) return "WhatsApp"; if (/youtube|youtu\.be/.test(h)) return "YouTube"; if (/tiktok/.test(h)) return "TikTok";
  if (/t\.co$|twitter|x\.com/.test(h)) return "X / Twitter"; if (/linkedin/.test(h)) return "LinkedIn"; if (/mail|outlook|gmail/.test(h)) return "Email";
  return h;
}

type Ev = { k?: string; p?: string; l?: string; r?: string; u?: string; v?: string; s?: string; a?: boolean | number; ms?: number };

export function analyticsRoutes(router: Router, env: Env): void {
  // The page sends a few events at a time (beacon). Always answers 204 quickly.
  router.post("/api/a", async (req) => {
    const ua = req.headers.get("user-agent") || "";
    if (!ua || BOT.test(ua)) return new Response(null, { status: 204 });
    try { await rateLimit(env, "analytics", clientIp(req), 600, 3600); } catch { return new Response(null, { status: 204 }); }
    const body = await readJson<{ e?: Ev[] } | Ev>(req).catch(() => ({}));
    const list = (Array.isArray((body as { e?: Ev[] }).e) ? (body as { e: Ev[] }).e : [body as Ev]).slice(0, 25);
    if (!list.length) return new Response(null, { status: 204 });
    const cf = (req as unknown as { cf?: { country?: string; city?: string } }).cf || {};
    const host = new URL(req.url).hostname.replace(/^www\./, "");
    const s = await getSession(env, req).catch(() => null);
    const d = device(ua), now = new Date(), ts = now.toISOString();
    const day = new Date(now.getTime() + 2 * 3600_000).toISOString().slice(0, 10);   // SAST day
    const stmts = list.filter((e) => e && (e.k === "view" || e.k === "click")).map((e) => {
      const ref = clip(e.r, 300), utm = clip(e.u, 60);
      let refHost: string | null = null;
      try { refHost = ref ? new URL(ref).hostname.replace(/^www\./, "") : null; } catch { refHost = null; }
      return env.DB.prepare(`INSERT INTO analytics_events (ts, day, kind, path, label, ref, source, country, city, device, browser, os, vid, sid, uid, app, ms)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ts, day, e.k, clip(e.p, 200), clip(e.l, 80), refHost && refHost !== host ? refHost : null,
        e.k === "view" ? sourceOf(ref, utm, host) : null, cf.country || null, cf.city || null, d.device, d.browser, d.os, okId(e.v), okId(e.s), s?.user.id ?? null,
        e.a ? 1 : 0, Number.isFinite(Number(e.ms)) ? Math.max(0, Math.min(60000, Math.round(Number(e.ms)))) : null);
    });
    if (stmts.length) await env.DB.batch(stmts);
    return new Response(null, { status: 204 });
  });

  router.get("/api/admin/analytics", async (req) => {
    await requireSuper(env, req);
    const days = Math.max(1, Math.min(365, Number(new URL(req.url).searchParams.get("days")) || 30));
    const now = Date.now() + 2 * 3600_000;
    const from = new Date(now - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const prevFrom = new Date(now - (2 * days - 1) * 86400_000).toISOString().slice(0, 10);
    const today = new Date(now).toISOString().slice(0, 10);
    const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
    const top = (col: string, kind = "view", n = 10) => q(`SELECT ${col} AS k, COUNT(*) AS n FROM analytics_events WHERE day >= ? AND kind = ? AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC LIMIT ${n}`, from, kind);
    const totalsSql = `SELECT SUM(kind = 'view') AS views, SUM(kind = 'click') AS clicks, COUNT(DISTINCT vid) AS visitors, COUNT(DISTINCT sid) AS sessions,
        COUNT(DISTINCT uid) AS users, ROUND(AVG(CASE WHEN kind = 'view' THEN ms END)) AS ms, ROUND(100.0 * AVG(CASE WHEN kind = 'view' THEN app END), 1) AS app_pct
        FROM analytics_events WHERE day >= ? AND day <= ?`;
    const rs = await env.DB.batch([
      q(totalsSql, from, today),
      q(totalsSql, prevFrom, from),
      q(`SELECT day, SUM(kind = 'view') AS views, COUNT(DISTINCT vid) AS visitors, COUNT(DISTINCT uid) AS users, SUM(kind = 'click') AS clicks FROM analytics_events WHERE day >= ? GROUP BY day ORDER BY day`, from),
      top("path"), top("source"), top("country"), top("city"), top("device"), top("browser"), top("os"),
      q(`SELECT label AS k, path, COUNT(*) AS n FROM analytics_events WHERE day >= ? AND kind = 'click' AND label IS NOT NULL GROUP BY label, path ORDER BY n DESC LIMIT 15`, from),
      q(`SELECT COUNT(*) AS sessions, SUM(c = 1) AS bounced FROM (SELECT sid, COUNT(*) AS c FROM analytics_events WHERE day >= ? AND kind = 'view' AND sid IS NOT NULL GROUP BY sid)`, from),
      q(`SELECT COUNT(DISTINCT CASE WHEN day = ? THEN uid END) AS dau, COUNT(DISTINCT CASE WHEN day >= ? THEN uid END) AS wau, COUNT(DISTINCT CASE WHEN day >= ? THEN uid END) AS mau FROM analytics_events WHERE uid IS NOT NULL AND day >= ?`,
        today, new Date(now - 6 * 86400_000).toISOString().slice(0, 10), new Date(now - 29 * 86400_000).toISOString().slice(0, 10), new Date(now - 29 * 86400_000).toISOString().slice(0, 10)),
      q(`SELECT strftime('%H', ts, '+2 hours') AS h, COUNT(*) AS n FROM analytics_events WHERE day >= ? AND kind = 'view' GROUP BY h ORDER BY h`, from),
      q(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ?`, from + "T00:00:00"),
      q(`SELECT COUNT(*) AS n FROM members WHERE created_at >= ?`, from + "T00:00:00"),
      q(`SELECT COUNT(*) AS n FROM event_registrations WHERE created_at >= ? AND status != 'cancelled'`, from + "T00:00:00"),
      q(`SELECT COUNT(*) AS n FROM push_subs`),
    ]);
    const rows = <T>(i: number) => rs[i].results as T[];
    const t = rows<Record<string, number>>(0)[0] || {}, prev = rows<Record<string, number>>(1)[0] || {};
    const bounce = rows<{ sessions: number; bounced: number }>(11)[0];

    // Retention: people (visitor id, or account when signed in) grouped by the week they first came, and which later weeks they came back.
    const since = new Date(now - 8 * 7 * 86400_000).toISOString().slice(0, 10);
    const { results: seen } = await q(`SELECT COALESCE(uid, vid) AS who, MIN(day) AS first, GROUP_CONCAT(DISTINCT day) AS days FROM analytics_events
        WHERE COALESCE(uid, vid) IS NOT NULL AND day >= ? AND kind = 'view' GROUP BY who LIMIT 20000`, since).all<{ who: string; first: string; days: string }>();
    const weekOf = (d: string) => Math.floor((Date.parse(d + "T00:00:00Z") - Date.parse(since + "T00:00:00Z")) / (7 * 86400_000));
    const cohorts: { week: string; size: number; back: number[] }[] = [];
    for (let w = 0; w < 8; w++) cohorts.push({ week: new Date(Date.parse(since + "T00:00:00Z") + w * 7 * 86400_000).toISOString().slice(0, 10), size: 0, back: Array(8).fill(0) });
    let returning = 0;
    for (const p of seen) {
      const fw = weekOf(p.first); if (fw < 0 || fw > 7) continue;
      const weeks = new Set(String(p.days).split(",").map(weekOf));
      cohorts[fw].size++;
      if (weeks.size > 1) returning++;
      for (const w of weeks) if (w > fw && w - fw < 8) cohorts[fw].back[w - fw]++;
    }
    const pct = (a: number, b: number) => (b ? Math.round((1000 * (a - b)) / b) / 10 : null);
    return json({
      ok: true, days, from, today,
      totals: { ...t, bounce_pct: bounce?.sessions ? Math.round((1000 * (bounce.bounced || 0)) / bounce.sessions) / 10 : null,
        pages_per_session: t.sessions ? Math.round((10 * (t.views || 0)) / t.sessions) / 10 : null,
        returning_pct: seen.length ? Math.round((1000 * returning) / seen.length) / 10 : null,
        change: { views: pct(t.views || 0, prev.views || 0), visitors: pct(t.visitors || 0, prev.visitors || 0), users: pct(t.users || 0, prev.users || 0) } },
      daily: rows(2), pages: rows(3), sources: rows(4), countries: rows(5), cities: rows(6), devices: rows(7), browsers: rows(8), os: rows(9), clicks: rows(10),
      active: rows(12)[0], hours: rows(13),
      growth: { accounts: rows<{ n: number }>(14)[0]?.n ?? 0, members: rows<{ n: number }>(15)[0]?.n ?? 0, tickets: rows<{ n: number }>(16)[0]?.n ?? 0, notifications: rows<{ n: number }>(17)[0]?.n ?? 0 },
      retention: cohorts.filter((c) => c.size),
    });
  });
}
