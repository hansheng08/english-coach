#!/usr/bin/env bash
# Asserted cases for g3-comment-guard.sh (O-009 / O-021). A fake gh (GH_BIN)
# serves the PR, the three comment endpoints and the status write; the REAL
# tooling/comment-lint.mjs classifies the comments. Each case asserts the
# exact exit code and the exact status writes (state, head SHA, description).
# Zero network.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/g3-comment-guard.sh"
TOOLING="$(cd "$HERE/../.." && pwd)/tooling"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0
SHA="9253f95595980a1b235cb63b6ca1961c0b32bb9d"
MERGE_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SKIP_DESC="not a [G3] PR; not checked"
VIOL_DESC="G3 comment violation (TechLead Review / QA local rerun); see run log"
ERR_DESC="g3-comment-guard error: see run log"

cat > "$WORK/gh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
M="${MOCK:?}"
args="$*"
if [[ "$args" == *"-X POST"*"/statuses/"* ]]; then
  state="" desc="" sha=""
  for a in "$@"; do
    case "$a" in
      state=*) state="${a#state=}" ;;
      description=*) desc="${a#description=}" ;;
      */statuses/*) sha="${a##*/statuses/}" ;;
    esac
  done
  printf '%s@%s@%s\n' "$state" "$sha" "$desc" >> "$M/status.log"
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

ok_desc() { printf '%s comment(s), no violation' "$1"; }
rec() { # state desc [sha]
  printf '%s@%s@%s' "$1" "${3:-$SHA}" "$2"
}

# setup <title> <issue jsonl> <reviews jsonl> <review comments jsonl> [sha]
setup() {
  M="$WORK/m"; rm -rf "$M"; mkdir -p "$M"
  local sha="${5:-$SHA}"
  if [[ "$sha" == MISSING ]]; then
    jq -cn --arg t "$1" '{title: $t, head: {}}' > "$M/pr"
  else
    jq -cn --arg t "$1" --arg s "$sha" '{title: $t, head: {sha: $s}}' > "$M/pr"
  fi
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
SKIP_REC="$(rec success "$SKIP_DESC")"
VIOL_REC="$(rec failure "$VIOL_DESC")"
ERR_REC="$(rec failure "$ERR_DESC")"
OK2_REC="$(rec success "$(ok_desc 2)")"
OK1_REC="$(rec success "$(ok_desc 1)")"
OK0_REC="$(rec success "$(ok_desc 0)")"

# --- AC-O21-2 / TC-2: existing [G3] cases (exit + state unchanged; now also SHA + description) ---
setup "[G3] T-022 x" "$CLEAN" "$SUMMARY" ""
run_case "(AC-O21-2) (TC-2) clean G3 PR -> success status, exit 0" 0 "$OK2_REC"
setup "[G3] T-022 x" "$CLEAN" "" ""
run_case "(AC-O21-2) (TC-2) no reviews / review comments still passes" 0 "$OK1_REC"
setup "[G3] T-022 x" "$TL" "" ""
run_case "(AC-O21-2) (TC-2) TechLead Review issue comment -> failure, exit 1" 1 "$VIOL_REC"
setup "[G3] T-022 x" "$CLEAN" "$QA" ""
run_case "(AC-O21-2) (TC-2) QA local pg_prove rerun in a review body -> failure, exit 1" 1 "$VIOL_REC"
setup "[G3] T-022 x" "" "" "$TL"
run_case "(AC-O21-2) (TC-2) TechLead Review as a review comment -> failure, exit 1" 1 "$VIOL_REC"

# --- AC-O21-1 / TC-1 / TC-8: non-G3 writes success with exact description on head SHA ---
# Replaces the old "non-G3 PR is not checked: exit 0, no status" coverage.
# Comment endpoints are marked to fail: they must not be called.
for title in "[G1] AC-15 x" "[G2] arch" "[D2] design system" "docs: O-021 任務單"; do
  setup "$title" "$TL" "" ""
  touch "$M/issue.fail" "$M/reviews.fail" "$M/review_comments.fail"
  run_case "(AC-O21-1) (TC-1) (TC-8) non-G3 '$title' writes success; comments not read" 0 "$SKIP_REC"
done

# --- AC-O21-3 / TC-3: non-G3 then [G3] on the same SHA ---
setup "[G2] arch" "$TL" "" ""
run_case "(AC-O21-3) (TC-3) first run non-G3 -> not-checked success" 0 "$SKIP_REC"
setup "[G3] T-022 x" "$TL" "" ""
run_case "(AC-O21-3) (TC-3) then [G3] with TechLead Review -> failure" 1 "$VIOL_REC"

# --- AC-O21-3 / TC-4: [G3] then non-G3 on the same SHA ---
setup "[G3] T-022 x" "$CLEAN" "$SUMMARY" ""
run_case "(AC-O21-3) (TC-4) first run clean [G3] -> comments success" 0 "$OK2_REC"
setup "[G1] later title" "$CLEAN" "$SUMMARY" ""
run_case "(AC-O21-3) (TC-4) then non-G3 -> not-checked success" 0 "$SKIP_REC"

# --- AC-O21-4 / TC-5: status write failure -> non-zero (G3 and non-G3) ---
setup "[G3] T-022 x" "$CLEAN" "" ""; echo bad > "$M/status.mode"
run_case "(AC-O21-4) (TC-5) [G3] status write fails -> exit 1" 1 "${OK1_REC}|${ERR_REC}"
setup "[G2] arch" "$CLEAN" "" ""; echo bad > "$M/status.mode"
run_case "(AC-O21-4) (TC-5) non-G3 status write fails -> exit 1" 1 "${SKIP_REC}|${ERR_REC}"

# --- AC-O21-4 / TC-6 / TC-9: missing or bad head SHA, PR API, comments, lint ---
setup "[G3] T-022 x" "$CLEAN" "" ""; touch "$M/pr.fail"
run_case "(AC-O21-4) (TC-9) PR API error -> exit 1, no status (head unknown)" 1 ""
setup "[G2] arch" "$CLEAN" "" ""; touch "$M/pr.fail"
run_case "(AC-O21-4) (TC-9) non-G3 PR API error -> exit 1, no status" 1 ""
setup "[G3] T-022 x" "$CLEAN" "" ""; touch "$M/reviews.fail"
run_case "(AC-O21-4) (TC-9) comments API error -> failure status, exit 1" 1 "$ERR_REC"
setup "[G3] T-022 x" "not json" "" ""
run_case "(AC-O21-4) (TC-9) unparsable comments -> failure status, exit 1" 1 "$ERR_REC"
setup "[G3] T-022 x" "$CLEAN" "" "" "abc"
run_case "(AC-O21-4) (TC-6) bad head SHA -> exit 1, no status" 1 ""
setup "[G2] arch" "$CLEAN" "" "" MISSING
run_case "(AC-O21-4) (TC-6) missing head SHA -> exit 1, no status" 1 ""
setup "[G3] T-022 x" "$CLEAN" "" ""
run_case "(AC-O21-4) (TC-9) bad PR_NUMBER -> exit 1, no status" 1 "" PR_NUMBER=x
setup "[G3] T-022 x" "$CLEAN" "" ""
run_case "(AC-O21-4) (TC-9) missing comment-lint (broken tooling dir) -> failure status, exit 1" 1 "$ERR_REC" TOOLING_DIR="$WORK/none"

# --- AC-O21-4 / TC-7: must not write to GITHUB_SHA (merge SHA stand-in) ---
setup "[G2] arch" "$CLEAN" "" ""
run_case "(AC-O21-4) (TC-7) non-G3 ignores GITHUB_SHA; POST uses head.sha" 0 "$SKIP_REC" GITHUB_SHA="$MERGE_SHA"
setup "[G3] T-022 x" "$CLEAN" "" ""
run_case "(AC-O21-4) (TC-7) [G3] ignores GITHUB_SHA; POST uses head.sha" 0 "$OK1_REC" GITHUB_SHA="$MERGE_SHA"

# Title readable-failure after SHA is known -> failure status (spec: title unreadable, SHA already checked)
setup "[G3] T-022 x" "$CLEAN" "" ""
jq -cn --arg s "$SHA" '{head: {sha: $s}}' > "$M/pr"
run_case "(AC-O21-4) no title but head SHA known -> failure status, exit 1" 1 "$ERR_REC"

if [[ "$FAIL" -ne 0 ]]; then echo "g3-comment-guard-test: FAILED"; exit 1; fi
echo "g3-comment-guard-test: all cases matched"
