// Code changes from collaborators: GitHub pull requests on the church's repositories.
// Anyone can fork and propose a change; checks run automatically; ONLY the main admin approves what reaches main.
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { requireSuper } from "../lib/auth.ts";
import { sendMail } from "../lib/email.ts";
import { hex, randomToken } from "../lib/crypto.ts";
import { esc } from "../emails/templates.ts";

export const REPOS = ["aogsccmedia-dot/aogchurch_app", "aogsccmedia-dot/scc-presenter"] as const;
const repoOk = (r: string) => (REPOS as readonly string[]).includes(r);
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

type GH = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

async function gh(env: Env, path: string, init: RequestInit = {}): Promise<GH> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "aogsccyouth.com", "x-github-api-version": "2022-11-28" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> || {}) } });
  const body = await res.json().catch(() => ({})) as GH;
  if (!res.ok) throw new HttpError(res.status === 403 || res.status === 401 ? 502 : res.status === 405 || res.status === 409 ? 409 : 502, `GitHub: ${body.message || res.status}`);
  return body;
}

/** One summary per check run set: passed / failed / running / none. */
export function checksSummary(runs: { status: string; conclusion: string | null }[]): "passed" | "failed" | "running" | "none" {
  if (!runs.length) return "none";
  if (runs.some((r) => r.status !== "completed")) return "running";
  if (runs.some((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion))) return "failed";
  return "passed";
}

async function webhookSecret(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'github_webhook_secret'").first<{ value: string }>();
  if (row?.value) return row.value;
  const v = randomToken(24);
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('github_webhook_secret', ?)").bind(v).run();
  return (await env.DB.prepare("SELECT value FROM settings WHERE key = 'github_webhook_secret'").first<{ value: string }>())!.value;
}
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

export function codeRoutes(router: Router, env: Env): void {
  const site = siteUrl(env);

  // ---- GitHub → website alerts (Repository → Settings → Webhooks). Signed with the secret shown in the admin portal.
  router.post("/api/hooks/github", async (req) => {
    const body = await req.text();
    if (body.length > 2_000_000) throw new HttpError(413, "Too large");
    const sig = req.headers.get("x-hub-signature-256") || "";
    const expected = `sha256=${await hmacHex(await webhookSecret(env), body)}`;
    if (!safeEqual(sig, expected)) throw new HttpError(401, "Bad signature");
    const kind = req.headers.get("x-github-event") || "";
    if (kind === "ping") return json({ ok: true, pong: true });
    const e = JSON.parse(body) as GH;
    const repo = String(e.repository?.full_name || "");
    if (!repoOk(repo)) return json({ ok: true, ignored: true });
    let row: { action: string; number: number | null; title: string; author: string; url: string; detail: string } | null = null;
    let alert = "";
    if (kind === "pull_request" && ["opened", "reopened", "ready_for_review", "synchronize", "closed"].includes(e.action)) {
      const pr = e.pull_request;
      const action = e.action === "closed" ? (pr.merged ? "merged" : "closed") : e.action;
      row = { action, number: pr.number, title: clip(pr.title, 200), author: clip(pr.user?.login, 60), url: pr.html_url, detail: `${pr.head?.label || ""} → ${pr.base?.ref || ""} · +${pr.additions ?? "?"} −${pr.deletions ?? "?"} in ${pr.changed_files ?? "?"} files` };
      if (["opened", "reopened", "ready_for_review"].includes(action) && !pr.draft) alert = `New change to review: “${row.title}” by ${row.author}`;
    } else if (kind === "pull_request_review" && e.action === "submitted") {
      row = { action: e.review?.state || "review", number: e.pull_request?.number ?? null, title: clip(e.pull_request?.title, 200), author: clip(e.review?.user?.login, 60), url: e.review?.html_url || e.pull_request?.html_url, detail: clip(e.review?.body, 300) };
    } else if (kind === "check_suite" && e.action === "completed") {
      const prs = (e.check_suite?.pull_requests || []).map((p: GH) => p.number);
      row = { action: e.check_suite?.conclusion || "completed", number: prs[0] ?? null, title: `Checks ${e.check_suite?.conclusion} on ${clip(e.check_suite?.head_branch, 80)}`, author: clip(e.sender?.login, 60), url: `https://github.com/${repo}/actions`, detail: clip(e.check_suite?.head_sha, 12) };
      if (e.check_suite?.conclusion === "failure" && e.check_suite?.head_branch === "main") alert = `Checks failed on main in ${repo}`;
    } else if (kind === "issues" && e.action === "opened") {
      row = { action: "opened", number: e.issue?.number, title: clip(e.issue?.title, 200), author: clip(e.issue?.user?.login, 60), url: e.issue?.html_url, detail: clip(e.issue?.body, 300) };
      alert = `New issue: “${row.title}”`;
    } else if (kind === "push" && e.ref === "refs/heads/main") {
      row = { action: "pushed", number: null, title: clip(e.head_commit?.message?.split("\n")[0], 200), author: clip(e.pusher?.name, 60), url: e.compare, detail: `${(e.commits || []).length} commit(s) to main` };
    } else if (kind === "fork") {
      row = { action: "forked", number: null, title: `Forked by ${clip(e.forkee?.owner?.login, 60)}`, author: clip(e.forkee?.owner?.login, 60), url: e.forkee?.html_url, detail: "" };
    }
    if (!row) return json({ ok: true, ignored: true });
    await env.DB.prepare("INSERT INTO code_events (repo, kind, action, number, title, author, url, detail) VALUES (?,?,?,?,?,?,?,?)")
      .bind(repo, kind, row.action, row.number, row.title, row.author, clip(row.url, 500), clip(row.detail, 500)).run();
    if (alert) {
      await sendMail(env, { to: adminEmail(env), subject: `[${repo.split("/")[1]}] ${alert}`,
        html: `<p>${esc(alert)}.</p><p>${esc(row.detail)}</p><p><a href="${site}/admin#code">Review it in the admin portal</a> · <a href="${esc(row.url)}">Open on GitHub</a></p><p style="color:#777">Only you (the main admin) can approve changes into the live site and app.</p>`,
        text: `${alert}.\n${row.detail}\nReview: ${site}/admin#code\nGitHub: ${row.url}`, template: "code_alert" });
    }
    return json({ ok: true });
  });

  // ---- Main admin: open changes across both repositories
  router.get("/api/admin/code", async (req) => {
    await requireSuper(env, req);
    const out = [];
    for (const repo of REPOS) {
      let pulls: GH[] = [];
      try { pulls = await gh(env, `/repos/${repo}/pulls?state=open&per_page=30`) as unknown as GH[]; } catch (e) { out.push({ repo, error: (e as Error).message, pulls: [] }); continue; }
      const detailed = await Promise.all(pulls.map(async (p) => {
        const [full, checks] = await Promise.all([
          gh(env, `/repos/${repo}/pulls/${p.number}`).catch(() => p),
          gh(env, `/repos/${repo}/commits/${p.head.sha}/check-runs?per_page=50`).catch(() => ({ check_runs: [] })),
        ]);
        const runs = (checks.check_runs || []) as { name: string; status: string; conclusion: string | null; html_url: string }[];
        return {
          number: p.number, title: p.title, author: p.user?.login, avatar: p.user?.avatar_url, url: p.html_url, draft: !!p.draft,
          from: p.head?.label, fromFork: p.head?.repo?.full_name !== repo, to: p.base?.ref, created: p.created_at, updated: p.updated_at,
          additions: full.additions, deletions: full.deletions, files: full.changed_files, commits: full.commits, mergeable: full.mergeable, mergeableState: full.mergeable_state,
          checks: checksSummary(runs), checkList: runs.slice(0, 12).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url })),
          body: clip(p.body, 1500),
        };
      }));
      out.push({ repo, pulls: detailed });
    }
    const { results: events } = await env.DB.prepare("SELECT * FROM code_events ORDER BY created_at DESC LIMIT 40").all();
    return json({ ok: true, repos: out, events, canMerge: !!env.GITHUB_TOKEN, webhook: { url: `${site}/api/hooks/github`, secret: await webhookSecret(env) } });
  });

  router.get("/api/admin/code/:owner/:repo/:number/files", async (req, { owner, repo, number }) => {
    await requireSuper(env, req);
    const full = `${owner}/${repo}`;
    if (!repoOk(full)) throw new HttpError(404, "Unknown repository");
    const files = await gh(env, `/repos/${full}/pulls/${Number(number)}/files?per_page=100`) as unknown as GH[];
    return json({ ok: true, files: files.map((f) => ({ name: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: clip(f.patch, 6000) })) });
  });

  /** Approve and merge into main. Only the main admin; only when every check has passed. */
  router.post("/api/admin/code/:owner/:repo/:number/approve", async (req, { owner, repo, number }) => {
    const s = await requireSuper(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const full = `${owner}/${repo}`, n = Number(number);
    if (!repoOk(full)) throw new HttpError(404, "Unknown repository");
    if (!env.GITHUB_TOKEN) throw new HttpError(409, "Add a GITHUB_TOKEN secret to the Worker first (see the steps on this page), or approve on GitHub.");
    const pr = await gh(env, `/repos/${full}/pulls/${n}`);
    if (pr.state !== "open") throw new HttpError(409, "This change is no longer open.");
    if (pr.base?.ref !== "main") throw new HttpError(409, "Only changes into main are approved here.");
    const runs = (await gh(env, `/repos/${full}/commits/${pr.head.sha}/check-runs?per_page=50`)).check_runs || [];
    const status = checksSummary(runs);
    if (status !== "passed") throw new HttpError(409, status === "running" ? "Checks are still running. Try again in a minute." : status === "none" ? "No checks have run on this change yet." : "Some checks failed. Ask the author to fix them first.");
    const { note } = await readJson<{ note?: string }>(req);
    await gh(env, `/repos/${full}/pulls/${n}/reviews`, { method: "POST", body: JSON.stringify({ event: "APPROVE", body: clip(note, 2000) || "Approved by the AOG Sandton City Church main admin." }) }).catch(() => null);
    const merged = await gh(env, `/repos/${full}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha: pr.head.sha, commit_title: `${pr.title} (#${n})` }) });
    await env.DB.prepare("INSERT INTO code_events (repo, kind, action, number, title, author, url, detail) VALUES (?,?,?,?,?,?,?,?)")
      .bind(full, "review", "approved_merged", n, clip(pr.title, 200), s.user.email, pr.html_url, clip(merged.sha, 12)).run();
    return json({ ok: true, merged: !!merged.merged, sha: merged.sha });
  });

  router.post("/api/admin/code/:owner/:repo/:number/decline", async (req, { owner, repo, number }) => {
    const s = await requireSuper(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const full = `${owner}/${repo}`, n = Number(number);
    if (!repoOk(full)) throw new HttpError(404, "Unknown repository");
    if (!env.GITHUB_TOKEN) throw new HttpError(409, "Add a GITHUB_TOKEN secret to the Worker first, or decline on GitHub.");
    const { reason, close } = await readJson<{ reason?: string; close?: boolean }>(req);
    const text = clip(reason, 3000).trim();
    if (!text) throw new HttpError(400, "Tell the author why, so they can fix it.");
    await gh(env, `/repos/${full}/pulls/${n}/reviews`, { method: "POST", body: JSON.stringify({ event: "REQUEST_CHANGES", body: text }) }).catch(async () => {
      await gh(env, `/repos/${full}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
    });
    if (close) await gh(env, `/repos/${full}/pulls/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
    await env.DB.prepare("INSERT INTO code_events (repo, kind, action, number, title, author, url, detail) VALUES (?,?,?,?,?,?,?,?)")
      .bind(full, "review", close ? "declined_closed" : "changes_requested", n, "", s.user.email, `https://github.com/${full}/pull/${n}`, clip(text, 300)).run();
    return json({ ok: true });
  });
}
