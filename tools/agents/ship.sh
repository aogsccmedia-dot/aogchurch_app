#!/usr/bin/env bash
# Ship an agent's VERIFIED change (no AI, and none of the agent's code runs here: this job holds write access).
# Applies the final patch from verify.sh, opens a pull request, and — only if verification said "ship" — merges,
# deploys, smoke-tests production and rolls back automatically if production got worse. Otherwise the pull request
# stays open for a human. Scripts here run from a trusted copy of main's tools/agents.
#
# Usage: ship.sh <guardian|freecreator> <dir from verify.sh> <trusted-tools-dir>
# Needs GH_TOKEN (contents, pull-requests, actions, issues: write); optional SCC_TOKEN for the desktop app repo.
set -uo pipefail
AGENT="$1"; DIR="$2"; TOOLS="$3"
DAY=$(date -u +%Y-%m-%d); BRANCH="agent/$AGENT/$DAY-${GITHUB_RUN_ID:-local}"
SMOKE_URL="${SMOKE_URL:-https://aogchurch-app.aogsccmedia.workers.dev}"
TITLE=$([ "$AGENT" = guardian ] && echo "Guardian" || echo "FreeCreator UX")
VERDICT=$(cat "$DIR/verdict.txt" 2>/dev/null || echo skip)
SUMMARY=$(sed -n '1,14p' "$DIR/LAST_RUN.md" 2>/dev/null || echo "Automated improvement.")
REPORT=$(cat "$DIR/report.md" 2>/dev/null)
say() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY"; return 0; }

say "### $TITLE agent"; say "$SUMMARY"; say ""; say "$REPORT"
if [ "$VERDICT" = skip ] || [ ! -s "$DIR/final.patch" ]; then say "Nothing to ship today."; exit 0; fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -q -B "$BRANCH" origin/main
git apply --index "$DIR/final.patch" || { say "The verified change no longer applies to main; skipped."; exit 0; }
FIRST=$(echo "$SUMMARY" | grep -m1 -v '^#' | sed 's/^[-* ]*//' | cut -c1-72)
git commit -q -m "$TITLE agent: ${FIRST:-daily improvement}" -m "$SUMMARY" -m "Automated change by the $TITLE agent (run ${GITHUB_RUN_ID:-local}); verified without AI before shipping."
git push -q -f origin "$BRANCH"

gh label create "agent:$AGENT" --color "d6a650" --description "Change made by the $TITLE agent" --force > /dev/null 2>&1 || true
gh label create "agent:needs-review" --color "b4321f" --description "An agent change that didn't pass every automatic check" --force > /dev/null 2>&1 || true
BODY=$(printf "%s\n\n---\n%s\n\n_Opened by the %s agent (run %s). When every automatic check passes it merges and deploys itself; production is then smoke-tested and the change is rolled back automatically if anything got worse._" "$SUMMARY" "$REPORT" "$TITLE" "${GITHUB_RUN_ID:-local}")
PR=$(gh pr create --base main --head "$BRANCH" --title "$TITLE agent: $DAY" --body "$BODY" --label "agent:$AGENT" 2>/dev/null || gh pr view "$BRANCH" --json url -q .url)
say "Pull request: $PR"

if [ "$VERDICT" != ship ]; then
  gh pr edit "$PR" --add-label "agent:needs-review" > /dev/null 2>&1 || true
  say "**Not shipped automatically** — left for a human to look at."
  exit 0
fi

# ---- the desktop app's shared screens first (FreeCreator full mode), so the website never ships ahead of its source
if [ -s "$DIR/scc.patch" ]; then
  if [ -z "${SCC_TOKEN:-}" ]; then say "No FREECREATOR_REPO_TOKEN: left for a human."; gh pr edit "$PR" --add-label "agent:needs-review" > /dev/null 2>&1; exit 0; fi
  ( git clone -q "https://x-access-token:${SCC_TOKEN}@github.com/aogsccmedia-dot/scc-presenter" ../scc-ship && cd ../scc-ship \
    && git apply --index "$DIR/scc.patch" \
    && git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "FreeCreator UX agent: ${FIRST:-daily improvement}" -m "$SUMMARY" \
    && git push -q origin HEAD:main ) || { say "Couldn't update the desktop app's source; left for a human."; gh pr edit "$PR" --add-label "agent:needs-review" > /dev/null 2>&1; exit 0; }
  say "Desktop app's shared screens updated."
fi

# ---- merge, deploy, check production, roll back if it got worse
gh pr merge "$PR" --squash --delete-branch || { say "Merge failed; left open."; exit 0; }
git fetch -q origin main; MERGED=$(git rev-parse origin/main)
git push -q origin "$MERGED:refs/heads/dev" 2>/dev/null || true
say "Merged as $MERGED. Deploying…"

deploy() {   # pushes made with the workflow token don't start other workflows, so start the deploy and wait for it
  local sha=$1 since id=""; since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  gh workflow run deploy.yml --ref main || return 1
  for _ in $(seq 1 30); do
    sleep 10
    id=$(gh run list --workflow deploy.yml --event workflow_dispatch --json databaseId,headSha,createdAt -q "[.[] | select(.headSha == \"$sha\" and .createdAt >= \"$since\")][0].databaseId")
    [ -n "$id" ] && break
  done
  [ -n "$id" ] || return 1
  gh run watch "$id" --exit-status --interval 20 > /dev/null 2>&1
}
worse() {   # true if production now fails a check it passed before this change
  sleep 45
  node "$TOOLS/smoke.mjs" "$SMOKE_URL" --json after.json > smoke.log 2>&1 || true
  node -e '
    const fs = require("fs"); let a, b = { failures: [] };
    try { a = JSON.parse(fs.readFileSync("after.json")); } catch { process.exit(1); }   // the check itself could not run: no verdict
    try { b = JSON.parse(fs.readFileSync(process.argv[1])); } catch {}
    const before = new Set((b.failures || []).map((f) => f.name)), fresh = a.failures.filter((f) => !before.has(f.name));
    if (fresh.length) { console.log(fresh.map((f) => `- ${f.name} ${f.detail}`).join("\n")); process.exit(0); }
    process.exit(1);' "$DIR/baseline.json" > worse.txt
}

DEPLOYED=0; deploy "$MERGED" && DEPLOYED=1
# Worse right after a deploy? Look again a minute later before deciding (caches and cold starts settle).
if [ $DEPLOYED -eq 1 ] && { ! worse || { sleep 60; ! worse; }; }; then
  say "✅ Deployed and production checks pass."
  gh pr comment "$PR" --body "✅ Deployed to production; the production checks pass." > /dev/null 2>&1 || true
  exit 0
fi

WHY=$( [ $DEPLOYED -eq 1 ] && cat worse.txt 2>/dev/null || echo "- The deploy itself failed." )
say "❌ Production got worse after this change — rolling back."
git checkout -q -B rollback origin/main
git revert --no-edit "$MERGED" > /dev/null && git push -q origin HEAD:main && git push -q origin HEAD:dev 2>/dev/null
deploy "$(git rev-parse HEAD)" || say "The rollback deploy needs a look."
gh issue create --title "$TITLE agent change rolled back ($DAY)" --label "agent:needs-review" \
  --body "$(printf "The %s agent's change (%s) was deployed, but production then failed checks it passed before, so it was rolled back automatically.\n\n**What broke**\n%s\n\nPull request: %s\nRun: %s/%s/actions/runs/%s" "$TITLE" "$MERGED" "$WHY" "$PR" "${GITHUB_SERVER_URL:-https://github.com}" "${GITHUB_REPOSITORY:-}" "${GITHUB_RUN_ID:-}")" > /dev/null 2>&1 || true
exit 1
