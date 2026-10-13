// Who on the team should hear about something: the main admin, plus admins and youth leaders
// who have been given the matching permission.
import type { Env } from "../env.ts";
import { adminEmail } from "../env.ts";
import { ADMIN_DEFAULT, parsePerms, YOUTH_DEFAULT } from "./auth.ts";

export async function teamRecipients(env: Env, perm = "events"): Promise<{ email: string; name: string | null }[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.email, r.role, r.perms, COALESCE(NULLIF(u.given_name, ''), u.name) AS name FROM admin_roles r LEFT JOIN users u ON u.id = r.user_id`).all<{ email: string; role: string; perms: string | null; name: string | null }>();
  const out = new Map<string, { email: string; name: string | null }>();
  out.set(adminEmail(env), { email: adminEmail(env), name: null });
  for (const r of results) {
    const has = parsePerms(r.perms, r.role === "youth_leader" ? YOUTH_DEFAULT : ADMIN_DEFAULT);
    if (!perm.split("|").some((k) => has.includes(k))) continue;
    out.set(r.email.toLowerCase(), { email: r.email, name: r.name });
  }
  return [...out.values()];
}
