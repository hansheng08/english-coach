#!/usr/bin/env bash
# Asserted cases for ci-guard-mode.sh and ci-referenced.mjs (O-015, retro
# §3.7 C1-C3 and light-mode fail-closed). Uses the REAL tooling/ci-mode.mjs on
# a throwaway git repo; `gh` is a fake driven by $FAKE_GH_DIR, so zero network.
# Each case asserts exit code and the mode / tasks_changed / pr_number lines.
# Five mutants must be killed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0
ZERO=0000000000000000000000000000000000000000

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'GH'
#!/usr/bin/env bash
# fake gh: records the call; prints $FAKE_GH_DIR/out; exits with $FAKE_GH_DIR/code (default 0).
echo "$*" >> "$FAKE_GH_DIR/calls"
[[ "${1-}" == "api" ]] || exit 2
[[ -f "$FAKE_GH_DIR/out" ]] && cat "$FAKE_GH_DIR/out"
code=0
[[ -f "$FAKE_GH_DIR/code" ]] && code="$(cat "$FAKE_GH_DIR/code")"
[[ "$code" == 0 ]] || echo "HTTP 502: fake failure" >&2
exit "$code"
GH
chmod +x "$WORK/bin/gh"
gh_set() { # gh_set <exit code> <stdout>
  rm -rf "$WORK/gh"; mkdir -p "$WORK/gh"; export FAKE_GH_DIR="$WORK/gh"
  echo "$1" > "$WORK/gh/code"; printf '%s' "$2" > "$WORK/gh/out"; : > "$WORK/gh/calls"
}
open_pr() { printf '[{"number":%s,"state":"open","head":{"ref":"%s"},"base":{"ref":"main"}}]' "$1" "$2"; }

# Throwaway repo: C0 (no referencer) -> C1 (tooling test imports docs/ARCHITECTURE.md) = BEFORE.
REPO_DIR="$WORK/repo"
git init -q -b main "$REPO_DIR"
g() { git -C "$REPO_DIR" "$@"; }
g config user.email t@example.invalid; g config user.name t
mkdir -p "$REPO_DIR/apps" "$REPO_DIR/docs/tasks" "$REPO_DIR/tooling"
echo 'export const x = 1;' > "$REPO_DIR/apps/x.ts"
echo '# arch' > "$REPO_DIR/docs/ARCHITECTURE.md"
echo '# tasks' > "$REPO_DIR/docs/TASKS.md"
echo '# O-1' > "$REPO_DIR/docs/tasks/O-1.md"
echo '# readme' > "$REPO_DIR/README.md"
g add -A; g commit -q -m c0; C0="$(g rev-parse HEAD)"
echo "import arch from '../docs/ARCHITECTURE.md?raw';" > "$REPO_DIR/tooling/news.test.ts"
g add -A; g commit -q -m c1; BEFORE="$(g rev-parse HEAD)"

# change <name> <shell snippet run inside the repo>: commit on a side branch from BEFORE, print the SHA.
change() {
  g checkout -q --detach "$BEFORE"
  (cd "$REPO_DIR" && eval "$2")
  g add -A; g commit -q -m "$1"; g rev-parse HEAD
}

SCRIPT="$HERE/ci-guard-mode.sh"
SCRIPTS_DIR="$HERE"
TOOLING_DIR="$ROOT/tooling"
# run_case <label> <want exit> <want output (space separated)> <event> <ref> <before> <sha> [repo]
run_case() {
  local label="$1" want_code="$2" want="$3" out code
  : > "$WORK/gh_out"
  set +e
  out="$(cd "$REPO_DIR" && PATH="$WORK/bin:$PATH" GITHUB_OUTPUT="$WORK/gh_out" EVENT_NAME="$4" REF_NAME="$5" \
    BEFORE_SHA="$6" SHA="$7" REPO="${8-hansheng08/english-coach}" TOOLING_DIR="$TOOLING_DIR" SCRIPTS_DIR="$SCRIPTS_DIR" \
    bash "$SCRIPT" 2>"$WORK/err")"
  code=$?
  set -e
  local got; got="$(grep -E '^(mode|tasks_changed|pr_number)=' <<<"$out" | tr '\n' ' ' | sed 's/ $//')"
  if [[ "$code" == "$want_code" && "$got" == "$want" ]]; then
    echo "ok   $label"
    return 0
  fi
  echo "FAIL $label: exit $code (want $want_code), got [$got] want [$want]"; sed 's/^/     /' "$WORK/err"
  return 1
}
check() { if ! run_case "$@"; then FAIL=1; fi; }

gh_set 0 '[]'
S_DOCS="$(change docs 'echo more >> docs/TASKS.md; echo r >> README.md')"
S_TASKS="$(change tasks 'echo "# O-2" > docs/tasks/O-2.md')"
S_MIXED="$(change mixed 'echo more >> docs/TASKS.md; echo "export const y = 2;" >> apps/x.ts')"
S_RENAME="$(change rename 'git mv apps/x.ts docs/x.md')"
S_DOCS_TS="$(change docs-ts 'echo "export const z = 3;" > docs/z.ts')"
S_DOCS_TXT="$(change docs-txt 'echo notes > docs/notes.txt')"
S_REF_EDIT="$(change ref-edit 'echo more >> docs/ARCHITECTURE.md')"
S_REF_DEL="$(change ref-del 'git rm -q docs/ARCHITECTURE.md')"
g checkout -q --detach "$BEFORE"

check "T1 docs-only push to main -> docs" 0 "mode=docs tasks_changed=false pr_number=" push main "$BEFORE" "$S_DOCS"
grep -qx 'mode=docs' "$WORK/gh_out" || { echo "FAIL T1b: GITHUB_OUTPUT missing mode=docs"; FAIL=1; }
check "T2 docs/tasks change -> docs, tasks_changed" 0 "mode=docs tasks_changed=true pr_number=" push main "$BEFORE" "$S_TASKS"
check "T3 docs + code -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_MIXED"
check "T4 (C1) git mv apps/x.ts docs/x.md -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_RENAME"
check "T5 (C2) only docs/z.ts -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_DOCS_TS"
check "T6 (C2) only docs/notes.txt -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_DOCS_TXT"
check "T7 (C3) edit a doc that code imports -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_REF_EDIT"
check "T8 (C3) delete a doc that code imports -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_REF_DEL"
g checkout -q --detach "$C0"
check "T9 (C3) work tree lacks the importer, SHA tree has it -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_REF_EDIT"
g checkout -q --detach "$BEFORE"
check "T10 BEFORE all zeros -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$ZERO" "$S_DOCS"
check "T11 BEFORE empty -> full" 0 "mode=full tasks_changed=false pr_number=" push main "" "$S_DOCS"
check "T12 BEFORE not in clone -> full" 0 "mode=full tasks_changed=false pr_number=" push main "1111111111111111111111111111111111111111" "$S_DOCS"
check "T13 ref given as refs/heads/main -> full" 0 "mode=full tasks_changed=false pr_number=" push refs/heads/main "$BEFORE" "$S_DOCS"
mkdir -p "$WORK/badref"; printf 'process.exit(1);\n' > "$WORK/badref/ci-referenced.mjs"
SCRIPTS_DIR="$WORK/badref"
check "T14 ci-referenced error -> full" 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_DOCS"
SCRIPTS_DIR="$HERE"

gh_set 0 "$(open_pr 7 task/T-1)"
check "T15 task push with open PR -> light" 0 "mode=light tasks_changed=false pr_number=7" push task/T-1 "$BEFORE" "$S_MIXED"
grep -q 'repos/hansheng08/english-coach/pulls?state=open&base=main&head=hansheng08:task/T-1' "$WORK/gh/calls" \
  || { echo "FAIL T15b: unexpected gh call: $(cat "$WORK/gh/calls")"; FAIL=1; }
gh_set 0 "$(open_pr 9 fix/Q-1)"
check "T16 fix push with open PR -> light" 0 "mode=light tasks_changed=false pr_number=9" push fix/Q-1 "$BEFORE" "$S_MIXED"
gh_set 0 '[]'
check "T17 task push, no PR -> full" 0 "mode=full tasks_changed=false pr_number=" push task/T-1 "$BEFORE" "$S_MIXED"
gh_set 1 ''
check "T18 gh api fails -> full" 0 "mode=full tasks_changed=false pr_number=" push task/T-1 "$BEFORE" "$S_MIXED"
gh_set 1 "$(open_pr 7 task/T-1)"
check "T19 gh prints an open PR but exits 1 -> full" 0 "mode=full tasks_changed=false pr_number=" push task/T-1 "$BEFORE" "$S_MIXED"
gh_set 0 '{"message":"x"'
check "T20 gh returns broken JSON -> full" 0 "mode=full tasks_changed=false pr_number=" push task/T-1 "$BEFORE" "$S_MIXED"
gh_set 0 "$(open_pr 7 task/T-2)"
check "T21 PR for another head -> full" 0 "mode=full tasks_changed=false pr_number=" push task/T-1 "$BEFORE" "$S_MIXED"
gh_set 0 "$(open_pr 7 task/T-1)"
check "T22 invalid REPO -> full, gh not called" 0 "mode=full tasks_changed=false pr_number=" push task/T-1 "$BEFORE" "$S_MIXED" 'bad repo'
[[ ! -s "$WORK/gh/calls" ]] || { echo "FAIL T22b: gh was called"; FAIL=1; }
check "T23 pull_request -> full, gh not called" 0 "mode=full tasks_changed=false pr_number=" pull_request 7/merge "$BEFORE" "$S_DOCS"
[[ ! -s "$WORK/gh/calls" ]] || { echo "FAIL T23b: gh was called"; FAIL=1; }
check "T24 workflow_dispatch on main -> full" 0 "mode=full tasks_changed=false pr_number=" workflow_dispatch main "$BEFORE" "$S_DOCS"
check "T25 push to poc/x with open PR -> full" 0 "mode=full tasks_changed=false pr_number=" push poc/x "$BEFORE" "$S_MIXED"
mkdir -p "$WORK/badtool"; printf 'process.exit(1);\n' > "$WORK/badtool/ci-mode.mjs"
TOOLING_DIR="$WORK/badtool"
check "T26 ci-mode.mjs exits 1 -> step fails" 1 "" push main "$BEFORE" "$S_DOCS"
printf 'console.log(JSON.stringify({mode:"Full",tasks_changed:false,pr_number:null}));\n' > "$WORK/badtool/ci-mode.mjs"
check "T27 ci-mode.mjs prints an unknown mode -> step fails" 1 "" push main "$BEFORE" "$S_DOCS"
printf 'console.log(JSON.stringify({mode:"light",tasks_changed:false,pr_number:null}));\n' > "$WORK/badtool/ci-mode.mjs"
check "T28 light without pr_number -> step fails" 1 "" push task/T-1 "$BEFORE" "$S_MIXED"
TOOLING_DIR="$ROOT/tooling"

# ---- mutants: each must make at least one case above give the wrong answer ----
mutant() { # mutant <name> <file: sh|mjs> <sed expr> <case function>
  local name="$1" kind="$2" expr="$3" fn="$4" saved_fail="$FAIL"
  rm -rf "$WORK/mut"; mkdir -p "$WORK/mut/.github/scripts"; ln -s "$ROOT/tooling" "$WORK/mut/tooling"
  cp "$HERE/ci-guard-mode.sh" "$HERE/ci-referenced.mjs" "$WORK/mut/.github/scripts/"
  local target="$WORK/mut/.github/scripts/ci-guard-mode.sh"
  [[ "$kind" == mjs ]] && target="$WORK/mut/.github/scripts/ci-referenced.mjs"
  sed -i "$expr" "$target"
  if cmp -s "$target" "$HERE/$(basename "$target")"; then echo "FAIL mutant '$name': sed did not change the file"; FAIL=1; return; fi
  SCRIPT="$WORK/mut/.github/scripts/ci-guard-mode.sh"; SCRIPTS_DIR="$WORK/mut/.github/scripts"
  local res
  if res="$("$fn" 2>&1)"; then echo "FAIL mutant '$name' survived"; FAIL="1"
  else echo "ok   mutant '$name' killed: $(grep -m1 -o 'exit .*want \[[^]]*\]' <<<"$res")"; FAIL="$saved_fail"; fi
  SCRIPT="$HERE/ci-guard-mode.sh"; SCRIPTS_DIR="$HERE"
}
m_rename() { run_case m1 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_RENAME"; }
m_docs_ts() { run_case m2 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_DOCS_TS"; }
m_deleted() { run_case m3 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_REF_DEL"; }
m_tree() { g checkout -q --detach "$C0"; local r=0; run_case m4 0 "mode=full tasks_changed=false pr_number=" push main "$BEFORE" "$S_REF_EDIT" || r=1; g checkout -q --detach "$BEFORE"; return "$r"; }
m_ghfail() { gh_set 1 "$(open_pr 7 task/T-1)"; run_case m5 0 "mode=full tasks_changed=false pr_number=" push task/T-1 "$BEFORE" "$S_MIXED"; }
mutant "C1 drop --no-renames" sh 's/ --no-renames//' m_rename
mutant "C2 docs/ non-.md not referenced" mjs "s/if (p.startsWith('docs\/') \&\& !p.endsWith('.md')) {/if (false) {/" m_docs_ts
mutant "C3 skip deleted docs" mjs 's/const candidates = changed;/const candidates = changed.filter((p) => tree.has(p));/' m_deleted
mutant "C3 search HEAD instead of SHA tree" mjs "s/'--full-tree', sha\]/'--full-tree', 'HEAD']/" m_tree
mutant "gh exit status ignored" sh 's/elif ! "\$GH_BIN" api \(.*\); then$/elif "$GH_BIN" api \1 \&\& false; then/' m_ghfail

if [[ "$FAIL" -ne 0 ]]; then echo "ci-guard-mode-test: FAILED"; exit 1; fi
echo "ci-guard-mode-test: all cases matched"
