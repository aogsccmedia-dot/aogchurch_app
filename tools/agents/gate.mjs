#!/usr/bin/env node
// Safety gate for the autonomous agents. Runs WITHOUT AI on the agent's committed change and decides whether it may
// ship to production on its own. Anything it doesn't like is left as a pull request for a human instead.
// Usage: node tools/agents/gate.mjs <guardian|freecreator> <base-ref> [--mode full|online]
import { execFileSync } from "node:child_process";

const [agent, base = "origin/main"] = process.argv.slice(2);
const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "online";
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const problems = [];

// Files any human-free change may never touch: the agents' own rules and the deploy machinery.
const PROTECTED = [/^\.github\//, /^tools\/agents\//, /^CLAUDE\.md$/, /^wrangler\.jsonc?$/, /^package(-lock)?\.json$/, /^\.agents\/[^/]+\/MISSION\.md$/,
  /^\.dev\.vars/, /(^|\/)\.env/, /^tools\/freecreator\/sync\.py$/];
// Files the build writes (not counted towards the size limit, allowed for both agents).
const GENERATED = [/^public\/[\w-]+\.html$/, /^public\/admin\/index\.html$/, /^public\/css\/[\w-]+\.min\.css$/, /^public\/sitemap-pages\.xml$/, /^src\/lib\/kb\.generated\.ts$/];
const FREECREATOR_OK = [/^public\/freecreator\//, /^public\/js\/freecreator\.js$/, /^tools\/site\/pages\/freecreator\.html$/, /^src\/routes\/freecreator\.ts$/,
  /^src\/lib\/(fc-church|bible)\.ts$/, /^test\//, /^\.agents\/freecreator\//, /^public\/sw\.js$/, /^public\/css\/pages\.css$/];
const SYNCED = /^public\/freecreator\/app\/(control|shared|web)\//;

const changes = git("diff", "--name-status", "--no-renames", `${base}...HEAD`).trim().split("\n").filter(Boolean).map((l) => { const [s, ...p] = l.split("\t"); return { s, f: p.join("\t") }; });
if (!changes.length) { console.log("No changes."); process.exit(0); }

for (const { s, f } of changes) {
  if (PROTECTED.some((re) => re.test(f))) problems.push(`touches a protected file: ${f}`);
  if (/^migrations\//.test(f) && s !== "A") problems.push(`changes or deletes an existing migration: ${f}`);
  if (agent === "freecreator" && !GENERATED.some((re) => re.test(f)) && !FREECREATOR_OK.some((re) => re.test(f))) problems.push(`outside FreeCreator's area: ${f}`);
  if (agent === "freecreator" && mode !== "full" && SYNCED.test(f)) problems.push(`edits a file copied from the desktop app (online mode): ${f}`);
  if (agent === "guardian" && /^\.agents\/freecreator\//.test(f)) problems.push(`edits the other agent's notes: ${f}`);
  if (s === "D" && !/^\.agents\//.test(f)) problems.push(`deletes a file: ${f}`);
}

// New migrations may add, never destroy.
for (const { s, f } of changes) {
  if (!/^migrations\/.*\.sql$/.test(f) || s !== "A") continue;
  const sql = git("show", `HEAD:${f}`).replace(/--.*$/gm, "");
  if (/\bDROP\s+TABLE\b|\bALTER\s+TABLE\b[^;]*\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(sql)) problems.push(`migration removes data or tables: ${f}`);
  if (/\bUPDATE\b(?![^;]*\bWHERE\b)/i.test(sql)) problems.push(`migration updates every row without a WHERE: ${f}`);
}

// No credentials in what's added.
const added = git("diff", "--unified=0", `${base}...HEAD`).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
const SECRET = /(sk-ant-[\w-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[\w]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[abpr]-[\w-]{10,}|cfut_[\w]{20,}|re_[A-Za-z0-9]{24,}|AIza[0-9A-Za-z_-]{30,})/;
if (SECRET.test(added)) problems.push("the change contains something that looks like a credential");

// Size: big changes need a human look.
const stat = git("diff", "--numstat", `${base}...HEAD`).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
const lines = stat.filter(([, , f]) => !GENERATED.some((re) => re.test(f))).reduce((n, [a, d]) => n + (Number(a) || 0) + (Number(d) || 0), 0);
const LIMIT = agent === "freecreator" ? 2500 : 1500;
if (lines > LIMIT) problems.push(`the change is large (${lines} lines; the limit for shipping on its own is ${LIMIT})`);

// The tests must not be weakened: no test removed, no assertion count drop.
const testsBefore = (git("show", `${base}:test/api.test.ts`).match(/\btest\(/g) || []).length;
const testsAfter = (git("show", "HEAD:test/api.test.ts").match(/\btest\(/g) || []).length;
if (testsAfter < testsBefore) problems.push(`tests were removed (${testsBefore} → ${testsAfter})`);
const assertsBefore = (git("show", `${base}:test/api.test.ts`).match(/\bassert\./g) || []).length;
const assertsAfter = (git("show", "HEAD:test/api.test.ts").match(/\bassert\./g) || []).length;
if (assertsAfter < assertsBefore - 3) problems.push(`assertions were removed (${assertsBefore} → ${assertsAfter})`);

console.log(`${changes.length} files changed, ${lines} hand-written lines.`);
if (problems.length) { console.log("NEEDS A HUMAN:\n- " + problems.join("\n- ")); process.exit(2); }
console.log("Gate passed.");
