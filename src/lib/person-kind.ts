// Is this person a verified church member, someone with an account who isn't a member yet, or a visitor?
import type { Env } from "../env.ts";

export type PersonKind = "member" | "not_member" | "visitor";
export const KIND_SQL = (reg: string) => `CASE
  WHEN EXISTS (SELECT 1 FROM members m WHERE (m.user_id = ${reg}.user_id OR lower(m.email) = lower(${reg}.email)) AND m.status = 'member') THEN 'member'
  WHEN ${reg}.user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = ${reg}.user_id AND u.visitor = 1) THEN 'visitor'
  ELSE 'not_member' END`;

export async function kindOfRegistration(env: Env, registrationId: string): Promise<PersonKind> {
  const r = await env.DB.prepare(`SELECT ${KIND_SQL("r")} AS kind FROM event_registrations r WHERE r.id = ?`).bind(registrationId).first<{ kind: PersonKind }>().catch(() => null);
  return r?.kind ?? "visitor";
}
