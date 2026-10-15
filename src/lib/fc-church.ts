// FreeCreator Online: which church workspace a signed-in person belongs to. Every FreeCreator query is scoped to it.
import type { Env } from "../env.ts";
import { isAdminEmail, type Session } from "./auth.ts";

export interface FcChurch { id: string; name: string; role: "owner" | "admin" | "media" | "member" }
export const SCC_NAME = "AOG Sandton City Church";

export async function churchFor(env: Env, s: Session): Promise<FcChurch | null> {
  const email = s.user.email.toLowerCase();
  // Sandton City Church: the main admin (owner), the media team (media status), the admin team and approved members.
  if (isAdminEmail(env, email)) return { id: "scc", name: SCC_NAME, role: "owner" };
  const listed = await env.DB.prepare(
    "SELECT c.id, c.name, m.role FROM fc_members m JOIN fc_churches c ON c.id = m.church_id WHERE m.email = ? AND c.status = 'active' LIMIT 1")
    .bind(email).first<{ id: string; name: string; role: FcChurch["role"] }>();
  if (listed?.id === "scc" && listed.role === "media") return { id: "scc", name: SCC_NAME, role: "media" };
  const team = await env.DB.prepare("SELECT role FROM admin_roles WHERE user_id = ?").bind(s.user.id).first<{ role: string }>();
  const scc = team ? null : await env.DB.prepare("SELECT interests FROM members WHERE (user_id = ? OR lower(email) = ?) AND status = 'member' LIMIT 1").bind(s.user.id, email).first<{ interests: string }>();
  const inMedia = (() => { try { return (JSON.parse(scc?.interests || "[]") as string[]).includes("media"); } catch { return false; } })();
  if (team) return { id: "scc", name: SCC_NAME, role: team.role === "admin" ? "admin" : inMedia ? "media" : "member" };
  if (scc) return { id: "scc", name: SCC_NAME, role: inMedia ? "media" : "member" };
  // Any other active church that added this person by hand (one church per person).
  return listed ?? null;
}

/** Which church (if any) already has this email: one church per person. */
export async function churchOfEmail(env: Env, email: string): Promise<string | null> {
  const e = email.toLowerCase();
  if (isAdminEmail(env, e)) return "scc";
  const listed = await env.DB.prepare("SELECT church_id FROM fc_members WHERE email = ? LIMIT 1").bind(e).first<{ church_id: string }>();
  if (listed) return listed.church_id;
  const scc = await env.DB.prepare(
    "SELECT 1 FROM members WHERE lower(email) = ? AND status = 'member' UNION SELECT 1 FROM admin_roles r JOIN users u ON u.id = r.user_id WHERE lower(u.email) = ? LIMIT 1")
    .bind(e, e).first().catch(() => null);
  return scc ? "scc" : null;
}
