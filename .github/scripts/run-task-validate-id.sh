#!/usr/bin/env bash
# O-032: "Validate task id" step of claude-run-task.yml (step 2, right after
# checkout, so a failure still leaves .github/scripts for the always() steps
# and Notify sends claude-task-finished with outcome=failure).
# Input: environment variable TASK only (never an argument or command text).
# Exit 0, empty stdout: TASK matches the frozen task id definition of O-032
# (one optional lowercase letter suffix; -fix<n> without a leading zero).
# Exit 1: anything else, unset and empty included; one stderr line
# "run-task-validate-id: invalid task id (<sanitized>)". The raw value is
# never printed: characters outside [A-Za-z0-9._/-] become '?' and the copy
# is cut to 40 characters, so a value with a newline plus "::error::" cannot
# turn into a workflow command. Whole-string match, LC_ALL=C.
set -euo pipefail
export LC_ALL=C
TASK_ID_RE='^[TQOAP]-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?$'
if [[ -n "${TASK-}" && "${TASK}" =~ $TASK_ID_RE ]]; then
  exit 0
fi
safe="${TASK-}"
safe="${safe//[!A-Za-z0-9._\/-]/?}"
safe="${safe:0:40}"
printf 'run-task-validate-id: invalid task id (%s)\n' "$safe" >&2
exit 1
