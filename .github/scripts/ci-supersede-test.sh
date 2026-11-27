#!/usr/bin/env bash
# Asserted cases for ci-supersede.sh (O-028 item 3, AC-O28-5..7 wiring) with the
# REAL tooling/ci-supersede.mjs and a fake `gh` (zero network). Each case checks
# the exit code and whether / which commit status would be POSTed. Mutants of
# ci-supersede.sh must be killed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0
SHA=1234567890abcdef1234567890abcdef12345678
REPO=hansheng08/english-coach

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'GH'
#!/usr/bin/env bash
# fake gh: GET answers from $D/<runs|jobs-ID|statuses> (+ <name>.code); POST appends its args to $D/posts.
echo "$*" >> "$D/calls"
[[ "${1-}" == "api" ]] || exit 2
shift
if [[ "${1-}" == "-X" ]]; then
  [[ -f "$D/post.code" ]] && exit "$(cat "$D/post.code")"
  echo "$*" >> "$D/posts"; echo '{}'; exit 0
fi
case "$1" in
  */actions/workflows/ci.yml/runs\?*) f=runs ;;
  */actions/runs/*/jobs\?*) f="jobs-$(sed -E 's#.*/runs/([0-9]+)/jobs.*#\1#' <<<"$1")" ;;
  */commits/*/statuses\?*) f=statuses ;;
  *) exit 3 ;;
esac
[[ -f "$D/$f.code" ]] && { echo "HTTP 502: fake" >&2; exit "$(cat "$D/$f.code")"; }
[[ -f "$D/$f" ]] || exit 4
cat "$D/$f"
GH
chmod +x "$WORK/bin/gh"

# run <id> <event> <conclusion> [head repo] [branch]
run_json() { printf '{"id":%s,"event":"%s","status":"completed","conclusion":"%s","head_sha":"%s","head_branch":"%s","head_repository":{"full_name":"%s"},"pull_requests":[{"number":82}],"html_url":"https://github.com/%s/actions/runs/%s"}' \
  "$1" "$2" "$3" "$SHA" "${5-task/T-018}" "${4-$REPO}" "$REPO" "$1"; }
setup() { # setup <runs json array> ; resets everything else to "nothing marked yet"
  rm -rf "$WORK/d"; mkdir -p "$WORK/d"; export D="$WORK/d"
  printf '{"total_count":1,"workflow_runs":%s}' "$1" > "$D/runs"
  echo '[]' > "$D/statuses"; : > "$D/calls"
}
jobs_for() { printf '{"jobs":[{"name":"%s","conclusion":"%s"}]}' "$2" "$3" > "$D/jobs-$1"; }

SCRIPT="$HERE/ci-supersede.sh"
# case <label> <want exit> <want post: none | success | error>
case_() {
  local label="$1" want_code="$2" want_post="$3" code got=none
  set +e
  PATH="$WORK/bin:$PATH" SHA="${CASE_SHA-$SHA}" REPO="$REPO" TOOLING_DIR="$ROOT/tooling" bash "$SCRIPT" >"$WORK/out" 2>&1
  code=$?
  set -e
  if [[ -s "$D/posts" ]]; then got="$(grep -o 'state=[a-z]*' "$D/posts" | head -1 | cut -d= -f2)"; fi
  if [[ "$code" == "$want_code" && "$got" == "$want_post" ]]; then echo "ok   $label"; return 0; fi
  echo "FAIL $label: exit $code (want $want_code), post [$got] want [$want_post]"; sed 's/^/     /' "$WORK/out"; return 1
}
check() { if ! case_ "$@"; then FAIL=1; fi; }

PR_GREEN_PUSH_RED="[$(run_json 11 pull_request success),$(run_json 12 push failure)]"
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success
check "S1 (AC-O28-5) (TC-10) PR ci-ok green + push red -> mark success" 0 success
grep -q 'context=ci-push-superseded' "$D/posts" && grep -q 'target_url=https://github.com/hansheng08/english-coach/actions/runs/11' "$D/posts" \
  && grep -q 'description=push run 12 .*PR #82' "$D/posts" || { echo "FAIL S1b: wrong POST: $(cat "$D/posts")"; FAIL=1; }
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok failure
check "S2 (AC-O28-6) (TC-11) PR ci-ok failure -> no status" 0 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 'ci-ok (push)' success
check "S3 (AC-O28-6) (TC-11) only a job named ci-ok (push) -> no status" 0 none
setup "[$(run_json 11 pull_request success someone/fork),$(run_json 12 push failure)]"; jobs_for 11 ci-ok success
check "S4 (AC-O28-6) (TC-11) PR run from a fork -> no status" 0 none
setup "[$(run_json 11 pull_request success),$(run_json 12 push success)]"; jobs_for 11 ci-ok success
check "S5 (AC-O28-6) (TC-11) push run green -> no status" 0 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success
printf '[{"context":"ci-push-superseded","state":"success","description":"push run 12 紅燈已被 PR #82 的 run 11 取代；非必過、請勿為消紅燈重推"}]' > "$D/statuses"
check "S6 (AC-O28-7) (TC-12) already marked for the same PR run -> no new status" 0 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok failure
printf '[{"context":"ci-push-superseded","state":"success","description":"push run 12 紅燈已被 PR #82 的 run 9 取代；非必過、請勿為消紅燈重推"}]' > "$D/statuses"
check "S7 (AC-O28-7) (TC-12) no longer superseded, was success -> retract (error)" 0 error
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok failure
printf '[{"context":"ci-ok","state":"success","description":"x"},{"context":"g3-comment-guard","state":"success","description":"y"}]' > "$D/statuses"
check "S8 (AC-O28-7) other contexts' success statuses are ignored -> no status" 0 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success; echo 1 > "$D/runs.code"
check "S9 (AC-O28-7) (TC-13) gh runs fails -> exit 1, no status" 1 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success; echo 1 > "$D/jobs-11.code"
check "S10 gh jobs fails -> exit 1, no status" 1 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success; echo '{"broken"' > "$D/runs"
check "S11 (AC-O28-7) (TC-13) broken runs JSON -> exit 1, no status" 1 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success; echo 1 > "$D/post.code"
check "S12 POST status fails -> exit 1" 1 none
setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success
CASE_SHA=not-a-sha check "S13 (AC-O28-7) (TC-13) bad SHA -> exit 1, gh not called" 1 none
[[ ! -s "$D/calls" ]] || { echo "FAIL S13b: gh was called"; FAIL=1; }

# ---- mutants of ci-supersede.sh: each must make at least one case give the wrong answer ----
mutant() { # mutant <name> <sed expr> <case function>
  local name="$1" expr="$2" fn="$3" saved_fail="$FAIL"
  cp "$HERE/ci-supersede.sh" "$WORK/mut.sh"; sed -i "$expr" "$WORK/mut.sh"
  if cmp -s "$WORK/mut.sh" "$HERE/ci-supersede.sh"; then echo "FAIL mutant '$name': sed did not change the file"; FAIL=1; return; fi
  SCRIPT="$WORK/mut.sh"
  if "$fn" >/dev/null 2>&1; then echo "FAIL mutant '$name' survived"; FAIL=1; else echo "ok   mutant '$name' killed"; FAIL="$saved_fail"; fi
  SCRIPT="$HERE/ci-supersede.sh"
}
m_retract() { setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok failure
  printf '[{"context":"ci-push-superseded","state":"success","description":"push run 12 紅燈已被 PR #82 的 run 9 取代"}]' > "$D/statuses"; case_ m1 0 error; }
m_jobs() { setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok success; case_ m2 0 success; }
m_ctx() { setup "$PR_GREEN_PUSH_RED"; jobs_for 11 ci-ok failure
  printf '[{"context":"ci-ok","state":"success","description":"x"}]' > "$D/statuses"; case_ m3 0 none; }
m_fork() { setup "[$(run_json 11 pull_request success someone/fork),$(run_json 12 push failure)]"; jobs_for 11 ci-ok success; case_ m4 0 none; }
mutant "retract posts success" 's/-f state=error/-f state=success/' m_retract
mutant "jobs never fetched" 's/^done <"\$WORK\/pr-ids.txt"$/done <\/dev\/null/' m_jobs
mutant "statuses not filtered by context" 's/s.filter((x) => x \&\& x.context === ctx)/s/' m_ctx
mutant "--repo ignored (fork check sees another repo)" 's/--repo "\$REPO"/--repo someone\/fork/' m_fork

if [[ "$FAIL" -ne 0 ]]; then echo "ci-supersede-test: FAILED"; exit 1; fi
echo "ci-supersede-test: all cases matched"
