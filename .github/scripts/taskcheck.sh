#!/usr/bin/env bash
# O-008 taskcheck: wire tooling/task-lint, scope-check and ac-coverage into ci.yml.
#
# Modes (decided from the event, never guessed):
#   push to main            -> task-lint every docs/tasks/*.md added or
#                              modified in this push (BEFORE_SHA..SHA).
#                              No such file -> pass with an explicit line.
#   push/PR on task/**      -> scope-check (git diff --name-only BASE...HEAD)
#                              then ac-coverage on a Vitest JSON report.
#   anything else           -> exit 1 (the job-level `if` must not route
#                              other refs here; reaching this is a wiring bug).
# Fail-closed: every missing input, git error or tool failure exits non-zero.
# Env: EVENT_NAME REF_NAME HEAD_REF BEFORE_SHA SHA BASE_SHA PR_HEAD_SHA
#      RUNNER_TEMP; optional TOOLING_DIR (tests), VITEST_JSON_CMD (tests).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
OUT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
EVENT_NAME="${EVENT_NAME:-}"
REF_NAME="${REF_NAME:-}"
ZERO_SHA="0000000000000000000000000000000000000000"

die() { echo "taskcheck: ERROR: $*" >&2; exit 1; }

if [[ "$EVENT_NAME" == "push" && "$REF_NAME" == "main" ]]; then
  [[ -n "${BEFORE_SHA:-}" && "${BEFORE_SHA}" != "$ZERO_SHA" ]] || die "push to main without a usable BEFORE_SHA ('${BEFORE_SHA:-}')"
  [[ -n "${SHA:-}" ]] || die "SHA is empty"
  MAIN_LIST="$OUT_DIR/taskcheck-main-tasks.txt"
  git diff --name-only --diff-filter=AM "$BEFORE_SHA" "$SHA" -- 'docs/tasks/*.md' > "$MAIN_LIST" || die "git diff ${BEFORE_SHA} ${SHA} failed"
  mapfile -t files < "$MAIN_LIST"
  if [[ "${#files[@]}" -eq 0 ]]; then
    echo "taskcheck: main push has no added or modified docs/tasks/*.md; nothing to lint"
    exit 0
  fi
  echo "taskcheck: task-lint ${files[*]}"
  node "$TOOLING_DIR/task-lint.mjs" "${files[@]}"
  exit 0
fi

case "$EVENT_NAME" in
  push)
    BRANCH="$REF_NAME"
    BASE="origin/main"
    HEAD="${SHA:-}"
    ;;
  pull_request)
    BRANCH="${HEAD_REF:-}"
    BASE="${BASE_SHA:-}"
    HEAD="${PR_HEAD_SHA:-}"
    ;;
  *) die "unsupported event '${EVENT_NAME}'" ;;
esac
[[ "$BRANCH" =~ ^task/[TQOAP]-[0-9]{3}$ ]] || die "branch '${BRANCH}' is not task/<id>; job-level if should have skipped it"
[[ -n "$BASE" && -n "$HEAD" ]] || die "base ('${BASE}') or head ('${HEAD}') is empty"

CHANGED="$OUT_DIR/taskcheck-changed.txt"
git diff --name-only "${BASE}...${HEAD}" > "$CHANGED" || die "git diff --name-only ${BASE}...${HEAD} failed"
echo "taskcheck: changed files (${BASE}...${HEAD}):"
cat "$CHANGED"
node "$TOOLING_DIR/scope-check.mjs" --branch "$BRANCH" --changed "$CHANGED"

RESULTS="$OUT_DIR/taskcheck-vitest.json"
rm -f "$RESULTS"
if [[ -n "${VITEST_JSON_CMD:-}" ]]; then
  bash -c "$VITEST_JSON_CMD" -- "$RESULTS" || die "Vitest JSON command failed (exit $?)"
else
  pnpm exec vitest run --reporter=json --outputFile="$RESULTS" || die "vitest run failed (exit $?)"
fi
[[ -s "$RESULTS" ]] || die "Vitest JSON report '${RESULTS}' is missing or empty"
node "$TOOLING_DIR/ac-coverage.mjs" --branch "$BRANCH" --results "$RESULTS"
