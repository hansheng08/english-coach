#!/usr/bin/env bash
# O-031: start the local Supabase stack with a bounded, fail-closed retry.
# Usage (from the repo root, supabase CLI on PATH):
#   bash .github/scripts/supabase-start.sh [--workdir DIR] <supabase start args...>
# Every failure is classified and every retry decision is made by
# tooling/supabase-start-policy.mjs (AC-O31-7: no second classifier in shell).
# Retry only port-bind / registry failures (max 3 attempts, 10 s then 20 s);
# before each retry: diagnostics + `supabase stop --no-backup`. A fatal failure,
# an exhausted budget, or a non-Docker listener left on 54320-54329 after the
# cleanup exits 1. Success only when one `supabase start` exits 0.
# Before attempt 1, 54320-54329 are added to net.ipv4.ip_local_reserved_ports
# (prevention, not verification: on failure warn and continue).
# Evidence lines start with "supabase-start:": one per attempt
# ("supabase-start: attempt N: exit RC kind=K -> retry in Ss | stop (reason)") and one
# summary ("OK on attempt N" / "FAILED: ..."). Count rescues by grepping
# "supabase-start: OK on attempt [23]". Output is key-masked like db-job-verify.sh.
# Env (tests only): SUPABASE_START_POLICY, SUPABASE_START_TMP.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY="${SUPABASE_START_POLICY:-$HERE/../../tooling/supabase-start-policy.mjs}"
TMP="${SUPABASE_START_TMP:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
PORTS_LO=54320
PORTS_HI=54329
RESERVE="${PORTS_LO}-${PORTS_HI}"

die() { echo "supabase-start: FAILED: $*"; echo "::error::supabase-start: $*"; exit 1; }

# Same masking rules as db-job-verify.sh mask_keys (supabase-start-test.sh compares them).
mask_keys() {
  sed -E \
    -e 's/(sb_(secret|publishable)_)[A-Za-z0-9_-]+/\1***/g' \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/***jwt***/g' \
    -e 's/((Access|Secret) Key[^A-Za-z0-9]+)[A-Za-z0-9]{16,}/\1***/g'
}

pre=()
if [[ "${1-}" == "--workdir" ]]; then
  [[ -n "${2-}" ]] || die "--workdir needs a directory"
  pre=(--workdir "$2")
  shift 2
fi
[[ $# -gt 0 ]] || die "no supabase start arguments (expected at least -x <services>)"
command -v node >/dev/null || die "node not found (the job must provide Node before this script)"
command -v supabase >/dev/null || die "supabase CLI not found"
[[ -f "$POLICY" ]] || die "policy module missing: $POLICY"
mkdir -p "$TMP"

have_sudo=0
if sudo -n true 2>/dev/null; then have_sudo=1; fi

reserve_ports() {
  local cur new
  if ! cur="$(sysctl -n net.ipv4.ip_local_reserved_ports)"; then
    echo "::warning::supabase-start: cannot read net.ipv4.ip_local_reserved_ports; continuing without reserving ${RESERVE}"
    return 0
  fi
  if [[ ",${cur// /}," == *",${RESERVE},"* ]]; then
    echo "supabase-start: reserved ports already include ${RESERVE} (${cur})"
    return 0
  fi
  if [[ -z "${cur// /}" ]]; then new="$RESERVE"; else new="${cur// /},${RESERVE}"; fi
  if [[ "$have_sudo" -eq 1 ]] && sudo -n sysctl -w "net.ipv4.ip_local_reserved_ports=${new}" >/dev/null; then
    echo "supabase-start: reserved ports now: $(sysctl -n net.ipv4.ip_local_reserved_ports)"
  else
    echo "::warning::supabase-start: could not reserve ${RESERVE} (sudo -n sysctl unavailable or failed); the retry still applies"
  fi
}

# Sockets on 54320-54329 (ESTAB / TIME-WAIT rows show ephemeral source-port use).
ss_ports() { # ss_ports <ss flags without p>
  local filter="( sport >= :${PORTS_LO} and sport <= :${PORTS_HI} )"
  if [[ "$have_sudo" -eq 1 ]]; then sudo -n ss "${1}p" "$filter"; else ss "$1" "$filter"; fi
}

diagnostics() { # diagnostics <attempt> <kind>
  echo "::group::supabase-start diagnostics (attempt $1, kind $2)"
  echo "-- sockets on ${RESERVE} (all states; process names need sudo) --"
  if ! ss_ports -Htan; then echo "(ss failed)"; fi
  echo "-- containers --"
  if ! docker ps -a --format '{{.Names}} {{.Status}} {{.Ports}}'; then echo "(docker ps failed)"; fi
  echo "-- ephemeral port range / reserved ports --"
  if ! sysctl -n net.ipv4.ip_local_port_range net.ipv4.ip_local_reserved_ports; then echo "(sysctl failed)"; fi
  echo "::endgroup::"
}

# 1 when, after the cleanup, something other than Docker listens on 54320-54329.
# Without process names (no sudo) any listener counts as "other" (fail-closed).
port_held_by_other() {
  local out line held=0
  if ! out="$(ss_ports -Htln)"; then echo 1; return 0; fi
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$line" =~ users:\(\(\"(docker-proxy|dockerd|containerd)\" ]]; then continue; fi
    held=1
  done <<<"$out"
  echo "$held"
}

cleanup_stack() {
  echo "-- cleanup: supabase ${pre[*]:+${pre[*]} }stop --no-backup --"
  if ! supabase "${pre[@]}" stop --no-backup 2>&1 | mask_keys; then
    echo "::warning::supabase-start: supabase stop --no-backup failed (the start failure above stands)"
  fi
}

reserve_ports
attempt=1
while :; do
  log="$TMP/supabase-start-attempt-${attempt}.log"
  echo "== attempt ${attempt}: supabase ${pre[*]:+${pre[*]} }start $* =="
  rc=0
  supabase "${pre[@]}" start "$@" 2>&1 | mask_keys | tee "$log" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "supabase-start: attempt ${attempt}: exit 0"
    echo "supabase-start: OK on attempt ${attempt}"
    exit 0
  fi
  kind="$(node "$POLICY" classify "$log")" || die "policy classify failed on attempt ${attempt}"
  [[ "$kind" =~ ^(port-bind|registry|fatal)$ ]] || die "policy classify returned '${kind}'"
  diagnostics "$attempt" "$kind"
  held=0
  if [[ "$kind" != fatal ]]; then
    cleanup_stack
    held="$(port_held_by_other)"
    if [[ "$held" == 1 ]]; then echo "-- a non-Docker listener is still on ${RESERVE} after the cleanup --"; fi
  fi
  decision="$(node "$POLICY" decide "$attempt" "$kind" "$held")" || die "policy decide failed on attempt ${attempt}"
  if [[ "$decision" =~ ^retry\ ([0-9]+)$ ]]; then
    echo "supabase-start: attempt ${attempt}: exit ${rc} kind=${kind} -> retry in ${BASH_REMATCH[1]}s"
    sleep "${BASH_REMATCH[1]}"
    attempt=$((attempt + 1))
    continue
  fi
  [[ "$decision" =~ ^stop\ (.+)$ ]] || die "policy decide returned '${decision}'"
  echo "supabase-start: attempt ${attempt}: exit ${rc} kind=${kind} -> stop (${BASH_REMATCH[1]})"
  die "after ${attempt} attempt(s), kind=${kind}: ${BASH_REMATCH[1]}"
done
