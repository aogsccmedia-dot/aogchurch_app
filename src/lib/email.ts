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
      });
    } catch (e) {
      status = "failed";
      const err = e as { code?: string; message?: string };
      error = `${err.code || ""} ${err.message || String(e)}`.trim().slice(0, 500);
      console.error("email failed", mail.template, error);
    }
  }
  try {
    await env.DB.prepare("INSERT INTO email_log (to_email, template, subject, status, error) VALUES (?,?,?,?,?)")
      .bind(mail.to, mail.template, mail.subject.slice(0, 200), status, error).run();
  } catch { /* logging must never fail the caller */ }
  return status === "sent";
}
