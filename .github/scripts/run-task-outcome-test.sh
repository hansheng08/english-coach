#!/usr/bin/env bash
# Asserted cases for run-task-outcome.sh (P12 / O-004 B3 / O-005 B-003 / O-007).
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
run_case "O-007: claude success + verify failure is verify_failed (not failure)" verify_failed success failure success
run_case "P12: summary failure, verify skipped must be failure" failure success skipped failure
run_case "O-007: summary failure, verify success is summary_failed" summary_failed success success failure
run_case "O-007: verify AND summary failure is failure (not verify_failed)" failure success failure failure
run_case "O-007: verify failure + summary skipped is failure" failure success failure skipped
run_case "O-007: verify failure + summary invalid is failure" failure success failure Failure
run_case "O-007: claude failure + verify failure is failure (not verify_failed)" failure failure failure success
run_case "O-007: claude cancelled + verify failure is cancelled" cancelled cancelled failure success
run_case "O-007: verify_failed literal as input is failure" failure success verify_failed success
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

# --json mode (O-007): exact JSON line, valid JSON, exit 0.
# run_json <name> <expected json> <args after --json...>
run_json() {
  local name="$1" expected="$2"
  shift 2
  echo "===== JSON CASE: ${name} ====="
  local got ec
  set +e
  got="$(bash "$HERE/run-task-outcome.sh" --json "$@" 2>/dev/null)"
  ec=$?
  set -e
  echo "json=${got} exit=${ec}"
  if [[ "$ec" -ne 0 ]]; then
    echo "ERROR: expected exit 0, got ${ec}"
    FAIL=1
  elif [[ "$got" != "$expected" ]]; then
    echo "ERROR: expected ${expected}"
    FAIL=1
  elif ! jq -e 'type == "object" and (keys | length) == 5' <<<"$got" >/dev/null; then
    echo "ERROR: not a 5-key JSON object"
    FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

run_json "all success" \
  '{"outcome":"success","claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"ok"}' \
  success success success ok
run_json "run 45323782247 shape: claude success, verify failure (fetch auth)" \
  '{"outcome":"verify_failed","claude_outcome":"success","verify_outcome":"failure","summary_outcome":"success","verify_reason":"none"}' \
  success failure success ""
run_json "verify failure with api_auth reason" \
  '{"outcome":"verify_failed","claude_outcome":"success","verify_outcome":"failure","summary_outcome":"success","verify_reason":"api_auth"}' \
  success failure success api_auth
run_json "verify failure with branch_missing reason" \
  '{"outcome":"verify_failed","claude_outcome":"success","verify_outcome":"failure","summary_outcome":"success","verify_reason":"branch_missing"}' \
  success failure success branch_missing
run_json "claude failure, verify skipped" \
  '{"outcome":"failure","claude_outcome":"failure","verify_outcome":"skipped","summary_outcome":"success","verify_reason":"none"}' \
  failure skipped success ""
run_json "summary failure" \
  '{"outcome":"summary_failed","claude_outcome":"success","verify_outcome":"success","summary_outcome":"failure","verify_reason":"ok"}' \
  success success failure ok
run_json "claude cancelled" \
  '{"outcome":"cancelled","claude_outcome":"cancelled","verify_outcome":"skipped","summary_outcome":"skipped","verify_reason":"none"}' \
  cancelled skipped skipped ""
run_json "invalid inputs are normalized to invalid, outcome failure" \
  '{"outcome":"failure","claude_outcome":"invalid","verify_outcome":"invalid","summary_outcome":"invalid","verify_reason":"invalid"}' \
  " success" SUCCESS 'x"y' 'ok; rm -rf /'
run_json "wrong-case Success in every field normalizes to invalid" \
  '{"outcome":"failure","claude_outcome":"invalid","verify_outcome":"invalid","summary_outcome":"invalid","verify_reason":"invalid"}' \
  Success Success Success OK
run_json "verify success but summary skipped is failure" \
  '{"outcome":"failure","claude_outcome":"success","verify_outcome":"success","summary_outcome":"skipped","verify_reason":"ok"}' \
  success success skipped ok
run_json "3 args in --json mode is failure" \
  '{"outcome":"failure","claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"none"}' \
  success success success
run_json "5 args in --json mode is failure" \
  '{"outcome":"failure","claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"ok"}' \
  success success success ok extra
run_json "no args in --json mode is failure" \
  '{"outcome":"failure","claude_outcome":"invalid","verify_outcome":"invalid","summary_outcome":"invalid","verify_reason":"none"}'

if [[ "$FAIL" -ne 0 ]]; then
  echo "run-task-outcome-test: FAILED"
  exit 1
fi
echo "run-task-outcome-test: all cases matched"
exit 0
