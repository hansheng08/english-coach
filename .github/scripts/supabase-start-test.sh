#!/usr/bin/env bash
# Asserted cases for supabase-start.sh (O-031, AC-O31-4..8 wiring; TC-10..14, TC-16, TC-19)
# with the REAL tooling/supabase-start-policy.mjs and fake supabase / ss / docker / sysctl /
# sudo / sleep on PATH (no Docker, no network, no real sleeping). Mutants of
# supabase-start.sh must be killed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0
export SUPABASE_START_POLICY="$ROOT/tooling/supabase-start-policy.mjs"
BIND='failed to start docker container: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint supabase_db_x: failed to bind host port 0.0.0.0:54322/tcp: address already in use'
REG='Error response from daemon: error from registry: Rate exceeded'
FATAL='Error: supabase/config.toml: invalid project_id'

mkdir -p "$WORK/bin"
fake() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$WORK/bin/$1"; chmod +x "$WORK/bin/$1"; }
# supabase: start N prints $D/start.N.out and exits $D/start.N.code; stop exits $D/stop.code.
fake supabase 'echo "$*" >> "$D/calls"
for a in "$@"; do
  if [[ "$a" == stop ]]; then echo "Stopped supabase local development setup."; [[ -f "$D/stop.code" ]] && exit "$(cat "$D/stop.code")"; exit 0; fi
  if [[ "$a" == start ]]; then
    n=$(( $(cat "$D/starts" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$D/starts"
    [[ -f "$D/start.$n.code" ]] || { echo "fake: no scenario for start $n"; exit 97; }
    cat "$D/start.$n.out"; exit "$(cat "$D/start.$n.code")"
  fi
done
exit 98'
# ss: listening query (-Htln[p]) prints $D/ss.listen, all-states query prints $D/ss.all.
fake ss 'echo "ss $*" >> "$D/calls"
case "$1" in -Htln|-Htlnp) [[ -f "$D/ss.listen" ]] && cat "$D/ss.listen" ;; *) echo "TIME-WAIT 0 0 10.1.0.4:54322 140.82.1.1:443" ;; esac
exit 0'
fake docker 'echo "supabase_db_x Exited (1) 2 seconds ago"; echo "supabase_kong_x Created"'
fake sysctl 'if [[ "$1" == -w ]]; then
  [[ "${FAKE_SUDO-}" == 1 ]] || { echo "sysctl: permission denied" >&2; exit 1; }
  echo "sysctl $*" >> "$D/calls"; echo "${2#*=}" > "$D/reserved"; exit 0
fi
[[ -f "$D/sysctl.fail" ]] && exit 1
shift
for k in "$@"; do case "$k" in
  net.ipv4.ip_local_port_range) echo "32768	60999" ;;
  net.ipv4.ip_local_reserved_ports) cat "$D/reserved" ;;
esac; done'
fake sudo '[[ "$1" == -n ]] && shift
[[ -f "$D/nosudo" ]] && { echo "sudo: a password is required" >&2; exit 1; }
FAKE_SUDO=1 exec "$@"'
fake sleep 'echo "$1" >> "$D/sleeps"'
export PATH="$WORK/bin:$PATH"

SCRIPT="$HERE/supabase-start.sh"
setup() { rm -rf "$WORK/d"; mkdir -p "$WORK/d/tmp"; export D="$WORK/d" SUPABASE_START_TMP="$WORK/d/tmp"; : > "$D/calls"; : > "$D/sleeps"; : > "$D/reserved"; }
attempt_() { printf '%s\n' "$2" > "$D/start.$1.out"; echo "$3" > "$D/start.$1.code"; } # attempt_ <n> <output> <exit>
go() { set +e; bash "$SCRIPT" "$@" > "$D/out" 2>&1; CODE=$?; set -e; }
starts() { awk '/(^| )start( |$)/ { n++ } END { print n + 0 }' "$D/calls"; }
stops() { awk '/^(--workdir W )?stop --no-backup$/ { n++ } END { print n + 0 }' "$D/calls"; }
sleeps() { paste -sd, "$D/sleeps"; }
evidence() { # evidence <n>: exactly n "supabase-start: attempt|OK|FAILED" lines (one per attempt + summary)
  local n; n="$(awk '/^supabase-start: (attempt [0-9]+: |OK on |FAILED: )/ { k++ } END { print k + 0 }' "$D/out")"
  if [[ "$n" == "$1" ]]; then return 0; fi
  echo "FAIL evidence lines: $n, want $1"; return 1; }
want() { # want <label> <code> <starts> <stops> <sleeps> [regex in output]...
  local label="$1" c="$2" s="$3" k="$4" z="$5"; shift 5
  local got="exit=$CODE starts=$(starts) stops=$(stops) sleeps=[$(sleeps)]"
  local exp="exit=$c starts=$s stops=$k sleeps=[$z]"
  local ok=1 r
  [[ "$got" == "$exp" ]] || ok=0
  for r in "$@"; do grep -Eq -- "$r" "$D/out" || { ok=0; echo "     missing /$r/"; }; done
  if [[ "$ok" == 1 ]]; then echo "ok   $label"; return 0; fi
  echo "FAIL $label: $got want $exp"; sed 's/^/     /' "$D/out"; return 1
}

c_ok_first() { setup; attempt_ 1 'Started supabase local development setup.' 0; go -x studio
  want "TC-10 success on attempt 1: no retry, no cleanup" 0 1 0 '' '^== attempt 1: supabase start -x studio ==$' '^supabase-start: OK on attempt 1$' && evidence 2; }
c_bind_then_ok() { setup; attempt_ 1 "$BIND" 1; attempt_ 2 'Started' 0; go -x studio
  want "TC-11 port-bind then OK: stop --no-backup, 10 s, 2 evidence lines + summary" 0 2 1 10 '^supabase-start: attempt 1: exit 1 kind=port-bind -> retry in 10s$' '^supabase-start: attempt 2: exit 0$' '^supabase-start: OK on attempt 2$' && evidence 3; }
c_reg_reg_ok() { setup; attempt_ 1 "$REG" 1; attempt_ 2 "$REG" 1; attempt_ 3 'Started' 0; go -x studio
  want "TC-11 registry twice then OK: 10 s then 20 s, 3 attempts" 0 3 2 10,20 '^supabase-start: attempt 2: exit 1 kind=registry -> retry in 20s$' '^supabase-start: OK on attempt 3$' && evidence 4; }
c_bind_exhausted() { setup; attempt_ 1 "$BIND" 1; attempt_ 2 "$BIND" 1; attempt_ 3 "$BIND" 1; attempt_ 4 'Started' 0; go -x studio
  want "TC-12 port-bind 3 times: exit 1, never a 4th attempt, diagnostics, summary" 1 3 3 10,20 '^supabase-start: attempt 3: exit 1 kind=port-bind -> stop \(attempts exhausted\)$' '^supabase-start: FAILED: after 3 attempt\(s\), kind=port-bind: attempts exhausted$' '^::error::supabase-start:' '^::group::supabase-start diagnostics \(attempt 3, kind port-bind\)$' && evidence 4; }
c_fatal() { setup; attempt_ 1 "$FATAL" 1; attempt_ 2 'Started' 0; go -x studio
  want "TC-13 fatal: exit 1 after 1 attempt, no cleanup, no sleep, diagnostics" 1 1 0 '' '^supabase-start: attempt 1: exit 1 kind=fatal -> stop \(not retryable: fatal\)$' '^::group::supabase-start diagnostics \(attempt 1, kind fatal\)$'; }
c_held_other() { setup; attempt_ 1 "$BIND" 1; attempt_ 2 'Started' 0
  echo 'LISTEN 0 4096 0.0.0.0:54322 0.0.0.0:* users:(("nginx",pid=77,fd=6))' > "$D/ss.listen"; go -x studio
  want "TC-14 non-Docker listener after cleanup: stop, no retry" 1 1 1 '' 'non-Docker listener is still on 54320-54329' 'port held by a non-Docker process'; }
c_held_docker() { setup; attempt_ 1 "$BIND" 1; attempt_ 2 'Started' 0
  echo 'LISTEN 0 4096 0.0.0.0:54322 0.0.0.0:* users:(("docker-proxy",pid=78,fd=4))' > "$D/ss.listen"; go -x studio
  want "TC-14 docker-proxy listener is not 'other': retry" 0 2 1 10 '^supabase-start: OK on attempt 2$'; }
c_held_nosudo() { setup; touch "$D/nosudo"; attempt_ 1 "$BIND" 1; attempt_ 2 'Started' 0
  echo 'LISTEN 0 4096 0.0.0.0:54322 0.0.0.0:*' > "$D/ss.listen"; go -x studio
  want "TC-14 listener without process name (no sudo) counts as other (fail-closed)" 1 1 1 '' 'port held by a non-Docker process'; }
# Key-shaped fixtures are assembled at run time so the repo's gitleaks scan sees no literal key.
SB_PREFIX="sb_""secret_"; FAKE_VAL="$(printf 'Zq%.0s' 1 2 3 4 5 6)"; FAKE_HEX="$(printf '0f%.0s' 1 2 3 4 5 6 7 8 9 10)"
FAKE_JWT="eyJ$(printf 'hb%.0s' 1 2 3).eyJ$(printf 'cm%.0s' 1 2 3).$(printf 'c2%.0s' 1 2 3)"
c_diag() { setup; attempt_ 1 "$BIND"$'\n'"API ${SB_PREFIX}${FAKE_VAL} anon ${FAKE_JWT} Secret Key: ${FAKE_HEX}" 1; attempt_ 2 'Started' 0
  FAKE_ENV_SECRET=do-not-print-me go -x studio
  local ok=0
  want "AC-O31-4 diagnostics: ports, containers, ephemeral range; keys masked" 0 2 1 10 \
    '^::group::supabase-start diagnostics \(attempt 1, kind port-bind\)$' 'TIME-WAIT .*:54322' '^supabase_db_x Exited' '^32768	60999$' 'sb_secret_\*\*\*' '\*\*\*jwt\*\*\*' 'Secret Key: \*\*\*' || ok=1
  if grep -Eq -- "${FAKE_VAL}|${FAKE_JWT%%.*}\\.|${FAKE_HEX}|do-not-print-me" "$D/out" "$D/tmp"/*.log; then echo "FAIL AC-O31-4 a key value or env value leaked"; ok=1; fi
  return "$ok"; }
c_stop_fails() { setup; echo 1 > "$D/stop.code"; attempt_ 1 "$REG" 1; attempt_ 2 "$REG" 1; attempt_ 3 "$REG" 1; go -x studio
  want "stop --no-backup failing is logged, the start failure still exits 1" 1 3 3 10,20 'supabase stop --no-backup failed' 'attempts exhausted'; }
c_workdir() { setup; attempt_ 1 "$BIND" 1; attempt_ 2 'Started' 0; go --workdir W -x "a,b"
  local ok=0
  want "--workdir goes before start and stop (db-job-verify.sh form)" 0 2 1 10 || ok=1
  [[ "$(grep -c '^--workdir W start -x a,b$' "$D/calls")" == 2 ]] || { echo "FAIL --workdir start calls: $(cat "$D/calls")"; ok=1; }
  return "$ok"; }
c_reserve_keep() { setup; echo '1000,2000-2010' > "$D/reserved"; attempt_ 1 'Started' 0; go -x studio
  local ok=0; want "TC-16 sudo -n sysctl keeps existing reserved ports, prints read-back" 0 1 0 '' '^supabase-start: reserved ports now: 1000,2000-2010,54320-54329$' || ok=1
  [[ "$(cat "$D/reserved")" == "1000,2000-2010,54320-54329" ]] || { echo "FAIL TC-16 reserved=$(cat "$D/reserved")"; ok=1; }
  [[ "$(sed -n 1p "$D/calls")" == "sysctl -w net.ipv4.ip_local_reserved_ports=1000,2000-2010,54320-54329" ]] || { echo "FAIL AC-O31-6 reservation is not the first call: $(cat "$D/calls")"; ok=1; }
  return "$ok"; }
c_reserve_empty() { setup; attempt_ 1 'Started' 0; go -x studio
  want "TC-16 empty reserved list becomes 54320-54329" 0 1 0 '' '^supabase-start: reserved ports now: 54320-54329$'; }
c_reserve_present() { setup; echo '54320-54329' > "$D/reserved"; attempt_ 1 'Started' 0; go -x studio
  local ok=0; want "TC-16 already reserved: no sysctl -w" 0 1 0 '' 'already include 54320-54329' || ok=1
  if grep -q '^sysctl -w' "$D/calls"; then echo "FAIL TC-16 sysctl -w called"; ok=1; fi
  return "$ok"; }
c_reserve_nosudo() { setup; touch "$D/nosudo"; attempt_ 1 'Started' 0; go -x studio
  want "TC-16 no sudo: warning only, start still runs" 0 1 0 '' '^::warning::supabase-start: could not reserve 54320-54329' '^supabase-start: OK on attempt 1$'; }
c_reserve_unreadable() { setup; touch "$D/sysctl.fail"; attempt_ 1 'Started' 0; go -x studio
  want "TC-16 reserved ports unreadable: warning only" 0 1 0 '' '^::warning::supabase-start: cannot read net.ipv4.ip_local_reserved_ports'; }
c_no_args() { setup; go; want "no start arguments: exit 1" 1 0 0 '' 'no supabase start arguments'; }
c_bad_policy() { setup; attempt_ 1 "$BIND" 1; printf 'console.log("maybe")\n' > "$D/p.mjs"
  SUPABASE_START_POLICY="$D/p.mjs" go -x studio
  want "policy output not understood: exit 1 (fail-closed)" 1 1 0 '' "classify returned 'maybe'"; }
c_bad_decide() { setup; attempt_ 1 "$BIND" 1; attempt_ 2 'Started' 0
  printf 'console.log(process.argv[2] === "classify" ? "port-bind" : "go ahead")\n' > "$D/p.mjs"
  SUPABASE_START_POLICY="$D/p.mjs" go -x studio
  want "policy decide not understood: exit 1 (fail-closed)" 1 1 1 '' "decide returned 'go ahead'"; }
c_no_policy() { setup; attempt_ 1 'Started' 0; SUPABASE_START_POLICY="$D/none.mjs" go -x studio
  want "policy module missing: exit 1 before any start" 1 0 0 '' 'policy module missing'; }
c_no_node() { setup; attempt_ 1 'Started' 0; mkdir -p "$D/nonode"
  local t; for t in sed tee mkdir dirname cat; do ln -s "$(command -v "$t")" "$D/nonode/$t"; done
  set +e; PATH="$WORK/bin:$D/nonode" "$BASH" "$SCRIPT" -x studio > "$D/out" 2>&1; CODE=$?; set -e
  want "AC-O31-7 node missing: exit 1 before any start" 1 0 0 '' 'node not found'; }
c_mask_same() {
  local a b
  a="$(grep -E "^    -e 's/" "$HERE/db-job-verify.sh")"; b="$(grep -E "^    -e 's/" "$SCRIPT")"
  if [[ -n "$a" && "$a" == "$b" && "$(wc -l <<<"$a")" -eq 3 ]]; then echo "ok   AC-O31-4 mask rules identical to db-job-verify.sh"; return 0; fi
  echo "FAIL AC-O31-4 mask rules differ"; return 1; }

CASES=(c_ok_first c_bind_then_ok c_reg_reg_ok c_bind_exhausted c_fatal c_held_other c_held_docker c_held_nosudo c_diag c_stop_fails c_workdir
  c_reserve_keep c_reserve_empty c_reserve_present c_reserve_nosudo c_reserve_unreadable c_no_args c_bad_policy c_bad_decide c_no_policy c_no_node c_mask_same)
for c in "${CASES[@]}"; do if ! "$c"; then FAIL=1; fi; done

# ---- TC-19 mutants of supabase-start.sh: each must make at least one case fail ----
all_cases() { local c; for c in "${CASES[@]}"; do "$c" || return 1; done; }
mutant() { # mutant <name> <literal from> <literal to>
  local name="$1"
  node -e 'const fs=require("fs");const [s,o,f,t]=process.argv.slice(1);const x=fs.readFileSync(s,"utf8");if(!x.includes(f))process.exit(3);fs.writeFileSync(o,x.split(f).join(t));' "$HERE/supabase-start.sh" "$WORK/mut.sh" "$2" "$3" \
    || { echo "FAIL mutant '$name': anchor not found"; FAIL=1; return; }
  if SCRIPT="$WORK/mut.sh" all_cases >/dev/null 2>&1; then echo "FAIL mutant '$name' survived"; FAIL=1; else echo "ok   mutant '$name' killed"; fi
}
mutant "failure exits 0" 'die "after ${attempt} attempt(s)' 'exit 0; die "x'
mutant "start exit code ignored" 'if [[ "$rc" -eq 0 ]]; then' 'if [[ "$rc" -ge 0 ]]; then'
mutant "no cleanup before retry" '    cleanup_stack' '    echo skip-cleanup'
mutant "stop without --no-backup" 'stop --no-backup 2>&1' 'stop 2>&1'
mutant "no backoff sleep" 'sleep "${BASH_REMATCH[1]}"' 'echo no-sleep'
mutant "held port ignored" 'held="$(port_held_by_other)"' 'held=0'
mutant "any listener counts as Docker" '(docker-proxy|dockerd|containerd)' '(docker-proxy|dockerd|containerd|nginx)'
mutant "unknown listener counts as Docker" 'held=1
  done' 'held=0
  done'
mutant "output not masked" '| mask_keys | tee' '| tee'
mutant "no diagnostics" 'diagnostics "$attempt" "$kind"' 'echo no-diagnostics'
mutant "reservation drops existing ports" 'new="${cur// /},${RESERVE}"' 'new="${RESERVE}"'
mutant "reservation failure is fatal" 'the retry still applies"' 'the retry still applies"; exit 1'
mutant "policy output not validated" 'die "policy classify returned' 'echo "policy classify returned'
mutant "node check removed" 'command -v node >/dev/null ||' 'true ||'
mutant "reservation after the first attempt" 'reserve_ports
attempt=1' 'attempt=1'

if [[ "$FAIL" -ne 0 ]]; then echo "supabase-start-test: FAILED"; exit 1; fi
echo "supabase-start-test: OK (${#CASES[@]} cases, 15 mutants killed)"
