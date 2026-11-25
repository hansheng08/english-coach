#!/usr/bin/env bash
# O-009: checks the workflow (not Claude) runs after a successful Claude step
# in claude-run-task.yml, on the working tree Claude pushed:
#   1. tooling/report-lint.mjs docs/reports/$TASK.md (charter v6 §13 rule 9:
#      no pasted test output, no hand-typed numbers, <= 80 lines);
#   2. Vitest JSON on that tree, then tooling/verify-summary.mjs with the
#      Claude execution log (permission denials) -> $RUNNER_TEMP/verify-summary.md,
#      also appended to GITHUB_STEP_SUMMARY; run-task-summary-step.sh adds it
#      to the run-task comment;
#   3. (O-012) scope-check --all-non-qa on every commit of this run
#      (PRE_HEAD..HEAD; see run-task-pre-head.sh).
# Every part runs and is reported; the step exits 1 when any part fails
# (report-lint error, failing tests, missing/empty Vitest JSON, summary
# error, bad input). Notify maps that to outcome=post_check_failed.
# Env: TASK LOG RUNNER_TEMP PRE_HEAD BRANCH (O-012); optional GITHUB_STEP_SUMMARY, BASE_REF
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

# O-012: every commit this run created (PRE_HEAD..HEAD, PRE_HEAD recorded by
# run-task-pre-head.sh before Claude) is checked with scope-check
# --all-non-qa: a Claude commit touching a QA-owned file
# (**/*.qa.test.ts, supabase/tests/qa_*.sql) fails, whatever its prefix or
# author. Scope rules apply to the run's own changes as well.
QA_FAILED=0
if [[ ! "${PRE_HEAD:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "run-task-post-check: PRE_HEAD '${PRE_HEAD:-}' is not a 40-hex SHA" >&2; QA_FAILED=1
elif [[ ! "${BRANCH:-}" =~ ^(task/[TQOAP]-[0-9]{3}|fix/Q-[0-9]{3})$ ]]; then
  echo "run-task-post-check: BRANCH '${BRANCH:-}' is not task/<id> or fix/Q-<nnn>" >&2; QA_FAILED=1
elif ! git merge-base --is-ancestor "$PRE_HEAD" "$HEAD_SHA"; then
  echo "run-task-post-check: PRE_HEAD ${PRE_HEAD} is not an ancestor of HEAD ${HEAD_SHA}" >&2; QA_FAILED=1
else
  RUN_CHANGED="$OUT_DIR/run-task-run-changed.txt"
  RUN_COMMITS="$OUT_DIR/run-task-run-commits.txt"
  git diff --name-only "$PRE_HEAD" "$HEAD_SHA" > "$RUN_CHANGED" || die "git diff ${PRE_HEAD} ${HEAD_SHA} failed"
  git log --format=%x1e%H%x1f%ae%x1f%ce%x1f%s --name-status -M --diff-merges=dense-combined "${PRE_HEAD}..${HEAD_SHA}" > "$RUN_COMMITS" || die "git log ${PRE_HEAD}..${HEAD_SHA} failed"
  if ! node "$TOOLING_DIR/scope-check.mjs" --branch "$BRANCH" --changed "$RUN_CHANGED" --commits "$RUN_COMMITS" --all-non-qa; then QA_FAILED=1; fi
fi
if [[ "$QA_FAILED" -ne 0 ]]; then FAILED+=(scope-qa-owner); fi

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
