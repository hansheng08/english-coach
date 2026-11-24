#!/usr/bin/env bash
# Negative and positive tests for ADR-010 key-presence checks.
# Run in CI by the pushguard job. Usage: bash .github/scripts/adr010-keycheck-test.sh
# Each case asserts an exact expected exit code; any mismatch fails this script.
# O-005: prefix is adr010-env; the retired o003-env prefix alone must fail.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=adr010-keycheck.sh
source "${HERE}/adr010-keycheck.sh"

PROBE_ROOT="$(mktemp -d)"
PRODUCT_ROOT="$(mktemp -d)"
mkdir -p "$PRODUCT_ROOT/supabase"
touch "$PRODUCT_ROOT/supabase/config.toml"
LOGS=()
cleanup() {
  rm -rf "$PROBE_ROOT" "$PRODUCT_ROOT"
  local f
  for f in "${LOGS[@]+"${LOGS[@]}"}"; do
    rm -f "$f"
  done
}
trap cleanup EXIT

mklog() {
  local f
  f="$(mktemp)"
  cat > "$f"
  LOGS+=("$f")
  printf '%s' "$f"
}

FAIL=0

run_case() {
  local name="$1" log="$2" root="$3" expected="$4"
  echo "===== CASE: ${name} ====="
  set +e
  check_adr010_keys "$log" "$root"
  local ec=$?
  set -e
  echo "exit=${ec} (expected ${expected})"
  if [[ "$ec" -ne "$expected" ]]; then
    echo "ERROR: expected exit ${expected}, got ${ec}"
    FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

good="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
LOG
)"

secret_false="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=false only_legacy_keys=false
LOG
)"

pub_false="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=false has_secret=true only_legacy_keys=false
LOG
)"

missing="$(mklog <<'LOG'
Setting up Edge Functions runtime...
Serving functions on http://127.0.0.1:54321/functions/v1/<function-name>
LOG
)"

only_url="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true
LOG
)"

missing_secret="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true only_legacy_keys=false
LOG
)"

missing_pub="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_secret=true only_legacy_keys=false
LOG
)"

empty_secret="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret= only_legacy_keys=false
LOG
)"

maybe_secret="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=maybe only_legacy_keys=false
LOG
)"

false_capital="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=False only_legacy_keys=false
LOG
)"

legacy_true="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=true
LOG
)"

url_false="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=false has_publishable=true has_secret=true only_legacy_keys=false
LOG
)"

conflict="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
2026-11-23T16:13:53.000000000Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=false only_legacy_keys=false
LOG
)"

dup_field="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true has_secret=false only_legacy_keys=false
LOG
)"

two_good="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
2026-11-23T16:13:53.000000000Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
LOG
)"

legacy_only="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] o003-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
LOG
)"

legacy_plus_good="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] o003-env has_supabase_url=true has_publishable=true has_secret=false only_legacy_keys=false
2026-11-23T16:13:53.000000000Z [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
LOG
)"

prefix_suffixed="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] adr010-envx has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
LOG
)"

prefix_embedded="$(mklog <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] xadr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
LOG
)"

run_case "good log (format of 45213610756, prefix adr010-env) / probe root" "$good" "$PROBE_ROOT" 0
run_case "(a) has_secret=false must fail" "$secret_false" "$PROBE_ROOT" 1
run_case "(b) has_publishable=false (real log format, field not adjacent) must fail" "$pub_false" "$PROBE_ROOT" 1
run_case "(c) missing adr010-env in probe mode must fail" "$missing" "$PROBE_ROOT" 1
run_case "(c') missing adr010-env in product mode must also fail (equivalent check required)" "$missing" "$PRODUCT_ROOT" 1
run_case "(d) only has_supabase_url=true (other fields missing) must fail" "$only_url" "$PROBE_ROOT" 1
run_case "(e) missing has_secret must fail" "$missing_secret" "$PROBE_ROOT" 1
run_case "(f) missing has_publishable must fail" "$missing_pub" "$PROBE_ROOT" 1
run_case "(g) empty has_secret= must fail" "$empty_secret" "$PROBE_ROOT" 1
run_case "(h) invalid has_secret=maybe must fail" "$maybe_secret" "$PROBE_ROOT" 1
run_case "(i) invalid has_secret=False (wrong case) must fail" "$false_capital" "$PROBE_ROOT" 1
run_case "(j) only_legacy_keys=true must fail" "$legacy_true" "$PROBE_ROOT" 1
run_case "(k) has_supabase_url=false must fail" "$url_false" "$PROBE_ROOT" 1
run_case "(l) conflicting adr010-env lines (good then has_secret=false) must fail" "$conflict" "$PROBE_ROOT" 1
run_case "(m) duplicate has_secret on one line must fail" "$dup_field" "$PROBE_ROOT" 1
run_case "(n) two complete correct adr010-env lines must pass" "$two_good" "$PROBE_ROOT" 0
run_case "(o) good adr010-env line in product mode must pass" "$good" "$PRODUCT_ROOT" 0
run_case "(p) only retired o003-env line (no adr010-env) must fail" "$legacy_only" "$PROBE_ROOT" 1
run_case "(p') only retired o003-env line in product mode must fail" "$legacy_only" "$PRODUCT_ROOT" 1
run_case "(q) retired o003-env lines are ignored when a valid adr010-env line exists" "$legacy_plus_good" "$PROBE_ROOT" 0
run_case "(r) adr010-envx (prefix not a whole token) must fail" "$prefix_suffixed" "$PROBE_ROOT" 1
run_case "(s) xadr010-env (prefix not a whole token) must fail" "$prefix_embedded" "$PROBE_ROOT" 1
run_case "(t) missing serve log file must fail" "${PROBE_ROOT}/no-such-serve.log" "$PROBE_ROOT" 1

if [[ "$FAIL" -ne 0 ]]; then
  echo "adr010-keycheck-test: FAILED (one or more cases did not match the expected exit code)"
  exit 1
fi
echo "adr010-keycheck-test: all cases matched expected exit codes"
exit 0
