import type { Env } from "../env.ts";
import { adminEmail } from "../env.ts";

export interface Mail {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; type: string; disposition: "attachment" | "inline"; content: string }[];
}

/**
 * Send one email through Cloudflare Email Service and record it in email_log.
 * Never throws: email problems must not break a form submission.
 * Returns true when the provider accepted the message.
 */
export async function sendMail(env: Env, mail: Mail): Promise<boolean> {
  let status = "sent";
  let error: string | null = null;
  if (!env.EMAIL) {
    status = "skipped";
    error = "EMAIL binding not configured";
  } else {
    try {
      await env.EMAIL.send({
        to: mail.toName ? { email: mail.to, name: mail.toName } : mail.to,
        from: { email: env.MAIL_FROM || "noreply@aogsccyouth.com", name: env.MAIL_FROM_NAME || "AOG Sandton City Church" },
        replyTo: adminEmail(env),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: mail.headers,
        attachments: mail.attachments,
      });
    } catch (e) {
      status = "failed";
      const err = e as { code?: string; message?: string };
      error = `${err.code || ""} ${err.message || String(e)}`.trim().slice(0, 500);
      console.error("email failed", mail.template, error);
    }
  }
  try {
    const payload = status === "sent" ? null : JSON.stringify(mail);
    await env.DB.prepare("INSERT INTO email_log (to_email, template, subject, status, error, payload) VALUES (?,?,?,?,?,?)")
      .bind(mail.to, mail.template, mail.subject.slice(0, 200), status, error, payload && payload.length < 900_000 ? payload : null).run();
  } catch { /* logging must never fail the caller */ }
  return status === "sent";
}

/** Errors that mean the domain isn't set up for sending to everyone yet (not a problem with one address). */
export const SETUP_ERRORS = ["E_RECIPIENT_NOT_ALLOWED", "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_SENDER_NOT_VERIFIED", "EMAIL binding not configured"];

export async function emailHealth(env: Env) {
  const r = await env.DB.prepare(`SELECT
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status IN ('failed','skipped') THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('failed','skipped') AND payload IS NOT NULL THEN 1 ELSE 0 END) AS resendable
    FROM email_log WHERE created_at >= datetime('now', '-30 days')`).first<{ sent: number | null; failed: number | null; resendable: number | null }>();
  const last = await env.DB.prepare("SELECT status, error, created_at FROM email_log ORDER BY id DESC LIMIT 1").first<{ status: string; error: string | null; created_at: string }>();
  const lastErr = await env.DB.prepare("SELECT error FROM email_log WHERE status IN ('failed','skipped') ORDER BY id DESC LIMIT 1").first<{ error: string | null }>();
  const needsSetup = !!last && last.status !== "sent" && SETUP_ERRORS.some((c) => (last.error || "").includes(c));
  return { sent: r?.sent ?? 0, failed: r?.failed ?? 0, resendable: r?.resendable ?? 0, last_status: last?.status ?? null, last_error: lastErr?.error ?? null, needs_setup: needsSetup };
}

/** Resend failed emails that still have their message stored. Returns how many went through. */
export async function resendFailed(env: Env, limit = 50) {
  const { results } = await env.DB.prepare("SELECT id, payload FROM email_log WHERE status IN ('failed','skipped') AND payload IS NOT NULL ORDER BY id LIMIT ?")
    .bind(limit).all<{ id: number; payload: string }>();
  let sent = 0, failed = 0;
  for (const row of results) {
    let mail: Mail;
    try { mail = JSON.parse(row.payload); } catch { continue; }
    const ok = await sendMail(env, mail);
    await env.DB.prepare("UPDATE email_log SET status = 'resent', payload = NULL WHERE id = ?").bind(row.id).run();
    if (ok) sent++; else { failed++; if (failed >= 3 && sent === 0) break; }
  }
  return { tried: sent + failed, sent, failed };
}
