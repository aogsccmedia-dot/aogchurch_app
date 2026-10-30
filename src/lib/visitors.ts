/**
 * Visitors sign in as guests: name and email (phone optional), no verification. They can browse events, get tickets
 * and see or cancel their own bookings. Everything for members is closed to them, checked here for every request.
 */
import { HttpError } from "./http.ts";
import { getSession } from "./auth.ts";
import type { Env } from "../env.ts";

/** Member-only features: messaging leaders, complaints, voting, the prayer wall, member tools and settings.
 * (FreeCreator Online itself is free for anyone, visitors included; its church library and phone cameras are not.) */
const BLOCKED = [
  /^\/api\/chat(\/|$)/, /^\/api\/me\/complaints/, /^\/api\/votes/, /^\/api\/poster\//, /^\/api\/freecreator\/(lib|cam|church|access)/,
  /^\/api\/wall(\/|$)/, /^\/api\/go\/contacts/, /^\/api\/me\/(letter|prayer-weekly|membership)/,
  /^\/api\/admin\//,
];
export const visitorBlocked = (path: string) => BLOCKED.some((re) => re.test(path));

export async function guardVisitor(env: Env, req: Request, path: string): Promise<void> {
  if (!visitorBlocked(path)) return;
  const s = await getSession(env, req).catch(() => null);
  if (s?.visitor) throw new HttpError(403, "You're signed in as a visitor, so you can see events and get tickets. To message leaders, vote and use the rest of the app, join the church family.");
}
