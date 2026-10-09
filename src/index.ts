/**
 * AOG Sandton City Church — Cloudflare Worker entry.
 *
 * Static pages in /public are served by Workers Static Assets. Requests under
 * /api/* run this Worker first (see run_worker_first in wrangler.jsonc).
 */
import type { Env } from "./env.ts";
import { adminEmail, siteUrl } from "./env.ts";
import { HttpError, Router, errorResponse, json } from "./lib/http.ts";
import { publicRoutes } from "./routes/public.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { faithRoutes } from "./routes/faith.ts";
import { processAnnouncements } from "./lib/newsletter.ts";
import { processCheckins, processWelcomes } from "./lib/membership.ts";
import { nextSundayAfternoon } from "./lib/time.ts";
import { sendMail } from "./lib/email.ts";
import { adminLetterReminder } from "./emails/templates.ts";

// Endpoints that legitimately receive cross-site POSTs (mail providers' one-click unsubscribe).
const CROSS_SITE_OK = new Set(["/api/newsletter/unsubscribe"]);

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.hostname === "www.aogsccyouth.com") {
      url.hostname = "aogsccyouth.com";
      return Response.redirect(url.toString(), 301);
    }

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    if (req.method !== "GET" && req.method !== "HEAD" && !CROSS_SITE_OK.has(url.pathname)) {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return errorResponse(new HttpError(403, "Cross-site request blocked."));
    }

    try {
      const router = new Router();
      authRoutes(router, env);
      publicRoutes(router, env);
      adminRoutes(router, env);
      faithRoutes(router, env);
      const res = await router.handle(req);
      return res ?? json({ ok: false, error: "Not found." }, 404);
    } catch (err) {
      return errorResponse(err);
    }
  },

  /**
   * Runs every 10 minutes:
   *  - sends due announcement letters in batches (Sunday afternoon by default)
   *  - Saturday 10:00 SAST: reminds the admin if no letter is scheduled for Sunday
   *  - 05:00 SAST daily: housekeeping
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date((controller as unknown as { scheduledTime?: number }).scheduledTime ?? Date.now());
    ctx.waitUntil((async () => {
      await processAnnouncements(env, now);
      await processCheckins(env, now);
      await processWelcomes(env, now);

      const h = now.getUTCHours(), m = now.getUTCMinutes();
      if (now.getUTCDay() === 6 && h === 8 && m < 10) {
        const sunday = nextSundayAfternoon(now);
        const planned = await env.DB.prepare("SELECT 1 FROM announcements WHERE status IN ('scheduled','sending','sent') AND scheduled_for BETWEEN ? AND ?")
          .bind(new Date(sunday.getTime() - 86400_000).toISOString(), new Date(sunday.getTime() + 86400_000).toISOString()).first();
        if (!planned) await sendMail(env, { to: adminEmail(env), ...adminLetterReminder({ site: siteUrl(env) }), template: "admin_letter_reminder" });
      }
      if (h === 3 && m < 10) {
        const iso = now.toISOString();
        await env.DB.batch([
          env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(iso),
          env.DB.prepare("DELETE FROM login_codes WHERE expires_at < ?").bind(new Date(now.getTime() - 86400_000).toISOString()),
          env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(Math.floor(now.getTime() / 1000) - 86400),
          env.DB.prepare("DELETE FROM email_log WHERE created_at < ?").bind(new Date(now.getTime() - 90 * 86400_000).toISOString()),
        ]);
      }
    })());
  },
} satisfies ExportedHandler<Env>;
