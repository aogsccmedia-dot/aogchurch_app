#!/usr/bin/env bash
# Verify an agent's change WITHOUT AI and WITHOUT any write access or secrets (the agent's code — build, tests — runs
# here, so this job must never hold credentials). Applies the patch to fresh main, rebuilds, type-checks, tests, builds
# the Worker and runs the safety gate. Writes the final patch (including generated files) and a verdict for the ship job.
#
# Usage: verify.sh <guardian|freecreator> <full|online> <in-dir> <out-dir> <trusted-tools-dir>
set -uo pipefail
AGENT="$1"; MODE="$2"; IN="$3"; OUT="$4"; TOOLS="$5"
mkdir -p "$OUT"
cp "$IN/LAST_RUN.md" "$IN/baseline.json" "$OUT/" 2>/dev/null || true
verdict() { printf '%s\n' "$1" > "$OUT/verdict.txt"; }

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -q -B agent-change origin/main

CHECKS=""; OK=1
# ---- the website change
if [ -s "$IN/app.patch" ] && ! git apply --3way --index "$IN/app.patch"; then
  verdict "skip"; echo "Today's change no longer applies cleanly to main (something else changed the same lines)." > "$OUT/report.md"; exit 0
fi
# ---- the desktop app's shared screens (FreeCreator, full mode): test them in a fresh public clone
if [ "$MODE" = full ] && [ -s "$IN/scc.patch" ]; then
  git clone -q --depth 50 https://github.com/aogsccmedia-dot/scc-presenter ../scc-presenter
  if (cd ../scc-presenter && git apply --index "$IN/scc.patch"); then
    bad=$(cd ../scc-presenter && git diff --cached --name-only | grep -E '^(package(-lock)?\.json|src/main/|build/|\.github/|tools/|electron-builder)' || true)
    [ -n "$bad" ] && { OK=0; CHECKS+="- Desktop change touches protected files: $bad\n"; }
    (cd ../scc-presenter && node --test test/*.test.js > ../scc-test.log 2>&1) || { OK=0; CHECKS+="- Desktop app tests failed\n"; }
    (cd ../scc-presenter && for f in $(git ls-files '*.js' '*.mjs' '*.cjs'); do node --check "$f" || exit 1; done) || { OK=0; CHECKS+="- A desktop JavaScript file doesn't parse\n"; }
    cp "$IN/scc.patch" "$OUT/scc.patch"
    python3 tools/freecreator/sync.py ../scc-presenter > /dev/null || { OK=0; CHECKS+="- Syncing the desktop screens failed\n"; }
  else
    OK=0; CHECKS+="- The desktop app change no longer applies cleanly\n"
  fi
fi

python3 tools/site/build.py > /dev/null || { OK=0; CHECKS+="- Page build failed\n"; }
git add -A
if git diff --cached --quiet; then verdict "skip"; echo "Nothing changed after rebuilding." > "$OUT/report.md"; exit 0; fi
git commit -q -m "agent change"

npm run typecheck > typecheck.log 2>&1 || { OK=0; CHECKS+="- Type-check failed: $(grep -m3 'error TS' typecheck.log | tr '\n' ' ')\n"; }
npm test > test.log 2>&1 || { OK=0; CHECKS+="- Tests failed ($(grep -E '^# fail' test.log)): $(grep -m3 '^not ok' test.log | tr '\n' ' ')\n"; }
npx wrangler deploy --dry-run --outdir dist > build.log 2>&1 || { OK=0; CHECKS+="- Worker build failed\n"; }
# The gate comes from main (a trusted copy taken before the patch was applied), never from the agent's change.
GATE=$(node "$TOOLS/gate.mjs" "$AGENT" origin/main --mode "$MODE" 2>&1); [ $? -ne 0 ] && OK=0

git diff --binary origin/main HEAD > "$OUT/final.patch"
{ echo "**Automatic checks**"; echo; echo '```'; echo "$GATE"; echo '```'; printf "%b" "$CHECKS"; } > "$OUT/report.md"
verdict "$([ $OK -eq 1 ] && echo ship || echo review)"
cat "$OUT/report.md"
