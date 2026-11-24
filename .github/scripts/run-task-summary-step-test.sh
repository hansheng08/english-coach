#!/usr/bin/env bash
# Asserted tests for run-task-summary-step.sh: missing execution file and
# posting paths are fail-closed. 403 fallback is unit-tested in
# post-run-task-comment.test.mjs; this script checks the step wrapper.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(mktemp -d)"
PATH_DIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR" "$PATH_DIR"' EXIT
FAIL=0

# Fake git/gh so the posting path cannot hit the network if a test gets that far.
cat > "$PATH_DIR/git" << 'FAKE'
#!/usr/bin/env bash
cmd="${1:-}"
case "$cmd" in
  branch) echo "task/O-004"; exit 0 ;;
  rev-parse) echo "abc123def"; exit 0 ;;
  *) echo "unexpected git $*" >&2; exit 90 ;;
esac
FAKE
cat > "$PATH_DIR/gh" << 'FAKE'
#!/usr/bin/env bash
echo "HTTP 403: Resource not accessible by integration" >&2
exit 1
FAKE
chmod +x "$PATH_DIR/git" "$PATH_DIR/gh"

run_case() {
  local name="$1" expected="$2"
  shift 2
  echo "===== CASE: ${name} ====="
  set +e
  "$@" >"$WORKDIR/out.txt" 2>"$WORKDIR/err.txt"
  local ec=$?
  set -e
  echo "exit=${ec} (expected ${expected})"
  if [[ "$ec" -ne "$expected" ]]; then
    echo "ERROR: expected exit ${expected}, got ${ec}"
    echo "----- stdout -----"
    cat "$WORKDIR/out.txt"
    echo "----- stderr -----"
    cat "$WORKDIR/err.txt"
    FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

export PATH="$PATH_DIR:$PATH"
export GITHUB_REPOSITORY="hansheng08/english-coach"
export TASK="O-004"
export RUN_URL="https://example.test/run"
export RUNNER_TEMP="$WORKDIR"

run_case "claude=success and missing execution_file must fail" 1 \
  env CLAUDE_OUTCOME=success LOG="" bash "$HERE/run-task-summary-step.sh"

run_case "claude=success and unreadable path must fail" 1 \
  env CLAUDE_OUTCOME=success LOG="$WORKDIR/no-such-execution.json" bash "$HERE/run-task-summary-step.sh"

run_case "claude=failure and missing execution_file is skipped (exit 0)" 0 \
  env CLAUDE_OUTCOME=failure LOG="" bash "$HERE/run-task-summary-step.sh"

# Confirm the success/missing error text is present for the first failure case
# (re-run to capture; already asserted exit code above).
set +e
CLAUDE_OUTCOME=success LOG="" bash "$HERE/run-task-summary-step.sh" >"$WORKDIR/miss.txt" 2>&1
set -e
if ! grep -q "execution_file is missing" "$WORKDIR/miss.txt"; then
  echo "ERROR: missing-file error text not found"
  cat "$WORKDIR/miss.txt"
  FAIL=1
else
  echo "CASE OK (missing-file error text present)"
fi

# O-009: the posted comment carries the automatic verification summary.
OKBIN="$(mktemp -d)"
cp "$PATH_DIR/git" "$OKBIN/git"
cat > "$OKBIN/gh" << 'FAKE'
#!/usr/bin/env bash
if [[ "${1:-} ${2:-}" == "pr list" ]]; then exit 0; fi
if [[ "${1:-}" == "api" ]]; then cat > "${CAPTURE:?}"; echo '{}'; exit 0; fi
echo "unexpected gh $*" >&2; exit 90
FAKE
chmod +x "$OKBIN/gh"
EXEC="$WORKDIR/exec.json"
echo '[{"type":"result","subtype":"success","permission_denials":[]}]' > "$EXEC"
printf '## 自動驗證摘要（O-004 @ abc123d）\n結果：通過\n' > "$WORKDIR/verify-summary.md"
run_case "O-009: verify summary is appended to the posted comment" 0 \
  env PATH="$OKBIN:$PATH" CAPTURE="$WORKDIR/posted.json" CLAUDE_OUTCOME=success LOG="$EXEC" bash "$HERE/run-task-summary-step.sh"
if jq -e '.body | contains("## 自動驗證摘要（O-004 @ abc123d）")' "$WORKDIR/posted.json" > /dev/null; then
  echo "CASE OK (verify summary in posted body)"
else
  echo "ERROR: verify summary not in posted body"; cat "$WORKDIR/posted.json"; FAIL=1
fi
rm -f "$WORKDIR/verify-summary.md"
run_case "O-009: missing verify summary still posts, with the not-produced note" 0 \
  env PATH="$OKBIN:$PATH" CAPTURE="$WORKDIR/posted2.json" CLAUDE_OUTCOME=success LOG="$EXEC" bash "$HERE/run-task-summary-step.sh"
if jq -e '.body | contains("自動驗證摘要未產生")' "$WORKDIR/posted2.json" > /dev/null; then
  echo "CASE OK (not-produced note in posted body)"
else
  echo "ERROR: not-produced note missing"; cat "$WORKDIR/posted2.json"; FAIL=1
fi
rm -rf "$OKBIN"

if [[ "$FAIL" -ne 0 ]]; then
  echo "run-task-summary-step-test: FAILED"
  exit 1
fi
echo "run-task-summary-step-test: all cases matched"
exit 0
