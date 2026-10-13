/**
 * Cloudflare bindings and config available to the Worker.
 * Declared in wrangler.jsonc — keep the two in sync.
 */
export interface SendEmailBinding {
  send(message: {
    to: string | { email: string; name?: string } | (string | { email: string; name?: string })[];
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | { email: string; name?: string };
    headers?: Record<string, string>;
    attachments?: { filename: string; type: string; disposition: "attachment" | "inline"; content: string | ArrayBuffer }[];
  }): Promise<{ messageId: string }>;
}

export interface Env {
  /** Static site in /public */
  ASSETS: Fetcher;
  /** Main database (Cloudflare D1, SQLite) */
  DB: D1Database;
  /** File store used while R2 is not enabled on the account */
  FILES_KV?: KVNamespace;
  /** Preferred file store once R2 is enabled (uncomment in wrangler.jsonc) */
  FILES_R2?: R2Bucket;
  /** Cloudflare Email Service (send_email binding). Optional until the domain is onboarded. */
  EMAIL?: SendEmailBinding;

  /** "kv" | "r2" — which store new uploads go to */
  STORAGE_DRIVER?: string;
  /** Max size of a single uploaded file, in MB */
  MAX_UPLOAD_MB?: string;
  /** "production" | "preview" | "development" */
  ENVIRONMENT?: string;
  /** Public site origin, e.g. https://aogsccyouth.com (used in emails) */
  SITE_URL?: string;
  /** The ONLY account allowed into the admin dashboard */
  ADMIN_EMAIL?: string;
  /** Sender address on our domain, e.g. noreply@aogsccyouth.com */
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;

  /** WhatsApp Business Platform (Meta Cloud API). All optional: WhatsApp features switch on once these are set. */
  WHATSAPP_TOKEN?: string;            // secret: permanent access token (System User)
  WHATSAPP_PHONE_ID?: string;         // the WhatsApp phone number ID
  WHATSAPP_APP_SECRET?: string;       // secret: Meta app secret, to verify webhook calls
  WHATSAPP_VERIFY_TOKEN?: string;     // secret: any phrase, also entered in Meta's webhook settings
  WHATSAPP_REMINDER_TEMPLATE?: string; // approved template name for service reminders (default "service_reminder")
  WHATSAPP_WELCOME_TEMPLATE?: string;  // approved template name for the welcome (default "member_welcome")
  WHATSAPP_TEMPLATE_LANG?: string;     // default "en"
  /** Optional: lets the WhatsApp helper answer free-form questions with Claude (otherwise built-in answers). */
  ANTHROPIC_API_KEY?: string;
  /** Optional GitHub fine-grained token (Contents + Pull requests: read & write on the two repos) so the main admin can approve and merge from the admin portal. */
  GITHUB_TOKEN?: string;
  /** Cloudflare Workers AI (open-weight models such as Llama) for Ask SCC. Optional: built-in answers work without it. */
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  /** Google Identity Services web client ID (public). Empty = Google sign-in hidden. */
  GOOGLE_CLIENT_ID?: string;
}

export const siteUrl = (env: Env) => (env.SITE_URL || "https://aogsccyouth.com").replace(/\/$/, "");
export const adminEmail = (env: Env) => (env.ADMIN_EMAIL || "aogsccmedia@gmail.com").toLowerCase();
