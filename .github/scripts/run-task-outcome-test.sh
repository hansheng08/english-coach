#!/usr/bin/env bash
# Asserted cases for run-task-outcome.sh (P12 / O-004 B3 / O-005 B-003).
# Run in CI by the pushguard job. Each case asserts the exact printed outcome
# AND the exit code (always 0, so Notify still runs); any mismatch fails.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

# run_case <name> <expected outcome> <args...>
run_case() {
  local name="$1" expected="$2"
  shift 2
  echo "===== CASE: ${name} ====="
  local got ec
  set +e
  got="$(bash "$HERE/run-task-outcome.sh" "$@" 2>/dev/null)"
  ec=$?
  set -e
  echo "outcome=${got} exit=${ec} (expected ${expected}, exit 0)"
  if [[ "$ec" -ne 0 ]]; then
    echo "ERROR: expected exit 0, got ${ec}"
    FAIL=1
  elif [[ "$got" != "$expected" ]]; then
    echo "ERROR: expected ${expected}, got ${got}"
    FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

run_case "all success" success success success success
run_case "verify failure" failure success failure success
run_case "P12: summary failure, verify skipped must be failure" failure success skipped failure
run_case "summary failure, verify success" failure success success failure
run_case "verify skipped even if summary success" failure success skipped success
run_case "verify cancelled with claude success" failure success cancelled success
run_case "summary cancelled with claude success" failure success success cancelled
run_case "claude failure, others skipped" failure failure skipped skipped
run_case "claude failure even if others success" failure failure success success
run_case "claude cancelled" cancelled cancelled skipped skipped
run_case "claude cancelled even if others success" cancelled cancelled success success
run_case "claude skipped normalizes to failure (was passed through before O-005)" failure skipped skipped skipped
run_case "claude skipped with others success is failure" failure skipped success success
run_case "claude empty is failure" failure "" success success
run_case "claude unexpected string is failure" failure neutral success success
run_case "claude Success (wrong case) is failure" failure Success success success
run_case "claude ' success' (whitespace) is failure" failure " success" success success
run_case "claude 'success ' (trailing space) is failure" failure "success " success success
run_case "verify empty with claude success is failure" failure success "" success
run_case "summary unexpected string with claude success is failure" failure success success timed_out
run_case "verify SUCCESS (wrong case) with claude success is failure" failure success SUCCESS success
run_case "only 2 arguments is failure" failure success success
run_case "no arguments is failure" failure
run_case "4 arguments is failure" failure success success success success
run_case "injection-looking input is failure" failure 'success; echo success' success success

if [[ "$FAIL" -ne 0 ]]; then
  echo "run-task-outcome-test: FAILED"
  exit 1
fi
echo "run-task-outcome-test: all cases matched"
exit 0
