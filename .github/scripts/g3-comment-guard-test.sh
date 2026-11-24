#!/usr/bin/env bash
# Asserted cases for g3-comment-guard.sh (O-009). A fake gh (GH_BIN) serves
# the PR, the three comment endpoints and the status write; the REAL
# tooling/comment-lint.mjs classifies the comments. Each case asserts the
# exact exit code and the exact status writes (state only). Zero network.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/g3-comment-guard.sh"
TOOLING="$(cd "$HERE/../.." && pwd)/tooling"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0
SHA="9253f95595980a1b235cb63b6ca1961c0b32bb9d"

cat > "$WORK/gh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
M="${MOCK:?}"
args="$*"
if [[ "$args" == *"-X POST"*"/statuses/"* ]]; then
  for a in "$@"; do [[ "$a" == state=* ]] && echo "${a#state=}" >> "$M/status.log"; done
  [[ "$(cat "$M/status.mode")" == ok ]] || { echo "gh: HTTP 403" >&2; exit 1; }
  echo '{}'; exit 0
fi
case "$args" in
  *"/pulls/7?"*|*"/pulls/7") key=pr ;;
  *"issues/7/comments"*) key=issue ;;
  *"pulls/7/reviews"*) key=reviews ;;
  *"pulls/7/comments"*) key=review_comments ;;
  *) echo "fake gh: unexpected: $args" >&2; exit 90 ;;
esac
if [[ -f "$M/$key.fail" ]]; then echo "gh: HTTP 403 for $key" >&2; exit 1; fi
cat "$M/$key"
FAKE
chmod +x "$WORK/gh"

# setup <title> <issue jsonl> <reviews jsonl> <review comments jsonl> [sha]
setup() {
  M="$WORK/m"; rm -rf "$M"; mkdir -p "$M"
  jq -cn --arg t "$1" --arg s "${5:-$SHA}" '{title: $t, head: {sha: $s}}' > "$M/pr"
  printf '%s' "$2" > "$M/issue"; printf '%s' "$3" > "$M/reviews"; printf '%s' "$4" > "$M/review_comments"
  echo ok > "$M/status.mode"; : > "$M/status.log"
}
# run_case <name> <expected exit> <expected statuses (| separated)> [env...]
run_case() {
  local name="$1" want="$2" want_status="$3"; shift 3
  local ec
  set +e
  env MOCK="$M" GH_BIN="$WORK/gh" TOOLING_DIR="$TOOLING" REPO=o/r PR_NUMBER=7 RUN_URL=u "$@" bash "$SCRIPT" > "$WORK/out" 2>&1
  ec=$?
  set -e
  local got; got="$(paste -sd '|' "$M/status.log")"
  if [[ "$ec" -ne "$want" || "$got" != "$want_status" ]]; then
    echo "CASE FAIL: ${name}: exit=${ec} (want ${want}) statuses=[${got}] (want [${want_status}])"; cat "$WORK/out"; FAIL=1
  else
    echo "CASE OK: ${name}: exit=${ec} statuses=[${got}]"
  fi
}

CLEAN='{"id":1,"body":"QA 通過：AC-T22-1（head 9253f95）；測試證據引用 PR CI run 的 pnpm check","url":"x"}'
TL='{"id":2,"body":"TechLead Review：核准（head 9253f95）","url":"x"}'
QA='{"id":3,"body":"**QA 退件**\n- box 上 pg_prove 重跑 4 檔","url":"x"}'
SUMMARY='{"id":4,"body":"## 自動驗證摘要（T-022 @ 9253f95）","url":"x"}'

setup "[G3] T-022 x" "$CLEAN" "$SUMMARY" ""
run_case "clean G3 PR -> success status, exit 0" 0 "success"
setup "[G3] T-022 x" "$CLEAN" "" ""
run_case "no reviews / review comments still passes" 0 "success"
setup "[G3] T-022 x" "$TL" "" ""
run_case "TechLead Review issue comment -> failure, exit 1" 1 "failure"
setup "[G3] T-022 x" "$CLEAN" "$QA" ""
run_case "QA local pg_prove rerun in a review body -> failure, exit 1" 1 "failure"
setup "[G3] T-022 x" "" "" "$TL"
run_case "TechLead Review as a review comment -> failure, exit 1" 1 "failure"
setup "[G2] arch" "$TL" "" ""
run_case "non-G3 PR is not checked: exit 0, no status" 0 ""
setup "[G3] T-022 x" "$CLEAN" "" ""; touch "$M/pr.fail"
run_case "PR API error -> exit 1, no status (head unknown)" 1 ""
setup "[G3] T-022 x" "$CLEAN" "" ""; touch "$M/reviews.fail"
run_case "comments API error -> failure status, exit 1" 1 "failure"
setup "[G3] T-022 x" "not json" "" ""
run_case "unparsable comments -> failure status, exit 1" 1 "failure"
setup "[G3] T-022 x" "$CLEAN" "" ""; echo bad > "$M/status.mode"
run_case "status write fails -> exit 1" 1 "success|failure"
setup "[G3] T-022 x" "$CLEAN" "" "" "abc"
run_case "bad head SHA -> exit 1, no status" 1 ""
setup "[G3] T-022 x" "$CLEAN" "" ""
run_case "bad PR_NUMBER -> exit 1, no status" 1 "" PR_NUMBER=x
setup "[G3] T-022 x" "$CLEAN" "" ""
run_case "missing comment-lint (broken tooling dir) -> failure status, exit 1" 1 "failure" TOOLING_DIR="$WORK/none"

if [[ "$FAIL" -ne 0 ]]; then echo "g3-comment-guard-test: FAILED"; exit 1; fi
echo "g3-comment-guard-test: all cases matched"
