# ADR-010 key-presence checks for the db job (sourced by db-job-verify.sh).
# Log format from PR #15 run 45213610756:
#   [Info] o003-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
#
# Fail-closed (charter v5 §5 / O-004 B1): at least one o003-env line must
# contain all four fields with these exact values, and every o003-env line
# must have all four fields, non-empty, with those exact values. Missing,
# empty, malformed, unexpected, duplicate, or conflicting values fail.

ADR010_FIELDS=(has_supabase_url has_publishable has_secret only_legacy_keys)
ADR010_VALUES=(true true true false)

# Print an error on stdout and return 1 if the line is invalid; return 0 if valid.
adr010_validate_env_line() {
  local line="$1"
  local i name want count val
  for i in 0 1 2 3; do
    name="${ADR010_FIELDS[$i]}"
    want="${ADR010_VALUES[$i]}"
    # grep exit 1 (no match) must not abort under pipefail; count only.
    # o004-allow: grep has no-match exit 1 when a field is absent; that absence is a failure below, not a pass.
    matches="$(grep -oE "(^|[[:space:]])${name}=" <<<"$line" || true)"
    if [[ -z "$matches" ]]; then
      count=0
    else
      count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
    fi
    if [[ "$count" -eq 0 ]]; then
      echo "o003-env line missing field ${name}"
      return 1
    fi
    if [[ "$count" -gt 1 ]]; then
      echo "o003-env line has duplicate field ${name}"
      return 1
    fi
    val=""
    if [[ "$line" =~ (^|[[:space:]])${name}=([^[:space:]]*) ]]; then
      val="${BASH_REMATCH[2]}"
    fi
    if [[ -z "$val" ]]; then
      echo "o003-env line has empty value for ${name}"
      return 1
    fi
    if [[ "$val" != "$want" ]]; then
      echo "o003-env line has invalid ${name}=${val} (required ${name}=${want})"
      return 1
    fi
  done
  return 0
}

check_adr010_keys() {
  local serve_log="$1"
  local repo_root="$2"

  echo "== ADR-010: injected key names (presence only) =="
  if ! grep -q 'o003-env' "$serve_log"; then
    if [[ -f "${repo_root}/supabase/config.toml" ]]; then
      echo "ERROR: no o003-env (or equivalent product key-presence) lines in serve log. After T-003, product functions must emit an equivalent check that SUPABASE_URL and publishable/secret keys are present (ADR-010); do not rely on the CI probe's o003-env lines."
    else
      echo "ERROR: did not find o003-env lines in serve log (required while the CI probe is in use)."
    fi
    return 1
  fi
  grep 'o003-env' "$serve_log" | tail -n 3 || true  # o004-allow: diagnostic reprint of log lines only; validation below is fail-closed

  local line err
  local field_errors=0
  local good_lines=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *o003-env* ]] || continue
    if err="$(adr010_validate_env_line "$line")"; then
      good_lines=$((good_lines + 1))
    else
      echo "ERROR: ${err}"
      echo "  line: ${line}"
      field_errors=1
    fi
  done < "$serve_log"

  if [[ "$field_errors" -ne 0 ]]; then
    return 1
  fi
  if [[ "$good_lines" -lt 1 ]]; then
    echo "ERROR: no o003-env line contained all four required fields with exact values (has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false)."
    return 1
  fi
  echo "Key-name check passed."
  return 0
}
