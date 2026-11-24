#!/usr/bin/env bash
# Asserted cases for run-task-post-check.sh (O-009). Uses the REAL
# tooling/report-lint.mjs and tooling/verify-summary.mjs on a throwaway git
# repo; only Vitest is replaced (VITEST_JSON_CMD). Each case asserts the exact
# exit code and whether verify-summary.md was produced. Zero network.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/run-task-post-check.sh"
TOOLING="$(cd "$HERE/../.." && pwd)/tooling"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0

REPO="$WORK/repo"
git init -q -b main "$REPO"
cd "$REPO"
git config user.email t@example.invalid
git config user.name t
echo a > README.md
git add README.md && git commit -qm base
git update-ref refs/remotes/origin/main HEAD
git switch -q -c task/O-902
mkdir -p docs/reports
printf '# O-902 報告\n\n## 完成摘要\n完成。\n\n## 未完成事項\n無。\n\n## 需要人類決定的問題\n無。\n\n## 權限被拒\n- 次數：0 次\n' > docs/reports/O-902.md
git add docs/reports/O-902.md && git commit -qm work
cp "$TOOLING/fixtures/o009/execution.json" "$WORK/exec.json"
echo '[{"type":"system"}]' > "$WORK/exec-noresult.json"

PASS_JSON='{"testResults":[{"assertionResults":[{"fullName":"a (AC-O9-1) ok","status":"passed"}]}]}'
FAILJ='{"testResults":[{"assertionResults":[{"fullName":"a (AC-O9-1) ok","status":"failed"}]}]}'
GOOD_VITEST="printf '%s' '$PASS_JSON' > \"\$1\""
FAILING_VITEST="printf '%s' '$FAILJ' > \"\$1\"; exit 1"
NOJSON_VITEST="exit 1"

# run_case <name> <expected exit> <summary expected: yes|no> [env...]
run_case() {
  local name="$1" want="$2" want_sum="$3"; shift 3
  rm -rf "$WORK/rt"; mkdir -p "$WORK/rt"
  local ec
  set +e
  env -i PATH="$PATH" HOME="$HOME" RUNNER_TEMP="$WORK/rt" GITHUB_STEP_SUMMARY="$WORK/rt/step" TOOLING_DIR="$TOOLING" \
    TASK=O-902 LOG="$WORK/exec.json" VITEST_JSON_CMD="$GOOD_VITEST" "$@" bash "$SCRIPT" > "$WORK/out" 2>&1
  ec=$?
  set -e
  local got_sum=no
  if [[ -s "$WORK/rt/verify-summary.md" ]] && grep -q '^## 自動驗證摘要（O-90[23] @ ' "$WORK/rt/verify-summary.md"; then got_sum=yes; fi
  if [[ "$ec" -ne "$want" || "$got_sum" != "$want_sum" ]]; then
    echo "CASE FAIL: ${name}: exit=${ec} (want ${want}) summary=${got_sum} (want ${want_sum})"; cat "$WORK/out"; FAIL=1
  else
    echo "CASE OK: ${name}: exit=${ec} summary=${got_sum}"
  fi
}

run_case "good report, passing tests -> exit 0 with summary" 0 yes
grep -q '次數：2' "$WORK/rt/verify-summary.md" || { echo "CASE FAIL: summary lacks the 2 denials"; FAIL=1; }
grep -q '結果：通過' "$WORK/rt/step" || { echo "CASE FAIL: step summary not appended"; FAIL=1; }
run_case "failing tests -> exit 1, summary still written" 1 yes VITEST_JSON_CMD="$FAILING_VITEST"
grep -q '結果：失敗' "$WORK/rt/verify-summary.md" || { echo "CASE FAIL: summary does not say 失敗"; FAIL=1; }
run_case "Vitest wrote no JSON -> exit 1, no summary" 1 no VITEST_JSON_CMD="$NOJSON_VITEST"
run_case "execution log without a result event -> exit 1" 1 no LOG="$WORK/exec-noresult.json"
run_case "missing execution log -> exit 1" 1 no LOG="$WORK/nope.json"
run_case "invalid TASK -> exit 1" 1 no TASK='O-902;x'
run_case "report missing -> exit 1, summary still written" 1 yes TASK=O-903
run_case "bad base ref -> exit 1" 1 no BASE_REF=refs/heads/nope

printf '\n Test Files  3 passed (3)\n' >> docs/reports/O-902.md
run_case "pasted Vitest output in the report -> exit 1, summary still written" 1 yes
git checkout -q -- docs/reports/O-902.md
for i in $(seq 1 80); do echo "- 行 ${i}" >> docs/reports/O-902.md; done
run_case "report over 80 lines -> exit 1" 1 yes
git checkout -q -- docs/reports/O-902.md
run_case "restored report passes again" 0 yes

if [[ "$FAIL" -ne 0 ]]; then echo "run-task-post-check-test: FAILED"; exit 1; fi
echo "run-task-post-check-test: all cases matched"
