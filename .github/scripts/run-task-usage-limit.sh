#!/usr/bin/env bash
# O-014: Claude usage limit (HTTP 429 usage_limit_reached) for claude-run-task.yml.
#
#   bash run-task-usage-limit.sh detect
#     Step "Detect Claude usage limit" (after the execution output upload).
#     1. tooling/usage-limit.mjs detect on the Claude execution file ($LOG);
#        no execution file (Claude never started) -> not a usage limit.
#     2. Only when it IS a usage limit: the previous result of the same task =
#        newest artifact "run-task-outcome-<task>" of another run, read with
#        gh api repos/<repo>/actions/artifacts?name=…; none -> --no-previous;
#        API error / more results than one page / expired / bad zip ->
#        --previous-error (tooling then answers unknown + stop).
#        Runs of one task are serialized by the workflow concurrency group.
#     3. tooling/usage-limit.mjs streak -> usage_limit_streak / _action.
#     Writes usage_limit, usage_limit_reset_at, usage_limit_type,
#     usage_limit_streak, usage_limit_action to GITHUB_OUTPUT.
#     Fail-closed: a detect error (unreadable or invalid JSON execution file)
#     or bad tooling output exits 1 and writes no usage_limit=true, so Notify
#     never reports usage_limit from a guess (run-task-outcome.sh treats the
#     missing value as "not true").
#
#   bash run-task-usage-limit.sh fields <outcome>
#     Notify: prints the four usage_limit_* webhook fields as one JSON object.
#     outcome=usage_limit -> values from the env UL_RESET_AT / UL_TYPE /
#     UL_STREAK / UL_ACTION (missing or malformed -> unknown, and the action
#     becomes stop); any other outcome -> none / none / 0 / none.
#
# Env: TASK; detect also LOG GITHUB_OUTPUT RUNNER_TEMP GH_TOKEN
#      GITHUB_REPOSITORY RUN_ID; optional TOOLING_DIR (tests).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
die() { echo "run-task-usage-limit: ERROR: $*" >&2; exit 1; }

fields() {
  local outcome="${1-}"
  if [[ "$outcome" != "usage_limit" ]]; then
    jq -cn '{usage_limit_reset_at: "none", usage_limit_type: "none", usage_limit_streak: 0, usage_limit_action: "none"}'
    return 0
  fi
  local reset="${UL_RESET_AT-}" type="${UL_TYPE-}" streak="${UL_STREAK-}" action="${UL_ACTION-}"
  [[ "$reset" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || reset="unknown"
  [[ "$type" =~ ^[a-z_]{1,32}$ ]] || type="unknown"
  if [[ "$streak" =~ ^[1-9][0-9]{0,5}$ && ( "$action" == "reschedule" || "$action" == "stop" ) ]]; then
    if [[ "$streak" -ge 2 ]]; then action="stop"; fi
    jq -cn --arg r "$reset" --arg t "$type" --argjson s "$streak" --arg a "$action" \
      '{usage_limit_reset_at: $r, usage_limit_type: $t, usage_limit_streak: $s, usage_limit_action: $a}'
  else
    jq -cn --arg r "$reset" --arg t "$type" \
      '{usage_limit_reset_at: $r, usage_limit_type: $t, usage_limit_streak: "unknown", usage_limit_action: "stop"}'
  fi
}

previous_arg() {
  # Prints one usage-limit.mjs streak option for the previous result.
  local list="$WORK/artifacts.json" pick id expired zip="$WORK/previous.zip" prev="$WORK/previous.json"
  if ! gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts?name=run-task-outcome-${TASK}&per_page=100" > "$list" 2> "$WORK/gh.err"; then
    echo "run-task-usage-limit: artifact list failed: $(head -c 300 "$WORK/gh.err")" >&2
    echo "--previous-error"; return 0
  fi
  if ! pick="$(jq -r --argjson run "$RUN_ID" '
      if (.total_count | type) != "number" or (.artifacts | type) != "array" then error("bad list")
      elif .total_count > (.artifacts | length) then error("more than one page")
      else [.artifacts[] | select(.workflow_run.id != $run)]
           | if length == 0 then "none" else (max_by(.created_at) | "\(.id) \(.expired)") end
      end' "$list" 2> "$WORK/jq.err")"; then
    echo "run-task-usage-limit: artifact list unusable: $(head -c 300 "$WORK/jq.err")" >&2
    echo "--previous-error"; return 0
  fi
  if [[ "$pick" == "none" ]]; then echo "--no-previous"; return 0; fi
  read -r id expired <<< "$pick"
  if [[ ! "$id" =~ ^[0-9]+$ || "$expired" != "false" ]]; then
    echo "run-task-usage-limit: previous artifact '${pick}' is expired or malformed" >&2
    echo "--previous-error"; return 0
  fi
  if ! gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts/${id}/zip" > "$zip" 2> "$WORK/gh.err" \
     || ! unzip -p "$zip" run-task-outcome.json > "$prev" 2> "$WORK/unzip.err" || [[ ! -s "$prev" ]]; then
    echo "run-task-usage-limit: cannot read previous artifact ${id}" >&2
    echo "--previous-error"; return 0
  fi
  echo "run-task-usage-limit: previous result from artifact ${id}: $(head -c 400 "$prev")" >&2
  printf '%s\n' "--previous-file" "$prev"
}

detect() {
  [[ "${TASK:-}" =~ ^[TQOAP]-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?$ ]] || die "invalid TASK '${TASK:-}'"
  [[ -n "${GITHUB_OUTPUT:-}" ]] || die "GITHUB_OUTPUT is not set"
  WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/usage-limit.XXXXXX")"
  local det ul reset type streak_json streak action
  if [[ -n "${LOG:-}" && -f "$LOG" ]]; then
    det="$(node "$TOOLING_DIR/usage-limit.mjs" detect --execution-file "$LOG")" || die "usage-limit detect failed on ${LOG}"
  else
    echo "run-task-usage-limit: no execution file; not a usage limit"
    det='{"usage_limit":false,"resets_at":null,"limit_type":null}'
  fi
  ul="$(jq -r '.usage_limit | if type == "boolean" then tostring else error("usage_limit is not boolean") end' <<< "$det")" || die "bad detect output: ${det}"
  reset="$(jq -r '.resets_at // "unknown"' <<< "$det")"
  type="$(jq -r '.limit_type // "unknown"' <<< "$det")"
  if [[ "$ul" == "true" ]]; then
    [[ -n "${GITHUB_REPOSITORY:-}" && "${RUN_ID:-}" =~ ^[0-9]+$ ]] || die "GITHUB_REPOSITORY / RUN_ID missing"
    local -a prev_opt
    mapfile -t prev_opt < <(previous_arg)
    [[ "${#prev_opt[@]}" -ge 1 ]] || die "previous lookup printed nothing"
    streak_json="$(node "$TOOLING_DIR/usage-limit.mjs" streak --current true "${prev_opt[@]}")" || die "usage-limit streak failed"
  else
    streak_json="$(node "$TOOLING_DIR/usage-limit.mjs" streak --current false --no-previous)" || die "usage-limit streak failed"
  fi
  streak="$(jq -r '.usage_limit_streak' <<< "$streak_json")"
  action="$(jq -r '.usage_limit_action' <<< "$streak_json")"
  [[ "$streak" =~ ^([0-9]+|unknown)$ && "$action" =~ ^(none|reschedule|stop)$ ]] || die "bad streak output: ${streak_json}"
  echo "run-task-usage-limit: usage_limit=${ul} reset_at=${reset} type=${type} streak=${streak} action=${action}"
  {
    echo "usage_limit=${ul}"
    echo "usage_limit_reset_at=${reset}"
    echo "usage_limit_type=${type}"
    echo "usage_limit_streak=${streak}"
    echo "usage_limit_action=${action}"
  } >> "$GITHUB_OUTPUT"
}

case "${1-}" in
  detect) detect ;;
  fields) fields "${2-}" ;;
  *) die "usage: run-task-usage-limit.sh detect | fields <outcome>" ;;
esac
