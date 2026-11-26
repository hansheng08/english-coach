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
  elif ! jq -e 'type == "object" and (keys | length) == 7' <<<"$got" >/dev/null; then
    echo "ERROR: not a 7-key JSON object"
    FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

run_json "all success" \
  '{"outcome":"success","claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"ok","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success success success ok
run_json "run 45323782247 shape: claude success, verify failure (fetch auth)" \
  '{"outcome":"verify_failed","claude_outcome":"success","verify_outcome":"failure","summary_outcome":"success","verify_reason":"none","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success failure success ""
run_json "verify failure with api_auth reason" \
  '{"outcome":"verify_failed","claude_outcome":"success","verify_outcome":"failure","summary_outcome":"success","verify_reason":"api_auth","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success failure success api_auth
run_json "verify failure with branch_missing reason" \
  '{"outcome":"verify_failed","claude_outcome":"success","verify_outcome":"failure","summary_outcome":"success","verify_reason":"branch_missing","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success failure success branch_missing
run_json "claude failure, verify skipped" \
  '{"outcome":"failure","claude_outcome":"failure","verify_outcome":"skipped","summary_outcome":"success","verify_reason":"none","task_lint_outcome":"none","post_check_outcome":"none"}' \
  failure skipped success ""
run_json "summary failure" \
  '{"outcome":"summary_failed","claude_outcome":"success","verify_outcome":"success","summary_outcome":"failure","verify_reason":"ok","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success success failure ok
run_json "claude cancelled" \
  '{"outcome":"cancelled","claude_outcome":"cancelled","verify_outcome":"skipped","summary_outcome":"skipped","verify_reason":"none","task_lint_outcome":"none","post_check_outcome":"none"}' \
  cancelled skipped skipped ""
run_json "invalid inputs are normalized to invalid, outcome failure" \
  '{"outcome":"failure","claude_outcome":"invalid","verify_outcome":"invalid","summary_outcome":"invalid","verify_reason":"invalid","task_lint_outcome":"none","post_check_outcome":"none"}' \
  " success" SUCCESS 'x"y' 'ok; rm -rf /'
run_json "wrong-case Success in every field normalizes to invalid" \
  '{"outcome":"failure","claude_outcome":"invalid","verify_outcome":"invalid","summary_outcome":"invalid","verify_reason":"invalid","task_lint_outcome":"none","post_check_outcome":"none"}' \
  Success Success Success OK
run_json "verify success but summary skipped is failure" \
  '{"outcome":"failure","claude_outcome":"success","verify_outcome":"success","summary_outcome":"skipped","verify_reason":"ok","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success success skipped ok
run_json "3 args in --json mode is failure" \
  '{"outcome":"failure","claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"none","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success success success
run_json "5 args in --json mode is failure" \
  '{"outcome":"failure","claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"ok","task_lint_outcome":"none","post_check_outcome":"none"}' \
  success success success ok extra
run_json "no args in --json mode is failure" \
  '{"outcome":"failure","claude_outcome":"invalid","verify_outcome":"invalid","summary_outcome":"invalid","verify_reason":"none","task_lint_outcome":"none","post_check_outcome":"none"}'

# O-008: --task-lint gate (checked before Claude/Verify/summary).
# run_lint <name> <expected outcome> <args...>  (args include --task-lint)
run_lint() {
  local name="$1" expected="$2"
  shift 2
  echo "===== LINT CASE: ${name} ====="
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
run_lint "O-008: lint failure, Claude skipped is task_lint_failed" task_lint_failed --task-lint failure skipped skipped success
run_lint "O-008: lint failure wins even if later steps say success" task_lint_failed --task-lint failure success success success
run_lint "O-008: lint success + all success is success" success --task-lint success success success success
run_lint "O-008: lint success + verify failure is still verify_failed" verify_failed --task-lint success success failure success
run_lint "O-008: lint success + claude failure is failure" failure --task-lint success failure skipped success
run_lint "O-008: lint skipped is failure (not success)" failure --task-lint skipped success success success
run_lint "O-008: lint empty is failure" failure --task-lint "" success success success
run_lint "O-008: lint wrong case is failure" failure --task-lint Success success success success
run_lint "O-008: lint cancelled is cancelled" cancelled --task-lint cancelled skipped skipped success
run_lint "O-008: --task-lint without value is failure" failure --task-lint
run_lint "O-008: lint failure in --json mode" \
  '{"outcome":"task_lint_failed","claude_outcome":"skipped","verify_outcome":"skipped","summary_outcome":"success","verify_reason":"none","task_lint_outcome":"failure","post_check_outcome":"none"}' \
  --task-lint failure --json skipped skipped success ""
run_lint "O-008: lint success in --json mode, all success" \
  '{"outcome":"success","claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"ok","task_lint_outcome":"success","post_check_outcome":"none"}' \
  --task-lint success --json success success success ok
run_lint "O-008: lint failure with wrong arg count is still failure" failure --task-lint failure success success

# O-009: --post-check (report-lint + automatic verification summary after Claude).
J='"claude_outcome":"success","verify_outcome":"success","summary_outcome":"success","verify_reason":"ok","task_lint_outcome":"success"'
run_lint "O-009: post-check success keeps success" success --task-lint success --post-check success success success success
run_lint "O-009: post-check failure after a good run is post_check_failed" post_check_failed --task-lint success --post-check failure success success success
run_lint "O-009: post-check skipped after a good run is failure" failure --task-lint success --post-check skipped success success success
run_lint "O-009: post-check empty after a good run is failure" failure --task-lint success --post-check "" success success success
run_lint "O-009: post-check wrong case is failure" failure --task-lint success --post-check Failure success success success
run_lint "O-009: post-check cancelled is cancelled" cancelled --task-lint success --post-check cancelled success success success
run_lint "O-009: claude failure stays failure (post-check skipped by design)" failure --task-lint success --post-check skipped failure skipped success
run_lint "O-009: verify failure stays verify_failed" verify_failed --task-lint success --post-check failure success failure success
run_lint "O-009: summary failure stays summary_failed" summary_failed --task-lint success --post-check success success success failure
run_lint "O-009: task-lint failure wins over post-check" task_lint_failed --task-lint failure --post-check skipped skipped skipped success
run_lint "O-009: options in either order" post_check_failed --post-check failure --task-lint success success success success
run_lint "O-009: --post-check given twice is invalid -> failure" failure --post-check success --post-check success success success success
run_lint "O-009: --post-check without value is failure" failure --post-check
run_lint "O-009: post-check failure in --json mode" \
  "{\"outcome\":\"post_check_failed\",${J},\"post_check_outcome\":\"failure\"}" \
  --task-lint success --post-check failure --json success success success ok
run_lint "O-009: all success in --json mode" \
  "{\"outcome\":\"success\",${J},\"post_check_outcome\":\"success\"}" \
  --task-lint success --post-check success --json success success success ok

# O-014: --usage-limit (Claude result is_error + api_error=usage_limit_reached + 429).
UL='--task-lint success --post-check skipped'
run_lint "O-014: claude failure + usage limit is usage_limit" usage_limit $UL --usage-limit true failure skipped success
run_lint "O-014: generic claude failure stays failure" failure $UL --usage-limit false failure skipped success
run_lint "O-014: --usage-limit invalid value is failure" failure $UL --usage-limit yes failure skipped success
run_lint "O-014: --usage-limit empty is failure" failure $UL --usage-limit "" failure skipped success
run_lint "O-014: --usage-limit True (wrong case) is failure" failure $UL --usage-limit True failure skipped success
run_lint "O-014: --usage-limit given twice is invalid -> failure" failure $UL --usage-limit true --usage-limit true failure skipped success
run_lint "O-014: --usage-limit without value is failure" failure --usage-limit
run_lint "O-014: task lint failure wins over usage limit" task_lint_failed --task-lint failure --usage-limit true skipped skipped success
run_lint "O-014: usage limit ignored when claude success" success --task-lint success --post-check success --usage-limit true success success success
run_lint "O-014: usage limit ignored when claude cancelled" cancelled $UL --usage-limit true cancelled skipped success
run_lint "O-014: usage limit ignored when claude skipped" failure $UL --usage-limit true skipped skipped success
run_lint "O-014: usage limit not given keeps failure" failure $UL failure skipped success
run_lint "O-014: options in any order" usage_limit --usage-limit true --post-check skipped --task-lint success failure skipped success
run_lint "O-014: usage_limit in --json mode" \
  '{"outcome":"usage_limit","claude_outcome":"failure","verify_outcome":"skipped","summary_outcome":"success","verify_reason":"none","task_lint_outcome":"success","post_check_outcome":"skipped"}' \
  $UL --usage-limit true --json failure skipped success ""

# O-026: post-check failure must not be overwritten by a summary failure (e.g. comment 422).
run_lint "(AC-O26-4) (TC-6) post-check failure + summary failure is post_check_failed" post_check_failed --task-lint success --post-check failure success success failure
run_lint "(AC-O26-4) (TC-6) same, options in the other order" post_check_failed --post-check failure --task-lint success success success failure
run_lint "(AC-O26-4) (TC-6) post-check failure + summary failure in --json mode" \
  "{\"outcome\":\"post_check_failed\",\"claude_outcome\":\"success\",\"verify_outcome\":\"success\",\"summary_outcome\":\"failure\",\"verify_reason\":\"ok\",\"task_lint_outcome\":\"success\",\"post_check_outcome\":\"failure\"}" \
  --task-lint success --post-check failure --json success success failure ok
run_lint "(AC-O26-4) existing priority kept: verify failure + post-check failure is verify_failed" verify_failed --task-lint success --post-check failure success failure success
run_lint "(AC-O26-4) existing priority kept: claude failure + post-check failure + summary failure is failure" failure --task-lint success --post-check failure failure skipped failure
run_lint "(AC-O26-4) summary failure alone (post-check success) is still summary_failed" summary_failed --task-lint success --post-check success success success failure

# O-026 mutation (AC-O26-6): a script that reports summary_failed when post-check
# failed must make the TC-6 case fail. Simulate by forcing the summary branch first.
MUT26="$(mktemp)"
sed 's/post_check_failed/summary_failed/g' "$HERE/run-task-outcome.sh" > "$MUT26"
if cmp -s "$MUT26" "$HERE/run-task-outcome.sh"; then echo "ERROR: O-026 mutation did not change the script"; FAIL=1; fi
MUT26_GOT="$(bash "$MUT26" --task-lint success --post-check failure success success failure 2>/dev/null)"
rm -f "$MUT26"
if [[ "$MUT26_GOT" == "post_check_failed" ]]; then
  echo "ERROR: (AC-O26-6) mutant reporting summary_failed still printed post_check_failed"; FAIL=1
else
  echo "MUTANT KILLED: (AC-O26-6) post-check failure reported as ${MUT26_GOT}"
fi

# O-014 mutation: removing the usage_limit branch must break the first case.
MUT="$(mktemp)"
grep -v 'result="usage_limit"' "$HERE/run-task-outcome.sh" > "$MUT"
if cmp -s "$MUT" "$HERE/run-task-outcome.sh"; then echo "ERROR: mutation did not change the script"; FAIL=1; fi
MUT_GOT="$(bash "$MUT" $UL --usage-limit true failure skipped success 2>/dev/null)"
rm -f "$MUT"
if [[ "$MUT_GOT" == "usage_limit" ]]; then
  echo "ERROR: mutant without the usage_limit branch still printed usage_limit"; FAIL=1
else
  echo "MUTANT KILLED: without the usage_limit branch -> ${MUT_GOT}"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "run-task-outcome-test: FAILED"
  exit 1
fi
echo "run-task-outcome-test: all cases matched"
exit 0
