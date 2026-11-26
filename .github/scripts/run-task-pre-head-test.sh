#!/usr/bin/env bash
# Asserted cases for run-task-pre-head.sh (O-012) with the REAL
# tooling/task-file.mjs on a throwaway git repo. Each case asserts the exit
# code and the exact GITHUB_OUTPUT lines. Zero network.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/run-task-pre-head.sh"
TOOLING="$(cd "$HERE/../.." && pwd)/tooling"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0

REPO="$WORK/repo"
git init -q -b main "$REPO"
cd "$REPO"
git config user.email t@example.invalid
git config user.name t
mkdir -p docs/tasks
task() { printf '# %s：x\n\n## 分支\n`%s`\n\n## 檔案範圍\n### 要做\n- `tooling/*.mjs`\n' "$1" "$2" > "docs/tasks/$1.md"; }
task T-960 task/T-960
task T-961 task/T-961
task T-960-fix1 task/T-960
task Q-962 fix/Q-962
task O-963 main
printf '# O-964：x\n\n## 檔案範圍\n### 要做\n- `a`\n' > docs/tasks/O-964.md
git add docs/tasks && git commit -qm base
MAIN="$(git rev-parse HEAD)"
git update-ref refs/remotes/origin/main "$MAIN"
git switch -q -c task/T-960
echo x > x && git add x && git commit -qm work
T960="$(git rev-parse HEAD)"
git update-ref refs/remotes/origin/task/T-960 "$T960"
git switch -q main

# run_case <name> <want exit> <want output ("" = none)> [env...]
run_case() {
  local name="$1" want="$2" want_out="$3"; shift 3
  : > "$WORK/gh_out"
  local ec
  set +e
  env -i PATH="$PATH" HOME="$HOME" GITHUB_OUTPUT="$WORK/gh_out" TOOLING_DIR="$TOOLING" "$@" bash "$SCRIPT" > "$WORK/out" 2>&1
  ec=$?
  set -e
  local got
  got="$(paste -sd '|' - < "$WORK/gh_out")"
  if [[ "$ec" -ne "$want" || "$got" != "$want_out" ]]; then
    echo "CASE FAIL: ${name}: exit=${ec} (want ${want}) output=[${got}] (want [${want_out}])"; cat "$WORK/out"; FAIL=1
  else
    echo "CASE OK: ${name}: exit=${ec} output=[${got}]"
  fi
}

run_case "(AC-O26-1) (TC-1) existing branch -> its current head" 0 "branch=task/T-960|pre_head=${T960}" TASK=T-960
run_case "(AC-O26-1) (TC-2) branch not pushed yet -> origin/main" 0 "branch=task/T-961|pre_head=${MAIN}" TASK=T-961

# (AC-O26-1) (TC-1): once the workflow checks out pre_head, HEAD must equal it
# and the ancestor check against it must be runnable (history is present).
git switch -q --detach "$T960"
if [[ "$(git rev-parse HEAD)" == "$T960" ]] && git merge-base --is-ancestor "$T960" HEAD; then
  echo "CASE OK: (AC-O26-1) (TC-1) HEAD == pre_head and ancestor check runs"
else
  echo "CASE FAIL: (AC-O26-1) (TC-1) HEAD != pre_head"; FAIL=1
fi
git switch -q main
# (AC-O26-1) (TC-2): first run stays on main whose tip is the pre_head.
if [[ "$(git rev-parse HEAD)" == "$MAIN" ]]; then
  echo "CASE OK: (AC-O26-1) (TC-2) first run stays on main"
else
  echo "CASE FAIL: (AC-O26-1) (TC-2) HEAD is not main"; FAIL=1
fi
# (AC-O26-1): persist-credentials must stay false (RUNBOOK §1.1).
WF="$HERE/../workflows/claude-run-task.yml"
if grep -Eq 'persist-credentials:[[:space:]]*true' "$WF" || ! grep -Eq 'persist-credentials:[[:space:]]*false' "$WF"; then
  echo "CASE FAIL: (AC-O26-1) persist-credentials is not false in claude-run-task.yml"; FAIL=1
else
  echo "CASE OK: (AC-O26-1) persist-credentials stays false"
fi
# (AC-O26-2) (TC-3): SKILL.md continues an existing head and only creates the
# branch from origin/main when it does not exist yet.
SKILL="$HERE/../../.claude/skills/run-task/SKILL.md"
if grep -q '接在既有 head' "$SKILL" \
  && grep -q '分支已存在時不得執行 `git switch -c <分支> origin/main`' "$SKILL" \
  && grep -q '只有分支尚不存在' "$SKILL"; then
  echo "CASE OK: (AC-O26-2) (TC-3) SKILL.md continues the existing head"
else
  echo "CASE FAIL: (AC-O26-2) (TC-3) SKILL.md lacks the existing-branch rule"; FAIL=1
fi
# Mutant: the old unconditional instruction must be caught by the same check.
if printf '%s\n' '例如 `git switch -c task/<編號> origin/main`' | grep -q '分支已存在時不得執行'; then
  echo "CASE FAIL: (AC-O26-6) mutant passed the SKILL check"; FAIL=1
else
  echo "CASE OK: (AC-O26-6) SKILL mutant is caught"
fi
run_case "fix round reuses task/T-960" 0 "branch=task/T-960|pre_head=${T960}" TASK=T-960-fix1
run_case "fix/Q-962 not pushed yet -> origin/main" 0 "branch=fix/Q-962|pre_head=${MAIN}" TASK=Q-962
run_case "task file names main -> exit 1" 1 "" TASK=O-963
run_case "task file without 分支 -> exit 1" 1 "" TASK=O-964
run_case "task file missing -> exit 1" 1 "" TASK=T-999
run_case "invalid TASK -> exit 1" 1 "" TASK='T-960;x'
run_case "GITHUB_OUTPUT unset -> exit 1" 1 "" TASK=T-960 GITHUB_OUTPUT=
git update-ref -d refs/remotes/origin/main
run_case "origin/main missing and branch not pushed -> exit 1" 1 "" TASK=T-961

if [[ "$FAIL" -ne 0 ]]; then echo "run-task-pre-head-test: FAILED"; exit 1; fi
echo "run-task-pre-head-test: all cases matched"
