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
#      (PRE_HEAD..HEAD; see run-task-pre-head.sh); O-013: task files from
#      BASE_REF (main);
#   4. (O-013) run-mutants on docs/qa/mutants/<base id>.json when present.
# Every part runs and is reported; the step exits 1 when any part fails
# (report-lint error, failing tests, missing/empty Vitest JSON, summary
# error, bad input). Notify maps that to outcome=post_check_failed.
# Env: TASK LOG RUNNER_TEMP PRE_HEAD BRANCH (O-012); optional GITHUB_STEP_SUMMARY, BASE_REF
#      (default origin/main), TOOLING_DIR / VITEST_JSON_CMD / RUN_MUTANTS_CMD (tests).
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
# (**/*.qa.test.ts, supabase/tests/qa_*.sql, O-013: docs/qa/mutants/*.json)
# fails, whatever its prefix or author. Scope rules apply to the run's own
# changes as well.
# O-013: task files come from BASE_REF (main), not the branch tree: a fix
# round's task file (T-015-fix1.md) exists only on main, and reading the
# branch tree made its report SC-OUT (run 45526553673). Each failure gets its
# own name (pre-head-invalid / tasks-from-main / scope-check:<rule ids>);
# the old blanket "scope-qa-owner" label misled that diagnosis.
SCOPE_ERR="$OUT_DIR/run-task-scope-check.err"
MAIN_TASKS="$OUT_DIR/run-task-main-tasks"
if [[ ! "${PRE_HEAD:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "run-task-post-check: PRE_HEAD '${PRE_HEAD:-}' is not a 40-hex SHA" >&2; FAILED+=(pre-head-invalid)
elif [[ ! "${BRANCH:-}" =~ ^(task/[TQOAP]-[0-9]{3}|fix/Q-[0-9]{3})$ ]]; then
  echo "run-task-post-check: BRANCH '${BRANCH:-}' is not task/<id> or fix/Q-<nnn>" >&2; FAILED+=(pre-head-invalid)
elif ! git merge-base --is-ancestor "$PRE_HEAD" "$HEAD_SHA"; then
  echo "run-task-post-check: PRE_HEAD ${PRE_HEAD} is not an ancestor of HEAD ${HEAD_SHA}" >&2; FAILED+=(pre-head-invalid)
elif ! { rm -rf "$MAIN_TASKS" && mkdir -p "$MAIN_TASKS" \
          && git archive --format=tar "$BASE_REF" docs/tasks > "$OUT_DIR/run-task-main-tasks.tar" \
          && tar -xf "$OUT_DIR/run-task-main-tasks.tar" -C "$MAIN_TASKS" \
          && compgen -G "$MAIN_TASKS/docs/tasks/*.md" > /dev/null; }; then
  echo "run-task-post-check: cannot read docs/tasks/*.md of ${BASE_REF}" >&2; FAILED+=(tasks-from-main)
else
  RUN_CHANGED="$OUT_DIR/run-task-run-changed.txt"
  RUN_COMMITS="$OUT_DIR/run-task-run-commits.txt"
  git diff --name-only "$PRE_HEAD" "$HEAD_SHA" > "$RUN_CHANGED" || die "git diff ${PRE_HEAD} ${HEAD_SHA} failed"
  git log --format=%x1e%H%x1f%ae%x1f%ce%x1f%s --name-status -M --diff-merges=dense-combined "${PRE_HEAD}..${HEAD_SHA}" > "$RUN_COMMITS" || die "git log ${PRE_HEAD}..${HEAD_SHA} failed"
  set +e
  node "$TOOLING_DIR/scope-check.mjs" --branch "$BRANCH" --changed "$RUN_CHANGED" --commits "$RUN_COMMITS" --all-non-qa --tasks-dir "$MAIN_TASKS/docs/tasks" 2> "$SCOPE_ERR"
  SCOPE_EC=$?
  set -e
  cat "$SCOPE_ERR" >&2
  if [[ "$SCOPE_EC" -ne 0 ]]; then
    RULES="$(sed -nE 's/^scope-check: FAIL [^:]*:[0-9]+: ([A-Z][A-Z-]*):.*/\1/p' "$SCOPE_ERR" | LC_ALL=C sort -u | paste -sd ',' -)"
    FAILED+=("scope-check:${RULES:-unknown}")
  fi
fi

# O-013: QA's mutants for this task (fix rounds use the base id, e.g.
# T-015-fix1 -> docs/qa/mutants/T-015.json) run here as in taskcheck; a
# surviving or broken mutant fails the step (幕僚長 agreed 2026-11-25 09:54).
BASE_ID="$(node --input-type=module -e '
const [mod, id] = process.argv.slice(1);
const { baseTaskId } = await import(mod);
const b = baseTaskId(id);
if (b === null) process.exit(1);
process.stdout.write(b);
' "$(cd "$TOOLING_DIR" && pwd)/task-file.mjs" "$TASK")" || die "baseTaskId(${TASK}) is not a valid task id"
MUTANTS="docs/qa/mutants/${BASE_ID}.json"
MUTANTS_REPORT="$OUT_DIR/run-task-mutants.json"
rm -f "$MUTANTS_REPORT"
summary_mutants=()
if [[ -f "$MUTANTS" ]]; then
  set +e
  if [[ -n "${RUN_MUTANTS_CMD:-}" ]]; then
    bash -c "$RUN_MUTANTS_CMD" -- "$MUTANTS" "$MUTANTS_REPORT"
  else
    node "$TOOLING_DIR/run-mutants.mjs" --file "$MUTANTS" --out "$MUTANTS_REPORT"
  fi
  MUTANTS_EC=$?
  set -e
  if [[ "$MUTANTS_EC" -ne 0 ]]; then FAILED+=(run-mutants); fi
  if [[ -s "$MUTANTS_REPORT" ]]; then
    summary_mutants=(--mutants "$MUTANTS_REPORT")
  else
    echo "run-task-post-check: run-mutants did not write ${MUTANTS_REPORT}" >&2; FAILED+=(run-mutants-report)
  fi
else
  echo "run-task-post-check: run-mutants: 未執行（沒有 ${MUTANTS}）"
fi

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
if node "$TOOLING_DIR/verify-summary.mjs" --task "$TASK" --sha "$HEAD_SHA" --vitest "$RESULTS" --changed "$CHANGED" --execution "$LOG" "${summary_mutants[@]}" > "$SUMMARY.tmp"; then
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
