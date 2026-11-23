#!/usr/bin/env bash
# O-003: start-local-stack checks for the ci.yml db job.
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
  WORKDIR="${RUNNER_TEMP:-/tmp}/o003-stack"
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
    kill "$(cat "$SERVE_PID_FILE")" 2>/dev/null || true
  fi
  supabase --workdir "$WORKDIR" stop || true
}
trap cleanup EXIT

echo "== docker info =="
docker info >/dev/null
echo "Docker is available on this runner."

echo "== supabase start =="
supabase --workdir "$WORKDIR" start -x "$EXCLUDES"

echo "== supabase db reset =="
supabase --workdir "$WORKDIR" db reset

echo "== supabase status -o env (names only) =="
# shellcheck disable=SC1090
eval "$(supabase --workdir "$WORKDIR" status -o env)"
: "${API_URL:?API_URL missing from supabase status -o env}"
: "${ANON_KEY:?ANON_KEY missing from supabase status -o env}"
echo "API_URL is set (value not printed)."
echo "ANON_KEY is set (value not printed)."

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
  code="$(curl -sS -o /tmp/o003-health-wait.body -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  body="$(tr '\n' ' ' < /tmp/o003-health-wait.body 2>/dev/null || true)"
  echo "Attempt ${i}/45: HTTP ${code:-000} body=${body}"
  if [[ "$code" =~ ^(200|401|404)$ ]]; then
    echo "health worker is up (HTTP ${code}) on attempt ${i}"
    ready=1
    break
  fi
  sleep 2
done
echo "---- functions serve log ----"
cat "$SERVE_LOG" || true
echo "---- end serve log ----"
echo "== container mount list (serve --debug + docker inspect) =="
if grep -E -i 'mount|bind|import.?map|deno\.json|packages/contracts|volume' "$SERVE_LOG" >/tmp/o003-mount-grep.txt; then
  cat /tmp/o003-mount-grep.txt
else
  echo "(no mount/import_map/packages.contracts lines in serve debug log yet)"
fi
cid="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' | awk '/edge.runtime|edge-runtime|supabase_edge/ {print $1; exit}')"
if [[ -n "${cid:-}" ]]; then
  echo "edge-runtime container: $cid"
  docker inspect -f '{{range .Mounts}}{{println .Type .Source "->" .Destination}}{{end}}' "$cid" || true
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
  tail -n 80 "$SERVE_LOG" || true
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
    tail -n 80 "$SERVE_LOG" || true
    exit 1
  fi
}

echo "== health without JWT → 401 =="
curl_code 401 "$HEALTH_URL"
sleep 1

echo "== health with ANON_KEY (not a user JWT) → 401 (ADR-010: role must be authenticated) =="
curl_code 401 -H "Authorization: Bearer ${ANON_KEY}" -H "apikey: ${ANON_KEY}" "$HEALTH_URL"

echo "== create local Auth user for health 200 =="
# Unique email; local config has enable_confirmations = false.
EMAIL="o003-ci-$(date +%s)@example.com"
SIGNUP_BODY="$(mktemp)"
SIGNUP_CODE="$(curl -sS -o "$SIGNUP_BODY" -w '%{http_code}' --max-time 15 \
  -X POST "${API_URL}/auth/v1/signup" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"Ci-O003-passw0rd!\"}")"
echo "signup HTTP ${SIGNUP_CODE}"
# Do not print tokens. Extract access_token with jq if present.
ACCESS_TOKEN="$(jq -r '.access_token // .session.access_token // empty' "$SIGNUP_BODY")"
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
  echo "ERROR: signup did not return access_token. HTTP ${SIGNUP_CODE}. Keys in body: $(jq -r 'keys|join(",")' "$SIGNUP_BODY" 2>/dev/null || echo unknown)"
  exit 1
fi
echo "Got user access_token (value not printed)."

echo "== user JWT claims on host (no token values) =="
ACCESS_TOKEN="$ACCESS_TOKEN" python3 - <<'JWTPY'
import os, json, base64, sys
tok = os.environ.get("ACCESS_TOKEN") or ""
parts = tok.split(".")
print(f"jwt parts={len(parts)}")
if len(parts) < 2:
    print("access_token is not a JWT-shaped string")
    sys.exit(0)

def dec(x):
    pad = "=" * ((4 - len(x) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(x + pad))

try:
    header = dec(parts[0])
    payload = dec(parts[1])
except Exception as exc:
    print(f"jwt decode error type={type(exc).__name__}")
    sys.exit(0)

print(
    "alg=" + str(header.get("alg")),
    "has_kid=" + str(bool(header.get("kid"))),
    "role=" + str(payload.get("role")),
    "aud=" + str(payload.get("aud")),
    "has_sub=" + str(bool(payload.get("sub"))),
    "is_anonymous=" + str(payload.get("is_anonymous")),
    "claim_keys=" + ",".join(sorted(map(str, payload.keys()))),
)
JWTPY

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
  echo "---- o003-auth diagnostic lines ----"
  grep -E "o003-auth|o003-handler-error" "$SERVE_LOG" || true
  tail -n 80 "$SERVE_LOG" || true
  exit 1
fi
if ! jq -e '.ok == true' "$USER_BODY" >/dev/null; then
  echo "ERROR: body is not {\"ok\": true}"
  exit 1
fi
echo "== o003-auth function log =="
grep -E 'o003-auth' "$SERVE_LOG" || true

echo "== ADR-010: injected key names (presence only) =="
if grep -q 'o003-env has_supabase_url=' "$SERVE_LOG"; then
  grep 'o003-env has_supabase_url=' "$SERVE_LOG" | tail -n 3
else
  echo "WARNING: did not find o003-env lines (expected on the CI probe; product api may log differently)."
fi
if grep -q 'o003-env .*only_legacy_keys=true' "$SERVE_LOG"; then
  echo "ERROR: CLI injected only legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Per ADR-010, stop and report to Architect; do not teach product code those names."
  exit 1
fi
if grep -q 'o003-env has_publishable=false' "$SERVE_LOG"; then
  echo "ERROR: publishable key not present in function env (ADR-010)."
  exit 1
fi
if grep -q 'o003-env has_supabase_url=false' "$SERVE_LOG"; then
  echo "ERROR: SUPABASE_URL not present in function env (ADR-010)."
  exit 1
fi
echo "Key-name check passed or not applicable (no probe env lines)."

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
done < <(find "$WORKDIR" "${HOME}/.supabase" /tmp "${RUNNER_TEMP:-/tmp}" -type f \( -name '*.eszip' -o -name '*eszip*' -o -name 'api.zip' \) 2>/dev/null | head -n 20 | tr '\n' '\0' || true)

# Also peek at edge-runtime container files if present (best effort).
if command -v docker >/dev/null; then
  cid="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' | awk '/edge.runtime|edge-runtime|supabase_edge/ {print $1; exit}')"
  if [[ -n "${cid:-}" ]]; then
    echo "edge-runtime container: $cid"
    docker exec "$cid" sh -c 'ls -la /home/deno 2>/dev/null; ls -la /root/functions 2>/dev/null; find / -name "*.eszip" 2>/dev/null | head' || true
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
