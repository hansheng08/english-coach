#!/usr/bin/env bash
# Asserted cases for run-task-outcome.sh (P12 / O-004 B3).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

run_case() {
  local name="$1" claude="$2" verify="$3" summary="$4" expected="$5"
  echo "===== CASE: ${name} ====="
  local got
  got="$(bash "$HERE/run-task-outcome.sh" "$claude" "$verify" "$summary")"
  echo "outcome=${got} (expected ${expected})"
  if [[ "$got" != "$expected" ]]; then
    echo "ERROR: expected ${expected}, got ${got}"
    FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

run_case "all success" success success success success
run_case "verify failure" success failure success failure
run_case "P12: summary failure, verify skipped must be failure" success skipped failure failure
run_case "summary failure, verify success" success success failure failure
run_case "verify skipped even if summary success" success skipped success failure
run_case "claude failure, others skipped" failure skipped skipped failure
run_case "claude cancelled" cancelled skipped skipped cancelled

if [[ "$FAIL" -ne 0 ]]; then
  echo "run-task-outcome-test: FAILED"
  exit 1
fi
echo "run-task-outcome-test: all cases matched"
exit 0
