# Local Auth checks for the db job (sourced by db-job-verify.sh; tested by
# db-auth-check-test.sh in the CI pushguard job).
#
# O-005 / Q-26 plan B: signups are off (`[auth] enable_signup = false`, Q-01,
# ARCHITECTURE §7). The db job proves that on the running stack and gets a
# user JWT through the local Auth Admin API instead of POST /auth/v1/signup.
#
# Every function is fail-closed: it returns 1 with an ERROR line on any
# unexpected HTTP code, missing field, non-JSON body, or malformed value.
# No function prints a key, password, or token value; bodies are summarized
# by field names / error codes only.

# Require a non-empty variable by name without printing its value.
db_auth_require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: ${name} missing or empty (value never printed)."
    return 1
  fi
  echo "${name} is set (value not printed)."
  return 0
}

# GET /auth/v1/settings must be HTTP 200 with "disable_signup": true.
db_auth_check_settings_signup_disabled() {
  local code="$1" body="$2"
  echo "auth settings HTTP ${code}"
  if [[ "$code" != "200" ]]; then
    echo "ERROR: GET /auth/v1/settings expected HTTP 200, got ${code}."
    return 1
  fi
  if ! jq -e 'type == "object" and .disable_signup == true' "$body" >/dev/null 2>&1; then
    echo "ERROR: /auth/v1/settings does not report disable_signup=true (enable_signup must be false; Q-01 / Q-26 plan B)."
    return 1
  fi
  echo "GET /auth/v1/settings reports disable_signup = true"
  return 0
}

# POST /auth/v1/signup must be rejected: HTTP 400/403/422 and
# error_code=signup_disabled (or the GoTrue "Signups not allowed" message).
db_auth_check_signup_rejected() {
  local code="$1" body="$2"
  local summary
  summary="$(jq -r 'if type == "object" then "error_code=\(.error_code // "none") msg=\(.msg // .message // .error_description // "none")" else "non-object body" end' "$body" 2>/dev/null)"
  echo "signup HTTP ${code} ${summary:-non-JSON body}"
  if [[ ! "$code" =~ ^(400|403|422)$ ]]; then
    echo "ERROR: signup was not rejected (expected HTTP 400/403/422, got ${code}); enable_signup = false is not active."
    return 1
  fi
  if jq -e 'type == "object" and ((.access_token // .session.access_token // "") != "")' "$body" >/dev/null 2>&1; then
    echo "ERROR: signup response carries an access_token despite HTTP ${code}."
    return 1
  fi
  if ! jq -e 'type == "object" and (.error_code == "signup_disabled" or ((.msg // .message // .error_description // "") | test("[Ss]ignups not allowed")))' "$body" >/dev/null 2>&1; then
    echo "ERROR: signup rejected with HTTP ${code} but not for signup_disabled; cannot prove enable_signup = false."
    return 1
  fi
  echo "signup rejected: signup_disabled (enable_signup = false is active)"
  return 0
}

# POST /auth/v1/admin/users (email_confirm: true) must be HTTP 200/201 with a
# non-empty id, the requested email, and a non-null email_confirmed_at.
db_auth_check_admin_user_created() {
  local code="$1" body="$2" email="$3"
  echo "admin create user HTTP ${code}"
  if [[ ! "$code" =~ ^(200|201)$ ]]; then
    local errsum
    errsum="$(jq -r 'if type == "object" then "error_code=\(.error_code // "none") msg=\(.msg // .message // "none")" else "non-object body" end' "$body" 2>/dev/null)"
    echo "ERROR: Auth Admin API did not create the test user (HTTP ${code}; ${errsum:-non-JSON body})."
    return 1
  fi
  if ! jq -e --arg email "$email" 'type == "object"
      and ((.id // "") | type == "string" and length > 0)
      and ((.email // "") | ascii_downcase) == ($email | ascii_downcase)
      and (.email_confirmed_at // null) != null' "$body" >/dev/null 2>&1; then
    echo "ERROR: Auth Admin API response lacks id / matching email / email_confirmed_at. Keys: $(jq -r 'if type == "object" then keys | join(",") else "non-object" end' "$body" 2>/dev/null)"
    return 1
  fi
  echo "admin user created and confirmed (id/email not printed)."
  return 0
}

# POST /auth/v1/token?grant_type=password must be HTTP 200 with
# token_type=bearer and a JWT-shaped access_token. Stores the token in the
# variable named by $3 (bash nameref); never prints it.
db_auth_extract_access_token() {
  local code="$1" body="$2"
  local -n __db_auth_out="$3"
  __db_auth_out=""
  echo "password sign-in HTTP ${code}"
  if [[ "$code" != "200" ]]; then
    local errsum
    errsum="$(jq -r 'if type == "object" then "error_code=\(.error_code // "none") msg=\(.msg // .message // .error_description // "none")" else "non-object body" end' "$body" 2>/dev/null)"
    echo "ERROR: password sign-in failed (HTTP ${code}; ${errsum:-non-JSON body})."
    return 1
  fi
  if ! jq -e 'type == "object" and ((.token_type // "") | ascii_downcase) == "bearer"' "$body" >/dev/null 2>&1; then
    echo "ERROR: sign-in response token_type is not bearer."
    return 1
  fi
  local __db_auth_tok
  __db_auth_tok="$(jq -r 'if type == "object" then (.access_token // "") else "" end' "$body" 2>/dev/null)"
  if [[ -z "$__db_auth_tok" || "$__db_auth_tok" == "null" ]]; then
    echo "ERROR: sign-in response has no access_token."
    return 1
  fi
  if [[ ! "$__db_auth_tok" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: access_token is not JWT-shaped (three base64url parts); value not printed."
    return 1
  fi
  __db_auth_out="$__db_auth_tok"
  echo "Got user access_token (value not printed)."
  return 0
}

# Decode the JWT header/payload on the host and require role=authenticated,
# a non-empty sub, and is_anonymous not true. Prints claim names/types only.
db_auth_check_user_jwt_claims() {
  local token="$1"
  if [[ -z "$token" ]]; then
    echo "ERROR: empty user token."
    return 1
  fi
  DB_AUTH_TOKEN="$token" python3 - <<'JWTPY'
import base64, json, os, sys
tok = os.environ.get("DB_AUTH_TOKEN") or ""
parts = tok.split(".")
if len(parts) != 3:
    print(f"ERROR: user JWT has {len(parts)} parts (expected 3).")
    sys.exit(1)

def dec(x):
    pad = "=" * ((4 - len(x) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(x + pad))

try:
    header = dec(parts[0])
    payload = dec(parts[1])
except Exception as exc:
    print(f"ERROR: user JWT decode error type={type(exc).__name__}")
    sys.exit(1)
if not isinstance(header, dict) or not isinstance(payload, dict):
    print("ERROR: user JWT header/payload is not a JSON object.")
    sys.exit(1)
role = payload.get("role")
sub = payload.get("sub")
anon = payload.get("is_anonymous")
print("user JWT: alg=" + str(header.get("alg")), "has_kid=" + str(bool(header.get("kid"))),
      "role=" + str(role), "has_sub=" + str(bool(sub)), "is_anonymous=" + str(anon))
if role != "authenticated":
    print("ERROR: user JWT role is not authenticated.")
    sys.exit(1)
if not isinstance(sub, str) or not sub:
    print("ERROR: user JWT has no sub.")
    sys.exit(1)
if anon is True:
    print("ERROR: user JWT is anonymous.")
    sys.exit(1)
sys.exit(0)
JWTPY
}
