#!/usr/bin/env bash
# Asserted cases for taskcheck.sh (O-008, O-009, O-012). The tooling CLIs are stubbed
# (TOOLING_DIR) so this tests only the wiring: which tool runs on which event,
# with which arguments, and that every failure is fail-closed (exit != 0).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/taskcheck.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0

STUBS="$WORK/stubs"
mkdir -p "$STUBS"
for tool in task-lint scope-check ac-coverage report-lint verify-summary; do
  cat > "$STUBS/$tool.mjs" <<STUB
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.CALLS, '${tool} ' + process.argv.slice(2).join(' ') + '\n');
process.exit(Number(process.env['EXIT_${tool//-/_}'] ?? '0'));
STUB
done
# run-mutants stub writes --out (unless NO_OUT_run_mutants=1) like the real tool.
cat > "$STUBS/run-mutants.mjs" <<'STUB'
import { appendFileSync, writeFileSync } from 'node:fs';
const a = process.argv.slice(2);
appendFileSync(process.env.CALLS, 'run-mutants ' + a.join(' ') + '\n');
if (process.env.NO_OUT_run_mutants !== '1') writeFileSync(a[a.indexOf('--out') + 1], '{}');
process.exit(Number(process.env.EXIT_run_mutants ?? '0'));
STUB

REPO="$WORK/repo"
git init -q -b main "$REPO"
cd "$REPO"
git config user.email t@example.invalid
git config user.name t
mkdir -p docs/tasks tooling
echo a > README.md
git add README.md && git commit -qm base
BASE_SHA="$(git rev-parse HEAD)"
echo "# T-901：x" > docs/tasks/T-901.md
git add docs/tasks/T-901.md && git commit -qm task
TASK_SHA="$(git rev-parse HEAD)"
echo b >> README.md
git add README.md && git commit -qm readme
README_SHA="$(git rev-parse HEAD)"
git update-ref refs/remotes/origin/main "$TASK_SHA"
git switch -q -c task/T-901 "$TASK_SHA"
echo c > tooling/x.mjs
git add tooling/x.mjs && git commit -qm work
BRANCH_SHA="$(git rev-parse HEAD)"
# O-009: a fix/Q-901 branch with a report and a QA mutants file.
git switch -q -c fix/Q-901 "$TASK_SHA"
mkdir -p docs/reports docs/qa/mutants
echo "# Q-901 報告" > docs/reports/Q-901.md
echo '{}' > docs/qa/mutants/Q-901.json
git add docs/reports/Q-901.md docs/qa/mutants/Q-901.json && git commit -qm fix
FIX_SHA="$(git rev-parse HEAD)"
# O-032: letter-suffix branches task/T-925a and fix/Q-925a.
git switch -q -c task/T-925a "$TASK_SHA"
mkdir -p tooling
echo d > tooling/y.mjs
git add tooling/y.mjs && git commit -qm "suffix work"
SFX_SHA="$(git rev-parse HEAD)"
git switch -q -c fix/Q-925a "$TASK_SHA"
mkdir -p docs/reports docs/qa/mutants
echo "# Q-925a 報告" > docs/reports/Q-925a.md
echo '{}' > docs/qa/mutants/Q-925a.json
git add docs/reports/Q-925a.md docs/qa/mutants/Q-925a.json && git commit -qm "suffix fix"
SFX_FIX_SHA="$(git rev-parse HEAD)"
git switch -q task/T-901

GOOD_VITEST='printf "{\"testResults\":[]}" > "$1"'
EMPTY_VITEST=': > "$1"'

# run_case <name> <expected exit> <expected calls (| separated, "" = none)> <env...>
run_case() {
  local name="$1" want="$2" want_calls="$3"
  shift 3
  echo "===== CASE: ${name} ====="
  : > "$WORK/calls"
  local ec
  set +e
  env -i PATH="$PATH" HOME="$HOME" RUNNER_TEMP="$WORK" GITHUB_STEP_SUMMARY="$WORK/step-summary" TOOLING_DIR="$STUBS" CALLS="$WORK/calls" \
    VITEST_JSON_CMD="$GOOD_VITEST" "$@" bash "$SCRIPT" > "$WORK/out" 2>&1
  ec=$?
  set -e
  local got_calls
  got_calls="$(sed -e "s#${WORK}#W#g" -e 's#[0-9a-f]\{40\}#SHA#g' "$WORK/calls" | paste -sd '|' -)"
  echo "exit=${ec} (expected ${want}) calls=[${got_calls}] (expected [${want_calls}])"
  if [[ "$ec" -ne "$want" || "$got_calls" != "$want_calls" ]]; then
    echo "ERROR"; cat "$WORK/out"; FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

run_case "main push adding a task file runs task-lint on it" 0 "task-lint docs/tasks/T-901.md" \
  EVENT_NAME=push REF_NAME=main BEFORE_SHA="$BASE_SHA" SHA="$TASK_SHA"
run_case "main push: task-lint failure fails the job" 1 "task-lint docs/tasks/T-901.md" \
  EVENT_NAME=push REF_NAME=main BEFORE_SHA="$BASE_SHA" SHA="$TASK_SHA" EXIT_task_lint=1
run_case "main push without task files lints nothing and passes" 0 "" \
  EVENT_NAME=push REF_NAME=main BEFORE_SHA="$TASK_SHA" SHA="$README_SHA"
run_case "main push with zero BEFORE_SHA is fail-closed" 1 "" \
  EVENT_NAME=push REF_NAME=main BEFORE_SHA=0000000000000000000000000000000000000000 SHA="$TASK_SHA"
run_case "main push with empty BEFORE_SHA is fail-closed" 1 "" \
  EVENT_NAME=push REF_NAME=main SHA="$TASK_SHA"
run_case "main push with unknown BEFORE_SHA is fail-closed" 1 "" \
  EVENT_NAME=push REF_NAME=main BEFORE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef SHA="$TASK_SHA"
run_case "task branch push runs scope-check then ac-coverage" 0 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA"
run_case "scope-check failure stops before ac-coverage" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" EXIT_scope_check=1
run_case "ac-coverage failure fails the job but the summary still runs" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" EXIT_ac_coverage=1
run_case "empty Vitest JSON is fail-closed" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" VITEST_JSON_CMD="$EMPTY_VITEST"
run_case "failing Vitest command is fail-closed" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" VITEST_JSON_CMD="exit 3"
run_case "pull_request uses head_ref and base/head SHAs" 0 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$BRANCH_SHA"
run_case "pull_request without PR_HEAD_SHA is fail-closed" 1 "" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA="$TASK_SHA"
run_case "bad diff range is fail-closed" 1 "" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef PR_HEAD_SHA="$BRANCH_SHA"
run_case "verify-summary failure fails the job" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" EXIT_verify_summary=1
run_case "fix/x (not fix/Q-<nnn>) is fail-closed" 1 "" \
  EVENT_NAME=push REF_NAME=fix/x SHA="$BRANCH_SHA"
run_case "docs/** pull_request is not routed here" 1 "" \
  EVENT_NAME=pull_request HEAD_REF=docs/g2-x BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$BRANCH_SHA"
run_case "unsupported event is fail-closed" 1 "" \
  EVENT_NAME=workflow_dispatch REF_NAME=task/T-901 SHA="$BRANCH_SHA"
run_case "empty event is fail-closed" 1 ""

# O-025: Playwright JSON is passed to ac-coverage only when e2e ran.
PW_OK="$WORK/pw-ok.json"
printf '{ "suites": [] }\n' > "$PW_OK"
: > "$WORK/pw-empty.json"
BASE_COV="scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks"
BASE_SUM="verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt"
run_case "e2e skipped does not pass --playwright" 0 \
  "${BASE_COV}|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|${BASE_SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" E2E_RESULT=skipped PLAYWRIGHT_JSON="$PW_OK"
run_case "e2e ran with valid JSON passes --playwright" 0 \
  "${BASE_COV}|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --playwright W/pw-ok.json|${BASE_SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" E2E_RESULT=success PLAYWRIGHT_JSON="$PW_OK"
run_case "e2e failed but JSON exists still passes --playwright" 0 \
  "${BASE_COV}|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --playwright W/pw-ok.json|${BASE_SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" E2E_RESULT=failure PLAYWRIGHT_JSON="$PW_OK"
run_case "e2e ran but Playwright JSON is missing is fail-closed" 1 \
  "$BASE_COV" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" E2E_RESULT=success PLAYWRIGHT_JSON="$WORK/pw-missing.json"
run_case "e2e ran but Playwright JSON is empty is fail-closed" 1 \
  "$BASE_COV" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" E2E_RESULT=success PLAYWRIGHT_JSON="$WORK/pw-empty.json"
run_case "unexpected E2E_RESULT is fail-closed" 1 \
  "$BASE_COV" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" E2E_RESULT=cancelled PLAYWRIGHT_JSON="$PW_OK"
run_case "PR + e2e skipped does not pass --e2e-skipped" 0 \
  "${BASE_COV}|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks|${BASE_SUM}" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$BRANCH_SHA" E2E_RESULT=skipped PLAYWRIGHT_JSON="$PW_OK"
run_case "push + e2e skipped passes --e2e-skipped --event push and not --playwright" 0 \
  "${BASE_COV}|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|${BASE_SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" E2E_RESULT=skipped

# O-016 (retro M5): renames must list the old path too (git diff --no-renames).
# expect_killed <mutant name> <line pattern> <run_case args...>: the case must FAIL
# on a copy of taskcheck.sh whose matching git diff line lost --no-renames.
expect_killed() {
  local mname="$1" pat="$2"; shift 2
  local mut="$WORK/taskcheck-mutant.sh" saved_fail="$FAIL" saved_script="$SCRIPT"
  awk -v pat="$pat" 'index($0, pat) { sub(/git diff --no-renames /, "git diff ") } { print }' "$SCRIPT" > "$mut"
  if cmp -s "$mut" "$SCRIPT"; then echo "ERROR: mutant ${mname} did not change the script"; FAIL=1; return; fi
  echo "----- MUTANT ${mname} (the next case must NOT match) -----"
  FAIL=0; SCRIPT="$mut"
  "$@"
  local got="$FAIL"
  FAIL="$saved_fail"; SCRIPT="$saved_script"
  if [[ "$got" -eq 1 ]]; then echo "MUTANT KILLED: ${mname}"; else echo "ERROR: mutant ${mname} survived"; FAIL=1; fi
  echo
}
git switch -q --detach "$TASK_SHA"
git mv docs/tasks/T-901.md docs/tasks/T-902.md
git commit -qm "rename a task file"
RENAMED_TASK_SHA="$(git rev-parse HEAD)"
git switch -q --detach "$TASK_SHA"
mkdir -p docs/reports
echo "# T-904 報告" > docs/reports/T-904.md
git add docs/reports/T-904.md && git commit -qm "report on the base"
REPORT_BASE_SHA="$(git rev-parse HEAD)"
git mv docs/reports/T-904.md docs/reports/T-904-fix1.md
git commit -qm "rename the report"
RENAMED_REPORT_SHA="$(git rev-parse HEAD)"
git switch -q task/T-901
run_case "main push renaming a task file still task-lints the new path (--no-renames)" 0 "task-lint docs/tasks/T-902.md" \
  EVENT_NAME=push REF_NAME=main BEFORE_SHA="$TASK_SHA" SHA="$RENAMED_TASK_SHA"
expect_killed "NR-T1 main-push task-lint diff without --no-renames" "-- 'docs/tasks/*.md'" \
  run_case "main push renaming a task file still task-lints the new path (--no-renames)" 0 "task-lint docs/tasks/T-902.md" \
  EVENT_NAME=push REF_NAME=main BEFORE_SHA="$TASK_SHA" SHA="$RENAMED_TASK_SHA"
RN_CALLS="scope-check --branch task/T-904 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-904 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks|report-lint docs/reports/T-904-fix1.md|verify-summary --task T-904 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt"
run_case "renamed report is still report-linted (--no-renames)" 0 "$RN_CALLS" \
  EVENT_NAME=pull_request HEAD_REF=task/T-904 BASE_SHA="$REPORT_BASE_SHA" PR_HEAD_SHA="$RENAMED_REPORT_SHA"
expect_killed "NR-T3 report-lint diff without --no-renames" "-- 'docs/reports/*.md'" \
  run_case "renamed report is still report-linted (--no-renames)" 0 "$RN_CALLS" \
  EVENT_NAME=pull_request HEAD_REF=task/T-904 BASE_SHA="$REPORT_BASE_SHA" PR_HEAD_SHA="$RENAMED_REPORT_SHA"

# O-009 fix/Q-901 cases need that branch checked out (mutants file is read from the tree).
git switch -q fix/Q-901
run_case "fix/Q-901 push: scope, coverage, report-lint, run-mutants, summary" 0 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA"
run_case "fix/Q-901 pull_request uses the same checks" 0 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=pull_request HEAD_REF=fix/Q-901 BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$FIX_SHA"
run_case "report-lint failure fails the job" 1 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA" EXIT_report_lint=1
run_case "surviving mutant (run-mutants exit 1) fails the job, summary still runs" 1 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA" EXIT_run_mutants=1
run_case "run-mutants without a report is fail-closed" 1 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA" EXIT_run_mutants=1 NO_OUT_run_mutants=1
# O-032 (AC-O32-5) (TC-12): one lowercase letter suffix is accepted on task/
# and fix/Q- branches; other shapes keep the same error message.
git switch -q task/T-925a
run_case "(AC-O32-5) (TC-12) task/T-925a push: scope-check then ac-coverage" 0 \
  "scope-check --branch task/T-925a --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-925a --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|verify-summary --task T-925a --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-925a SHA="$SFX_SHA"
run_case "(AC-O32-5) (TC-12) task/T-925a pull_request" 0 \
  "scope-check --branch task/T-925a --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-925a --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks|verify-summary --task T-925a --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=pull_request HEAD_REF=task/T-925a BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$SFX_SHA"
git switch -q fix/Q-925a
run_case "(AC-O32-5) (TC-12) fix/Q-925a push: report-lint and mutants with the suffix id" 0 \
  "scope-check --branch fix/Q-925a --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch fix/Q-925a --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|report-lint docs/reports/Q-925a.md|run-mutants --file docs/qa/mutants/Q-925a.json --out W/taskcheck-mutants.json|verify-summary --task Q-925a --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-925a SHA="$SFX_FIX_SHA"
for bad_branch in task/T-925ab task/T-925A task/T-92a task/T-925a/x task/T-925a-fix1 fix/T-925a fix/Q-925ab $'task/T-925a\n'; do
  run_case "(AC-O32-5) (TC-12) branch $(printf '%q' "$bad_branch") is fail-closed" 1 "" \
    EVENT_NAME=pull_request HEAD_REF="$bad_branch" BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$SFX_SHA"
  if grep -q "^taskcheck: ERROR: branch '" "$WORK/out" && grep -q "' is not task/<id> or fix/Q-<nnn>; job-level if should have skipped it$" "$WORK/out"; then
    echo "CASE OK: (AC-O32-5) (TC-12) same branch error message"
  else
    echo "ERROR: (AC-O32-5) (TC-12) branch error message changed"; cat "$WORK/out"; FAIL=1
  fi
done
git switch -q task/T-901

# O-010 db-test cases: supabase/config.toml in the working tree turns db-test on.
mkdir -p supabase && : > supabase/config.toml
DB_GOOD='printf "db-test %s\n" "$1" >> "$CALLS"; mkdir -p "$1"; printf "1..1\nok 1 - x\n" > "$1/b.tap"; printf "1..1\nok 1 - y\n" > "$1/a.tap"'
DB_FAIL_WITH_TAP='printf "db-test %s\n" "$1" >> "$CALLS"; mkdir -p "$1"; printf "1..1\nnot ok 1 - x\n" > "$1/a.tap"; exit 1'
DB_FAIL_NO_TAP='printf "db-test %s\n" "$1" >> "$CALLS"; exit 1'
DB_OK_NO_TAP='printf "db-test %s\n" "$1" >> "$CALLS"; mkdir -p "$1"; : > "$1/a.txt"'
COV_TAP="ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --tap W/taskcheck-pgtap/a.tap --tap W/taskcheck-pgtap/b.tap"
COV_TAP_PUSH="${COV_TAP} --e2e-skipped --event push"
SUM="verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt"
run_case "config.toml: db-test runs, every TAP (sorted) goes to ac-coverage" 0 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|db-test W/taskcheck-pgtap|${COV_TAP_PUSH}|${SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" DB_TEST_CMD="$DB_GOOD"
run_case "config.toml on pull_request runs db-test too" 0 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|db-test W/taskcheck-pgtap|${COV_TAP}|${SUM}" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$BRANCH_SHA" DB_TEST_CMD="$DB_GOOD"
run_case "db-test failure (not ok, TAP written) fails the job; coverage and summary still run" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|db-test W/taskcheck-pgtap|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --tap W/taskcheck-pgtap/a.tap --e2e-skipped --event push|${SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" DB_TEST_CMD="$DB_FAIL_WITH_TAP"
run_case "db-test failure without any TAP is fail-closed" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|db-test W/taskcheck-pgtap" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" DB_TEST_CMD="$DB_FAIL_NO_TAP"
run_case "db-test exit 0 but no *.tap is fail-closed" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|db-test W/taskcheck-pgtap" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" DB_TEST_CMD="$DB_OK_NO_TAP"
run_case "config.toml: ac-coverage failure with TAP still fails the job" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|db-test W/taskcheck-pgtap|${COV_TAP_PUSH}|${SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" DB_TEST_CMD="$DB_GOOD" EXIT_ac_coverage=1
FAKEBIN="$WORK/fakebin"
mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/pnpm" <<'FAKE'
#!/usr/bin/env bash
printf 'pnpm %s\n' "$*" >> "$CALLS"
[[ "$1 $2" == "db:test --tap-dir" && -n "$3" ]] || exit 9
mkdir -p "$3"; printf '1..1\nok 1 - x\n' > "$3/a.tap"
exit "${EXIT_pnpm:-0}"
FAKE
chmod +x "$FAKEBIN/pnpm"
run_case "default command is pnpm db:test --tap-dir <dir>" 0 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|pnpm db:test --tap-dir W/taskcheck-pgtap|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --tap W/taskcheck-pgtap/a.tap --e2e-skipped --event push|${SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" PATH="$FAKEBIN:$PATH"
run_case "default command failing fails the job" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|pnpm db:test --tap-dir W/taskcheck-pgtap|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --tap W/taskcheck-pgtap/a.tap --e2e-skipped --event push|${SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" PATH="$FAKEBIN:$PATH" EXIT_pnpm=1
rm -rf supabase
run_case "no config.toml: db-test does not run even with DB_TEST_CMD set" 0 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt --commits W/taskcheck-commits.txt --tasks-dir W/taskcheck-main-tasks/docs/tasks|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json --tasks-dir W/taskcheck-main-tasks/docs/tasks --e2e-skipped --event push|${SUM}" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" DB_TEST_CMD="$DB_GOOD"

# O-012: QA ownership end to end with the REAL scope-check (other tools stay
# stubbed). The commit list taskcheck.sh builds must make scope-check go red
# when a non-QA commit touches a QA-owned file, and green for a [QA] commit.
REAL_TOOLING="$(cd "$HERE/../.." && pwd)/tooling"
MIXED="$WORK/mixed"
mkdir -p "$MIXED"
cp "$STUBS"/*.mjs "$MIXED/"
cp "$REAL_TOOLING/scope-check.mjs" "$REAL_TOOLING/qa-owner.mjs" "$REAL_TOOLING/task-file.mjs" "$MIXED/"
QREPO="$WORK/qrepo"
git init -q -b main "$QREPO"
cd "$QREPO"
git config user.email t@example.invalid
git config user.name t
mkdir -p docs/tasks tooling packages/a supabase/tests
for id in T-950 T-951 T-952; do
  printf '# %s：x\n\n## 分支\n`task/%s`\n\n## 檔案範圍\n### 要做\n- `tooling/*.mjs`\n### 範圍外\n- `packages/**`\n- `supabase/**`\n' "$id" "$id" > "docs/tasks/${id}.md"
done
echo 'base' > packages/a/b.qa.test.ts
git add -A && git commit -qm base
git update-ref refs/remotes/origin/main HEAD
qcommit() { # qcommit <branch> <author email> <subject> ; edits the QA file and a tooling file
  git switch -q -c "$1" origin/main
  mkdir -p tooling
  echo "$1" >> packages/a/b.qa.test.ts
  echo "$1" > tooling/x.mjs
  git add packages/a/b.qa.test.ts tooling/x.mjs
  git -c user.email="$2" commit -qm "$3"
  git rev-parse HEAD
}
CLAUDE_EMAIL='41898282+claude[bot]@users.noreply.github.com'
Q_CLAUDE="$(qcommit task/T-950 "$CLAUDE_EMAIL" '[Claude] T-950 loosen qa test')"
Q_QA="$(qcommit task/T-951 bot@example.invalid '[QA] T-951 qa test')"
Q_FAKE="$(qcommit task/T-952 "$CLAUDE_EMAIL" '[QA] T-952 spoofed prefix')"
qa_case() { # qa_case <name> <want exit> <branch> <sha> <want: SC-QA-OWNER|OK>
  echo "===== CASE: $1 ====="
  : > "$WORK/calls"
  local ec
  set +e
  env -i PATH="$PATH" HOME="$HOME" RUNNER_TEMP="$WORK" TOOLING_DIR="$MIXED" CALLS="$WORK/calls" \
    VITEST_JSON_CMD="$GOOD_VITEST" EVENT_NAME=push REF_NAME="$3" SHA="$4" bash "$SCRIPT" > "$WORK/out" 2>&1
  ec=$?
  set -e
  if [[ "$ec" -ne "$2" ]] || ! grep -q "$5" "$WORK/out"; then
    echo "ERROR: exit=${ec} (expected $2), expected output to contain $5"; cat "$WORK/out"; FAIL=1
  else
    echo "exit=${ec} (expected $2), output contains $5"; echo "CASE OK"
  fi
  echo
}
qa_case "Claude commit modifying a QA-owned file -> scope-check red" 1 task/T-950 "$Q_CLAUDE" 'SC-QA-OWNER'
qa_case "[QA] commit by a non-bot author -> green" 0 task/T-951 "$Q_QA" 'scope-check: OK task/T-951'
qa_case "[QA] prefix but claude[bot] author -> red" 1 task/T-952 "$Q_FAKE" 'SC-QA-OWNER'
# O-013: the T-015-fix1 topology. The fix task file exists only on main;
# the branch has a [QA] commit (QA test + mutants) and then a Claude commit
# with in-scope code and the fix report. Task files must come from main.
git switch -q main
printf '# T-953：x\n\n## 分支\n`task/T-953`\n\n## 檔案範圍\n### 要做\n- `tooling/*.mjs`\n### 範圍外\n- `packages/**`\n' > docs/tasks/T-953.md
git add docs/tasks/T-953.md && git commit -qm "T-953 task"
git update-ref refs/remotes/origin/main HEAD
git switch -q -c task/T-953
mkdir -p tooling docs/qa/mutants docs/reports
echo q > packages/a/c.qa.test.ts; echo '{}' > docs/qa/mutants/T-953.json
git add packages/a/c.qa.test.ts docs/qa/mutants/T-953.json
git -c user.email=bot@example.invalid commit -qm "[QA] T-953 qa tests and mutants"
git switch -q main
printf '# T-953-fix1：x\n\n## 分支\n`task/T-953`\n\n## 檔案範圍\n### 要做\n- `tooling/*.mjs`\n' > docs/tasks/T-953-fix1.md
git add docs/tasks/T-953-fix1.md && git commit -qm "T-953-fix1 task (main only)"
git update-ref refs/remotes/origin/main HEAD
git switch -q task/T-953
mkdir -p tooling docs/reports
echo fix > tooling/x.mjs; echo '# T-953-fix1 報告' > docs/reports/T-953-fix1.md
git add tooling/x.mjs docs/reports/T-953-fix1.md
git -c user.email="$CLAUDE_EMAIL" commit -qm "[Claude] T-953-fix1 fix"
Q_FIX="$(git rev-parse HEAD)"
[[ ! -f docs/tasks/T-953-fix1.md ]] || { echo "ERROR: setup: fix task file must not be on the branch"; FAIL=1; }
qa_case "fix round: fix task only on main, [QA] commit then in-scope Claude commit -> green" 0 task/T-953 "$Q_FIX" 'scope-check: OK task/T-953'
if [[ -f "$WORK/taskcheck-main-tasks/docs/tasks/T-953-fix1.md" ]] && grep -q -- '--tasks-dir W/taskcheck-main-tasks/docs/tasks' <(sed "s#${WORK}#W#g" "$WORK/calls"); then
  echo "CASE OK: ac-coverage got main's docs/tasks (with T-953-fix1.md)"
else
  echo "ERROR: ac-coverage did not get main's docs/tasks with T-953-fix1.md"; sed "s#${WORK}#W#g" "$WORK/calls"; FAIL=1
fi
echo other > docs/reports/T-954-fix1.md
git add docs/reports/T-954-fix1.md
git -c user.email="$CLAUDE_EMAIL" commit -qm "[Claude] T-953-fix1 other task report"
qa_case "fix round: another task's fix report -> SC-OUT" 1 task/T-953 "$(git rev-parse HEAD)" 'SC-OUT'
git rm -q docs/reports/T-954-fix1.md
git -c user.email="$CLAUDE_EMAIL" commit -qm "[Claude] T-953-fix1 drop other report"
echo bad > docs/qa/mutants/T-953.json
git add docs/qa/mutants/T-953.json
git -c user.email="$CLAUDE_EMAIL" commit -qm "[Claude] T-953-fix1 touch mutants"
qa_case "Claude commit modifying docs/qa/mutants/T-953.json -> SC-QA-OWNER" 1 task/T-953 "$(git rev-parse HEAD)" 'SC-QA-OWNER'
EMPTY_BASE="$(git commit-tree "$(git hash-object -t tree /dev/null)" -m empty)"
git update-ref refs/remotes/origin/main "$EMPTY_BASE"
qa_case "main without docs/tasks -> fail-closed" 1 task/T-953 "$Q_FIX" 'taskcheck: ERROR'
# O-016 (retro M5): `git mv` an out-of-scope file into scope -> SC-OUT on the old
# path (real scope-check). Without --no-renames only the new path is listed.
git switch -q main
printf '# T-955：x\n\n## 分支\n`task/T-955`\n\n## 檔案範圍\n### 要做\n- `tooling/*.mjs`\n' > docs/tasks/T-955.md
mkdir -p packages/a
printf 'export const moved = "an out-of-scope file that is renamed into scope";\n' > packages/a/moved.ts
git add docs/tasks/T-955.md packages/a/moved.ts && git commit -qm "T-955 task and an out-of-scope file"
git update-ref refs/remotes/origin/main HEAD
git switch -q -c task/T-955
mkdir -p tooling
git mv packages/a/moved.ts tooling/moved.mjs
git -c user.email="$CLAUDE_EMAIL" commit -qm "[Claude] T-955 move an out-of-scope file into scope"
qa_case "git mv out-of-scope file into scope -> SC-OUT on the old path" 1 task/T-955 "$(git rev-parse HEAD)" 'packages/a/moved.ts:[0-9]*: SC-OUT'
MIXED_SCRIPT="$SCRIPT"
awk 'index($0, "> \"$CHANGED\"") { sub(/git diff --no-renames /, "git diff ") } { print }' "$SCRIPT" > "$WORK/taskcheck-mutant.sh"
if cmp -s "$WORK/taskcheck-mutant.sh" "$SCRIPT"; then echo "ERROR: mutant NR-T2 did not change the script"; FAIL=1; fi
SCRIPT="$WORK/taskcheck-mutant.sh"
SAVED_FAIL="$FAIL"; FAIL=0
echo "----- MUTANT NR-T2 scope-check diff without --no-renames (the next case must NOT match) -----"
qa_case "git mv out-of-scope file into scope -> SC-OUT on the old path" 1 task/T-955 "$(git rev-parse HEAD)" 'packages/a/moved.ts:[0-9]*: SC-OUT'
if [[ "$FAIL" -eq 1 ]]; then echo "MUTANT KILLED: NR-T2 scope-check diff without --no-renames"; FAIL="$SAVED_FAIL"; else echo "ERROR: mutant NR-T2 survived"; FAIL=1; fi
SCRIPT="$MIXED_SCRIPT"
cd "$REPO"

if [[ "$FAIL" -ne 0 ]]; then
  echo "taskcheck-test: FAILED"
  exit 1
fi
echo "taskcheck-test: all cases matched"
exit 0
