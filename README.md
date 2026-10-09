# AOG Sandton City Church — aogsccyouth.com

The church website and members' platform for **AOG Sandton City Church**, 17 Humber Street, Woodmead, Sandton.
It's one Cloudflare Worker that serves the public site and the API, backed by Cloudflare D1 (an open-source SQLite database) and Workers KV/R2 for file uploads. Everything runs on our own domain and our own Cloudflare account.

## What's inside

| Area | What it does |
|---|---|
| **Public site** | Photo-led design: black-and-white photos come to colour on hover (and on scroll on phones). Sections cover who we are, services & events, getting involved, the weekly letter, prayer, and how to visit. |
| **Join the church** | A 7-step onboarding form: path, about you, life stage, faith journey, ministries, care & consent (with a POPIA notice, under-18 guardian rules, photo/document uploads). Drafts autosave on the device. **Sign in with Google** pre-fills it. |
| **Events & forms (like Tally)** | The admin builds any event with its own form (12 field types, drag-to-reorder, live preview), cover image, capacity, waitlist and closing date. People register at `/event?e=<slug>` and get a branded confirmation email plus an add-to-calendar link. When someone cancels, the next person on the waitlist is moved in and emailed automatically. |
| **Paid events (EFT)** | Set a ticket price and tick *Paid event*. People see the banking details (per event, or the default in Site settings), the amount due for their number of tickets, and must upload proof of payment. Registrations wait as *awaiting approval* and hold their seats. The admin is emailed, then approves one by one or with **Approve all**; approved people get their ticket and calendar invite by email, and declined people get a kind note. Turn on *auto-approve* to skip the review. |
| **Weekly letter** | Footer and Google sign-up (double opt-in), plus an opt-in on the join form. The admin writes the letter; it sends **every Sunday at 14:00 SAST**, batched by cron, and automatically includes the week's published events. One-click unsubscribe. If nothing is scheduled by Saturday morning, the admin gets a reminder. |
| **Accounts** | Google sign-in for everyone, with a `/me` profile showing their events, a weekly-letter toggle and cancellations. |
| **Admin** (`/admin/`) | **Only `aogsccmedia@gmail.com`**, via Google **plus a 6-digit code emailed on every sign-in**. The admin never has to fill in the join form. Includes members (search, status, notes, attachments, CSV, POPIA erase), events & responses (check-in, CSV), letters (preview, test send, schedule), subscribers, prayer, messages, site settings and an email log. |
| **Pages** | Home, About us, Our story, What we believe, Services & events, Get involved, Prayer, Visit & contact, Join, plus Privacy (POPIA), Terms, Event payments & refunds and Cookie policy. Section tabs, previous/next buttons and a phone tab bar make it easy to move around. SEO: Church + WebSite structured data, breadcrumbs, event listings, sitemap. |
| **App (PWA)** | Installable on iPhone, Android and desktop. `/app` detects the device and browser and shows the right steps (one-tap Install where the browser supports it). Works offline for pages already visited. |
| **Cookies** | A consent banner (Essential / Functional). Choices are stored in a cookie and logged anonymously in D1. |
| **Emails** | Warm, branded HTML templates with the church logo, sent from `noreply@aogsccyouth.com` through Cloudflare Email Service. Preview and test-send every template in Admin → Email templates; failed emails can be resent from Admin → Email log. |

## Architecture

```
Browser ──► Cloudflare (aogsccyouth.com)
              └─ Worker "aogchurch-app"
                   ├─ /*        → Static Assets (public/)
                   ├─ /api/*    → src/index.ts router
                   │                ├─ D1  "aogscc-youth-db"   (members, events, registrations, letters…)
                   │                ├─ KV  "aogscc-youth-files" (uploads; switch to R2 any time)
                   │                └─ Email Service (send_email binding)
                   └─ cron */10 → weekly letter batches · Saturday reminder · housekeeping
```

There are no runtime npm dependencies: the backend is plain TypeScript on Workers APIs, which keeps it fast, cheap and easy to audit.

```
src/
  index.ts              entry: routing, security, cron
  routes/public.ts      join, events, registrations, prayer, contact, newsletter
  routes/auth.ts        Google sign-in, admin email codes, /api/me
  routes/admin.ts       everything behind the admin login
  lib/                  auth, forms (schema validation), newsletter, storage, uploads, email, rate limiting
  emails/templates.ts   branded email templates
public/                 HTML/CSS/JS served as-is
tools/site/             page sources: edit tools/site/pages/*.html, then run `python3 tools/site/build.py`
migrations/             D1 SQL migrations (applied automatically on deploy)
test/                   API tests that run the real Worker on Node + SQLite
```

## Development

```bash
npm install
npm test                # full API test suite (Node 22+)
npm run dev             # wrangler dev — local D1/KV, http://localhost:8787
npm run preview:node    # zero-dependency preview on :8788 (emails print to the console)
npm run typecheck
```

Database changes: `npm run db:new -- <name>`, write the SQL, commit. Migrations are applied automatically before each production deploy.

## Deploying

Every push to `main` runs **CI → D1 migrations → `wrangler deploy` → smoke test** via GitHub Actions. See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the one-time setup (Cloudflare token, Email Service, Google client ID) and for how to scale.
