# AOG Sandton City Church — aogsccyouth.com

The church website, members' app, admin portal and FreeCreator Online, on Cloudflare Workers + D1 + KV + Workers AI.
This file is read by every Claude session and by the two autonomous agents (see `.agents/`).

## Layout
- `src/` — the Worker (TypeScript). `src/index.ts` routes `/api/*`; `src/routes/*` are the endpoints; `src/lib/*` shared logic;
  `src/emails/templates.ts` every email (previewable in Admin → Email templates via `src/emails/samples.ts`).
- `public/` — static site served by Workers Static Assets. Page HTML is **generated**: edit `tools/site/pages/<name>.html`
  and `tools/site/build.py`, never `public/<name>.html` directly. Styles: edit `public/css/{base,pages,admin}.css`; the build
  writes the minified `*.min.css` the pages load.
- `public/js/*` — browser ES modules (no bundler). `esc()` from `site.js` escapes every user value put into HTML.
- `migrations/NNNN_*.sql` — D1 migrations, applied automatically by the deploy. Never edit an existing migration; add a new one.
- `test/api.test.ts` — the whole API, run against Node's built-in SQLite. `test/support/` holds the fake Worker env.
- FreeCreator Online lives in `public/freecreator/app/`. Its `control/`, `shared/` and `web/` folders are **copied** from the
  desktop app's source (github.com/aogsccmedia-dot/scc-presenter, `src/renderer/*` and `src/shared/`) by
  `python3 tools/freecreator/sync.py ../scc-presenter`. Online-only files (edit here): `web-bridge.js`, `gate.js`, `studio.*`,
  `program.*`, `camera.*`, `clock.js`, `ai-local.js` is generated. Landing page: `tools/site/pages/freecreator.html` + `public/js/freecreator.js`.

## Commands
- Build pages + CSS: `python3 tools/site/build.py`
- Tests: `npm test` (must stay green). Type-check: `npm run typecheck`.
- Full check (CI): `npm run typecheck && npm test && npx wrangler deploy --dry-run --outdir dist`
- Production smoke test (read-only): `node tools/agents/smoke.mjs https://aogchurch-app.aogsccmedia.workers.dev`
- Deploy = merge to `main` (`.github/workflows/deploy.yml`). Bump `const VERSION = "scc-vNN"` in `public/sw.js` whenever
  browser files change, so phones pick up the new version.

## Non-negotiable rules (security, privacy and church decisions — never weaken these)
1. Credentials only in GitHub/Cloudflare secrets. Never in code, logs, commits or issues.
2. Tickets, QR codes and ticket PDFs go only to their holder. Admins see what's needed to check someone in, never the QR/PDF.
3. Only the main admin (the `ADMIN_EMAIL` account) assigns roles, and only to members. The main admin is never a member or
   leader. Delegated admins can't delete users or manage roles. Everything not explicitly granted is main-admin only.
4. Ballots are secret: admins see totals only, never who voted for whom.
5. Analytics and rate limits never store raw IP addresses (hash them, as `rateLimit`/`ipHash` do).
6. Leaders' phone numbers are shown only to signed-in members. Messaging is member → leader only.
7. Poster photos are never altered or sent to AI.
8. No emails are imported from spreadsheets. WhatsApp only to people who opted in.
9. Visitors (guest sign-in) are never verified and can only use events, registration and their tickets — no messaging
   leaders, complaints, voting, Ask SCC, member tools or admin (`src/lib/visitors.ts`). An existing account's email can't be
   used as a visitor; known emails need an emailed code. Existing members can't sign up again.
10. Ask SCC never prays for people: it suggests scriptures and hands the person to a leader.
11. FreeCreator: free for anyone on a computer with no account (work saved in their browser). Church workspaces are strictly
    church-scoped — churches never see each other's data or streams; one church per person. Phones/tablets are sent to
    "use a computer", except phone cameras for the accounts the main admin allows.
12. Don't add GitHub branch rules that restrict `main` without a bypass. Don't change the deploy or agent workflows' safety
    checks to make a change pass.
13. Every cross-site write is refused; every write endpoint checks the session and `trustedWrite`; every SQL value is bound
    (never string-built from input); every user value in HTML goes through `esc()`.

## House style (the church's own choices)
- Plain white backgrounds; solid beige/gold (`#d6a650`) as the accent; no purple or pastel gradients; no black ticket buttons.
- Buttons centred and never wider than their box; layouts must not squash or scroll sideways at 320px.
- Write for church members, not engineers: short, warm, plain words. South African English. Times in SAST (Africa/Johannesburg).
