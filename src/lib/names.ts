// Names of church members and the team, each person once (for pickers like MC and poster speakers). Names only.
import type { Env } from "../env.ts";

export async function churchNames(env: Env): Promise<string[]> {
    const { results } = await env.DB.prepare(
      `SELECT name, key FROM (
         SELECT trim(COALESCE(NULLIF(trim(preferred_name), ''), trim(first_name)) || ' ' || trim(COALESCE(last_name, ''))) AS name,
                COALESCE(lower(trim(email)), user_id, id) AS key, created_at
           FROM members WHERE status NOT IN ('revoked', 'inactive')
         UNION ALL
         SELECT trim(COALESCE(u.name, '')), lower(u.email), r.created_at FROM admin_roles r JOIN users u ON u.id = r.user_id)
       WHERE name != '' ORDER BY created_at DESC`).all<{ name: string; key: string }>();
    const byPerson = new Set<string>(), byName = new Map<string, string>();
    for (const r of results) {
      const clean = r.name.replace(/\s+/g, " ").trim(), k = clean.toLowerCase();
      if (byPerson.has(r.key) || byName.has(k)) continue;   // one entry per person, and no repeated names
      byPerson.add(r.key); byName.set(k, clean);
    }
    return [...byName.values()].sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" }));
}
