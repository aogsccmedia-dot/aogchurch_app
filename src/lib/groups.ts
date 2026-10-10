/** Ministry groups: every event and weekly service belongs to one, so money and attendance roll up per group. */
export const MINISTRY_GROUPS: [string, string][] = [
  ["church", "Whole church"],
  ["youth", "Youth Ministry"],
  ["mothers", "Mothers' Ministry"],
  ["fathers", "Fathers' Ministry"],
  ["daughters", "Daughters' Ministry"],
  ["children", "Children's Ministry"],
  ["choir", "Choir & Worship"],
  ["prayer", "Prayer Ministry"],
  ["cells", "Cell groups"],
  ["outreach", "Outreach & Missions"],
  ["other", "Other"],
];
export const GROUP_KEYS = MINISTRY_GROUPS.map(([k]) => k);
export const groupLabel = (k: string | null | undefined) => MINISTRY_GROUPS.find(([g]) => g === k)?.[1] ?? "Whole church";

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Today's date in South Africa (YYYY-MM-DD). */
export function saToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();

/** The next date (today included) a service on `day` happens. */
export function nextOccurrence(day: number, from = saToday()): string {
  return addDays(from, (day - weekday(from) + 7) % 7);
}
/** Recent and upcoming dates for a service day: `back` past occurrences, then today/next and `ahead` more. */
export function occurrences(day: number, back = 4, ahead = 4, from = saToday()): string[] {
  const next = nextOccurrence(day, from);
  const out: string[] = [];
  for (let i = back; i >= 1; i--) out.push(addDays(next, -7 * i));
  for (let i = 0; i <= ahead; i++) out.push(addDays(next, 7 * i));
  return out;
}
export const isServiceDay = (date: string, day: number) => /^\d{4}-\d{2}-\d{2}$/.test(date) && weekday(date) === day;

/** "R1 250.50" style Rands from cents. */
export const rands = (cents: number | null | undefined) =>
  "R" + (Number(cents || 0) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
