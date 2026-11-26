#!/usr/bin/env bash
# O-008 taskcheck: wire tooling/task-lint, scope-check and ac-coverage into ci.yml.
#
# Modes (decided from the event, never guessed):
#   push to main            -> task-lint every docs/tasks/*.md added or
#                              modified in this push (BEFORE_SHA..SHA).
#                              No such file -> pass with an explicit line.
#   push/PR on task/<id>    -> scope-check (git diff --no-renames --name-only BASE...HEAD,
#                              O-012: --commits from git log BASE..HEAD;
#                              O-013: --tasks-dir = docs/tasks of BASE (main)),
#   and fix/Q-<nnn> (O-009)    Vitest JSON, ac-coverage, report-lint on the
#                              changed docs/reports/*.md, run-mutants when
#                              docs/qa/mutants/<branch id>.json exists, then
#                              verify-summary into GITHUB_STEP_SUMMARY.
#                              ac-coverage / report-lint / run-mutants /
#                              verify-summary all run and are all reported;
#                              any one failing fails the job (exit 1).
#                              O-010: when supabase/config.toml exists,
#                              `pnpm db:test --tap-dir <dir>` runs against the
#                              local Supabase the job started; a db-test
#                              failure is reported like the others, and every
#                              <dir>/*.tap is passed to ac-coverage as --tap.
#                              No TAP file at all -> exit 1 (fail-closed).
#   anything else           -> exit 1 (the job-level `if` must not route
#                              other refs here; reaching this is a wiring bug).
# Fail-closed: every missing input, git error or tool failure exits non-zero.
# O-016 (retro M5): every git diff uses --no-renames, so a rename lists both
# the old (deleted) and the new path: renaming an out-of-scope file into scope
# is SC-OUT, and a renamed task file / report is still an A for --diff-filter=AM.
# Env: EVENT_NAME REF_NAME HEAD_REF BEFORE_SHA SHA BASE_SHA PR_HEAD_SHA
#      RUNNER_TEMP; optional GITHUB_STEP_SUMMARY; optional TOOLING_DIR (tests), VITEST_JSON_CMD (tests),
#      DB_TEST_CMD (tests; gets the TAP dir as $1).
#      O-025: E2E_RESULT (needs.e2e.result: success|failure|skipped; unset = skipped),
#      PLAYWRIGHT_JSON (downloaded artifact path; required and must be non-empty
#      when E2E_RESULT is success or failure).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
OUT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
EVENT_NAME="${EVENT_NAME:-}"
REF_NAME="${REF_NAME:-}"
ZERO_SHA="0000000000000000000000000000000000000000"

die() { echo "taskcheck: ERROR: $*" >&2; exit 1; }

if [[ "$EVENT_NAME" == "push" && "$REF_NAME" == "main" ]]; then
  [[ -n "${BEFORE_SHA:-}" && "${BEFORE_SHA}" != "$ZERO_SHA" ]] || die "push to main without a usable BEFORE_SHA ('${BEFORE_SHA:-}')"
  [[ -n "${SHA:-}" ]] || die "SHA is empty"
  MAIN_LIST="$OUT_DIR/taskcheck-main-tasks.txt"
  git diff --no-renames --name-only --diff-filter=AM "$BEFORE_SHA" "$SHA" -- 'docs/tasks/*.md' > "$MAIN_LIST" || die "git diff ${BEFORE_SHA} ${SHA} failed"
  mapfile -t files < "$MAIN_LIST"
  if [[ "${#files[@]}" -eq 0 ]]; then
    echo "taskcheck: main push has no added or modified docs/tasks/*.md; nothing to lint"
    exit 0
  fi
  echo "taskcheck: task-lint ${files[*]}"
  node "$TOOLING_DIR/task-lint.mjs" "${files[@]}"
  exit 0
fi

case "$EVENT_NAME" in
  push)
    BRANCH="$REF_NAME"
    BASE="origin/main"
    HEAD="${SHA:-}"
    ;;
  pull_request)
    BRANCH="${HEAD_REF:-}"
    BASE="${BASE_SHA:-}"
    HEAD="${PR_HEAD_SHA:-}"
    ;;
  *) die "unsupported event '${EVENT_NAME}'" ;;
esac
[[ "$BRANCH" =~ ^(task/[TQOAP]-[0-9]{3}|fix/Q-[0-9]{3})$ ]] || die "branch '${BRANCH}' is not task/<id> or fix/Q-<nnn>; job-level if should have skipped it"
[[ -n "$BASE" && -n "$HEAD" ]] || die "base ('${BASE}') or head ('${HEAD}') is empty"
BRANCH_ID="${BRANCH#*/}"
HEAD_SHA="$(git rev-parse --verify "${HEAD}^{commit}")" || die "cannot resolve head '${HEAD}'"

# O-013: task files come from main (BASE), never from the branch tree. Task
# files are pushed to main before dispatch (charter §3) and Claude may not
# edit docs/tasks/**, so a fix round's task file (e.g. T-015-fix1.md) exists
# only on main; reading the branch tree made its report SC-OUT and hid its
# ACs from ac-coverage (T-015-fix1 run 45526553673).
MAIN_TASKS="$OUT_DIR/taskcheck-main-tasks"
rm -rf "$MAIN_TASKS"
mkdir -p "$MAIN_TASKS"
git archive --format=tar "$BASE" docs/tasks > "$OUT_DIR/taskcheck-main-tasks.tar" || die "git archive ${BASE} docs/tasks failed"
tar -xf "$OUT_DIR/taskcheck-main-tasks.tar" -C "$MAIN_TASKS" || die "cannot extract docs/tasks of ${BASE}"
TASKS_DIR="$MAIN_TASKS/docs/tasks"
compgen -G "$TASKS_DIR/*.md" > /dev/null || die "no docs/tasks/*.md in ${BASE}"

CHANGED="$OUT_DIR/taskcheck-changed.txt"
git diff --no-renames --name-only "${BASE}...${HEAD}" > "$CHANGED" || die "git diff --name-only ${BASE}...${HEAD} failed"
echo "taskcheck: changed files (${BASE}...${HEAD}):"
cat "$CHANGED"
# O-012: the commit list (BASE..HEAD, merges as dense-combined diffs) lets
# scope-check enforce QA ownership of **/*.qa.test.ts and
# supabase/tests/qa_*.sql (only [QA] commits by non-bot authors may touch them).
COMMITS="$OUT_DIR/taskcheck-commits.txt"
git log --format=%x1e%H%x1f%ae%x1f%ce%x1f%s --name-status -M --diff-merges=dense-combined "${BASE}..${HEAD}" > "$COMMITS" || die "git log ${BASE}..${HEAD} failed"
node "$TOOLING_DIR/scope-check.mjs" --branch "$BRANCH" --changed "$CHANGED" --commits "$COMMITS" --tasks-dir "$TASKS_DIR"

RESULTS="$OUT_DIR/taskcheck-vitest.json"
rm -f "$RESULTS"
if [[ -n "${VITEST_JSON_CMD:-}" ]]; then
  bash -c "$VITEST_JSON_CMD" -- "$RESULTS" || die "Vitest JSON command failed (exit $?)"
else
  pnpm exec vitest run --reporter=json --outputFile="$RESULTS" || die "vitest run failed (exit $?)"
fi
[[ -s "$RESULTS" ]] || die "Vitest JSON report '${RESULTS}' is missing or empty"

# From here every check runs and is reported; FAILED collects the names.
FAILED=()
cov_args=(--branch "$BRANCH" --results "$RESULTS" --tasks-dir "$TASKS_DIR")
if [[ -f supabase/config.toml ]]; then
  TAP_DIR="$OUT_DIR/taskcheck-pgtap"
  rm -rf "$TAP_DIR"
  # One code path for CI and tests: the default command is the real one.
  if ! bash -c "${DB_TEST_CMD:-pnpm db:test --tap-dir \"\$1\"}" -- "$TAP_DIR"; then FAILED+=(db-test); fi
  taps=()
  if [[ -d "$TAP_DIR" ]]; then mapfile -t taps < <(find "$TAP_DIR" -maxdepth 1 -type f -name '*.tap' | LC_ALL=C sort); fi
  [[ "${#taps[@]}" -gt 0 ]] || die "db-test wrote no *.tap under '${TAP_DIR}' (failed: ${FAILED[*]:-none})"
  for t in "${taps[@]}"; do cov_args+=(--tap "$t"); done
else
  echo "taskcheck: db-test: 未執行（沒有 supabase/config.toml）"
fi
# O-025: only pass --playwright when e2e actually ran. Missing/empty JSON is
# fail-closed (die), not a silent skip. Unset or skipped keeps Vitest/TAP only.
E2E_RESULT="${E2E_RESULT:-skipped}"
PLAYWRIGHT_JSON="${PLAYWRIGHT_JSON:-}"
case "$E2E_RESULT" in
  success|failure)
    [[ -s "${PLAYWRIGHT_JSON}" ]] || die "e2e ran (${E2E_RESULT}) but Playwright JSON '${PLAYWRIGHT_JSON}' is missing or empty"
    cov_args+=(--playwright "$PLAYWRIGHT_JSON")
    ;;
  skipped)
    echo "taskcheck: ac-coverage: 未傳 --playwright（e2e 未跑或被略過）"
    ;;
  *)
    die "unexpected E2E_RESULT '${E2E_RESULT}'"
    ;;
esac
if ! node "$TOOLING_DIR/ac-coverage.mjs" "${cov_args[@]}"; then FAILED+=(ac-coverage); fi

REPORTS="$OUT_DIR/taskcheck-reports.txt"
git diff --no-renames --name-only --diff-filter=AM "${BASE}...${HEAD}" -- 'docs/reports/*.md' > "$REPORTS" || die "git diff for docs/reports failed"
mapfile -t reports < "$REPORTS"
if [[ "${#reports[@]}" -eq 0 ]]; then
  echo "taskcheck: report-lint: no added or modified docs/reports/*.md on this branch"
elif ! node "$TOOLING_DIR/report-lint.mjs" "${reports[@]}"; then
  FAILED+=(report-lint)
fi

MUTANTS="docs/qa/mutants/${BRANCH_ID}.json"
MUTANTS_REPORT="$OUT_DIR/taskcheck-mutants.json"
rm -f "$MUTANTS_REPORT"
summary_args=(--task "$BRANCH_ID" --sha "$HEAD_SHA" --vitest "$RESULTS" --changed "$CHANGED")
if [[ -f "$MUTANTS" ]]; then
  if ! node "$TOOLING_DIR/run-mutants.mjs" --file "$MUTANTS" --out "$MUTANTS_REPORT"; then FAILED+=(run-mutants); fi
  [[ -s "$MUTANTS_REPORT" ]] || die "run-mutants did not write '${MUTANTS_REPORT}'"
  summary_args+=(--mutants "$MUTANTS_REPORT")
else
  echo "taskcheck: run-mutants: 未執行（沒有 ${MUTANTS}）"
fi

SUMMARY="$OUT_DIR/taskcheck-verify-summary.md"
if node "$TOOLING_DIR/verify-summary.mjs" "${summary_args[@]}" > "$SUMMARY"; then
  cat "$SUMMARY"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"; fi
else
  FAILED+=(verify-summary)
fi

if [[ "${#FAILED[@]}" -gt 0 ]]; then
  echo "taskcheck: FAILED: ${FAILED[*]}" >&2
  exit 1
fi
echo "taskcheck: OK ${BRANCH}"
