#!/usr/bin/env bash
# Asserted cases for run-task-post-check.sh (O-009, O-012, O-013, O-014). Uses the REAL
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
# O-012: scope-check (run by post-check on PRE_HEAD..HEAD) needs the task file.
mkdir -p docs/tasks packages/a
printf '# O-902：x\n\n## 分支\n`task/O-902`\n\n## 檔案範圍\n### 要做\n- `tooling/*.mjs`\n### 範圍外\n- `packages/**`\n' > docs/tasks/O-902.md
echo base > packages/a/b.qa.test.ts
git add README.md docs/tasks/O-902.md packages/a/b.qa.test.ts && git commit -qm base
git update-ref refs/remotes/origin/main HEAD
BASE_SHA="$(git rev-parse HEAD)"
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
    MAIN_URL="$PWD" TASK=O-902 LOG="$WORK/exec.json" VITEST_JSON_CMD="$GOOD_VITEST" PRE_HEAD="$BASE_SHA" BRANCH=task/O-902 "$@" bash "$SCRIPT" > "$WORK/out" 2>&1
  ec=$?
  set -e
  local got_sum=no
  if [[ -s "$WORK/rt/verify-summary.md" ]] && grep -qE '^## 自動驗證摘要（(O-90[2-5]|T-971-fix[01]) @ ' "$WORK/rt/verify-summary.md"; then got_sum=yes; fi
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

# O-012: QA ownership of this run's commits (--all-non-qa).
run_case "PRE_HEAD missing -> exit 1, summary still written" 1 yes PRE_HEAD=
run_case "PRE_HEAD not 40-hex -> exit 1" 1 yes PRE_HEAD=main
run_case "BRANCH invalid -> exit 1" 1 yes BRANCH=main
run_case "PRE_HEAD not an ancestor of HEAD -> exit 1" 1 yes PRE_HEAD=0123456789abcdef0123456789abcdef01234567
echo b >> README.md
git add README.md && git commit -qm "[Claude] O-902 out of scope"
run_case "run commit outside the task scope -> exit 1 (scope rules on the run)" 1 yes
grep -q 'SC-OUT' "$WORK/out" || { echo "CASE FAIL: output lacks SC-OUT"; cat "$WORK/out"; FAIL=1; }
AFTER_OUT="$(git rev-parse HEAD)"
echo loosened >> packages/a/b.qa.test.ts
git add packages/a/b.qa.test.ts && git commit -qm "[QA] O-902 spoofed prefix inside a Claude run"
run_case "run commit touching a QA-owned file, even with [QA] prefix -> exit 1" 1 yes PRE_HEAD="$AFTER_OUT"
grep -q 'SC-QA-OWNER' "$WORK/out" || { echo "CASE FAIL: output lacks SC-QA-OWNER"; cat "$WORK/out"; FAIL=1; }
grep -q 'SC-OUT' "$WORK/out" && { echo "CASE FAIL: SC-OUT from a commit before PRE_HEAD"; FAIL=1; }
run_case "PRE_HEAD at HEAD -> no commit of this run -> exit 1 (SC-EMPTY)" 1 yes PRE_HEAD="$(git rev-parse HEAD)"
grep -q 'SC-EMPTY' "$WORK/out" || { echo "CASE FAIL: output lacks SC-EMPTY"; cat "$WORK/out"; FAIL=1; }

# O-013: exact T-015-fix1 topology (run 45526553673). main: T-971 task, later
# T-971-fix1 task (main only). Branch task/T-971: Claude commit, then a [QA]
# commit (QA test + mutants) = PRE_HEAD, then the fix-round Claude commit with
# in-scope code and docs/reports/T-971-fix1.md. Must pass; mutants run with
# the base id (docs/qa/mutants/T-971.json).
IREPO="$WORK/irepo"
git init -q -b main "$IREPO"
cd "$IREPO"
git config user.email t@example.invalid
git config user.name t
mkdir -p docs/tasks
printf '# T-971：x\n\n## 分支\n`task/T-971`\n\n## 檔案範圍\n### 要做\n- `src/*.ts`\n### 範圍外\n- `packages/**`\n' > docs/tasks/T-971.md
git add docs/tasks/T-971.md && git commit -qm "T-971 task"
git update-ref refs/remotes/origin/main HEAD
git switch -q -c task/T-971
mkdir -p src docs/reports docs/qa/mutants
echo a > src/a.ts; printf '# T-971 報告\n\n## 完成摘要\n完成。\n\n## 未完成事項\n無。\n\n## 需要人類決定的問題\n無。\n\n## 權限被拒\n- 次數：0 次\n' > docs/reports/T-971.md
git add src/a.ts docs/reports/T-971.md
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[Claude] T-971 work"
echo q > src/a.qa.test.ts; echo '{"task":"T-971","mutants":[]}' > docs/qa/mutants/T-971.json
git add src/a.qa.test.ts docs/qa/mutants/T-971.json
git -c user.email='63729823+hansheng08@users.noreply.github.com' commit -qm "[QA] T-971 mutants and qa test"
QA_HEAD="$(git rev-parse HEAD)"
git switch -q main
printf '# T-971-fix1：x\n\n## 分支\n`task/T-971`\n\n## 檔案範圍\n### 要做\n- `src/*.ts`\n' > docs/tasks/T-971-fix1.md
git add docs/tasks/T-971-fix1.md && git commit -qm "T-971-fix1 task (main only)"
git update-ref refs/remotes/origin/main HEAD
git switch -q task/T-971
echo fixed > src/a.ts; sed 's/# T-971 報告/# T-971-fix1 報告/' docs/reports/T-971.md > docs/reports/T-971-fix1.md
git add src/a.ts docs/reports/T-971-fix1.md
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[Claude] T-971-fix1 fix"
[[ ! -f docs/tasks/T-971-fix1.md ]] || { echo "CASE FAIL: setup: fix task file must not be on the branch"; FAIL=1; }
MUT_OK="printf '%s' '{\"task\":\"T-971\",\"total\":1,\"killed\":1,\"survived\":[],\"results\":[{\"id\":\"M1\",\"status\":\"killed\",\"failedTests\":[\"t\"]}]}' > \"\$2\"; echo \"mutants file: \$1\""
MUT_SURV="printf '%s' '{\"task\":\"T-971\",\"total\":1,\"killed\":0,\"survived\":[\"M1\"],\"results\":[{\"id\":\"M1\",\"status\":\"survived\",\"failedTests\":[]}]}' > \"\$2\"; exit 1"
run_case "incident topology: QA commit before PRE_HEAD, in-scope Claude fix -> exit 0" 0 yes TASK=T-971-fix1 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="$MUT_OK"
grep -q '^mutants file: docs/qa/mutants/T-971.json$' "$WORK/out" || { echo "CASE FAIL: mutants not run with the base id"; cat "$WORK/out"; FAIL=1; }
grep -q 'killed／total：1／1' "$WORK/rt/verify-summary.md" || { echo "CASE FAIL: summary lacks the mutants result"; FAIL=1; }
run_case "same, surviving mutant -> exit 1 (run-mutants), summary still written" 1 yes TASK=T-971-fix1 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="$MUT_SURV"
grep -q 'FAILED: run-mutants$' "$WORK/out" || { echo "CASE FAIL: expected only run-mutants in FAILED"; cat "$WORK/out"; FAIL=1; }
run_case "same, run-mutants wrote no report -> exit 1" 1 yes TASK=T-971-fix1 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="exit 0"
grep -q 'run-mutants-report' "$WORK/out" || { echo "CASE FAIL: expected run-mutants-report"; FAIL=1; }
run_case "tasks from the branch tree (BASE_REF = branch base) -> exit 1, scope-check:SC-OUT" 1 yes TASK=T-971-fix1 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="$MUT_OK" BASE_REF="$(git rev-parse HEAD~2)"
grep -q 'FAILED: scope-check:SC-OUT$' "$WORK/out" || { echo "CASE FAIL: expected FAILED: scope-check:SC-OUT"; cat "$WORK/out"; FAIL=1; }
echo loosen >> src/a.qa.test.ts
git add src/a.qa.test.ts
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[Claude] T-971-fix1 loosen qa test"
run_case "Claude touches the QA test after PRE_HEAD -> exit 1, scope-check:SC-QA-OWNER" 1 yes TASK=T-971-fix1 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="$MUT_OK"
grep -q 'FAILED: scope-check:SC-QA-OWNER$' "$WORK/out" || { echo "CASE FAIL: expected FAILED: scope-check:SC-QA-OWNER"; cat "$WORK/out"; FAIL=1; }
git reset -q --hard HEAD~1  # throwaway test repo: drop the loosening commit
echo '{"task":"T-971","mutants":[{}]}' > docs/qa/mutants/T-971.json
git add docs/qa/mutants/T-971.json
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[QA] T-971-fix1 spoofed mutants edit"
run_case "Claude edits docs/qa/mutants/T-971.json after PRE_HEAD (even [QA] prefix) -> exit 1" 1 yes TASK=T-971-fix1 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="$MUT_OK"
grep -q 'scope-check:SC-QA-OWNER' "$WORK/out" || { echo "CASE FAIL: expected scope-check:SC-QA-OWNER"; cat "$WORK/out"; FAIL=1; }
run_case "BASE_REF without docs/tasks -> exit 1, tasks-from-main" 1 yes TASK=T-971-fix1 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="$MUT_OK" BASE_REF="$(git commit-tree "$(git hash-object -t tree /dev/null)" -p "$(git rev-list --max-parents=0 HEAD)" -m "no docs/tasks")"
grep -q 'FAILED:.*tasks-from-main' "$WORK/out" || { echo "CASE FAIL: expected tasks-from-main"; cat "$WORK/out"; FAIL=1; }
run_case "fix0 task id -> exit 1 (baseTaskId null)" 1 no TASK=T-971-fix0 BRANCH=task/T-971 PRE_HEAD="$QA_HEAD" RUN_MUTANTS_CMD="$MUT_OK"

# O-014: T-009 run 45575460457 topology. PRE_HEAD = main M0 (branch did not
# exist yet); main gets M1 (another task file + README) during the run;
# Claude's `git fetch origin` + `git switch -c task/O-905 origin/main` bases
# the branch on M1 (no merge, no rebase). M1 must not be checked as Claude's.
CREPO="$WORK/crepo"
git init -q -b main "$CREPO"
cd "$CREPO"
git config user.email t@example.invalid
git config user.name t
mkdir -p docs/tasks
echo a > README.md
printf '# O-905：x\n\n## 分支\n`task/O-905`\n\n## 檔案範圍\n### 要做\n- `tooling/*.mjs`\n### 範圍外\n- `packages/**`\n' > docs/tasks/O-905.md
git add README.md docs/tasks/O-905.md && git commit -qm "M0: O-905 task"
M0="$(git rev-parse HEAD)"
git update-ref refs/remotes/origin/main HEAD
printf '# O-906：y\n\n## 分支\n`task/O-906`\n\n## 檔案範圍\n### 要做\n- `x/*`\n' > docs/tasks/O-906.md
echo b >> README.md
git add docs/tasks/O-906.md README.md && git commit -qm "M1: O-906 task pushed to main during the run"
git update-ref refs/remotes/origin/main HEAD
git switch -q -c task/O-905 main
mkdir -p tooling docs/reports
echo x > tooling/x.mjs
printf '# O-905 報告\n\n## 完成摘要\n完成。\n\n## 未完成事項\n無。\n\n## 需要人類決定的問題\n無。\n\n## 權限被拒\n- 次數：0 次\n' > docs/reports/O-905.md
git add tooling/x.mjs docs/reports/O-905.md
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[Claude] O-905 work"
C14=(TASK=O-905 BRANCH=task/O-905 PRE_HEAD="$M0")
run_case "O-014 (a): main commit pulled in during the run is not Claude's -> exit 0" 0 yes "${C14[@]}"
grep -q 'scope-check on 1 commit(s) of this run' "$WORK/out" || { echo "CASE FAIL: expected exactly 1 commit in range"; cat "$WORK/out"; FAIL=1; }
# Mutation: without the main exclusion, (a) must fail with SC-OUT on M1's files.
MUT_SCRIPT="$WORK/post-check-mutant.sh"
sed -e 's/ "^${FRESH_MAIN}"//' "$SCRIPT" > "$MUT_SCRIPT"
if cmp -s "$MUT_SCRIPT" "$SCRIPT"; then echo "CASE FAIL: mutation did not change the script"; FAIL=1; fi
REAL_SCRIPT="$SCRIPT"; SCRIPT="$MUT_SCRIPT"
run_case "O-014 mutant (exclusion removed): (a) now fails" 1 yes "${C14[@]}"
grep -q 'docs/tasks/O-906.md:[0-9]*: SC-OUT' "$WORK/out" && echo "MUTANT KILLED: exclusion removed -> SC-OUT docs/tasks/O-906.md" || { echo "CASE FAIL: mutant did not flag docs/tasks/O-906.md"; cat "$WORK/out"; FAIL=1; }
SCRIPT="$REAL_SCRIPT"
echo c >> README.md
git add README.md
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[Claude] O-905 out of scope"
run_case "O-014 (b): Claude's own out-of-scope commit (same file main also changed) -> SC-OUT" 1 yes "${C14[@]}"
grep -q 'README.md:[0-9]*: SC-OUT' "$WORK/out" || { echo "CASE FAIL: expected SC-OUT README.md"; cat "$WORK/out"; FAIL=1; }
grep -q 'O-906' "$WORK/out" && { echo "CASE FAIL: main's O-906 task file flagged"; FAIL=1; }
git update-ref refs/remotes/origin/main HEAD
run_case "O-014 (d): Claude moved refs/remotes/origin/main to HEAD -> still SC-OUT (fresh main used)" 1 yes "${C14[@]}"
grep -q 'README.md:[0-9]*: SC-OUT' "$WORK/out" || { echo "CASE FAIL: local origin/main tampering hid SC-OUT"; cat "$WORK/out"; FAIL=1; }
git update-ref refs/remotes/origin/main main
run_case "O-014 (c): fetching main fails -> exit 1 (main-fetch), no summary" 1 no "${C14[@]}" MAIN_URL="$WORK/no-such-repo"
grep -q 'main-fetch' "$WORK/out" || { echo "CASE FAIL: expected main-fetch"; cat "$WORK/out"; FAIL=1; }
grep -q 'run-task-post-check: OK' "$WORK/out" && { echo "CASE FAIL: OK printed after a failed fetch"; FAIL=1; }
run_case "O-014 (c2): no MAIN_URL and no GITHUB_REPOSITORY -> exit 1 (main-fetch)" 1 no "${C14[@]}" MAIN_URL=
grep -q 'main-fetch: GITHUB_REPOSITORY' "$WORK/out" || { echo "CASE FAIL: expected main-fetch: GITHUB_REPOSITORY"; cat "$WORK/out"; FAIL=1; }
git reset -q --hard HEAD~1  # throwaway test repo: drop the out-of-scope commit
# Existing branch + merge of main during the run: QA commit = PRE_HEAD, main
# gets M2, Claude merges main (--no-ff) and makes an in-scope commit.
echo q > tooling/x.qa.test.ts
git add tooling/x.qa.test.ts
git -c user.email='63729823+hansheng08@users.noreply.github.com' commit -qm "[QA] O-905 qa test"
QA14="$(git rev-parse HEAD)"
git switch -q main
printf '# O-907：z\n\n## 分支\n`task/O-907`\n\n## 檔案範圍\n### 要做\n- `z/*`\n' > docs/tasks/O-907.md
git add docs/tasks/O-907.md && git commit -qm "M2: O-907 task"
git switch -q task/O-905
git -c user.email='41898282+claude[bot]@users.noreply.github.com' merge -q --no-ff -m "[Claude] O-905 merge main" main
echo y > tooling/y.mjs
git add tooling/y.mjs
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[Claude] O-905 more"
run_case "O-014 (a2): main merged into an existing branch during the run -> exit 0" 0 yes TASK=O-905 BRANCH=task/O-905 PRE_HEAD="$QA14"
SCRIPT="$MUT_SCRIPT"
run_case "O-014 mutant (exclusion removed): (a2) now fails" 1 yes TASK=O-905 BRANCH=task/O-905 PRE_HEAD="$QA14"
grep -q 'docs/tasks/O-907.md:[0-9]*: SC-OUT' "$WORK/out" && echo "MUTANT KILLED: exclusion removed -> SC-OUT docs/tasks/O-907.md" || { echo "CASE FAIL: mutant did not flag docs/tasks/O-907.md"; cat "$WORK/out"; FAIL=1; }
SCRIPT="$REAL_SCRIPT"
echo loosen >> tooling/x.qa.test.ts
git add tooling/x.qa.test.ts
git -c user.email='41898282+claude[bot]@users.noreply.github.com' commit -qm "[QA] O-905 spoofed"
run_case "O-014: after main is excluded, Claude touching a QA file is still SC-QA-OWNER" 1 yes TASK=O-905 BRANCH=task/O-905 PRE_HEAD="$QA14"
grep -q 'FAILED: scope-check:SC-QA-OWNER$' "$WORK/out" || { echo "CASE FAIL: expected scope-check:SC-QA-OWNER"; cat "$WORK/out"; FAIL=1; }
cd "$REPO"

if [[ "$FAIL" -ne 0 ]]; then echo "run-task-post-check-test: FAILED"; exit 1; fi
echo "run-task-post-check-test: all cases matched"
