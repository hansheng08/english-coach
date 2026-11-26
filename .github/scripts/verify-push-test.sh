#!/usr/bin/env bash
# Asserted cases for verify-push.sh (O-007). Run in CI by the pushguard job.
# Uses a fake `gh` and a fake `git` first in PATH: zero network, no sleeping
# (VERIFY_PUSH_SLEEP=0). Every case asserts the exact exit code AND the
# verify_reason written to GITHUB_OUTPUT; any mismatch fails this script.
# The fake `git` fails loudly on `git fetch` so a reintroduced fetch is caught.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/verify-push.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
FAKEBIN="$ROOT/bin"
mkdir -p "$FAKEBIN"
FAIL=0
CASES=0
SENTINEL="ghs_O007_FAKE_TOKEN_SENTINEL_DO_NOT_PRINT"
SHA_A="1a2ef4c4ded3241f9583f1e9d7a55e63080af29d"
SHA_B="3b1ccfa67a4b9803a17dda6a553bf0e9c67d5707"
SHA_PRE="28367c8c2e7dace35fda16b7c697cda11f27e7ee" # archive/T-018-run1 tip (fixture)
SHA_LOCAL="7fb74cce397e9b84de590497893677260662590c" # unpushed local HEAD of run 45852999547

cat >"$FAKEBIN/gh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
M="${MOCK_DIR:?}"
printf 'gh %s\n' "$*" >>"$M/calls.log"
if [[ "${1:-}" == "api" ]]; then
  case "$(cat "$M/ref.status")" in
    ok) cat "$M/ref.json"; exit 0 ;;
    404) printf '{"message":"Not Found","status":"404"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
    401) echo "gh: Bad credentials (HTTP 401)" >&2; exit 1 ;;
    403) echo "gh: Resource not accessible by integration (HTTP 403)" >&2; exit 1 ;;
    *) echo "error connecting to api.github.com" >&2; exit 1 ;;
  esac
fi
if [[ "${1:-} ${2:-}" == "run list" ]]; then
  n=$(( $(cat "$M/runs.count" 2>/dev/null || echo 0) + 1 )) # o004-allow: test fake counter
  echo "$n" >"$M/runs.count"
  case "$(cat "$M/runs.status")" in
    ok) ;;
    401) echo "gh: Bad credentials (HTTP 401)" >&2; exit 1 ;;
    403) echo "gh: Resource not accessible by integration (HTTP 403)" >&2; exit 1 ;;
    *) echo "error connecting to api.github.com" >&2; exit 1 ;;
  esac
  if [[ -f "$M/runs.$n.json" ]]; then cat "$M/runs.$n.json"; else cat "$M/runs.json"; fi
  exit 0
fi
echo "fake gh: unexpected: $*" >&2
exit 90
FAKE
cat >"$FAKEBIN/git" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >>"${MOCK_DIR:?}/calls.log"
case "${1:-} ${2:-}" in
  "branch --show-current") echo "${MOCK_BRANCH:-task/T-003}"; exit 0 ;;
  "rev-parse HEAD") echo "${MOCK_HEAD:?}"; exit 0 ;;
esac
if [[ "${1:-}" == "fetch" ]]; then
  echo "fatal: FAKE git fetch called - verify-push.sh must not run git fetch" >&2
  exit 97
fi
echo "fake git: unexpected: $*" >&2
exit 90
FAKE
chmod +x "$FAKEBIN/gh" "$FAKEBIN/git"

ref_obj() { # <ref> <sha> [type]
  printf '{"ref":"%s","object":{"sha":"%s","type":"%s"}}' "$1" "$2" "${3:-commit}"
}
run_obj() { # <event> <branch> <sha> [status] [conclusion]
  printf '{"databaseId":45324530991,"event":"%s","headBranch":"%s","headSha":"%s","status":"%s","conclusion":"%s","url":"https://example.invalid/run","createdAt":"2026-11-24T04:10:29Z"}' "$1" "$2" "$3" "${4:-completed}" "${5-success}"
}

# new_case: fresh mock dir with default "happy" responses.
new_case() {
  M="$ROOT/case$((CASES + 1))"
  mkdir -p "$M"
  : >"$M/calls.log"
  echo ok >"$M/ref.status"
  ref_obj refs/heads/task/T-003 "$SHA_A" >"$M/ref.json"
  echo ok >"$M/runs.status"
  printf '[%s]' "$(run_obj push task/T-003 "$SHA_A")" >"$M/runs.json"
}

# check <name> <expected exit> <expected verify_reason> [env...] -- [args...]
check() {
  local name="$1" want_ec="$2" want_reason="$3"
  shift 3
  local envs=() args=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ $# -gt 0 ]] && shift
  args=("$@")
  CASES=$((CASES + 1))
  : >"$M/github_output"
  echo "===== CASE ${CASES}: ${name} ====="
  local ec
  set +e
  env PATH="$FAKEBIN:$PATH" MOCK_DIR="$M" GITHUB_OUTPUT="$M/github_output" \
    MOCK_HEAD="$SHA_A" PRE_HEAD="$SHA_PRE" \
    GH_TOKEN="$SENTINEL" GITHUB_REPOSITORY="hansheng08/english-coach" \
    VERIFY_PUSH_SLEEP=0 VERIFY_PUSH_ATTEMPTS=3 TASK=T-003 "${envs[@]}" \
    bash "$SCRIPT" "${args[@]}" >"$M/out.txt" 2>&1
  ec=$?
  set -e
  local reason
  reason="$(sed -n 's/^verify_reason=//p' "$M/github_output" | tail -n 1)"
  sed 's/^/  | /' "$M/out.txt"
  echo "exit=${ec} verify_reason=${reason} (expected exit=${want_ec} verify_reason=${want_reason})"
  local bad=0
  [[ "$ec" -eq "$want_ec" ]] || { echo "ERROR: exit ${ec} != ${want_ec}"; bad=1; }
  [[ "$reason" == "$want_reason" ]] || { echo "ERROR: verify_reason '${reason}' != '${want_reason}'"; bad=1; }
  if grep -q "$SENTINEL" "$M/out.txt" "$M/github_output"; then echo "ERROR: GH_TOKEN value was printed"; bad=1; fi
  if grep -q '^git fetch' "$M/calls.log"; then echo "ERROR: verify-push.sh ran git fetch"; bad=1; fi
  if [[ "$bad" -eq 0 ]]; then echo "CASE OK"; else FAIL=1; fi
  echo
}

# ---------------------------------------------------------------- positive
new_case
check "branch exists (exact ref object) + matching push run -> 0" 0 ok -- task/T-003
grep -q '^gh api repos/hansheng08/english-coach/git/ref/heads/task/T-003$' "$M/calls.log" \
  || { echo "ERROR: expected gh api git/ref/heads/task/T-003 call"; FAIL=1; }
grep -q -- '--repo hansheng08/english-coach --workflow ci.yml --branch task/T-003 --event push' "$M/calls.log" \
  || { echo "ERROR: expected gh run list --event push call"; FAIL=1; }

new_case
check "branch from git branch --show-current (no arg) -> 0" 0 ok MOCK_BRANCH=task/T-003 --

new_case
ref_obj refs/heads/task/T-003 "$SHA_A" >"$M/ref.json"
check "non-task current branch falls back to task/\$TASK -> 0" 0 ok MOCK_BRANCH=main --

new_case
echo '[]' >"$M/runs.1.json"
printf '[%s]' "$(run_obj push task/T-003 "$SHA_B")" >"$M/runs.2.json"
check "polling: miss, other sha, then match on attempt 3 -> 0" 0 ok -- task/T-003
[[ "$(cat "$M/runs.count")" == "3" ]] || { echo "ERROR: expected 3 gh run list calls, got $(cat "$M/runs.count")"; FAIL=1; }

new_case
ref_obj refs/heads/fix/Q-001 "$SHA_A" >"$M/ref.json"
printf '[%s]' "$(run_obj push fix/Q-001 "$SHA_A")" >"$M/runs.json"
check "fix/ branch -> 0" 0 ok -- fix/Q-001

# ---------------------------------------------------------------- ref API
new_case; echo 404 >"$M/ref.status"
check "branch missing (HTTP 404) -> 1" 1 branch_missing -- task/T-003
new_case; echo 401 >"$M/ref.status"
check "ref API 401 -> 1" 1 api_auth -- task/T-003
new_case; echo 403 >"$M/ref.status"
check "ref API 403 -> 1" 1 api_auth -- task/T-003
new_case; echo neterr >"$M/ref.status"
check "ref API network/other error -> 1" 1 api_error -- task/T-003
new_case
printf '[%s,%s]' "$(ref_obj refs/heads/task/T-003 "$SHA_A")" "$(ref_obj refs/heads/task/T-0031 "$SHA_B")" >"$M/ref.json"
check "ambiguous prefix match (JSON array) -> 1" 1 bad_ref_json -- task/T-003
new_case; ref_obj refs/heads/task/T-003 1a2ef4c >"$M/ref.json"
check "short sha -> 1" 1 bad_ref_json -- task/T-003
new_case; ref_obj refs/heads/task/T-003 "${SHA_A^^}" >"$M/ref.json"
check "uppercase (non 40-lowercase-hex) sha -> 1" 1 bad_ref_json -- task/T-003
new_case; ref_obj refs/heads/task/T-0031 "$SHA_A" >"$M/ref.json"
check "ref object for a different branch -> 1" 1 bad_ref_json -- task/T-003
new_case; ref_obj refs/heads/task/T-003 "$SHA_A" tag >"$M/ref.json"
check "ref object.type is not commit -> 1" 1 bad_ref_json -- task/T-003
new_case; echo 'not json' >"$M/ref.json"
check "ref response not JSON -> 1" 1 bad_ref_json -- task/T-003

# ---------------------------------------------------------------- run list
new_case; echo '[]' >"$M/runs.json"
check "no push run after all attempts -> 1" 1 no_push_run -- task/T-003
[[ "$(cat "$M/runs.count")" == "3" ]] || { echo "ERROR: expected 3 attempts, got $(cat "$M/runs.count")"; FAIL=1; }
new_case; printf '[%s]' "$(run_obj push task/T-003 "$SHA_B")" >"$M/runs.json"
check "push run with wrong headSha -> 1" 1 no_push_run -- task/T-003
new_case; printf '[%s]' "$(run_obj pull_request task/T-003 "$SHA_A")" >"$M/runs.json"
check "only a pull_request run for the sha -> 1" 1 no_push_run -- task/T-003
new_case; printf '[%s]' "$(run_obj push task/T-0031 "$SHA_A")" >"$M/runs.json"
check "push run on a different headBranch -> 1" 1 no_push_run -- task/T-003
new_case; echo 401 >"$M/runs.status"
check "gh run list 401 -> 1" 1 run_list_error -- task/T-003
new_case; echo 403 >"$M/runs.status"
check "gh run list 403 -> 1" 1 run_list_error -- task/T-003
new_case; echo neterr >"$M/runs.status"
check "gh run list other error -> 1" 1 run_list_error -- task/T-003
new_case; echo '{"message":"oops"}' >"$M/runs.json"
check "gh run list returns an object, not an array -> 1" 1 bad_run_json -- task/T-003
new_case; echo 'not json' >"$M/runs.json"
check "gh run list returns invalid JSON -> 1" 1 bad_run_json -- task/T-003

# ---------------------------------------------------------------- inputs
new_case
check "missing GH_TOKEN -> 1" 1 bad_input GH_TOKEN= -- task/T-003
new_case
check "missing GITHUB_REPOSITORY -> 1" 1 bad_input GITHUB_REPOSITORY= -- task/T-003
new_case
check "malformed GITHUB_REPOSITORY -> 1" 1 bad_input "GITHUB_REPOSITORY=a/b/c" -- task/T-003
new_case
check "non-task branch and empty TASK -> 1" 1 bad_input MOCK_BRANCH=main TASK= --
new_case
check "nested branch name -> 1" 1 bad_input -- task/T-003/x
new_case
check "VERIFY_PUSH_ATTEMPTS=0 -> 1" 1 bad_input VERIFY_PUSH_ATTEMPTS=0 -- task/T-003
new_case
check "VERIFY_PUSH_SLEEP=abc -> 1" 1 bad_input VERIFY_PUSH_SLEEP=abc -- task/T-003

# ---------------------------------------------------------------- O-026
# Regression of run 45852999547: local HEAD 7fb74cc was never pushed, remote and
# PRE_HEAD are 28367c8, and an older push CI run exists for 28367c8.
new_case
ref_obj refs/heads/task/T-003 "$SHA_PRE" >"$M/ref.json"
printf '[%s]' "$(run_obj push task/T-003 "$SHA_PRE" completed failure)" >"$M/runs.json"
check "(AC-O26-3) (TC-4) remote=PRE_HEAD != local HEAD, stale push CI -> head_mismatch" 1 head_mismatch MOCK_HEAD="$SHA_LOCAL" PRE_HEAD="$SHA_PRE" -- task/T-003
new_case
printf '[%s]' "$(run_obj push task/T-003 "$SHA_A")" >"$M/runs.json"
check "(AC-O26-3) remote head != local HEAD (push CI exists for remote sha) -> head_mismatch" 1 head_mismatch MOCK_HEAD="$SHA_B" -- task/T-003
new_case
ref_obj refs/heads/task/T-003 "$SHA_PRE" >"$M/ref.json"
printf '[%s]' "$(run_obj push task/T-003 "$SHA_PRE")" >"$M/runs.json"
check "(AC-O26-3) remote == local == PRE_HEAD (nothing new pushed) -> stale_head" 1 stale_head MOCK_HEAD="$SHA_PRE" PRE_HEAD="$SHA_PRE" -- task/T-003
new_case
printf '[%s]' "$(run_obj push task/T-003 "$SHA_A" in_progress "")" >"$M/runs.json"
check "(AC-O26-3) (TC-5) pushed, push CI in_progress -> ok" 0 ok -- task/T-003
new_case
printf '[%s]' "$(run_obj push task/T-003 "$SHA_A" completed failure)" >"$M/runs.json"
check "(AC-O26-3) (TC-5) pushed, push CI conclusion=failure -> ok" 0 ok -- task/T-003
new_case
printf '[%s]' "$(run_obj push task/T-003 "$SHA_B")" >"$M/runs.json"
check "(AC-O26-3) (TC-9) pushed, only an earlier sha has push CI -> no_push_run" 1 no_push_run -- task/T-003
new_case
echo '[]' >"$M/runs.json"
check "(AC-O26-3) (TC-9) pushed, no push CI run at all -> no_push_run" 1 no_push_run -- task/T-003

# (AC-O26-6) (TC-8) mutant: drop every line naming the head_mismatch/stale_head
# reasons; the TC-4 regression (local 7fb74cc, remote 28367c8) must then no
# longer be rejected on those grounds, and the mutant is reported as caught only
# if the real script differs from it AND the real script rejects the case.
MUT="$ROOT/mutant.sh"
set +e
grep -vE 'head_mismatch|stale_head' "$SCRIPT" >"$MUT"
set -e
if cmp -s "$MUT" "$SCRIPT"; then
  echo "ERROR: (AC-O26-6) verify-push.sh has no head_mismatch/stale_head checks to mutate"; FAIL=1
else
  new_case
  ref_obj refs/heads/task/T-003 "$SHA_PRE" >"$M/ref.json"
  printf '[%s]' "$(run_obj push task/T-003 "$SHA_PRE" completed failure)" >"$M/runs.json"
  set +e
  env PATH="$FAKEBIN:$PATH" MOCK_DIR="$M" GITHUB_OUTPUT="$M/github_output" MOCK_HEAD="$SHA_LOCAL" PRE_HEAD="$SHA_PRE" \
    GH_TOKEN="$SENTINEL" GITHUB_REPOSITORY="hansheng08/english-coach" VERIFY_PUSH_SLEEP=0 VERIFY_PUSH_ATTEMPTS=1 TASK=T-003 \
    bash "$MUT" task/T-003 >"$M/out.txt" 2>&1
  MUT_EC=$?
  set -e
  if [[ "$MUT_EC" -eq 0 ]]; then
    echo "MUTANT KILLED: (AC-O26-6) without the head checks the stale CI run is accepted (exit 0), so the TC-4 case guards it"
  else
    echo "ERROR: (AC-O26-6) mutant without head checks is still rejected; TC-4 would not detect the weakening"; FAIL=1
  fi
fi

# ---------------------------------------------------------------- static
echo "===== STATIC: verify-push.sh has no git fetch command ====="
if grep -nE '^[^#]*\bgit[[:space:]]+fetch\b' "$SCRIPT"; then
  echo "ERROR: verify-push.sh contains a git fetch command (fails under persist-credentials: false)"
  FAIL=1
else
  echo "no git fetch command line in verify-push.sh"
  echo "STATIC OK"
fi
echo

if [[ "$FAIL" -ne 0 ]]; then
  echo "verify-push-test: FAILED"
  exit 1
fi
echo "verify-push-test: all ${CASES} cases matched"
exit 0
