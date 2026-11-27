#!/usr/bin/env bash
# O-028 item 3 (ci-supersede.yml): read the `ci` runs, their jobs and the existing
# `ci-push-superseded` statuses for one head SHA through the GitHub API, let
# tooling/ci-supersede.mjs decide mark / retract / none, then POST the status.
# Fail-closed: bad SHA / REPO, any gh failure, bad JSON or a non-zero decision
# exits non-zero and posts nothing. Never checks out or runs PR code.
# Env: SHA REPO (GH_TOKEN for gh); optional TOOLING_DIR GH_BIN (tests).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
GH_BIN="${GH_BIN:-gh}"
SHA="${SHA:-}"
REPO="${REPO:-}"
CONTEXT="ci-push-superseded"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

die() { echo "ci-supersede: $*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "SHA missing or not 40 hex"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "REPO missing or invalid"

"$GH_BIN" api "repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=100" >"$WORK/runs-page.json" \
  || die "gh api runs failed"
# runs.json = workflow_runs array; pr-ids.txt = pull_request run ids at this SHA (jobs are read for these).
node -e '
const fs = require("node:fs");
const [page, sha, runsOut, idsOut] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(page, "utf8"));
if (p === null || typeof p !== "object" || !Array.isArray(p.workflow_runs)) { console.error("ci-supersede: runs page has no workflow_runs"); process.exit(1); }
fs.writeFileSync(runsOut, JSON.stringify(p.workflow_runs));
const ids = p.workflow_runs.filter((r) => r && r.head_sha === sha && r.event === "pull_request" && Number.isInteger(r.id) && r.id > 0).map((r) => r.id);
fs.writeFileSync(idsOut, ids.map((n) => `${n}\n`).join(""));
' "$WORK/runs-page.json" "$SHA" "$WORK/runs.json" "$WORK/pr-ids.txt"

echo '{}' >"$WORK/jobs.json"
while read -r id; do
  [[ "$id" =~ ^[1-9][0-9]*$ ]] || die "bad run id: $id"
  "$GH_BIN" api "repos/${REPO}/actions/runs/${id}/jobs?per_page=100" >"$WORK/jobs-$id.json" || die "gh api jobs for run $id failed"
  node -e '
const fs = require("node:fs");
const [all, one, id] = process.argv.slice(1);
const j = JSON.parse(fs.readFileSync(one, "utf8"));
if (j === null || typeof j !== "object" || !Array.isArray(j.jobs)) { console.error("ci-supersede: jobs page has no jobs"); process.exit(1); }
const acc = JSON.parse(fs.readFileSync(all, "utf8"));
acc[id] = j.jobs;
fs.writeFileSync(all, JSON.stringify(acc));
' "$WORK/jobs.json" "$WORK/jobs-$id.json" "$id"
done <"$WORK/pr-ids.txt"

"$GH_BIN" api "repos/${REPO}/commits/${SHA}/statuses?per_page=100" >"$WORK/statuses.json" || die "gh api statuses failed"
node -e '
const fs = require("node:fs");
const [inp, out, ctx] = process.argv.slice(1);
const s = JSON.parse(fs.readFileSync(inp, "utf8"));
if (!Array.isArray(s)) { console.error("ci-supersede: statuses is not an array"); process.exit(1); }
fs.writeFileSync(out, JSON.stringify(s.filter((x) => x && x.context === ctx)));
' "$WORK/statuses.json" "$WORK/existing.json" "$CONTEXT"

node "$TOOLING_DIR/ci-supersede.mjs" decide --sha "$SHA" --repo "$REPO" --runs "$WORK/runs.json" \
  --jobs "$WORK/jobs.json" --existing "$WORK/existing.json" >"$WORK/decision.json"
echo "ci-supersede: $(cat "$WORK/decision.json")"

# Pull action / description / target URL out of the decision (target = the PR run's web page).
node -e '
const fs = require("node:fs");
const [dec, runs, out] = process.argv.slice(1);
const d = JSON.parse(fs.readFileSync(dec, "utf8"));
if (!["mark", "retract", "none"].includes(d.action)) { console.error("ci-supersede: bad action " + String(d.action)); process.exit(1); }
let url = "";
if (d.action === "mark") {
  const r = JSON.parse(fs.readFileSync(runs, "utf8")).find((x) => x && x.id === d.prRunId);
  if (!r || typeof r.html_url !== "string" || !r.html_url.startsWith("https://github.com/")) { console.error("ci-supersede: PR run url missing"); process.exit(1); }
  if (typeof d.description !== "string" || d.description === "") { console.error("ci-supersede: empty description"); process.exit(1); }
  url = r.html_url;
}
fs.writeFileSync(out, `${d.action}\n${url}\n${String(d.description ?? "")}\n`);
' "$WORK/decision.json" "$WORK/runs.json" "$WORK/act.txt"
{ read -r action; read -r target_url; read -r description; } <"$WORK/act.txt"

case "$action" in
  mark)
    "$GH_BIN" api -X POST "repos/${REPO}/statuses/${SHA}" -f state=success -f context="$CONTEXT" \
      -f description="$description" -f target_url="$target_url" >/dev/null || die "POST status (mark) failed"
    echo "ci-supersede: marked $CONTEXT=success on $SHA"
    ;;
  retract)
    "$GH_BIN" api -X POST "repos/${REPO}/statuses/${SHA}" -f state=error -f context="$CONTEXT" \
      -f description="取代條件已不成立（PR 的 ci-ok 不是綠燈）；以必過的 ci-ok 為準" >/dev/null || die "POST status (retract) failed"
    echo "ci-supersede: retracted $CONTEXT (state=error) on $SHA"
    ;;
  none)
    echo "ci-supersede: nothing to do"
    ;;
esac
