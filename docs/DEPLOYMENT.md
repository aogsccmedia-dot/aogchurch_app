# Deployment & operations

## Cloudflare resources (already created)

| Resource | Name | ID |
|---|---|---|
| D1 database | `aogscc-youth-db` | `40211a07-6b0e-43a9-b91e-41bc8134b380` |
| KV namespace (uploads) | `aogscc-youth-files` | `0256e53df0cc4a1a9a1ee90483c8986a` |
| Worker | `aogchurch-app` | created on first deploy |
| Domain | `aogsccyouth.com` (+ `www` → redirect) | attached automatically by `wrangler deploy` |

## One-time setup

### 1. Email sending (Cloudflare Email Service) ✅ enabled
Dashboard → **Compute → Email Service → Email Sending → Onboard Domain** → `aogsccyouth.com`.
This adds SPF/DKIM/DMARC records under `cf-bounce.aogsccyouth.com`. The Worker sends as `noreply@aogsccyouth.com` (see `send_email` in `wrangler.jsonc`), and replies go to `aogsccmedia@gmail.com`.
> Do this **before the first deploy**. Admin sign-in codes depend on it.

### 2. GitHub → Cloudflare deploys
1. Cloudflare → **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers**.
   - Account Resources: your account. Zone Resources: `aogsccyouth.com`.
   - Add the permissions **Account · D1 · Edit** (for migrations) and **Account · Workers KV Storage · Edit**.
2. GitHub repo → **Settings → Secrets and variables → Actions**:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Push to `main` (or run the **Deploy** workflow manually). Follow it under the **Actions** tab.

### 3. Google sign-in
1. https://console.cloud.google.com/apis/credentials → **Create credentials → OAuth client ID → Web application**.
2. Authorised JavaScript origins: `https://aogsccyouth.com` (and `http://localhost:8787` for development).
3. Put the client ID in `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` and push. It's a public value, not a secret. ✅ Done: `388453371259-…apps.googleusercontent.com`.

Until step 3 is done, admin sign-in falls back to **email code only** (only `aogsccmedia@gmail.com` can request one). Once Google is on, the admin must sign in with Google **and** enter the emailed code.

## The custom domain

`wrangler.jsonc` → `routes` attaches `aogsccyouth.com` and `www.aogsccyouth.com` as Custom Domains. Cloudflare creates the DNS records and certificates.
If the deploy says the hostname is already in use, remove the old record or route first (Dashboard → `aogsccyouth.com` → DNS, or Workers → the old Worker → Settings → Domains & Routes), then re-run the deploy.

## Day-to-day

| Task | How |
|---|---|
| Change service times / socials | `/admin/` → Site settings (live instantly, no deploy) |
| New event | `/admin/` → Events & forms → New event → build the form → Published |
| Weekly letter | `/admin/` → Weekly letter → write → **Schedule for Sunday 14:00** |
| Logs | `npx wrangler tail` or Dashboard → Workers → aogchurch-app → Logs |
| Roll back | Dashboard → Workers → aogchurch-app → Deployments → pick a version → Rollback |
| Back up the database | `npx wrangler d1 export aogscc-youth-db --remote --output backup.sql` (D1 also keeps 30-day Time Travel: `wrangler d1 time-travel restore`) |

## Changing the admin account
`wrangler.jsonc` → `vars.ADMIN_EMAIL`. Only that address can ever reach the dashboard.

## Scaling notes

- **Uploads → R2.** When R2 is enabled on the account, run `npx wrangler r2 bucket create aogscc-youth-uploads`, uncomment `r2_buckets` and set `STORAGE_DRIVER` to `"r2"`. Existing files keep working because each one records which store it lives in.
- **Bigger mailing lists.** The cron sends 40 letters every 10 minutes (about 240 per hour, about 1,000 within the Sunday afternoon window). For thousands of subscribers, move delivery to a Cloudflare Queue consumer. The `email_deliveries` table is already per-recipient, so only `processAnnouncements()` needs to change.
- **Staging.** Add an `env.staging` block in `wrangler.jsonc` with its own D1/KV and a `staging.aogsccyouth.com` custom domain, and a workflow that deploys `--env staging` from a `staging` branch.
- **Rate limits** live in D1 (`rate_limits`). For heavy traffic, switch to the Workers Rate Limiting binding.
- **Spam.** Honeypots plus per-IP limits are in place. To add Cloudflare Turnstile, create a widget, add the site key to the forms and verify the token in `routes/public.ts`.
