#!/usr/bin/env bash
# Compute the webhook outcome for claude-run-task Notify.
#
# Usage:
#   bash run-task-outcome.sh <claude> <verify> <summary>
#       -> prints one word (the overall outcome)
#   bash run-task-outcome.sh --json <claude> <verify> <summary> <verify_reason>
#       -> prints one JSON object with the overall outcome AND each
#          normalized step outcome, for the claude-task-finished webhook:
#          {"outcome":…,"claude_outcome":…,"verify_outcome":…,
#           "summary_outcome":…,"verify_reason":…}
#
# Step outcomes from GitHub are success | failure | cancelled | skipped.
# Every input is normalized first; anything else (empty, whitespace, other
# case, unknown string) becomes "invalid" (O-005 / B-003).
#
# Overall outcome (O-007 separates Claude/product failure from Verify):
#   success        claude, verify and summary are all success
#   verify_failed  claude success + summary success + verify failure:
#                  Claude finished; the "Verify push triggered CI" step
#                  failed. See verify_reason: branch_missing means the push
#                  did not reach GitHub; api_auth / api_error /
#                  run_list_error / bad_* mean infrastructure; no_push_run
#                  means the branch is there but no push CI run was found.
#   summary_failed claude success + verify success + summary failure
#                  (resplit detected or the summary comment failed)
#   cancelled      claude was cancelled
#   failure        everything else: claude failure/skipped/invalid, both
#                  verify and summary failed, any skipped/cancelled/invalid
#                  verify or summary after claude success, wrong arg count.
# Only three literal "success" inputs produce "success" (P12 / O-004 B3).
# Never fail-open: verify_failed / summary_failed are not success, and the
# workflow job itself still fails because the failing step fails.
# The script always exits 0 so Notify still sends the webhook; argument
# problems are reported on stderr and yield "failure".
set -euo pipefail

normalize_step_outcome() {
  case "${1-}" in
    success | failure | cancelled | skipped) printf '%s' "$1" ;;
    *) printf '%s' "invalid" ;;
  esac
}

normalize_verify_reason() {
  case "${1-}" in
    ok | bad_input | branch_missing | api_auth | api_error | bad_ref_json | run_list_error | bad_run_json | no_push_run) printf '%s' "$1" ;;
    "") printf '%s' "none" ;;
    *) printf '%s' "invalid" ;;
  esac
}

mode="word"
want=3
if [[ "${1-}" == "--json" ]]; then
  mode="json"
  want=4
  shift
fi

argc_ok=1
if [[ "$#" -ne "$want" ]]; then
  echo "run-task-outcome: expected ${want} arguments after mode=${mode}, got $#; reporting failure" >&2
  argc_ok=0
fi
claude="$(normalize_step_outcome "${1-}")"
verify="$(normalize_step_outcome "${2-}")"
summary="$(normalize_step_outcome "${3-}")"
reason="$(normalize_verify_reason "${4-}")"

result="failure"
if [[ "$argc_ok" -eq 1 ]]; then
  case "$claude" in
    success)
      if [[ "$verify" == "success" && "$summary" == "success" ]]; then
        result="success"
      elif [[ "$verify" == "failure" && "$summary" == "success" ]]; then
        result="verify_failed"
      elif [[ "$verify" == "success" && "$summary" == "failure" ]]; then
        result="summary_failed"
      fi
      ;;
    cancelled) result="cancelled" ;;
    *) result="failure" ;;
  esac
fi
if [[ "$result" != "success" ]]; then
  echo "run-task-outcome: claude=${claude} verify=${verify} summary=${summary} -> ${result}" >&2
fi
if [[ "$mode" == "json" ]]; then
  # Every value is one of the fixed literals above, so no escaping is needed.
  printf '{"outcome":"%s","claude_outcome":"%s","verify_outcome":"%s","summary_outcome":"%s","verify_reason":"%s"}\n' \
    "$result" "$claude" "$verify" "$summary" "$reason"
else
  printf '%s\n' "$result"
fi
exit 0
