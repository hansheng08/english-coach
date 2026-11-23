# ADR-010 key-presence checks for the db job (sourced by db-job-verify.sh).
# Log format from PR #15 run 45213610756:
#   [Info] o003-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
# Patterns must use 'o003-env .*field=' so fields after the first still match.

check_adr010_keys() {
  local serve_log="$1"
  local repo_root="$2"

  echo "== ADR-010: injected key names (presence only) =="
  if ! grep -q 'o003-env has_supabase_url=' "$serve_log"; then
    if [[ -f "${repo_root}/supabase/config.toml" ]]; then
      echo "ERROR: no o003-env (or equivalent product key-presence) lines in serve log. After T-003, product functions must emit an equivalent check that SUPABASE_URL and publishable/secret keys are present (ADR-010); do not rely on the CI probe's o003-env lines."
    else
      echo "ERROR: did not find o003-env lines in serve log (required while the CI probe is in use)."
    fi
    return 1
  fi
  grep 'o003-env has_supabase_url=' "$serve_log" | tail -n 3 || true

  if grep -q 'o003-env .*only_legacy_keys=true' "$serve_log"; then
    echo "ERROR: CLI injected only legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Per ADR-010, stop and report to Architect; do not teach product code those names."
    return 1
  fi
  if grep -q 'o003-env .*has_publishable=false' "$serve_log"; then
    echo "ERROR: publishable key not present in function env (ADR-010)."
    return 1
  fi
  if grep -q 'o003-env .*has_supabase_url=false' "$serve_log"; then
    echo "ERROR: SUPABASE_URL not present in function env (ADR-010)."
    return 1
  fi
  if grep -q 'o003-env .*has_secret=false' "$serve_log"; then
    echo "ERROR: secret key not present in function env (ADR-010)."
    return 1
  fi
  echo "Key-name check passed."
  return 0
}
