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

/** Outlook / Microsoft 365 web "add event" link. */
export function outlookUrl(e: { title: string; starts_at: string; ends_at: string | null; location: string | null; description?: string | null }): string {
  const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600_000).toISOString();
  const p = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: e.title, startdt: new Date(e.starts_at).toISOString(),
    enddt: new Date(end).toISOString(), location: e.location || "17 Humber Street, Woodmead, Sandton", body: (e.description || "").slice(0, 500) });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}

const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** RFC 5545 calendar file — works with Apple Calendar, Outlook, Google and phones. */
export function icsFile(e: { id: string; title: string; starts_at: string; ends_at: string | null; location: string | null; description?: string | null; url: string }): string {
  const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600_000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AOG Sandton City Church//Events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${e.id}@aogsccyouth.com`, `DTSTAMP:${gcal(new Date().toISOString())}`,
    `DTSTART:${gcal(new Date(e.starts_at).toISOString())}`, `DTEND:${gcal(new Date(end).toISOString())}`,
    `SUMMARY:${icsEsc(e.title)}`, `LOCATION:${icsEsc(e.location || "17 Humber Street, Woodmead, Sandton")}`,
    `DESCRIPTION:${icsEsc(((e.description || "") + "\n\n" + e.url).trim())}`, `URL:${e.url}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(e.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  // Fold long lines to 75 octets as the spec requires.
  return lines.map((l) => l.length <= 74 ? l : l.match(/.{1,73}/g)!.join("\r\n ")).join("\r\n") + "\r\n";
}
