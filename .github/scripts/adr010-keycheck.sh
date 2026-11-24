# ADR-010 key-presence checks for the db job (sourced by db-job-verify.sh).
#
# Contract (O-005, product prefix): the function under test (CI probe now,
# product supabase/functions/api after T-003) logs one line per request:
#   [Info] adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false
# The token `adr010-env` must stand alone (whitespace or line edge on both
# sides). Only presence booleans are logged, never key values (ADR-010).
#
# Fail-closed (charter v5 §5 / O-004 B1):
#   - at least one adr010-env line must carry all four fields with exactly
#     these values, and
#   - every adr010-env line must have all four fields, once each, non-empty,
#     with exactly those values.
# Missing, empty, malformed, unexpected, duplicate, or conflicting values fail.
# Logs that only contain the retired O-003 prefix (`o003-env`) fail as well,
# so a stale probe or product function cannot pass silently.

ADR010_PREFIX="adr010-env"
ADR010_LEGACY_PREFIX="o003-env"
ADR010_FIELDS=(has_supabase_url has_publishable has_secret only_legacy_keys)
ADR010_VALUES=(true true true false)
# Whole-token match: prefix preceded and followed by whitespace or line edge.
ADR010_LINE_RE="(^|[[:space:]])${ADR010_PREFIX}([[:space:]]|$)"
ADR010_LEGACY_RE="(^|[[:space:]])${ADR010_LEGACY_PREFIX}([[:space:]]|$)"

# Print an error on stdout and return 1 if the line is invalid; return 0 if valid.
adr010_validate_env_line() {
  local line="$1"
  local i name want count val matches
  for i in 0 1 2 3; do
    name="${ADR010_FIELDS[$i]}"
    want="${ADR010_VALUES[$i]}"
    # o004-allow: grep exits 1 when a field is absent; absence is counted as 0 and fails below, never passes.
    matches="$(grep -oE "(^|[[:space:]])${name}=" <<<"$line" || true)"
    if [[ -z "$matches" ]]; then
      count=0
    else
      count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
    fi
    if [[ "$count" -eq 0 ]]; then
      echo "${ADR010_PREFIX} line missing field ${name}"
      return 1
    fi
    if [[ "$count" -gt 1 ]]; then
      echo "${ADR010_PREFIX} line has duplicate field ${name}"
      return 1
    fi
    val=""
    if [[ "$line" =~ (^|[[:space:]])${name}=([^[:space:]]*) ]]; then
      val="${BASH_REMATCH[2]}"
    fi
    if [[ -z "$val" ]]; then
      echo "${ADR010_PREFIX} line has empty value for ${name}"
      return 1
    fi
    if [[ "$val" != "$want" ]]; then
      echo "${ADR010_PREFIX} line has invalid ${name}=${val} (required ${name}=${want})"
      return 1
    fi
  done
  return 0
}

check_adr010_keys() {
  local serve_log="$1"
  local repo_root="$2"

  echo "== ADR-010: injected key names (presence only, prefix ${ADR010_PREFIX}) =="
  if [[ ! -f "$serve_log" ]]; then
    echo "ERROR: serve log not found: ${serve_log}"
    return 1
  fi
  if ! grep -qE "$ADR010_LINE_RE" "$serve_log"; then
    if grep -qE "$ADR010_LEGACY_RE" "$serve_log"; then
      echo "ERROR: serve log only has the retired ${ADR010_LEGACY_PREFIX} prefix; the function must log '${ADR010_PREFIX} has_supabase_url=… has_publishable=… has_secret=… only_legacy_keys=…' (O-005)."
    elif [[ -f "${repo_root}/supabase/config.toml" ]]; then
      echo "ERROR: no ${ADR010_PREFIX} lines in serve log. After T-003 the product api function must log '${ADR010_PREFIX} has_supabase_url=… has_publishable=… has_secret=… only_legacy_keys=…' (names/booleans only, ADR-010)."
    else
      echo "ERROR: did not find ${ADR010_PREFIX} lines in serve log (required while the CI probe is in use)."
    fi
    return 1
  fi
  grep -E "$ADR010_LINE_RE" "$serve_log" | tail -n 3

  local line err
  local field_errors=0
  local good_lines=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ $ADR010_LINE_RE ]] || continue
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
    echo "ERROR: no ${ADR010_PREFIX} line contained all four required fields with exact values (has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false)."
    return 1
  fi
  echo "Key-name check passed (${good_lines} ${ADR010_PREFIX} line(s))."
  return 0
}
