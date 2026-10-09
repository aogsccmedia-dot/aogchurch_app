/** Church programme (annual calendar + sub-region planner) and the regular weekly services. */
export const WEEKLY_SERVICES = [
  { day: "Monday", title: "Prayer", time: "06:00 – 15:00", note: "Come and pray any time during the day" },
  { day: "Tuesday", title: "Cell groups (home cells)", time: "18:00 – 20:00", note: "Twice a month" },
  { day: "Wednesday", title: "Choir practice", time: "18:00 – 19:30", note: "Weekly" },
  { day: "Thursday", title: "Mothers', Fathers' & Daughters' services", time: "18:00 – 20:00", note: "Three services at the same time" },
  { day: "Friday", title: "Youth service", time: "18:00 – 20:00", note: "For teens and young adults" },
  { day: "Saturday", title: "Rest", time: "", note: "No services, a day to rest" },
  { day: "Sunday", title: "Main service", time: "08:45 – 11:00", note: "Everyone welcome: family, kids and youth" },
];

export interface ProgrammeRow { id: string; source: string; audience: string; start_date: string; end_date: string | null; time_label: string | null; title: string; department: string | null; venue: string | null; notes: string | null }

const DAY = (iso: string) => new Date(iso + "T12:00:00Z");
export function programmeWhen(p: Pick<ProgrammeRow, "start_date" | "end_date" | "time_label">) {
  const f = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-ZA", { ...o, timeZone: "UTC" }).format(DAY(iso));
  const start = f(p.start_date, { weekday: "short", day: "numeric", month: "short" });
  const range = p.end_date && p.end_date !== p.start_date ? `${start} – ${f(p.end_date, { weekday: "short", day: "numeric", month: "short" })}` : start;
  return p.time_label ? `${range} · ${p.time_label}` : range;
}
