#!/usr/bin/env bash
# Asserted cases for pr-body-check.sh (O-016). Uses the REAL
# tooling/pr-body-lint.mjs on a throwaway git repo; `gh` is a fake that prints
# $FAKE_GH_DIR/out and exits with $FAKE_GH_DIR/code, so zero network.
# Each case asserts the exit code and a line of output; two mutants must be killed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$HERE/pr-body-check.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'GH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_GH_DIR/calls"
[[ "${1-}" == "api" ]] || exit 2
[[ -f "$FAKE_GH_DIR/out" ]] && cat "$FAKE_GH_DIR/out"
code="$(cat "$FAKE_GH_DIR/code")"
[[ "$code" == 0 ]] || echo "HTTP 502: fake failure" >&2
exit "$code"
GH
chmod +x "$WORK/bin/gh"
gh_set() { # gh_set <exit code> <body file or "">
  rm -rf "$WORK/gh"; mkdir -p "$WORK/gh"
  echo "$1" > "$WORK/gh/code"; : > "$WORK/gh/calls"
  if [[ -n "$2" ]]; then cp "$2" "$WORK/gh/out"; else : > "$WORK/gh/out"; fi
}

FX="$ROOT/tooling/fixtures/o016"
PLACEHOLDER_BODY="$FX/pr-placeholder.md"
FILLED_BODY="$FX/pr-filled.md"
printf '## 摘要\n改 CI。\n\n## Actions 分鐘數影響\n會變少。\n' > "$WORK/vague.md"
printf '## 摘要\n改 CI。\n\n## Actions 分鐘數影響\n無影響：只改註解。\n' > "$WORK/no-impact.md"

REPO_DIR="$WORK/repo"
git init -q -b main "$REPO_DIR"
cd "$REPO_DIR"
git config user.email t@example.invalid
git config user.name t
mkdir -p .github/workflows .github/scripts docs
printf 'name: x\non:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo one two three four five\n' > .github/workflows/x.yml
echo a > docs/a.md
git add -A && git commit -qm base
BASE="$(git rev-parse HEAD)"
git switch -q -c wf "$BASE"
echo '# comment' >> .github/workflows/x.yml
git commit -qam "change a workflow"
WF="$(git rev-parse HEAD)"
git switch -q -c nowf "$BASE"
echo b >> docs/a.md; echo 'echo' > .github/scripts/x.sh
git add -A && git commit -qm "change docs and a script"
NOWF="$(git rev-parse HEAD)"
git switch -q -c mv "$BASE"
git mv .github/workflows/x.yml docs/x.yml
git commit -qm "move the workflow out of .github/workflows"
MV="$(git rev-parse HEAD)"
git switch -q main

# run_case <name> <want exit> <want output substring> <head sha> <gh code> <body file> [env...]
run_case() {
  local name="$1" want="$2" grep_for="$3" head="$4"
  gh_set "$5" "$6"
  shift 6
  local ec
  set +e
  env -i PATH="$WORK/bin:$PATH" HOME="$HOME" RUNNER_TEMP="$WORK" FAKE_GH_DIR="$WORK/gh" TOOLING_DIR="$ROOT/tooling" \
    REPO=o/r PR_NUMBER=7 BASE_SHA="$BASE" HEAD_SHA="$head" GH_TOKEN=x "$@" bash "$SCRIPT" > "$WORK/out" 2>&1
  ec=$?
  set -e
  if [[ "$ec" -ne "$want" ]] || ! grep -qF -- "$grep_for" "$WORK/out"; then
    echo "CASE FAIL: ${name}: exit=${ec} (want ${want}), want output containing: ${grep_for}"; cat "$WORK/out"; FAIL=1
  else
    echo "CASE OK: ${name}: exit=${ec}, output has: ${grep_for}"
  fi
}

run_case "workflow changed + placeholder -> red" 1 'FAIL PB-PLACEHOLDER' "$WF" 0 "$PLACEHOLDER_BODY"
run_case "workflow changed + filled (minutes) -> green" 0 'pr-body-lint: OK' "$WF" 0 "$FILLED_BODY"
if [[ "$(cat "$WORK/gh/calls")" == 'api repos/o/r/pulls/7 --jq .body // ""' ]]; then
  echo "CASE OK: gh reads the CURRENT description: $(cat "$WORK/gh/calls")"
else
  echo "CASE FAIL: unexpected gh call: $(cat "$WORK/gh/calls")"; FAIL=1
fi
run_case "workflow changed + 無影響：理由 -> green" 0 'pr-body-lint: OK' "$WF" 0 "$WORK/no-impact.md"
run_case "workflow changed + vague text -> red" 1 'FAIL PB-VAGUE' "$WF" 0 "$WORK/vague.md"
run_case "workflow changed + null description (jq prints nothing) -> red" 1 'FAIL PB-MISSING' "$WF" 0 ""
run_case "gh fails -> red (fail-closed)" 1 'cannot read the current PR description' "$WF" 1 "$FILLED_BODY"
run_case "no workflow changed + placeholder -> green" 0 'pr-body-lint: OK' "$NOWF" 0 "$PLACEHOLDER_BODY"
run_case "workflow moved out of .github/workflows + placeholder -> red (--no-renames)" 1 'FAIL PB-PLACEHOLDER' "$MV" 0 "$PLACEHOLDER_BODY"
run_case "bad diff range -> red" 1 'git diff' deadbeefdeadbeefdeadbeefdeadbeefdeadbeef 0 "$FILLED_BODY"
run_case "PR_NUMBER empty -> red" 1 'PR_NUMBER is empty' "$WF" 0 "$FILLED_BODY" PR_NUMBER=
run_case "PR_NUMBER not a number -> red" 1 'is not a PR number' "$WF" 0 "$FILLED_BODY" PR_NUMBER='7;x'
run_case "HEAD_SHA empty -> red" 1 'HEAD_SHA is empty' "" 0 "$FILLED_BODY"

# Mutants: each must turn a red case green (killed = the case fails on the mutant).
mutant() { # mutant <name> <sed expr> <case name> <head> <body>
  local m="$WORK/mutant.sh"
  sed -e "$2" "$SCRIPT" > "$m"
  if cmp -s "$m" "$SCRIPT"; then echo "CASE FAIL: mutant $1 did not change the script"; FAIL=1; return; fi
  gh_set 0 "$5"
  local ec
  set +e
  env -i PATH="$WORK/bin:$PATH" HOME="$HOME" RUNNER_TEMP="$WORK" FAKE_GH_DIR="$WORK/gh" TOOLING_DIR="$ROOT/tooling" \
    REPO=o/r PR_NUMBER=7 BASE_SHA="$BASE" HEAD_SHA="$4" GH_TOKEN=x bash "$m" > "$WORK/out" 2>&1
  ec=$?
  set -e
  if [[ "$ec" -eq 0 ]]; then echo "MUTANT KILLED: $1 (case \"$3\" now exits 0)"; else echo "CASE FAIL: mutant $1 survived (exit ${ec})"; cat "$WORK/out"; FAIL=1; fi
}
mutant "PB-M1 diff without --no-renames" 's/git diff --no-renames --name-only/git diff --name-only/' "workflow moved out" "$MV" "$PLACEHOLDER_BODY"
mutant "PB-M2 lint result ignored" 's/if ! node "$TOOLING_DIR\/pr-body-lint.mjs" --body "$BODY" --changed "$CHANGED"; then/if ! true; then/' "workflow changed + placeholder" "$WF" "$PLACEHOLDER_BODY"

if [[ "$FAIL" -ne 0 ]]; then echo "pr-body-check-test: FAILED"; exit 1; fi
echo "pr-body-check-test: all cases matched"
