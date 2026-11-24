#!/usr/bin/env bash
# Compute the webhook "outcome" for claude-run-task Notify.
# Usage: bash run-task-outcome.sh <claude_outcome> <verify_outcome> <summary_outcome>
#
# Step outcomes from GitHub are success | failure | cancelled | skipped.
# O-005 / B-003: every input is normalized first; anything else (empty,
# whitespace, different case, unknown string, missing argument) is treated as
# "invalid". The printed result is always exactly one of:
#   success   — claude, verify_push and run_task_summary are all success
#   cancelled — claude was cancelled (run stopped; not a pass)
#   failure   — every other combination, including claude skipped/invalid
# Nothing but three literal "success" inputs can produce "success" (P12 /
# O-004 B3). The script always exits 0 so Notify still sends the webhook;
# argument problems are reported on stderr and yield "failure".
set -euo pipefail

normalize_step_outcome() {
  case "${1-}" in
    success | failure | cancelled | skipped) printf '%s' "$1" ;;
    *) printf '%s' "invalid" ;;
  esac
}

if [[ "$#" -ne 3 ]]; then
  echo "run-task-outcome: expected 3 arguments, got $#; reporting failure" >&2
fi
claude="$(normalize_step_outcome "${1-}")"
verify="$(normalize_step_outcome "${2-}")"
summary="$(normalize_step_outcome "${3-}")"

result="failure"
if [[ "$#" -eq 3 ]]; then
  case "$claude" in
    success)
      if [[ "$verify" == "success" && "$summary" == "success" ]]; then
        result="success"
      fi
      ;;
    cancelled) result="cancelled" ;;
    *) result="failure" ;;
  esac
fi
if [[ "$result" != "success" ]]; then
  echo "run-task-outcome: claude=${claude} verify=${verify} summary=${summary} -> ${result}" >&2
fi
printf '%s\n' "$result"
exit 0
