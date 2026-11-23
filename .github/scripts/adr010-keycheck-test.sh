#!/usr/bin/env bash
# Local negative tests for ADR-010 key-presence checks (TechLead review of PR #15).
# Not run in CI. Usage: bash .github/scripts/adr010-keycheck-test.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=adr010-keycheck.sh
source "${HERE}/adr010-keycheck.sh"

PROBE_ROOT="$(mktemp -d)"
PRODUCT_ROOT="$(mktemp -d)"
mkdir -p "$PRODUCT_ROOT/supabase"
touch "$PRODUCT_ROOT/supabase/config.toml"
trap 'rm -rf "$PROBE_ROOT" "$PRODUCT_ROOT" "$good" "$secret_false" "$pub_false" "$missing"' EXIT

good="$(mktemp)"
# Exact field order from PR #15 run 45213610756
cat > "$good" <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] o003-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
LOG

secret_false="$(mktemp)"
cat > "$secret_false" <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] o003-env has_supabase_url=true has_publishable=true has_secret=false only_legacy_keys=false
LOG

pub_false="$(mktemp)"
# Real log format: has_publishable is not immediately after 'o003-env '
cat > "$pub_false" <<'LOG'
2026-11-23T16:13:52.612263536Z [Info] o003-env has_supabase_url=true has_publishable=false has_secret=true only_legacy_keys=false
LOG

missing="$(mktemp)"
cat > "$missing" <<'LOG'
Setting up Edge Functions runtime...
Serving functions on http://127.0.0.1:54321/functions/v1/<function-name>
LOG

run_case() {
  local name="$1" log="$2" root="$3"
  echo "===== CASE: ${name} ====="
  set +e
  check_adr010_keys "$log" "$root"
  local ec=$?
  set -e
  echo "exit=${ec}"
  echo
}

run_case "good log (real format from 45213610756) / probe root" "$good" "$PROBE_ROOT"
run_case "(a) has_secret=false must fail" "$secret_false" "$PROBE_ROOT"
run_case "(b) has_publishable=false (real log format, field not adjacent) must fail" "$pub_false" "$PROBE_ROOT"
run_case "(c) missing o003-env in probe mode must fail" "$missing" "$PROBE_ROOT"
run_case "(c') missing o003-env in product mode must also fail (equivalent check required)" "$missing" "$PRODUCT_ROOT"
