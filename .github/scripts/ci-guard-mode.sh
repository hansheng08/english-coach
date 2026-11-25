#!/usr/bin/env bash
# O-015 ci-guard "Decide CI mode" step: build the inputs for tooling/ci-mode.mjs
# and write mode / tasks_changed / pr_number to $GITHUB_OUTPUT.
#   push to main      : changed = git diff --no-renames --name-only BEFORE SHA (C1);
#                       referenced = ci-referenced.mjs on the SHA tree (C2, C3).
#                       Any failure (BEFORE empty / all zeros / unknown, diff or
#                       referenced error) -> --changed-error -> full.
#   push task/, fix/  : open PRs into main for this head via gh api; any gh
#                       failure (even with output) -> --pr-error -> full.
#   anything else     : --changed-error --pr-skip -> full.
# ci-mode.mjs exiting non-zero or printing an unexpected mode fails the step.
# Env: EVENT_NAME REF_NAME BEFORE_SHA SHA REPO (GH_TOKEN for gh);
#      optional TOOLING_DIR SCRIPTS_DIR GH_BIN (tests), GITHUB_OUTPUT.
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
SCRIPTS_DIR="${SCRIPTS_DIR:-.github/scripts}"
GH_BIN="${GH_BIN:-gh}"
EVENT_NAME="${EVENT_NAME:-}"
REF_NAME="${REF_NAME:-}"
BEFORE_SHA="${BEFORE_SHA:-}"
SHA="${SHA:-}"
REPO="${REPO:-}"
ZERO_SHA="0000000000000000000000000000000000000000"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

note() { echo "ci-guard-mode: $*" >&2; }

changed_args=(--changed-error)
pr_args=(--pr-skip)

if [[ "$EVENT_NAME" == "push" && "$REF_NAME" == "main" ]]; then
  if [[ ! "$BEFORE_SHA" =~ ^[0-9a-f]{40}$ || "$BEFORE_SHA" == "$ZERO_SHA" || ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
    note "BEFORE_SHA/SHA missing or all zeros -> --changed-error"
  elif ! git cat-file -e "${BEFORE_SHA}^{commit}" 2>/dev/null || ! git cat-file -e "${SHA}^{commit}" 2>/dev/null; then
    note "BEFORE_SHA or SHA is not a commit in this clone -> --changed-error"
  elif ! git diff --no-renames --name-only "$BEFORE_SHA" "$SHA" >"$WORK/changed.txt"; then
    note "git diff failed -> --changed-error"
  elif ! node "$SCRIPTS_DIR/ci-referenced.mjs" --sha "$SHA" --changed "$WORK/changed.txt" >"$WORK/referenced.txt"; then
    note "ci-referenced failed -> --changed-error"
  else
    changed_args=(--changed "$WORK/changed.txt" --referenced "$WORK/referenced.txt")
    note "changed: $(wc -l <"$WORK/changed.txt") file(s); referenced docs: $(wc -l <"$WORK/referenced.txt")"
  fi
elif [[ "$EVENT_NAME" == "push" && ( "$REF_NAME" == task/* || "$REF_NAME" == fix/* ) ]]; then
  if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    note "REPO missing or invalid -> --pr-error"
    pr_args=(--pr-error)
  elif ! "$GH_BIN" api "repos/${REPO}/pulls?state=open&base=main&head=${REPO%%/*}:${REF_NAME}" >"$WORK/pr.json" 2>"$WORK/pr.err"; then
    note "gh api pulls failed -> --pr-error: $(head -c 300 "$WORK/pr.err")"
    pr_args=(--pr-error)
  else
    pr_args=(--pr "$WORK/pr.json")
  fi
fi

node "$TOOLING_DIR/ci-mode.mjs" decide --event "$EVENT_NAME" --ref "$REF_NAME" "${changed_args[@]}" "${pr_args[@]}" >"$WORK/mode.json"
echo "ci-mode: $(cat "$WORK/mode.json")"

node -e '
const fs = require("node:fs");
const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!["full", "docs", "light"].includes(o.mode)) { console.error("ci-guard-mode: bad mode " + String(o.mode)); process.exit(1); }
if (typeof o.tasks_changed !== "boolean") { console.error("ci-guard-mode: bad tasks_changed"); process.exit(1); }
if (o.mode === "light" && !(Number.isInteger(o.pr_number) && o.pr_number > 0)) { console.error("ci-guard-mode: light without pr_number"); process.exit(1); }
process.stdout.write(`mode=${o.mode}\ntasks_changed=${String(o.tasks_changed)}\npr_number=${o.pr_number === null ? "" : String(o.pr_number)}\n`);
' "$WORK/mode.json" >"$WORK/out.txt"

cat "$WORK/out.txt"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  cat "$WORK/out.txt" >>"$GITHUB_OUTPUT"
fi
