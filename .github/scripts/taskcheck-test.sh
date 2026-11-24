#!/usr/bin/env bash
# Asserted cases for taskcheck.sh (O-008, O-009). The tooling CLIs are stubbed
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
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA"
run_case "scope-check failure stops before ac-coverage" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" EXIT_scope_check=1
run_case "ac-coverage failure fails the job but the summary still runs" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" EXIT_ac_coverage=1
run_case "empty Vitest JSON is fail-closed" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" VITEST_JSON_CMD="$EMPTY_VITEST"
run_case "failing Vitest command is fail-closed" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" VITEST_JSON_CMD="exit 3"
run_case "pull_request uses head_ref and base/head SHAs" 0 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$BRANCH_SHA"
run_case "pull_request without PR_HEAD_SHA is fail-closed" 1 "" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA="$TASK_SHA"
run_case "bad diff range is fail-closed" 1 "" \
  EVENT_NAME=pull_request HEAD_REF=task/T-901 BASE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef PR_HEAD_SHA="$BRANCH_SHA"
run_case "verify-summary failure fails the job" 1 \
  "scope-check --branch task/T-901 --changed W/taskcheck-changed.txt|ac-coverage --branch task/T-901 --results W/taskcheck-vitest.json|verify-summary --task T-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt" \
  EVENT_NAME=push REF_NAME=task/T-901 SHA="$BRANCH_SHA" EXIT_verify_summary=1
run_case "fix/x (not fix/Q-<nnn>) is fail-closed" 1 "" \
  EVENT_NAME=push REF_NAME=fix/x SHA="$BRANCH_SHA"
run_case "docs/** pull_request is not routed here" 1 "" \
  EVENT_NAME=pull_request HEAD_REF=docs/g2-x BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$BRANCH_SHA"
run_case "unsupported event is fail-closed" 1 "" \
  EVENT_NAME=workflow_dispatch REF_NAME=task/T-901 SHA="$BRANCH_SHA"
run_case "empty event is fail-closed" 1 ""

# O-009 fix/Q-901 cases need that branch checked out (mutants file is read from the tree).
git switch -q fix/Q-901
run_case "fix/Q-901 push: scope, coverage, report-lint, run-mutants, summary" 0 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA"
run_case "fix/Q-901 pull_request uses the same checks" 0 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=pull_request HEAD_REF=fix/Q-901 BASE_SHA="$TASK_SHA" PR_HEAD_SHA="$FIX_SHA"
run_case "report-lint failure fails the job" 1 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA" EXIT_report_lint=1
run_case "surviving mutant (run-mutants exit 1) fails the job, summary still runs" 1 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json|verify-summary --task Q-901 --sha SHA --vitest W/taskcheck-vitest.json --changed W/taskcheck-changed.txt --mutants W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA" EXIT_run_mutants=1
run_case "run-mutants without a report is fail-closed" 1 \
  "scope-check --branch fix/Q-901 --changed W/taskcheck-changed.txt|ac-coverage --branch fix/Q-901 --results W/taskcheck-vitest.json|report-lint docs/reports/Q-901.md|run-mutants --file docs/qa/mutants/Q-901.json --out W/taskcheck-mutants.json" \
  EVENT_NAME=push REF_NAME=fix/Q-901 SHA="$FIX_SHA" EXIT_run_mutants=1 NO_OUT_run_mutants=1
git switch -q task/T-901

if [[ "$FAIL" -ne 0 ]]; then
  echo "taskcheck-test: FAILED"
  exit 1
fi
echo "taskcheck-test: all cases matched"
exit 0
