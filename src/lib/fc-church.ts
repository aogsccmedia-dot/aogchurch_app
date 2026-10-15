// FreeCreator Online: which church workspace a signed-in person belongs to. Every FreeCreator query is scoped to it.
import type { Env } from "../env.ts";
import { isAdminEmail, type Session } from "./auth.ts";

export interface FcChurch { id: string; name: string; role: "owner" | "admin" | "member" }

export async function churchFor(env: Env, s: Session): Promise<FcChurch | null> {
  const email = s.user.email.toLowerCase();
  // Sandton City Church: the main admin, the team, and approved members.
  if (isAdminEmail(env, email)) return { id: "scc", name: "AOG Sandton City Church", role: "owner" };
  const team = await env.DB.prepare("SELECT role FROM admin_roles WHERE user_id = ?").bind(s.user.id).first<{ role: string }>();
  if (team) return { id: "scc", name: "AOG Sandton City Church", role: team.role === "admin" ? "admin" : "member" };
  const scc = await env.DB.prepare("SELECT 1 FROM members WHERE (user_id = ? OR lower(email) = ?) AND status = 'member' LIMIT 1").bind(s.user.id, email).first();
  if (scc) return { id: "scc", name: "AOG Sandton City Church", role: "member" };
  // Any active church that added this person by hand (including extra people Sandton City Church adds).
  const row = await env.DB.prepare(
    "SELECT c.id, c.name, m.role FROM fc_members m JOIN fc_churches c ON c.id = m.church_id WHERE m.email = ? AND c.status = 'active' ORDER BY m.created_at LIMIT 1")
    .bind(email).first<{ id: string; name: string; role: FcChurch["role"] }>();
  return row ?? null;
}
