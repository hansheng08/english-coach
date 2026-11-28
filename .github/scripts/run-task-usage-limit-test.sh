#!/usr/bin/env bash
# Asserted cases for run-task-usage-limit.sh (O-014). Uses the REAL
# tooling/usage-limit.mjs; `gh` is a fake on PATH driven by FAKE_GH_* files,
# so zero network. Each case asserts the exit code and the exact
# GITHUB_OUTPUT / JSON. Two mutants of the script must be killed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/run-task-usage-limit.sh"
ROOT="$(cd "$HERE/../.." && pwd)"
TOOLING="$ROOT/tooling"
FIX="$TOOLING/fixtures/o014"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'GH'
#!/usr/bin/env bash
# fake gh: "gh api <path>"; list -> $FAKE_GH_DIR/list.json (or exit 1 when
# list.fail exists); zip -> $FAKE_GH_DIR/<id>.zip (exit 1 when missing).
echo "$*" >> "$FAKE_GH_DIR/calls"
[[ "${1-}" == "api" ]] || exit 2
case "${2-}" in
  *"/actions/artifacts?name="*)
    [[ -f "$FAKE_GH_DIR/list.fail" ]] && { echo "HTTP 502" >&2; exit 1; }
    cat "$FAKE_GH_DIR/list.json" ;;
  */actions/artifacts/*/zip)
    id="${2%/zip}"; id="${id##*/}"
    [[ -f "$FAKE_GH_DIR/${id}.zip" ]] || { echo "HTTP 404" >&2; exit 1; }
    cat "$FAKE_GH_DIR/${id}.zip" ;;
  *) exit 3 ;;
esac
GH
chmod +x "$WORK/bin/gh"

mkzip() { # mkzip <id> <member name> <json content>
  python3 -c 'import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z: z.writestr(sys.argv[2], sys.argv[3])' "$FAKE_GH_DIR/$1.zip" "$2" "$3"
}
art() { # art <id> <run id> <created_at> [expired]
  printf '{"id":%s,"expired":%s,"created_at":"%s","workflow_run":{"id":%s}}' "$1" "${4:-false}" "$3" "$2"
}
setlist() { # setlist <total_count> <artifact json>...
  local total="$1"; shift
  local IFS=,
  printf '{"total_count":%s,"artifacts":[%s]}' "$total" "$*" > "$FAKE_GH_DIR/list.json"
}
reset_gh() { rm -rf "$WORK/gh"; mkdir -p "$WORK/gh"; export FAKE_GH_DIR="$WORK/gh"; setlist 0; }
python3 - "$FIX/t023-usage-limit.json" "$WORK/noreset.json" <<'PY'
import json, sys
ev = [e for e in json.load(open(sys.argv[1])) if e.get("type") != "rate_limit_event"]
json.dump(ev, open(sys.argv[2], "w"))
PY
printf '{' > "$WORK/bad.json"
RUN=45575716220

# run_detect <name> <want exit> <want output lines or ""> [env...]
run_detect() {
  local name="$1" want="$2" want_out="$3"; shift 3
  rm -f "$WORK/out" "$WORK/log"; touch "$WORK/out"
  local ec
  set +e
  env -i PATH="$WORK/bin:$PATH" HOME="$HOME" FAKE_GH_DIR="$FAKE_GH_DIR" RUNNER_TEMP="$WORK" TOOLING_DIR="$TOOLING" \
    TASK=T-023 GITHUB_OUTPUT="$WORK/out" GITHUB_REPOSITORY=hansheng08/english-coach RUN_ID="$RUN" GH_TOKEN=fake \
    LOG="$FIX/t023-usage-limit.json" "$@" bash "${SUT:-$SCRIPT}" detect > "$WORK/log" 2>&1
  ec=$?
  set -e
  local got; got="$(paste -sd ' ' "$WORK/out")"
  if [[ "$ec" -ne "$want" || "$got" != "$want_out" ]]; then
    echo "CASE FAIL: ${name}: exit=${ec} (want ${want})"; echo "  got:  ${got}"; echo "  want: ${want_out}"; cat "$WORK/log"; FAIL=1
  else
    echo "CASE OK: ${name}: exit=${ec} ${got}"
  fi
}
R="usage_limit_reset_at=2026-11-25T05:20:00Z usage_limit_type=five_hour"
NOT="usage_limit=false usage_limit_reset_at=unknown usage_limit_type=unknown usage_limit_streak=0 usage_limit_action=none"

reset_gh; touch "$FAKE_GH_DIR/list.fail"
run_detect "no execution file (Claude never started) -> not a usage limit, gh not called" 0 "$NOT" LOG=
[[ ! -f "$FAKE_GH_DIR/calls" ]] || { echo "CASE FAIL: gh called without a usage limit"; FAIL=1; }
run_detect "generic API error (overloaded) -> not a usage limit, gh not called" 0 "$NOT" LOG="$FIX/overloaded-error.json"
[[ ! -f "$FAKE_GH_DIR/calls" ]] || { echo "CASE FAIL: gh called without a usage limit"; FAIL=1; }
run_detect "invalid JSON execution file -> exit 1, nothing written" 1 "" LOG="$WORK/bad.json"
run_detect "invalid TASK -> exit 1" 1 "" TASK='T-023;x'
# O-032 (AC-O32-5) (TC-12): letter-suffix ids pass; bad shapes keep the same message.
reset_gh; touch "$FAKE_GH_DIR/list.fail"
run_detect "(AC-O32-5) (TC-12) T-025a without execution file -> not a usage limit" 0 "$NOT" TASK=T-025a LOG=
run_detect "(AC-O32-5) (TC-12) T-025a-fix1 without execution file -> not a usage limit" 0 "$NOT" TASK=T-025a-fix1 LOG=
for bad_id in T-025A T-025ab T-25a T-025-a X-025 T-025a-fix0 T-025a-fix01 $'T-025a\n'; do
  run_detect "(AC-O32-5) (TC-12) invalid TASK $(printf '%q' "$bad_id") -> exit 1" 1 "" TASK="$bad_id"
  grep -q "^run-task-usage-limit: ERROR: invalid TASK '" "$WORK/log" || { echo "CASE FAIL: (AC-O32-5) (TC-12) error message changed for $(printf '%q' "$bad_id")"; cat "$WORK/log"; FAIL=1; }
done
reset_gh
run_detect "(AC-O32-5) (TC-12) T-025a usage limit -> streak 1, artifact looked up by the suffix id" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule" TASK=T-025a
grep -q 'actions/artifacts?name=run-task-outcome-T-025a&per_page=100' "$FAKE_GH_DIR/calls" || { echo "CASE FAIL: (AC-O32-5) (TC-12) list query not by T-025a"; FAIL=1; }
run_detect "no GITHUB_REPOSITORY on a usage limit -> exit 1" 1 "" GITHUB_REPOSITORY=
reset_gh
run_detect "1st usage limit, no previous artifact -> streak 1 reschedule" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule"
grep -q 'actions/artifacts?name=run-task-outcome-T-023&per_page=100' "$FAKE_GH_DIR/calls" || { echo "CASE FAIL: list query not by name"; FAIL=1; }
run_detect "usage limit without rate_limit_event -> reset unknown, still usage limit" 0 "usage_limit=true usage_limit_reset_at=unknown usage_limit_type=unknown usage_limit_streak=1 usage_limit_action=reschedule" LOG="$WORK/noreset.json"
reset_gh; setlist 1 "$(art 11 100 2026-11-25T04:22:40Z)"; mkzip 11 run-task-outcome.json '{"outcome":"usage_limit","usage_limit_streak":1}'
run_detect "2nd in a row (previous usage_limit streak 1) -> streak 2 stop" 0 "usage_limit=true $R usage_limit_streak=2 usage_limit_action=stop"
reset_gh; setlist 1 "$(art 11 100 2026-11-25T04:22:40Z)"; mkzip 11 run-task-outcome.json '{"outcome":"failure","usage_limit_streak":0}'
run_detect "previous was a generic failure -> streak 1 reschedule" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule"
reset_gh; setlist 2 "$(art 11 100 2026-11-25T04:22:40Z)" "$(art 12 101 2026-11-25T05:40:00Z)"
mkzip 11 run-task-outcome.json '{"outcome":"usage_limit","usage_limit_streak":1}'; mkzip 12 run-task-outcome.json '{"outcome":"failure","usage_limit_streak":0}'
run_detect "newest previous wins (failure after usage_limit) -> streak 1" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule"
setlist 2 "$(art 12 101 2026-11-25T05:40:00Z)" "$(art 11 100 2026-11-25T04:22:40Z)"
run_detect "same, list order reversed -> streak 1" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule"
reset_gh; setlist 1 "$(art 13 "$RUN" 2026-11-25T08:00:00Z)"; mkzip 13 run-task-outcome.json '{"outcome":"usage_limit","usage_limit_streak":1}'
run_detect "only this run's own artifact (re-run attempt) -> no previous -> streak 1" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule"
U="usage_limit=true $R usage_limit_streak=unknown usage_limit_action=stop"
reset_gh; touch "$FAKE_GH_DIR/list.fail"
run_detect "artifact list API fails -> unknown stop" 0 "$U"
reset_gh; setlist 1 "$(art 11 100 2026-11-25T04:22:40Z true)"
run_detect "previous artifact expired -> unknown stop" 0 "$U"
reset_gh; setlist 101 "$(art 11 100 2026-11-25T04:22:40Z)"
run_detect "more results than one page -> unknown stop" 0 "$U"
reset_gh; printf 'not json' > "$FAKE_GH_DIR/list.json"
run_detect "artifact list not JSON -> unknown stop" 0 "$U"
reset_gh; setlist 1 "$(art 11 100 2026-11-25T04:22:40Z)"
run_detect "zip download fails -> unknown stop" 0 "$U"
mkzip 11 other.json '{"outcome":"usage_limit","usage_limit_streak":1}'
run_detect "zip without run-task-outcome.json -> unknown stop" 0 "$U"
mkzip 11 run-task-outcome.json 'nope'
run_detect "previous file not JSON -> unknown stop" 0 "$U"

# fields <outcome>
run_fields() { # run_fields <name> <want json> <outcome> [env...]
  local name="$1" want="$2" outcome="$3"; shift 3
  local got ec
  set +e
  got="$(env -i PATH="$PATH" "$@" bash "$SCRIPT" fields "$outcome" 2>&1)"
  ec=$?
  set -e
  if [[ "$ec" -ne 0 || "$got" != "$want" ]]; then
    echo "CASE FAIL: ${name}: exit=${ec}"; echo "  got:  ${got}"; echo "  want: ${want}"; FAIL=1
  else
    echo "CASE OK: ${name}: ${got}"
  fi
}
run_fields "fields: usage_limit, 1st" '{"usage_limit_reset_at":"2026-11-25T05:20:00Z","usage_limit_type":"five_hour","usage_limit_streak":1,"usage_limit_action":"reschedule"}' usage_limit \
  UL_RESET_AT=2026-11-25T05:20:00Z UL_TYPE=five_hour UL_STREAK=1 UL_ACTION=reschedule
run_fields "fields: streak 2 forces stop even if action says reschedule" '{"usage_limit_reset_at":"unknown","usage_limit_type":"five_hour","usage_limit_streak":2,"usage_limit_action":"stop"}' usage_limit \
  UL_RESET_AT=unknown UL_TYPE=five_hour UL_STREAK=2 UL_ACTION=reschedule
run_fields "fields: usage_limit, detect outputs missing -> unknown stop" '{"usage_limit_reset_at":"unknown","usage_limit_type":"unknown","usage_limit_streak":"unknown","usage_limit_action":"stop"}' usage_limit
run_fields "fields: usage_limit, bad values -> unknown stop" '{"usage_limit_reset_at":"unknown","usage_limit_type":"unknown","usage_limit_streak":"unknown","usage_limit_action":"stop"}' usage_limit \
  UL_RESET_AT='5:20am' UL_TYPE='Five Hour' UL_STREAK=0 UL_ACTION=none
run_fields "fields: generic failure -> none" '{"usage_limit_reset_at":"none","usage_limit_type":"none","usage_limit_streak":0,"usage_limit_action":"none"}' failure \
  UL_RESET_AT=2026-11-25T05:20:00Z UL_TYPE=five_hour UL_STREAK=1 UL_ACTION=reschedule
run_fields "fields: success -> none" '{"usage_limit_reset_at":"none","usage_limit_type":"none","usage_limit_streak":0,"usage_limit_action":"none"}' success

# Mutants: each must change at least one asserted case.
mutant() { # mutant <name> <sed expr> <case function...>
  local name="$1" expr="$2"; shift 2
  local m="$WORK/mutant.sh" before="$FAIL"
  sed -e "$expr" "$SCRIPT" > "$m"
  if cmp -s "$m" "$SCRIPT"; then echo "MUTANT FAIL: ${name}: sed did not change the script"; FAIL=1; return; fi
  FAIL=0
  SUT="$m" "$@" > "$WORK/mutant.log" 2>&1
  if [[ "$FAIL" -eq 1 ]]; then echo "MUTANT KILLED: ${name}"; FAIL="$before"
  else echo "MUTANT SURVIVED: ${name}"; FAIL=1; fi
}
m_own_run() {
  reset_gh; setlist 1 "$(art 13 "$RUN" 2026-11-25T08:00:00Z)"; mkzip 13 run-task-outcome.json '{"outcome":"usage_limit","usage_limit_streak":1}'
  run_detect "mutant: own run artifact" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule"
}
m_newest() {
  reset_gh; setlist 2 "$(art 11 100 2026-11-25T04:22:40Z)" "$(art 12 101 2026-11-25T05:40:00Z)"
  mkzip 11 run-task-outcome.json '{"outcome":"usage_limit","usage_limit_streak":1}'; mkzip 12 run-task-outcome.json '{"outcome":"failure","usage_limit_streak":0}'
  run_detect "mutant: newest previous" 0 "usage_limit=true $R usage_limit_streak=1 usage_limit_action=reschedule"
}
mutant "drop own-run exclusion" 's/select(.workflow_run.id != $run)/select(true)/' m_own_run
mutant "oldest instead of newest" 's/max_by(.created_at)/min_by(.created_at)/' m_newest

if [[ "$FAIL" -ne 0 ]]; then echo "run-task-usage-limit-test: FAILED"; exit 1; fi
echo "run-task-usage-limit-test: all cases matched"
