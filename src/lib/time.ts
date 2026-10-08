// South Africa has no daylight saving: SAST is always UTC+2.
export const TZ = "Africa/Johannesburg";

export function formatWhen(iso: string, endIso?: string | null): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);
  const t = (x: Date) => new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(x);
  return `${day} · ${t(d)}${endIso ? `–${t(new Date(endIso))}` : ""}`;
}

/** Next Sunday at 14:00 SAST (12:00 UTC) — when the weekly letter goes out. */
export function nextSundayAfternoon(from = new Date()): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12, 0, 0));
  const add = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  if (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

const gcal = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export function calendarUrl(e: { title: string; starts_at: string; ends_at: string | null; location: string | null; description?: string | null }): string {
  const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600_000).toISOString();
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${gcal(new Date(e.starts_at).toISOString())}/${gcal(new Date(end).toISOString())}`,
    location: e.location || "17 Humber Street, Woodmead, Sandton", details: (e.description || "").slice(0, 500) });
  return `https://calendar.google.com/calendar/render?${p}`;
}
