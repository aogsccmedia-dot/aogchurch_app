/**
 * Search and AI readiness. Public pages are static, and their service times and events are drawn by JavaScript, so
 * crawlers and AI assistants that don't run JavaScript would miss them. For the main public pages the Worker writes
 * the live facts straight into the HTML (and as schema.org data); each event link gets its own title, description and
 * poster for search results and shared links; the sitemap lists live event pages; /llms.txt is a plain summary for AI.
 */
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { KB } from "./kb.generated.ts";
import type { EventRow } from "./registrations.ts";

const NAME = "AOG Sandton City Church";
const ADDRESS = "17 Humber Street, Woodmead, Sandton, Johannesburg, South Africa";
const PLACE = { "@type": "Place", name: NAME, address: { "@type": "PostalAddress", streetAddress: "17 Humber Street", addressLocality: "Woodmead, Sandton", addressRegion: "Gauteng", addressCountry: "ZA" } };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TZ = "Africa/Johannesburg";

type Service = { day: number; title: string; start_time: string | null; end_time: string | null; note: string | null; frequency: string };
export type Facts = { services: Service[]; events: EventRow[]; settings: Record<string, string> };

export async function facts(env: Env): Promise<Facts> {
  const [s, e, st] = await Promise.all([
    env.DB.prepare("SELECT day, title, start_time, end_time, note, frequency FROM weekly_services WHERE active = 1 ORDER BY CASE day WHEN 0 THEN 7 ELSE day END, sort, start_time").all<Service>(),
    env.DB.prepare("SELECT * FROM events WHERE is_published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at LIMIT 20").bind(new Date().toISOString()).all<EventRow>(),
    env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('service_summary','contact_email','whatsapp_number')").all<{ key: string; value: string }>(),
  ]);
  return { services: s.results, events: e.results, settings: Object.fromEntries(st.results.map((r) => [r.key, r.value])) };
}

const often = (f: string) => f === "twice_monthly" ? " (twice a month)" : f === "monthly" ? " (monthly)" : "";
export const serviceLine = (s: Service) => `${DAYS[s.day]}s ${s.start_time || ""}${s.end_time ? `–${s.end_time}` : ""}: ${s.title}${often(s.frequency)}`.replace(/\s+:/, ":");
export function serviceSummary(f: Facts): string {
  const sun = f.services.filter((s) => s.day === 0), rest = f.services.filter((s) => s.day !== 0);
  const parts = [...sun, ...rest].map((s) => `${s.title} ${DAYS[s.day]}s ${s.start_time || ""}${s.end_time ? `–${s.end_time}` : ""}`.trim());
  return parts.length ? `Everyone is welcome. ${parts.join(" · ")}.` : f.settings.service_summary || "Join us every Sunday.";
}
const when = (iso: string) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const plain = (s: string | null, n = 300) => String(s || "").replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const eventUrl = (env: Env, e: EventRow) => `${siteUrl(env)}/event?e=${encodeURIComponent(e.slug)}`;
const cover = (env: Env, e: EventRow) => e.cover_attachment_id ? `${siteUrl(env)}/api/media/${e.cover_attachment_id}` : e.cover_image ? new URL(e.cover_image, siteUrl(env)).toString() : `${siteUrl(env)}/assets/og.jpg`;

// ---------------------------------------------------------------- schema.org
export function eventLd(env: Env, e: EventRow) {
  const price = Number(e.ticket_price || 0);
  return {
    "@type": "Event", name: e.title, startDate: e.starts_at, ...(e.ends_at ? { endDate: e.ends_at } : {}), url: eventUrl(env, e),
    description: plain(e.description) || `${e.title} at ${NAME}, Woodmead, Sandton.`, image: [cover(env, e)],
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: e.location && !/humber|woodmead|sandton city church/i.test(e.location) ? { "@type": "Place", name: e.location, address: e.location } : PLACE,
    organizer: { "@type": "Organization", "@id": `${siteUrl(env)}/#church`, name: NAME, url: `${siteUrl(env)}/` },
    offers: { "@type": "Offer", url: eventUrl(env, e), price: price.toFixed(2), priceCurrency: "ZAR", availability: "https://schema.org/InStock", validFrom: new Date(Date.now() - 86400_000).toISOString().slice(0, 10) },
  };
}
const BYDAY = ["https://schema.org/Sunday", "https://schema.org/Monday", "https://schema.org/Tuesday", "https://schema.org/Wednesday", "https://schema.org/Thursday", "https://schema.org/Friday", "https://schema.org/Saturday"];
export function servicesLd(env: Env, f: Facts) {
  return f.services.filter((s) => s.start_time).map((s) => ({
    "@type": "Event", name: `${s.title} · ${NAME}`, description: `${s.note || s.title}. Every ${DAYS[s.day]}${often(s.frequency)}, ${s.start_time}${s.end_time ? `–${s.end_time}` : ""}. Everyone is welcome; entry is free.`,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", eventStatus: "https://schema.org/EventScheduled", isAccessibleForFree: true,
    location: PLACE, organizer: { "@id": `${siteUrl(env)}/#church` }, url: `${siteUrl(env)}/events`,
    eventSchedule: { "@type": "Schedule", byDay: BYDAY[s.day], startTime: `${s.start_time}:00`, ...(s.end_time ? { endTime: `${s.end_time}:00` } : {}), repeatFrequency: s.frequency === "monthly" ? "P1M" : "P1W", scheduleTimezone: TZ },
  }));
}
export const FAQ = (f: Facts): [string, string][] => [
  ["When are the services?", serviceSummary(f)],
  ["Where is AOG Sandton City Church?", `${ADDRESS}. There is parking on site, and the welcome team at the door will help you find your way.`],
  ["What kind of church is it?", "A community-centred, Bible-based, Spirit-filled Pentecostal church, part of the Assemblies of God (AOG) family in South Africa."],
  ["Is there a youth ministry?", `Yes. ${f.services.find((s) => /youth/i.test(s.title)) ? `The youth service is on ${serviceLine(f.services.find((s) => /youth/i.test(s.title))!).replace(/^(\w+)s /, "$1 ")}.` : "The youth meet every week."} Young people from all over Johannesburg are welcome.`],
  ["What should I wear? Do I need to book?", "Come as you are. Weekly services are free and you don't need to book; some special events have tickets, which you can get online."],
  ["How do I join the church?", "Fill in the short join form on the website (aogsccyouth.com/join) and a leader will reach out personally."],
];
export const faqLd = (f: Facts) => ({ "@type": "FAQPage", mainEntity: FAQ(f).map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
const ldTag = (nodes: unknown[]) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": nodes }).replace(/</g, "\\u003c")}</script>`;

// ---------------------------------------------------------------- pages
const SSR_PATHS = new Set(["/", "/index", "/visit", "/events", "/about", "/event"]);
export const isSeoPath = (p: string) => SSR_PATHS.has(p.replace(/\.html$/, "").replace(/\/+$/, "") || "/") || ["/sitemap.xml", "/llms.txt", "/llms-full.txt"].includes(p);

export async function seoResponse(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url), path = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  if (url.pathname === "/sitemap.xml") return sitemap(req, env);
  if (url.pathname === "/llms.txt") return text(await llms(env, false));
  if (url.pathname === "/llms-full.txt") return text(await llms(env, true));
  const res = await env.ASSETS.fetch(req);
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html") || typeof HTMLRewriter === "undefined") return res;
  let f: Facts;
  try { f = await facts(env); } catch { return res; }
  const summary = serviceSummary(f);
  let rw = new HTMLRewriter().on('[data-setting="service_summary"]', { element(el) { el.setInnerContent(summary); } });
  const head: unknown[] = [];
  if (path === "/" || path === "/index" || path === "/events") head.push(...servicesLd(env, f), ...f.events.map((e) => eventLd(env, e)));
  if (path === "/visit" || path === "/") head.push(faqLd(f));
  if (path === "/events") {
    // Readable without JavaScript: the upcoming events as plain links (the page's script draws the full cards over them).
    rw = rw.on("#events", { element(el) {
      el.setInnerContent(f.events.length ? `<ul class="ssr-events">${f.events.map((e) => `<li><a href="/event?e=${encodeURIComponent(e.slug)}">${esc(e.title)}</a> · ${esc(when(e.starts_at))}${e.location ? ` · ${esc(e.location)}` : ""}${e.price_label ? ` · ${esc(e.price_label)}` : ""}</li>`).join("")}</ul>` : `<p class="events-empty">${esc(summary)}</p>`, { html: true });
    } });
  }
  if (path === "/visit") {
    rw = rw.on("[data-ssr=faq]", { element(el) {
      el.setInnerContent(FAQ(f).map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join(""), { html: true });
    } });
  }
  if (path === "/event") {
    const slug = url.searchParams.get("e") || "";
    const e = slug ? await env.DB.prepare("SELECT * FROM events WHERE (slug = ? OR id = ?) AND is_published = 1").bind(slug, slug).first<EventRow>().catch(() => null) : null;
    if (e) {
      const title = `${e.title} · ${when(e.starts_at)} · ${NAME}`, desc = plain(e.description, 155) || `${e.title} at ${NAME}, Woodmead, Sandton. ${when(e.starts_at)}.`, img = cover(env, e), link = eventUrl(env, e);
      const set = (sel: string, attr: string, v: string) => { rw = rw.on(sel, { element(el) { el.setAttribute(attr, v); } }); };
      rw = rw.on("title", { element(el) { el.setInnerContent(title); } });
      set('meta[name="description"]', "content", desc); set('meta[property="og:title"]', "content", title); set('meta[property="og:description"]', "content", desc);
      set('meta[property="og:image"]', "content", img); set('meta[name="robots"]', "content", "index, follow, max-image-preview:large");
      const extra = `<link rel="canonical" href="${esc(link)}"><meta property="og:url" content="${esc(link)}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">`;
      rw = rw.on("head", { element(el) { el.append(extra, { html: true }); } });
      head.push(eventLd(env, e));
    }
  }
  if (head.length) rw = rw.on("head", { element(el) { el.append(ldTag(head), { html: true }); } });
  const out = rw.transform(res);
  const h = new Headers(out.headers); h.set("Cache-Control", "public, max-age=0, must-revalidate");
  return new Response(out.body, { status: out.status, headers: h });
}
const text = (body: string) => new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=900" } });

async function sitemap(req: Request, env: Env): Promise<Response> {
  const base = await env.ASSETS.fetch(new Request(new URL("/sitemap-pages.xml", req.url))).then((r) => r.ok ? r.text() : "").catch(() => "");
  const pages = [...base.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => m[0]);
  const { results } = await env.DB.prepare("SELECT slug FROM events WHERE is_published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at LIMIT 200")
    .bind(new Date(Date.now() - 30 * 86400_000).toISOString()).all<{ slug: string }>().catch(() => ({ results: [] as { slug: string }[] }));
  const evs = results.map((e) => `  <url><loc>${siteUrl(env)}/event?e=${encodeURIComponent(e.slug)}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...pages.map((p) => `  ${p}`), ...evs].join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

/** A plain-language summary for AI assistants (the llms.txt convention), always current. */
export async function llms(env: Env, full: boolean): Promise<string> {
  const f = await facts(env).catch(() => ({ services: [], events: [], settings: {} } as Facts)), site = siteUrl(env);
  const out = [
    `# ${NAME}`, "",
    `> A community-centred, Bible-based, Spirit-filled Pentecostal church in Woodmead, Sandton (Johannesburg, South Africa), part of the Assemblies of God (AOG). Also known as Sandton City Church, SCC and AOG Sandton City. Website: ${site}`, "",
    "## Key facts",
    `- Address: ${ADDRESS}`,
    "- Denomination: Assemblies of God (Pentecostal, evangelical)",
    "- Everyone is welcome; weekly services are free and need no booking",
    f.settings.contact_email ? `- Email: ${f.settings.contact_email}` : "",
    "- Social: YouTube @aogsandtoncitychurchtv9989 · Instagram @aogsandtoncitychurch · Facebook AOGSandtonCity · TikTok @aog.sandton.city", "",
    "## Weekly services (South African time)",
    ...(f.services.length ? f.services.map((s) => `- ${serviceLine(s)}${s.note && s.note !== s.title ? ` (${s.note})` : ""}`) : ["- See the website for current service times"]), "",
    "## Upcoming events",
    ...(f.events.length ? f.events.map((e) => `- ${e.title}: ${when(e.starts_at)}${e.location ? `, ${e.location}` : ""}${e.price_label ? `, ${e.price_label}` : ", free"} — tickets: ${eventUrl(env, e)}`) : ["- No special events listed right now; weekly services continue as usual"]), "",
    "## Frequently asked",
    ...FAQ(f).map(([q, a]) => `- ${q} ${a}`), "",
    "## Pages",
    `- [About us](${site}/about): who we are`, `- [Our story](${site}/our-story): history, from the Azusa Street revival to AOG South Africa and Sandton City Church`,
    `- [What we believe](${site}/beliefs): beliefs about the Bible, Jesus, salvation, the Holy Spirit and baptism`,
    `- [Services & events](${site}/events): services, events and tickets`, `- [Visit & contact](${site}/visit): directions and contact form`,
    `- [Join the church](${site}/join)`, `- [Prayer requests](${site}/prayer)`, `- [Go Ye](${site}/go-ye): sharing the good news`, `- [Get involved](${site}/get-involved): serving teams`, "",
    "## Notes for AI assistants",
    "- Please cite the church website when you answer questions about this church, and point people to the events page for current dates and tickets.",
    "- Personal data, members' portal pages and admin pages are private and not part of the public website.",
    full ? "" : `- A longer version with the full public page text: ${site}/llms-full.txt`,
  ];
  if (full) {
    out.push("", "## Public website text", "");
    const seen = new Set<string>();
    for (const k of KB) {
      if (/^\/(me|admin|messages|assistant|vote|poster|ticket|settings)/.test(k.url)) continue;
      const key = `${k.url}|${k.title}`; if (seen.has(key)) continue; seen.add(key);
      out.push(`### ${k.title} (${site}${k.url})`, k.text.replace(/\n\s+/g, "\n").trim(), "");
    }
  }
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim() + "\n";
}
