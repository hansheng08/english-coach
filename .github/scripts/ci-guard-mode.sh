#!/usr/bin/env bash
# O-015 ci-guard "Decide CI mode" step: build the inputs for tooling/ci-mode.mjs
# and write mode / tasks_changed / pr_number to $GITHUB_OUTPUT.
#   push to main      : changed = git diff --no-renames --name-only BEFORE SHA (C1);
#                       referenced = ci-referenced.mjs on the SHA tree (C2, C3).
#                       Any failure (BEFORE empty / all zeros / unknown, diff or
#                       referenced error) -> --changed-error -> full.
#   push task/, fix/  : open PRs into main for this head via gh api; any gh
#                       failure (even with output) -> --pr-error -> full.
#                       O-028: also the QA-file list of BEFORE..SHA (--qa-changed);
#                       BEFORE empty / all zeros / not a commit / not an ancestor of
#                       SHA (force push) / diff error -> --qa-changed-error -> full.
#                       Previous push (QA batch warning only): the repository
#                       activity API entry (activity_type=push) whose `after` is
#                       BEFORE; its before..after is the previous range. Anything
#                       undeterminable -> --prev-skip (no warning; warn-only).
#   anything else     : --changed-error --pr-skip -> full.
# ci-mode.mjs exiting non-zero or printing an unexpected mode fails the step.
# Outputs: mode, tasks_changed, pr_number, mode_reason, qa_batch_warning
#          (qa_batch_warning=true also prints a ::warning; never changes exit code).
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
qa_args=()
prev_args=()

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ && "$1" != "$ZERO_SHA" ]]; }
is_commit() { git cat-file -e "${1}^{commit}" 2>/dev/null; }
# range_ok <from> <to>: both real commits in this clone and <from> is an ancestor of <to>.
range_ok() { is_sha "$1" && is_sha "$2" && is_commit "$1" && is_commit "$2" && git merge-base --is-ancestor "$1" "$2"; }

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
  # O-028: QA-file list for this push (fail-closed: anything odd -> --qa-changed-error -> full).
  qa_args=(--qa-changed-error)
  prev_args=(--prev-skip)
  if ! range_ok "$BEFORE_SHA" "$SHA"; then
    note "O-028: BEFORE..SHA not a fast-forward range of known commits -> --qa-changed-error"
  elif ! git diff --no-renames --name-only "$BEFORE_SHA" "$SHA" >"$WORK/qa.txt"; then
    note "O-028: git diff failed -> --qa-changed-error"
  else
    qa_args=(--qa-changed "$WORK/qa.txt")
    # Previous push (warning only). Any failure leaves --prev-skip.
    prev_before=""
    if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
      note "O-028: REPO invalid -> --prev-skip"
    elif "$GH_BIN" api "repos/${REPO}/activity?ref=refs/heads/${REF_NAME}&activity_type=push&per_page=100" >"$WORK/act.json" 2>"$WORK/act.err"; then
      prev_before="$(node -e '
const fs = require("node:fs");
let a; try { a = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(3); }
if (!Array.isArray(a)) process.exit(3);
const hit = a.find((e) => e && e.activity_type === "push" && e.after === process.argv[2]);
if (!hit || typeof hit.before !== "string") process.exit(3);
process.stdout.write(hit.before);
' "$WORK/act.json" "$BEFORE_SHA")" || prev_before="" # o004-allow: warn-only lookup; empty -> --prev-skip
    else
      note "O-028: activity API failed -> --prev-skip: $(head -c 300 "$WORK/act.err")"
    fi
    if [[ -n "$prev_before" ]] && range_ok "$prev_before" "$BEFORE_SHA" \
      && git diff --no-renames --name-only "$prev_before" "$BEFORE_SHA" >"$WORK/prev.txt"; then
      prev_args=(--prev-qa-changed "$WORK/prev.txt")
    else
      note "O-028: previous push range undeterminable -> --prev-skip"
    fi
  fi
fi

node "$TOOLING_DIR/ci-mode.mjs" decide --event "$EVENT_NAME" --ref "$REF_NAME" "${changed_args[@]}" "${pr_args[@]}" "${qa_args[@]}" "${prev_args[@]}" >"$WORK/mode.json"
echo "ci-mode: $(cat "$WORK/mode.json")"

node -e '
const fs = require("node:fs");
const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!["full", "docs", "light"].includes(o.mode)) { console.error("ci-guard-mode: bad mode " + String(o.mode)); process.exit(1); }
if (typeof o.tasks_changed !== "boolean") { console.error("ci-guard-mode: bad tasks_changed"); process.exit(1); }
if (typeof o.reason !== "string" || !/^[a-z-]+$/.test(o.reason)) { console.error("ci-guard-mode: bad reason"); process.exit(1); }
const warn = o.qa_batch_warning === undefined ? false : o.qa_batch_warning;
if (typeof warn !== "boolean") { console.error("ci-guard-mode: bad qa_batch_warning"); process.exit(1); }
if (o.mode === "light") {
  const prOk = Number.isInteger(o.pr_number) && o.pr_number > 0;
  if (o.reason === "tests-only-no-pr") {
    if (o.pr_number !== null || !process.argv[2].startsWith("task/")) { console.error("ci-guard-mode: tests-only-no-pr light needs task/** and no pr_number"); process.exit(1); }
  } else if (o.reason !== "branch-with-open-pr" || !prOk) { console.error("ci-guard-mode: light without pr_number"); process.exit(1); }
}
if (warn && o.reason !== "tests-only-no-pr") { console.error("ci-guard-mode: qa_batch_warning outside tests-only-no-pr"); process.exit(1); }
process.stdout.write(`mode=${o.mode}\ntasks_changed=${String(o.tasks_changed)}\npr_number=${o.pr_number === null ? "" : String(o.pr_number)}\nmode_reason=${o.reason}\nqa_batch_warning=${String(warn)}\n`);
' "$WORK/mode.json" "$REF_NAME" >"$WORK/out.txt"

cat "$WORK/out.txt"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  cat "$WORK/out.txt" >>"$GITHUB_OUTPUT"
fi
# O-028 item 2: warn only (exit code unchanged).
if grep -qx 'qa_batch_warning=true' "$WORK/out.txt"; then
  echo "::warning title=QA 補充測試請合併推送::尚未開 PR 的 ${REF_NAME} 連續兩次推送都只改 QA 檔，每次都會跑一輪 CI；請把補充測試合成一次推送（O-028，只警告不擋）。"
fi
