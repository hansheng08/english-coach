#!/usr/bin/env bash
# O-009: checks the workflow (not Claude) runs after a successful Claude step
# in claude-run-task.yml, on the working tree Claude pushed:
#   1. tooling/report-lint.mjs docs/reports/$TASK.md (charter v6 §13 rule 9:
#      no pasted test output, no hand-typed numbers, <= 80 lines);
#   2. Vitest JSON on that tree, then tooling/verify-summary.mjs with the
#      Claude execution log (permission denials) -> $RUNNER_TEMP/verify-summary.md,
#      also appended to GITHUB_STEP_SUMMARY; run-task-summary-step.sh adds it
#      to the run-task comment.
# Every part runs and is reported; the step exits 1 when any part fails
# (report-lint error, failing tests, missing/empty Vitest JSON, summary
# error, bad input). Notify maps that to outcome=post_check_failed.
# Env: TASK LOG RUNNER_TEMP; optional GITHUB_STEP_SUMMARY, BASE_REF
#      (default origin/main), TOOLING_DIR / VITEST_JSON_CMD (tests).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
OUT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
BASE_REF="${BASE_REF:-origin/main}"
die() { echo "run-task-post-check: ERROR: $*" >&2; exit 1; }

[[ "${TASK:-}" =~ ^[TQOAP]-[0-9]{3}(-fix[0-9]+)?$ ]] || die "invalid TASK '${TASK:-}'"
[[ -n "${LOG:-}" && -f "$LOG" ]] || die "execution log '${LOG:-}' is missing"
HEAD_SHA="$(git rev-parse --verify 'HEAD^{commit}')" || die "cannot resolve HEAD"

FAILED=()
REPORT="docs/reports/${TASK}.md"
if [[ ! -f "$REPORT" ]]; then
  echo "run-task-post-check: ${REPORT} does not exist" >&2
  FAILED+=(report-missing)
elif ! node "$TOOLING_DIR/report-lint.mjs" "$REPORT"; then
  FAILED+=(report-lint)
fi

CHANGED="$OUT_DIR/run-task-changed.txt"
git diff --name-only "${BASE_REF}...${HEAD_SHA}" > "$CHANGED" || die "git diff --name-only ${BASE_REF}...${HEAD_SHA} failed"

RESULTS="$OUT_DIR/run-task-vitest.json"
rm -f "$RESULTS"
set +e
if [[ -n "${VITEST_JSON_CMD:-}" ]]; then
  bash -c "$VITEST_JSON_CMD" -- "$RESULTS"
else
  pnpm exec vitest run --reporter=json --outputFile="$RESULTS"
fi
VITEST_EC=$?
set -e
# A failing test still writes the JSON; the summary shows it, the step fails.
if [[ "$VITEST_EC" -ne 0 ]]; then FAILED+=(vitest); fi
[[ -s "$RESULTS" ]] || die "Vitest JSON '${RESULTS}' is missing or empty (vitest exit ${VITEST_EC}); failed so far: ${FAILED[*]:-none}"

SUMMARY="$OUT_DIR/verify-summary.md"
rm -f "$SUMMARY"
if node "$TOOLING_DIR/verify-summary.mjs" --task "$TASK" --sha "$HEAD_SHA" --vitest "$RESULTS" --changed "$CHANGED" --execution "$LOG" > "$SUMMARY.tmp"; then
  mv "$SUMMARY.tmp" "$SUMMARY"
  cat "$SUMMARY"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"; fi
else
  FAILED+=(verify-summary)
fi

if [[ "${#FAILED[@]}" -gt 0 ]]; then
  echo "run-task-post-check: FAILED: ${FAILED[*]}" >&2
  exit 1
fi
echo "run-task-post-check: OK ${TASK} @ ${HEAD_SHA}"
