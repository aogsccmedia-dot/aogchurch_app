// The one-time "what's new" email: small batches each cron run until everyone on the list has it.
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { isAdminEmail } from "./auth.ts";
import { sendMail } from "./email.ts";
import { whatsNew } from "../emails/templates.ts";

const BATCH = 40;

export async function processWhatsNew(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT email, name, leader FROM whats_new_mail WHERE status = 'pending' ORDER BY leader DESC, email LIMIT ?")
    .bind(BATCH).all<{ email: string; name: string | null; leader: number }>().catch(() => ({ results: [] as { email: string; name: string | null; leader: number }[] }));
  let sent = 0;
  for (const r of results) {
    if (isAdminEmail(env, r.email)) { await env.DB.prepare("UPDATE whats_new_mail SET status = 'skipped' WHERE email = ?").bind(r.email).run(); continue; }
    // Claim the row first, so two runs never send the same person two emails.
    const claim = await env.DB.prepare("UPDATE whats_new_mail SET status = 'sending' WHERE email = ? AND status = 'pending'").bind(r.email).run();
    if (!claim.meta.changes) continue;
    const m = whatsNew({ site: siteUrl(env) }, { name: r.name, leader: !!r.leader });
    const ok = await sendMail(env, { to: r.email, ...m, template: "whats_new" }).catch(() => false);
    await env.DB.prepare("UPDATE whats_new_mail SET status = ?, sent_at = ?, error = ? WHERE email = ?")
      .bind(ok ? "sent" : "failed", new Date().toISOString(), ok ? null : "send failed", r.email).run();
    if (ok) sent++;
  }
  return sent;
}
