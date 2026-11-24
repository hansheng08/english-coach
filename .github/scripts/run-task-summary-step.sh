#!/usr/bin/env bash
# Orchestrate detect-resplit + run-task-summary + PR/commit comment (C3 / B3).
# O-009: the comment also carries the automatic verification summary.
# Fail closed when Claude succeeded but execution_file is missing.
# Exit status is the resplit detector's status (1 if a bypass is found).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOG="${LOG:-}"
CLAUDE_OUTCOME="${CLAUDE_OUTCOME:-}"
if [[ -z "${LOG}" || ! -f "$LOG" ]]; then
  if [[ "${CLAUDE_OUTCOME}" == "success" ]]; then
    echo "ERROR: claude outcome is success but execution_file is missing or unreadable: '${LOG}'"
    exit 1
  fi
  echo "No execution_file; skip summary and resplit check (claude outcome=${CLAUDE_OUTCOME:-unknown})."
  exit 0
fi

set +e
RESPLIT_REPORT="$(node "$HERE/detect-resplit.mjs" "$LOG")"
RESPLIT_STATUS=$?
set -e
printf '%s' "$RESPLIT_REPORT"
export RESPLIT_REPORT

SUMMARY_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
mkdir -p "$SUMMARY_DIR"
SUMMARY_FILE="${SUMMARY_DIR}/run-task-summary.md"
node "$HERE/run-task-summary.mjs" "$LOG" | tee "$SUMMARY_FILE"

# O-009: append the automatic verification summary written by
# run-task-post-check.sh (same RUNNER_TEMP). Its absence is not a failure
# here: the post-check step already failed and Notify reports post_check_failed.
VERIFY_SUMMARY="${SUMMARY_DIR}/verify-summary.md"
if [[ -s "$VERIFY_SUMMARY" ]]; then
  { echo; cat "$VERIFY_SUMMARY"; } | tee -a "$SUMMARY_FILE"
else
  { echo; echo "（自動驗證摘要未產生：見 run-task post-check 步驟，outcome 為 post_check_failed 或 Claude 未成功）"; } | tee -a "$SUMMARY_FILE"
fi

# o004-allow: detached HEAD should not fail the summary step; posting then uses SHA.
BRANCH="$(git branch --show-current || true)"
if [[ ! "${BRANCH:-}" =~ ^(task|fix)/ ]]; then
  BRANCH="task/${TASK:-unknown}"
fi
# o004-allow: no open PR is a normal mode-C state; fall back to a commit comment (including on 403).
PR_NUMBER="$(gh pr list --repo "${GITHUB_REPOSITORY}" --head "$BRANCH" --state open --json number --jq '.[0].number // empty' || true)"
SHA="$(git rev-parse HEAD)"

args=(
  --repo "${GITHUB_REPOSITORY}"
  --sha "$SHA"
  --body-file "$SUMMARY_FILE"
)
if [[ -n "${PR_NUMBER:-}" ]]; then
  args+=(--pr "$PR_NUMBER")
fi
node "$HERE/post-run-task-comment.mjs" "${args[@]}"

exit "$RESPLIT_STATUS"
