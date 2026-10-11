# Helping with the AOG Sandton City Church website

Thank you for helping! Anyone can propose a change. The main church admin approves every change before it goes live.

## How it works
1. **Fork** this repository on GitHub (the *Fork* button, top right). You get your own copy.
2. **Make a branch** in your copy, named after what you're doing, e.g. `fix-event-dates` or `new-prayer-page`.
3. **Make your change** and run the checks on your computer:
   ```bash
   npm install
   npm test          # tests
   npm run typecheck # code checks
   python3 tools/site/build.py   # if you changed a page in tools/site/pages
   ```
4. **Open a pull request** into `main`. Fill in the short form (what, why, how you tested).
5. **Automatic checks run** (type-check, tests and a full build). If one fails, click *Details*, fix it and push again — the pull request updates by itself.
6. **The main admin reviews it.** They can approve it (it goes live about two minutes later), ask for changes, or decline it. You'll get a GitHub notification either way.

## Rules
- Never commit passwords, API keys, tokens or anyone's personal information. Secrets live in Cloudflare and GitHub settings, not in code.
- Keep each pull request to one thing. Smaller changes are reviewed faster.
- Pages are written in `tools/site/pages/*.html`; the shared header, menu and footer come from `tools/site/build.py`.
- Be kind. Our [code of conduct](https://aogsccyouth.com/code-of-conduct) applies here too.
