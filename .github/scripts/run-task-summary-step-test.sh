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

if [[ "$FAIL" -ne 0 ]]; then
  echo "run-task-summary-step-test: FAILED"
  exit 1
fi
echo "run-task-summary-step-test: all cases matched"
exit 0
