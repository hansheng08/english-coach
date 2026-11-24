#!/usr/bin/env bash
# Negative and positive tests for db-auth-check.sh (O-005 / Q-26 plan B).
# Run in CI by the pushguard job. Usage: bash .github/scripts/db-auth-check-test.sh
# Each case asserts an exact expected exit code; any mismatch fails this script.
# Fake tokens are generated at runtime (not real credentials) and the script
# also asserts that no fake token / secret value ever appears in the output.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=db-auth-check.sh
source "${HERE}/db-auth-check.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ALL_OUT="${TMP}/all-output.txt"
: > "$ALL_OUT"
FAIL=0

b64url() { printf '%s' "$1" | base64 | tr -d '=\n' | tr '+/' '-_'; }
mkjwt() { printf '%s.%s.%s' "$(b64url "$1")" "$(b64url "$2")" "$(b64url "fake-signature-$RANDOM")"; }

GOOD_JWT="$(mkjwt '{"alg":"ES256","kid":"test-kid","typ":"JWT"}' '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","is_anonymous":false}')"
ANON_ROLE_JWT="$(mkjwt '{"alg":"ES256","kid":"test-kid"}' '{"role":"anon","sub":"x"}')"
NO_SUB_JWT="$(mkjwt '{"alg":"ES256","kid":"test-kid"}' '{"role":"authenticated"}')"
ANONYMOUS_JWT="$(mkjwt '{"alg":"ES256","kid":"test-kid"}' '{"role":"authenticated","sub":"x","is_anonymous":true}')"
TWO_PART_JWT="$(b64url '{"alg":"ES256"}').$(b64url '{"role":"authenticated","sub":"x"}')"
GARBAGE_JWT="not_base64.###.sig"
FAKE_SECRET="fake-secret-value-$RANDOM-$RANDOM"

body() {
  local f="${TMP}/body-$RANDOM-$RANDOM.json"
  cat > "$f"
  printf '%s' "$f"
}

# run_case <name> <expected exit> <command...>
run_case() {
  local name="$1" expected="$2"
  shift 2
  echo "===== CASE: ${name} =====" | tee -a "$ALL_OUT"
  local out="${TMP}/case.out" ec
  set +e
  "$@" >"$out" 2>&1
  ec=$?
  set -e
  cat "$out" | tee -a "$ALL_OUT"
  echo "exit=${ec} (expected ${expected})" | tee -a "$ALL_OUT"
  if [[ "$ec" -ne "$expected" ]]; then
    echo "ERROR: expected exit ${expected}, got ${ec}" | tee -a "$ALL_OUT"
    FAIL=1
  else
    echo "CASE OK"
  fi
  echo
}

# --- settings: disable_signup -------------------------------------------------
run_case "settings 200 disable_signup=true passes" 0 db_auth_check_settings_signup_disabled 200 "$(body <<<'{"disable_signup":true,"mailer_autoconfirm":true}')"
run_case "settings 200 disable_signup=false must fail (enable_signup=true)" 1 db_auth_check_settings_signup_disabled 200 "$(body <<<'{"disable_signup":false}')"
run_case "settings 200 without disable_signup must fail" 1 db_auth_check_settings_signup_disabled 200 "$(body <<<'{"external":{}}')"
run_case "settings 200 disable_signup=\"true\" (string) must fail" 1 db_auth_check_settings_signup_disabled 200 "$(body <<<'{"disable_signup":"true"}')"
run_case "settings 500 must fail" 1 db_auth_check_settings_signup_disabled 500 "$(body <<<'{"disable_signup":true}')"
run_case "settings non-JSON body must fail" 1 db_auth_check_settings_signup_disabled 200 "$(body <<<'<html>bad gateway</html>')"

# --- signup must be rejected ---------------------------------------------------
run_case "signup 422 signup_disabled passes" 0 db_auth_check_signup_rejected 422 "$(body <<<'{"code":422,"error_code":"signup_disabled","msg":"Signups not allowed for this instance"}')"
run_case "signup 422 message-only 'Signups not allowed' passes" 0 db_auth_check_signup_rejected 422 "$(body <<<'{"msg":"Signups not allowed for this instance"}')"
run_case "signup 200 (signup open) must fail" 1 db_auth_check_signup_rejected 200 "$(body <<<'{"id":"u1","email":"a@example.com"}')"
run_case "signup 200 even with error_code signup_disabled must fail (status must be 4xx)" 1 db_auth_check_signup_rejected 200 "$(body <<<'{"error_code":"signup_disabled","msg":"Signups not allowed for this instance"}')"
run_case "signup 422 but other error_code (weak_password) must fail" 1 db_auth_check_signup_rejected 422 "$(body <<<'{"code":422,"error_code":"weak_password","msg":"Password should be at least 6 characters"}')"
run_case "signup 422 signup_disabled but carries access_token must fail" 1 db_auth_check_signup_rejected 422 "$(body <<<"{\"error_code\":\"signup_disabled\",\"access_token\":\"${GOOD_JWT}\"}")"
run_case "signup 429 rate limited must fail" 1 db_auth_check_signup_rejected 429 "$(body <<<'{"error_code":"over_request_rate_limit"}')"
run_case "signup 500 must fail" 1 db_auth_check_signup_rejected 500 "$(body <<<'{"error_code":"unexpected_failure"}')"
run_case "signup 422 non-JSON body must fail" 1 db_auth_check_signup_rejected 422 "$(body <<<'upstream error')"

# --- Auth Admin API user creation ----------------------------------------------
EMAIL="adr010-ci-test@example.com"
run_case "admin create 200 confirmed passes" 0 db_auth_check_admin_user_created 200 "$(body <<<'{"id":"u1","email":"adr010-ci-test@example.com","email_confirmed_at":"2026-11-24T00:00:00Z","role":"authenticated"}')" "$EMAIL"
run_case "admin create 201 confirmed passes" 0 db_auth_check_admin_user_created 201 "$(body <<<'{"id":"u1","email":"ADR010-CI-TEST@example.com","email_confirmed_at":"2026-11-24T00:00:00Z"}')" "$EMAIL"
run_case "admin create 401 (no/invalid secret key) must fail" 1 db_auth_check_admin_user_created 401 "$(body <<<'{"code":401,"error_code":"no_authorization","msg":"This endpoint requires a valid Bearer token"}')" "$EMAIL"
run_case "admin create 403 not_admin must fail" 1 db_auth_check_admin_user_created 403 "$(body <<<'{"code":403,"error_code":"not_admin","msg":"User not allowed"}')" "$EMAIL"
run_case "admin create 422 email_exists must fail" 1 db_auth_check_admin_user_created 422 "$(body <<<'{"code":422,"error_code":"email_exists"}')" "$EMAIL"
run_case "admin create 200 without email_confirmed_at must fail" 1 db_auth_check_admin_user_created 200 "$(body <<<'{"id":"u1","email":"adr010-ci-test@example.com","email_confirmed_at":null}')" "$EMAIL"
run_case "admin create 200 with other email must fail" 1 db_auth_check_admin_user_created 200 "$(body <<<'{"id":"u1","email":"someone@example.com","email_confirmed_at":"2026-11-24T00:00:00Z"}')" "$EMAIL"
run_case "admin create 200 with empty id must fail" 1 db_auth_check_admin_user_created 200 "$(body <<<'{"id":"","email":"adr010-ci-test@example.com","email_confirmed_at":"2026-11-24T00:00:00Z"}')" "$EMAIL"
run_case "admin create 500 with a valid-looking user body must fail" 1 db_auth_check_admin_user_created 500 "$(body <<<'{"id":"u1","email":"adr010-ci-test@example.com","email_confirmed_at":"2026-11-24T00:00:00Z"}')" "$EMAIL"
run_case "admin create 200 non-JSON must fail" 1 db_auth_check_admin_user_created 200 "$(body <<<'ok')" "$EMAIL"

# --- password sign-in / access_token extraction ---------------------------------
extract_and_compare() {
  local code="$1" bodyf="$2" want="$3"
  local USER_TOKEN="preset"
  local ec=0
  db_auth_extract_access_token "$code" "$bodyf" USER_TOKEN || ec=$?  # o004-allow: test harness captures the exit code and re-checks it below
  if [[ "$ec" -eq 0 && "$USER_TOKEN" != "$want" ]]; then
    echo "ERROR: extracted token does not match fixture (value not printed)"
    return 3
  fi
  if [[ "$ec" -ne 0 && -n "$USER_TOKEN" ]]; then
    echo "ERROR: token variable not cleared on failure"
    return 4
  fi
  return "$ec"
}
run_case "token 200 bearer JWT passes and is stored" 0 extract_and_compare 200 "$(body <<<"{\"access_token\":\"${GOOD_JWT}\",\"token_type\":\"bearer\",\"expires_in\":3600}")" "$GOOD_JWT"
run_case "token 400 invalid_credentials must fail" 1 extract_and_compare 400 "$(body <<<'{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}')" ""
run_case "token 200 without access_token must fail" 1 extract_and_compare 200 "$(body <<<'{"token_type":"bearer"}')" ""
run_case "token 200 access_token null must fail" 1 extract_and_compare 200 "$(body <<<'{"access_token":null,"token_type":"bearer"}')" ""
run_case "token 200 access_token empty must fail" 1 extract_and_compare 200 "$(body <<<'{"access_token":"","token_type":"bearer"}')" ""
run_case "token 200 access_token not JWT-shaped must fail" 1 extract_and_compare 200 "$(body <<<"{\"access_token\":\"${FAKE_SECRET}\",\"token_type\":\"bearer\"}")" ""
run_case "token 200 two-part access_token must fail" 1 extract_and_compare 200 "$(body <<<"{\"access_token\":\"${TWO_PART_JWT}\",\"token_type\":\"bearer\"}")" ""
run_case "token 200 without token_type bearer must fail" 1 extract_and_compare 200 "$(body <<<"{\"access_token\":\"${GOOD_JWT}\"}")" ""
run_case "token 500 with a valid-looking token body must fail" 1 extract_and_compare 500 "$(body <<<"{\"access_token\":\"${GOOD_JWT}\",\"token_type\":\"bearer\"}")" ""
run_case "token 200 non-JSON must fail" 1 extract_and_compare 200 "$(body <<<'<html>')" ""

# --- JWT claims ------------------------------------------------------------------
run_case "claims role=authenticated with sub passes" 0 db_auth_check_user_jwt_claims "$GOOD_JWT"
run_case "claims role=anon must fail" 1 db_auth_check_user_jwt_claims "$ANON_ROLE_JWT"
run_case "claims without sub must fail" 1 db_auth_check_user_jwt_claims "$NO_SUB_JWT"
run_case "claims is_anonymous=true must fail" 1 db_auth_check_user_jwt_claims "$ANONYMOUS_JWT"
run_case "claims two-part token must fail" 1 db_auth_check_user_jwt_claims "$TWO_PART_JWT"
run_case "claims undecodable token must fail" 1 db_auth_check_user_jwt_claims "$GARBAGE_JWT"
run_case "claims empty token must fail" 1 db_auth_check_user_jwt_claims ""

# --- required variables ------------------------------------------------------------
export DB_AUTH_TEST_SET="$FAKE_SECRET"
export DB_AUTH_TEST_EMPTY=""
unset DB_AUTH_TEST_UNSET
run_case "require_var set passes (value not printed)" 0 db_auth_require_var DB_AUTH_TEST_SET
run_case "require_var empty must fail" 1 db_auth_require_var DB_AUTH_TEST_EMPTY
run_case "require_var unset must fail" 1 db_auth_require_var DB_AUTH_TEST_UNSET

# --- no secret leakage in any output -------------------------------------------------
echo "===== CASE: no fake token or secret value appears in any output ====="
leak=0
for v in "$GOOD_JWT" "$ANON_ROLE_JWT" "$NO_SUB_JWT" "$ANONYMOUS_JWT" "$TWO_PART_JWT" "$FAKE_SECRET"; do
  if grep -qF -- "$v" "$ALL_OUT"; then
    leak=1
  fi
done
if [[ "$leak" -ne 0 ]]; then
  echo "ERROR: a token or secret value was printed"
  FAIL=1
else
  echo "exit=0 (expected 0)"
  echo "CASE OK"
fi
echo

if [[ "$FAIL" -ne 0 ]]; then
  echo "db-auth-check-test: FAILED (one or more cases did not match the expected exit code)"
  exit 1
fi
echo "db-auth-check-test: all cases matched expected exit codes"
exit 0
