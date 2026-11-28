#!/usr/bin/env bash
# O-032: asserted cases for run-task-validate-id.sh (TC-8 ~ TC-11), the real
# Notify step of claude-run-task.yml after a failed Validate (TC-16 ~ TC-18),
# and script-level mutants (AC-O32-9 / TC-20). Every mutant must be caught.
# Zero network: curl is a fake that records the POST; jq is the real one.
# The task-id class is assembled from pieces so this file carries no
# task-id regex (claude-permission-check.mjs scans every file under .github/).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/run-task-validate-id.sh"
WF="$HERE/../workflows/claude-run-task.yml"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0
ok() { echo "CASE OK: $*"; }
bad() { echo "CASE FAIL: $*"; FAIL=1; }

GOOD=(T-025a T-025a-fix1 T-025 O-030 T-017b T-035b Q-012 Q-012a P-001 A-001 T-012-fix1 T-012-fix12)
LONG="$(printf 'T%.0s' {1..5000})"
BAD=(T-025A T-025ab T-25a T-025-a X-025 T-025a-fix T-025a-fix0 T-025a-fix01 '' $'T-025a\n' '../T-025a' 12345
  ' T-025a' 'T-025a ' T-025aa t-025a 'T-025é' 'T-０２５a' 'T-025a;id' 'T-025a$(id)' $'T-025a\nO-030'
  'task/T-025a' "$LONG")
UNSAFE=($'T-025a\n::error::x' $'x\n::add-mask::secret-value' $'::warning::y' $'a\r::error::b' $'\e[31mred' "$LONG")

# id_cases <script>: prints one "MISMATCH ..." line per case that does not
# match TC-8 / TC-9 (valid: exit 0 + empty stdout; invalid or unset: exit 1).
id_cases() {
  local s="$1" v ec
  for v in "${GOOD[@]}"; do
    set +e; env -i PATH="$PATH" TASK="$v" bash "$s" > "$WORK/o" 2> "$WORK/e"; ec=$?; set -e
    [[ "$ec" -eq 0 && ! -s "$WORK/o" ]] || echo "MISMATCH valid $(printf '%q' "$v") exit=${ec}"
  done
  for v in "${BAD[@]}"; do
    set +e; env -i PATH="$PATH" TASK="$v" bash "$s" > "$WORK/o" 2> "$WORK/e"; ec=$?; set -e
    [[ "$ec" -eq 1 ]] || echo "MISMATCH invalid $(printf '%.40q' "$v") exit=${ec}"
  done
  set +e; env -i PATH="$PATH" bash "$s" > "$WORK/o" 2> "$WORK/e"; ec=$?; set -e
  [[ "$ec" -eq 1 ]] || echo "MISMATCH unset exit=${ec}"
}

# out_cases <script>: TC-10, all output of an invalid value is one line, no
# line starts with "::", no control character, at most 200 characters.
out_cases() {
  local s="$1" v ec
  for v in "${UNSAFE[@]}"; do
    set +e; env -i PATH="$PATH" TASK="$v" bash "$s" > "$WORK/o" 2>&1; ec=$?; set -e
    if [[ "$ec" -ne 1 ]]; then echo "MISMATCH unsafe exit=${ec}"; continue; fi
    if grep -q '^::' "$WORK/o"; then echo "MISMATCH unsafe: a line starts with ::"; fi
    if tr -d '\n' < "$WORK/o" | LC_ALL=C grep -q '[[:cntrl:]]'; then echo "MISMATCH unsafe: control character"; fi
    if [[ "$(wc -l < "$WORK/o")" -ne 1 ]]; then echo "MISMATCH unsafe: not exactly one line"; fi
    if [[ "$(wc -c < "$WORK/o")" -gt 200 ]]; then echo "MISMATCH unsafe: over 200 characters"; fi
    if ! grep -qE '^run-task-validate-id: invalid task id \([A-Za-z0-9._/?-]{0,40}\)$' "$WORK/o"; then echo "MISMATCH unsafe: message format"; fi
  done
}

id_cases "$SCRIPT" > "$WORK/m1"
if [[ -s "$WORK/m1" ]]; then bad "(AC-O32-4) (TC-8) (TC-9) ids"; cat "$WORK/m1"; else ok "(AC-O32-4) (TC-8) ${#GOOD[@]} valid ids exit 0 with empty stdout; (TC-9) ${#BAD[@]} invalid ids and unset exit 1"; fi
out_cases "$SCRIPT" > "$WORK/m2"
if [[ -s "$WORK/m2" ]]; then bad "(AC-O32-4) (TC-10) output safety"; cat "$WORK/m2"; else ok "(AC-O32-4) (TC-10) ${#UNSAFE[@]} hostile values: one line, no ::, no control character, <= 200 chars"; fi

# TC-11: an outer locale must not widen [a-z] / [0-9].
for loc in C.UTF-8 POSIX; do
  for v in 'T-025é' T-025B; do
    set +e; env -i PATH="$PATH" LC_ALL="$loc" LANG="$loc" TASK="$v" bash "$SCRIPT" > /dev/null 2>&1; ec=$?; set -e
    if [[ "$ec" -eq 1 ]]; then ok "(AC-O32-4) (TC-11) LC_ALL=${loc} $(printf '%q' "$v") -> exit 1"; else bad "(AC-O32-4) (TC-11) LC_ALL=${loc} $(printf '%q' "$v") exit=${ec}"; fi
  done
  set +e; env -i PATH="$PATH" LC_ALL="$loc" TASK=T-025a bash "$SCRIPT" > /dev/null 2>&1; ec=$?; set -e
  if [[ "$ec" -eq 0 ]]; then ok "(AC-O32-4) (TC-11) LC_ALL=${loc} T-025a -> exit 0"; else bad "(AC-O32-4) (TC-11) LC_ALL=${loc} T-025a exit=${ec}"; fi
done

# (AC-O32-9) (TC-20) script mutants: each must make TC-8 ~ TC-10 fail.
CLS='[TQ''OAP]'
DEF="^${CLS}-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?\$"
mutant() {
  local name="$1" from="$2" to="$3" src out
  src="$(cat "$SCRIPT")"
  out="${src/"$from"/"$to"}"
  if [[ "$out" == "$src" ]]; then bad "mutant ${name}: anchor not found"; return; fi
  printf '%s\n' "$out" > "$WORK/mut.sh"
  { id_cases "$WORK/mut.sh"; out_cases "$WORK/mut.sh"; } > "$WORK/mm"
  if [[ -s "$WORK/mm" ]]; then ok "(AC-O32-9) (TC-20) MUTANT KILLED ${name}: $(head -n 1 "$WORK/mm")"; else bad "(AC-O32-9) (TC-20) mutant survived: ${name}"; fi
}
mutant "VM1 old regex" "$DEF" "^${CLS}-[0-9]{3}(-fix[0-9]+)?\$"
mutant "VM2 uppercase suffix" '[a-z]?' '[A-Za-z]?'
mutant "VM3 several letters" '[a-z]?' '[a-z]*'
mutant "VM4 -fix0 allowed" '-fix[1-9][0-9]*' '-fix[0-9]+'
mutant "VM5 no start anchor" "'^${CLS}" "'${CLS}"
mutant "VM6 echoes the raw value" 'invalid task id (%s)\n'"' \"\$safe\"" 'invalid task id (%s)\n'"' \"\${TASK-}\""
mutant "VM7 no sanitizing" 'safe="${safe//[!A-Za-z0-9._\/-]/?}"' ':'
mutant "VM8 no length cut" 'safe="${safe:0:40}"' ':'
mutant "VM9 fail-open exit" $'>&2\nexit 1' $'>&2\nexit 0'

# ---- TC-16 ~ TC-18: the real Notify step after a failed Validate. ----
awk '
  /^      - name: Notify Grok chief of staff$/ { s = 1; next }
  s && /^      - / { exit }
  s && /^        run: \|$/ { r = 1; next }
  r { if ($0 == "" || $0 ~ /^          /) { sub(/^          /, ""); print } else exit }
' "$WF" > "$WORK/notify.sh"
if grep -q 'claude-task-finished' "$WORK/notify.sh" && grep -q 'run-task-outcome.sh' "$WORK/notify.sh"; then ok "(AC-O32-7) Notify run: extracted ($(wc -l < "$WORK/notify.sh") lines)"; else bad "(AC-O32-7) Notify run: not extracted"; fi
mkdir -p "$WORK/ws/.github" "$WORK/bin" "$WORK/empty"
cp -R "$HERE" "$WORK/ws/.github/scripts"
cat > "$WORK/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_LOG"
cat > "$CURL_LOG.body"
CURL
chmod +x "$WORK/bin/curl"

# notify <dir> <task> <summary outcome> [env...]: runs the extracted step.
notify() {
  local dir="$1" task="$2" sum="$3"; shift 3
  : > "$WORK/curl.log"; rm -f "$WORK/curl.log.body" "$WORK/outcome.json"
  set +e
  (cd "$dir" && env -i PATH="$WORK/bin:$PATH" HOME="$HOME" CURL_LOG="$WORK/curl.log" TASK="$task" \
    TASK_LINT_OUTCOME=skipped CLAUDE_OUTCOME=skipped VERIFY_OUTCOME=skipped VERIFY_REASON= \
    SUMMARY_OUTCOME="$sum" POST_CHECK_OUTCOME=skipped USAGE_LIMIT= UL_RESET_AT= UL_TYPE= UL_STREAK= UL_ACTION= \
    OUTCOME_FILE="$WORK/outcome.json" RUN_URL=https://example.invalid/run/1 \
    WEBHOOK_URL=https://example.invalid/hook WEBHOOK_KEY=dummy-key "$@" bash "$WORK/notify.sh") > "$WORK/n.out" 2>&1
  NEC=$?
  set -e
  NPOST="$(wc -l < "$WORK/curl.log")"
}
# notify_failed_ok <name>: exactly one POST with the AC-O32-7 fields.
notify_failed_ok() {
  local name="$1" task="$2"
  if [[ "$NEC" -eq 0 && "$NPOST" -eq 1 ]] && grep -q -- '-X POST' "$WORK/curl.log" \
     && jq -e --arg t "$task" '.event == "claude-task-finished" and .outcome == "failure" and .claude_outcome == "skipped" and .task == $t' "$WORK/curl.log.body" > /dev/null; then
    ok "${name}: one POST, outcome=failure, claude_outcome=skipped, task escaped"
  else
    bad "${name}: exit=${NEC} posts=${NPOST}"; cat "$WORK/n.out"; if [[ -f "$WORK/curl.log.body" ]]; then cat "$WORK/curl.log.body"; fi
  fi
}
for sum in skipped success failure; do
  for t in $'T-025a\n::error::x' T-025A ''; do
    notify "$WORK/ws" "$t" "$sum"
    notify_failed_ok "(AC-O32-7) (TC-16) Validate failed, summary=${sum}, task=$(printf '%q' "$t")" "$t"
  done
done
notify "$WORK/ws" 'T-025a;id' skipped USAGE_LIMIT=false
notify_failed_ok "(AC-O32-7) (TC-16) Validate failed, usage-limit step said false" 'T-025a;id'

notify "$WORK/ws" T-025a skipped WEBHOOK_URL=
if [[ "$NEC" -eq 0 && "$NPOST" -eq 0 ]] && grep -q 'Webhook not configured, skip.' "$WORK/n.out"; then ok "(AC-O32-7) (TC-17) no WEBHOOK_URL -> exit 0, no POST"; else bad "(AC-O32-7) (TC-17) no WEBHOOK_URL: exit=${NEC} posts=${NPOST}"; cat "$WORK/n.out"; fi
notify "$WORK/empty" T-025a skipped
if [[ "$NEC" -ne 0 && "$NPOST" -eq 0 ]]; then ok "(AC-O32-7) (TC-17) without .github/scripts (no checkout) -> exit ${NEC}, no POST"; else bad "(AC-O32-7) (TC-17) without .github/scripts: exit=${NEC} posts=${NPOST}"; fi

OUT18="$(bash "$HERE/run-task-outcome.sh" --task-lint skipped --post-check skipped --usage-limit '' --json skipped skipped skipped '')"
WORD18="$(bash "$HERE/run-task-outcome.sh" --task-lint skipped --post-check skipped skipped skipped skipped)"
if [[ "$(jq -r '.outcome' <<< "$OUT18")" == failure && "$WORD18" == failure ]]; then ok "(AC-O32-7) (TC-18) all skipped -> failure, not success"; else bad "(AC-O32-7) (TC-18) all skipped gave ${OUT18} / ${WORD18}"; fi
# Mutant NM1: run-task-outcome.sh maps skipped to success; the Notify check must catch it.
cp "$HERE/run-task-outcome.sh" "$WORK/outcome.orig"
src="$(cat "$WORK/outcome.orig")"
mutated="${src/"success | failure | cancelled | skipped) printf '%s' \"\$1\" ;;"/"success | skipped) printf '%s' success ;;
    failure | cancelled) printf '%s' \"\$1\" ;;"}"
if [[ "$mutated" == "$src" ]]; then bad "mutant NM1: anchor not found"; else
  printf '%s\n' "$mutated" > "$WORK/ws/.github/scripts/run-task-outcome.sh"
  notify "$WORK/ws" T-025A skipped
  if [[ "$NPOST" -eq 1 ]] && jq -e '.outcome == "failure"' "$WORK/curl.log.body" > /dev/null; then bad "(AC-O32-9) (TC-18) mutant NM1 survived (skipped counted as success)"; else ok "(AC-O32-9) (TC-18) MUTANT KILLED NM1: skipped as success -> outcome $(jq -r '.outcome' "$WORK/curl.log.body" 2> /dev/null)"; fi
  cp "$WORK/outcome.orig" "$WORK/ws/.github/scripts/run-task-outcome.sh"
fi

if [[ "$FAIL" -ne 0 ]]; then echo "run-task-validate-id-test: FAILED"; exit 1; fi
echo "run-task-validate-id-test: all cases matched"
