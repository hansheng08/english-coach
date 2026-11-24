#!/usr/bin/env bash
# Compute the webhook "outcome" for claude-run-task Notify.
# Usage: bash run-task-outcome.sh <claude_outcome> <verify_outcome> <summary_outcome>
# If Claude succeeded, verify_push and run_task_summary must both be success;
# skipped/failure/cancelled on either is reported as failure (P12 / O-004 B3).
set -euo pipefail
claude="${1:-}"
verify="${2:-}"
summary="${3:-}"
if [[ "$claude" == "success" ]]; then
  if [[ "$verify" != "success" || "$summary" != "success" ]]; then
    printf '%s\n' "failure"
    exit 0
  fi
  printf '%s\n' "success"
  exit 0
fi
if [[ -n "$claude" ]]; then
  printf '%s\n' "$claude"
  exit 0
fi
printf '%s\n' "failure"
exit 0
