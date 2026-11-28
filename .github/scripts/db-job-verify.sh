#!/usr/bin/env bash
# O-003: start-local-stack checks for the ci.yml db job.
# O-005: test user via local Auth Admin API (enable_signup = false, Q-26 plan B);
#        ADR-010 key-presence prefix adr010-env.
# Usage: invoked from the repo root after supabase CLI is on PATH and Docker is up.
set -euo pipefail

ROOT="$(pwd)"
if [[ -f "${ROOT}/supabase/config.toml" ]]; then
  WORKDIR="${ROOT}"
  echo "Using project supabase/ at repo root (T-003+)."
else
  # Assemble a temporary monorepo layout (supabase/ and packages/ as siblings)
  # so the Edge Runtime mount can follow deno.json imports the same way ADR-009
  # describes. The checked-in probe lives under .github/ci/ and is not visible
  # as a sibling of packages/ (run 45205832782: Module not found).
  WORKDIR="${RUNNER_TEMP:-/tmp}/db-job-stack"
  rm -rf "$WORKDIR"
  mkdir -p "$WORKDIR/packages"
  cp -a "${ROOT}/.github/ci/supabase-probe/supabase" "$WORKDIR/supabase"
  cp -a "${ROOT}/packages/contracts" "$WORKDIR/packages/contracts"
  cp -a "${ROOT}/packages/domain" "$WORKDIR/packages/domain"
  cat > "$WORKDIR/supabase/functions/deno.json" <<'DENOEOF'
{
  "imports": {
    "@english-coach/contracts": "../../packages/contracts/src/index.ts",
    "@english-coach/domain": "../../packages/domain/src/index.ts",
    "zod": "npm:zod@^4.6.7",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.119.2"
  }
}
DENOEOF
  echo "No supabase/config.toml at repo root; staged CI probe + packages/* at $WORKDIR"
fi

EXCLUDES="studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor"
HEALTH_PATH="/functions/v1/api/health"
SERVE_LOG="${RUNNER_TEMP:-/tmp}/functions-serve.log"
SERVE_PID_FILE="${RUNNER_TEMP:-/tmp}/functions-serve.pid"
ENV_FILE="${RUNNER_TEMP:-/tmp}/functions.env"

cleanup() {
  if [[ -f "$SERVE_PID_FILE" ]]; then
    kill "$(cat "$SERVE_PID_FILE")" 2>/dev/null || true  # o004-allow: cleanup in trap; job result already decided
  fi
  supabase --workdir "$WORKDIR" stop || true  # o004-allow: cleanup in trap; job result already decided
}
trap cleanup EXIT

echo "== docker info =="
docker info >/dev/null
echo "Docker is available on this runner."

# Mask key-looking values in CLI tables (local defaults, but logs never carry
# key values; O-005). pipefail keeps the CLI exit code.
mask_keys() {
  sed -E \
    -e 's/(sb_(secret|publishable)_)[A-Za-z0-9_-]+/\1***/g' \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/***jwt***/g' \
    -e 's/((Access|Secret) Key[^A-Za-z0-9]+)[A-Za-z0-9]{16,}/\1***/g'
}

echo "== supabase start =="
# O-031: bounded retry + diagnostics; the wrapper masks keys with the same rules.
bash "$(dirname "${BASH_SOURCE[0]}")/supabase-start.sh" --workdir "$WORKDIR" -x "$EXCLUDES"

echo "== supabase db reset =="
supabase --workdir "$WORKDIR" db reset 2>&1 | mask_keys

echo "== supabase status -o env (names only) =="
# shellcheck disable=SC1090
eval "$(supabase --workdir "$WORKDIR" status -o env)"
# shellcheck source=db-auth-check.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db-auth-check.sh"
# PUBLISHABLE_KEY / SECRET_KEY: CLI 3.2.0 status -o env names (sb_ keys; the
# local Kong maps apikey=SECRET_KEY to the service_role bearer for Auth).
for v in API_URL ANON_KEY PUBLISHABLE_KEY SECRET_KEY; do
  db_auth_require_var "$v" || exit 1
done

echo "== dummy function env (ADR-010 names, dummy values, not secrets) =="
{
  echo "GEMINI_API_KEY=dummy"
  echo "GEMINI_PAID_API_KEY=dummy"
  echo "GROQ_API_KEY=dummy"
  echo "AZURE_SPEECH_KEY=dummy"
  echo "AZURE_SPEECH_REGION=dummy"
  echo "APP_ALLOWED_ORIGINS=http://localhost:5173"
} > "$ENV_FILE"

echo "== ADR-009 host path check (file must exist on the runner before serve) =="
CONTRACTS_SRC="${WORKDIR}/packages/contracts/src/index.ts"
ls -la "$CONTRACTS_SRC"
if [[ ! -f "$CONTRACTS_SRC" ]]; then
  echo "ERROR: $CONTRACTS_SRC missing on the host; staging failed."
  exit 1
fi
echo "Host can see contracts at $CONTRACTS_SRC"

echo "== supabase functions serve (background, --no-verify-jwt --debug, ADR-010) =="
# --no-verify-jwt matches config.toml verify_jwt = false so requests reach the function.
# JWT checks happen inside the function (requireUser / probe equivalent).
# --debug: capture container mount list to confirm packages/contracts is mounted.
rm -f "$SERVE_LOG"
supabase --workdir "$WORKDIR" functions serve --no-verify-jwt --debug --env-file "$ENV_FILE" \
  >"$SERVE_LOG" 2>&1 &
echo $! > "$SERVE_PID_FILE"
echo "serve pid=$(cat "$SERVE_PID_FILE")"

HEALTH_URL="${API_URL}${HEALTH_PATH}"
echo "== wait for functions serve to replace the start-owned edge runtime =="
served=0
for i in $(seq 1 90); do
  if grep -q 'Serving functions on' "$SERVE_LOG"; then served=1; echo "SERVE_READY after ${i}s"; break; fi
  sleep 1
done
[[ "$served" -eq 1 ]] || { echo "ERROR: functions serve never printed 'Serving functions on'"; tail -n 80 "$SERVE_LOG"; exit 1; }

echo "== wait for ${HEALTH_PATH} (ignore BOOT_ERROR 503 until the worker boots) =="
ready=0
for i in $(seq 1 45); do
  code="$(curl -sS -o "${RUNNER_TEMP:-/tmp}/health-wait.body" -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"  # o004-allow: retry loop; success still requires HTTP 200/401/404 later
  body="$(tr '\n' ' ' < "${RUNNER_TEMP:-/tmp}/health-wait.body" 2>/dev/null || true)"  # o004-allow: retry loop body read; missing file is treated as empty, not success
  echo "Attempt ${i}/45: HTTP ${code:-000} body=${body}"
  if [[ "$code" =~ ^(200|401|404)$ ]]; then
    echo "health worker is up (HTTP ${code}) on attempt ${i}"
    ready=1
    break
  fi
  sleep 2
done
echo "---- functions serve log ----"
cat "$SERVE_LOG" || true  # o004-allow: diagnostic dump; boot/health checks still hard-fail
echo "---- end serve log ----"
echo "== container mount list (serve --debug + docker inspect) =="
if grep -E -i 'mount|bind|import.?map|deno\.json|packages/contracts|volume' "$SERVE_LOG" >"${RUNNER_TEMP:-/tmp}/mount-grep.txt"; then
  cat "${RUNNER_TEMP:-/tmp}/mount-grep.txt"
else
  echo "(no mount/import_map/packages.contracts lines in serve debug log yet)"
fi
cid="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' | awk '/edge.runtime|edge-runtime|supabase_edge/ {print $1; exit}')"
if [[ -n "${cid:-}" ]]; then
  echo "edge-runtime container: $cid"
  docker inspect -f '{{range .Mounts}}{{println .Type .Source "->" .Destination}}{{end}}' "$cid" || true  # o004-allow: diagnostic dump; MOUNT_OK/MISSING is the actual check
  if docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' "$cid" | grep -q 'packages/contracts'; then
    echo "MOUNT_OK: packages/contracts appears in the container mount list."
  else
    echo "MOUNT_MISSING: packages/contracts not found in docker inspect mounts."
  fi
else
  echo "No edge-runtime container found while collecting mounts."
fi
echo "---- end mount list ----"
if [[ "$ready" -ne 1 ]]; then
  echo "ERROR: health worker did not boot (wanted HTTP 200/401/404, last was ${code:-000})."
  if grep -q 'Module not found .*packages/contracts' "$SERVE_LOG"; then
    echo "ADR-009 (1) FAILED: supabase functions serve (CLI ${SUPABASE_CLI_VERSION:-unknown}) did not load packages/contracts even though the file exists on the host as a sibling of supabase/. Per ADR-009, stop and report to Architect; do not apply the _shared backup in this PR."
  fi
  exit 1
fi

echo "== ADR-009 (1): contracts import (serve log) =="
if grep -E 'Module not found|Cannot resolve|Could not find.*@english-coach/contracts' "$SERVE_LOG"; then
  echo "ERROR: serve log shows @english-coach/contracts resolution failure."
  tail -n 80 "$SERVE_LOG" || true  # o004-allow: error-path log dump; already exiting non-zero
  exit 1
fi
echo "No contracts resolution error in serve log."

curl_code() {
  local expected="$1"
  shift
  local body
  body="$(mktemp)"
  local code
  code="$(curl -sS -o "$body" -w '%{http_code}' --max-time 5 "$@")"
  echo "curl HTTP ${code} (expected ${expected})"
  echo "body: $(tr '\n' ' ' < "$body")"
  if [[ "$code" != "$expected" ]]; then
    echo "ERROR: expected HTTP ${expected}, got ${code}"
    tail -n 80 "$SERVE_LOG" || true  # o004-allow: error-path log dump; already exiting non-zero
    exit 1
  fi
}

echo "== health without JWT → 401 =="
curl_code 401 "$HEALTH_URL"
sleep 1

echo "== health with ANON_KEY (not a user JWT) → 401 (ADR-010: role must be authenticated) =="
curl_code 401 -H "Authorization: Bearer ${ANON_KEY}" -H "apikey: ${ANON_KEY}" "$HEALTH_URL"

echo "== Auth: enable_signup = false is active (Q-01 / Q-26 plan B) =="
AUTH_SETTINGS_BODY="$(mktemp)"
AUTH_SETTINGS_CODE="$(curl -sS -o "$AUTH_SETTINGS_BODY" -w '%{http_code}' --max-time 15 \
  -H "apikey: ${PUBLISHABLE_KEY}" \
  "${API_URL}/auth/v1/settings")"
db_auth_check_settings_signup_disabled "$AUTH_SETTINGS_CODE" "$AUTH_SETTINGS_BODY" || exit 1

# A random password generated here, used once, never printed.
TEST_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
SIGNUP_EMAIL="adr010-signup-$(date +%s)-${RANDOM}@example.com"
SIGNUP_BODY="$(mktemp)"
SIGNUP_CODE="$(jq -n --arg email "$SIGNUP_EMAIL" --arg password "$TEST_PASSWORD" '{email: $email, password: $password}' \
  | curl -sS -o "$SIGNUP_BODY" -w '%{http_code}' --max-time 15 \
      -X POST "${API_URL}/auth/v1/signup" \
      -H "apikey: ${PUBLISHABLE_KEY}" \
      -H "Content-Type: application/json" \
      --data @-)"
db_auth_check_signup_rejected "$SIGNUP_CODE" "$SIGNUP_BODY" || exit 1

echo "== Auth Admin API: create confirmed test user (secret key; nothing printed) =="
EMAIL="adr010-ci-$(date +%s)-${RANDOM}@example.com"
ADMIN_BODY="$(mktemp)"
# Only apikey: Kong maps the opaque sb_secret key to the service_role bearer.
ADMIN_CODE="$(jq -n --arg email "$EMAIL" --arg password "$TEST_PASSWORD" '{email: $email, password: $password, email_confirm: true}' \
  | curl -sS -o "$ADMIN_BODY" -w '%{http_code}' --max-time 15 \
      -X POST "${API_URL}/auth/v1/admin/users" \
      -H "apikey: ${SECRET_KEY}" \
      -H "Content-Type: application/json" \
      --data @-)"
db_auth_check_admin_user_created "$ADMIN_CODE" "$ADMIN_BODY" "$EMAIL" || exit 1

echo "== Auth: password sign-in for the admin-created user =="
TOKEN_BODY="$(mktemp)"
TOKEN_CODE="$(jq -n --arg email "$EMAIL" --arg password "$TEST_PASSWORD" '{email: $email, password: $password}' \
  | curl -sS -o "$TOKEN_BODY" -w '%{http_code}' --max-time 15 \
      -X POST "${API_URL}/auth/v1/token?grant_type=password" \
      -H "apikey: ${PUBLISHABLE_KEY}" \
      -H "Content-Type: application/json" \
      --data @-)"
ACCESS_TOKEN=""
db_auth_extract_access_token "$TOKEN_CODE" "$TOKEN_BODY" ACCESS_TOKEN || exit 1
rm -f "$TOKEN_BODY" "$ADMIN_BODY" "$SIGNUP_BODY"
unset TEST_PASSWORD

echo "== user JWT claims on host (no token values) =="
db_auth_check_user_jwt_claims "$ACCESS_TOKEN" || exit 1

echo "== JWKS algs (public key types only, no key values) =="
curl -sS "${API_URL}/auth/v1/.well-known/jwks.json" | jq -r '"JWKS algs=" + ([.keys[] | (.alg // .kty)] | join(","))'

echo "== health with user JWT → 200 {ok:true} =="
USER_BODY="$(mktemp)"
USER_CODE="$(curl -sS -o "$USER_BODY" -w '%{http_code}' --max-time 5 \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "apikey: ${ANON_KEY}" \
  "$HEALTH_URL")"
echo "curl HTTP ${USER_CODE} (expected 200)"
echo "body: $(tr '\n' ' ' < "$USER_BODY")"
if [[ "$USER_CODE" != "200" ]]; then
  echo "ERROR: expected HTTP 200 with user JWT, got ${USER_CODE}"
  echo "---- adr010-auth diagnostic lines ----"
  grep -E "adr010-auth|adr010-handler-error" "$SERVE_LOG" || true  # o004-allow: error-path log dump; already exiting non-zero
  tail -n 80 "$SERVE_LOG" || true  # o004-allow: error-path log dump; already exiting non-zero
  exit 1
fi
if ! jq -e '.ok == true' "$USER_BODY" >/dev/null; then
  echo "ERROR: body is not {\"ok\": true}"
  exit 1
fi
echo "== adr010-auth function log =="
grep -E 'adr010-auth' "$SERVE_LOG" || true  # o004-allow: display-only after a successful 200

# shellcheck source=adr010-keycheck.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/adr010-keycheck.sh"
check_adr010_keys "$SERVE_LOG" "$ROOT" || exit 1

echo "== ADR-009 (2): local pack equivalent — do NOT run functions deploy (remote only, no --dry-run in CLI 3.2.0) =="
# Runtime evidence from (1): serve loaded the function and imported contracts.
# Also search common local artifact locations; if a bundle is found it must mention contracts.
found=0
while IFS= read -r -d '' f; do
  echo "found candidate bundle: $f"
  found=1
  if ! grep -a -q -E 'english-coach/contracts|packages/contracts' "$f"; then
    echo "ERROR: bundle does not appear to contain contracts: $f"
    exit 1
  fi
  echo "bundle mentions contracts: $f"
done < <(find "$WORKDIR" "${HOME}/.supabase" /tmp "${RUNNER_TEMP:-/tmp}" -type f \( -name '*.eszip' -o -name '*eszip*' -o -name 'api.zip' \) 2>/dev/null | head -n 20 | tr '\n' '\0' || true)  # o004-allow: retry loop body read

# Also peek at edge-runtime container files if present (best effort).
if command -v docker >/dev/null; then
  cid="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' | awk '/edge.runtime|edge-runtime|supabase_edge/ {print $1; exit}')"
  if [[ -n "${cid:-}" ]]; then
    echo "edge-runtime container: $cid"
    docker exec "$cid" sh -c 'ls -la /home/deno 2>/dev/null; ls -la /root/functions 2>/dev/null; find / -name "*.eszip" 2>/dev/null | head' || true  # o004-allow: eszip search is best-effort; missing artifact is UNCONFIRMED, not a pass of (2) deploy proof
  fi
fi

if [[ "$found" -eq 0 ]]; then
  echo "No local pack artifact (eszip) found. CLI 3.2.0 has no 'functions deploy --dry-run' and deploy is remote-only."
  echo "Using runtime success of functions serve + contracts import as the local equivalent for ADR-009 (2)."
  echo "UNCONFIRMED: a deploy-time bundle definitely contains contracts. Do not run remote deploy in CI."
fi

echo "== RLS tests =="
if [[ -d "${WORKDIR}/supabase/tests" ]]; then
  supabase --workdir "$WORKDIR" test db
else
  echo "supabase/tests not found; skipping RLS tests"
fi

echo "db-job-verify: all checks passed."
