#!/usr/bin/env bash
# Verify that Claude's push reached GitHub AND triggered a ci.yml run
# (event=push) for the exact pushed commit.
#
# O-007: no `git fetch` here. claude-run-task.yml checks out with
# `persist-credentials: false` (RUNBOOK §1.1), and claude-code-action puts the
# Claude App token into the remote URL and revokes it when its step ends, so a
# later `git fetch` fails with "Invalid username or token" (run 45323782247,
# exit 128) even though the push and its CI already happened. Instead, read the
# remote branch tip with the job's GH_TOKEN through the REST API:
#   1. gh api repos/<repo>/git/ref/heads/<branch>  -> exact ref object + SHA
#   2. gh run list --workflow ci.yml --event push   -> a run with that headSha
#
# Fail-closed (exit 1) on: missing/invalid input, branch 404, API 401/403 or
# any other gh error, a response that is not exactly one ref object for this
# branch (e.g. a JSON array from a prefix match), a non-40-hex SHA, invalid
# run-list JSON, or no matching push run after the configured attempts.
# There is no `|| true` / `continue-on-error` on any verification path.
#
# Inputs:
#   $1 (optional)       branch; default: current branch, else task/$TASK
#   GH_TOKEN            required, used by gh; never printed
#   GITHUB_REPOSITORY   required, owner/repo
#   VERIFY_PUSH_ATTEMPTS  positive integer, default 12
#   VERIFY_PUSH_SLEEP     non-negative integer seconds, default 15
#   GITHUB_OUTPUT       optional; receives verify_reason=<code>
#   PRE_HEAD            required, 40-hex SHA recorded before Claude
#                       (workflow: steps.pre_head.outputs.pre_head)
#
# verify_reason codes (for Notify / 幕僚長 routing):
#   ok | bad_input | branch_missing | api_auth | api_error | bad_ref_json |
#   head_mismatch | stale_head | run_list_error | bad_run_json | no_push_run
#
# O-026: after reading the remote tip, require remote == local HEAD
# (git rev-parse HEAD; no git fetch) and remote != PRE_HEAD before looking
# for a ci.yml event=push run for that SHA. The push run need only have been
# triggered (in_progress or conclusion=failure still counts). A missing run
# is no_push_run. A push CI for an earlier SHA is not ok.
set -euo pipefail

REASON="bad_input"
write_reason() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'verify_reason=%s\n' "$REASON" >>"$GITHUB_OUTPUT"
  fi
}
fail() {
  REASON="$1"
  shift
  echo "ERROR: verify-push: $*"
  exit 1
}

TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP"
  write_reason
}
trap cleanup EXIT

# --- inputs ---------------------------------------------------------------
if [[ -z "${GH_TOKEN:-}" ]]; then
  fail bad_input "GH_TOKEN is empty (pass GH_TOKEN: \${{ github.token }} to this step)"
fi
REPO="${GITHUB_REPOSITORY:-}"
if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail bad_input "GITHUB_REPOSITORY must be owner/repo, got '${REPO}'"
fi
ATTEMPTS="${VERIFY_PUSH_ATTEMPTS:-12}"
SLEEP_S="${VERIFY_PUSH_SLEEP:-15}"
if [[ ! "$ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  fail bad_input "VERIFY_PUSH_ATTEMPTS must be a positive integer, got '${ATTEMPTS}'"
fi
if [[ ! "$SLEEP_S" =~ ^[0-9]+$ ]]; then
  fail bad_input "VERIFY_PUSH_SLEEP must be a non-negative integer, got '${SLEEP_S}'"
fi

BRANCH="${1:-}"
if [[ -z "$BRANCH" ]]; then
  # Local only (reads .git/HEAD); no network, no credentials needed.
  if ! BRANCH="$(git branch --show-current)"; then
    fail bad_input "git branch --show-current failed"
  fi
fi
if [[ ! "$BRANCH" =~ ^(task|fix)/ ]]; then
  if [[ -z "${TASK:-}" ]]; then
    fail bad_input "current branch '${BRANCH}' is not task/ or fix/, and TASK is empty"
  fi
  BRANCH="task/${TASK}"
fi
if [[ ! "$BRANCH" =~ ^(task|fix)/[A-Za-z0-9._-]+$ || "$BRANCH" == *..* ]]; then
  fail bad_input "branch '${BRANCH}' is not a single-segment task/ or fix/ branch"
fi

# --- 1. remote branch tip via REST (exact ref object) ---------------------
echo "Reading remote ref repos/${REPO}/git/ref/heads/${BRANCH} via gh api"
if ! gh api "repos/${REPO}/git/ref/heads/${BRANCH}" >"$TMP/ref.json" 2>"$TMP/ref.err"; then
  echo "----- gh api stderr -----"
  cat "$TMP/ref.err"
  if grep -q 'HTTP 404' "$TMP/ref.err"; then
    fail branch_missing "remote branch ${BRANCH} not found (HTTP 404); Claude's push did not reach GitHub"
  elif grep -Eq 'HTTP 40[13]' "$TMP/ref.err"; then
    fail api_auth "GitHub API rejected GH_TOKEN reading refs/heads/${BRANCH} (HTTP 401/403)"
  fi
  fail api_error "gh api failed reading refs/heads/${BRANCH}"
fi
if ! SHA="$(jq -er --arg ref "refs/heads/${BRANCH}" '
    if type == "object"
       and .ref == $ref
       and (.object | type) == "object"
       and .object.type == "commit"
       and (.object.sha | type) == "string"
       and (.object.sha | test("^[0-9a-f]{40}$"))
    then .object.sha
    else error("not exactly one commit ref object for \($ref)")
    end' "$TMP/ref.json" 2>"$TMP/ref.jq.err")"; then
  echo "----- jq -----"
  cat "$TMP/ref.jq.err"
  echo "----- response (first 300 bytes) -----"
  head -c 300 "$TMP/ref.json"
  echo
  fail bad_ref_json "gh api response is not a single ref object refs/heads/${BRANCH} with a 40-hex commit sha"
fi
echo "remote ${BRANCH} = ${SHA}"

# --- 1b. O-026: this run's local HEAD, not an earlier tip -----------------
# No git fetch (O-007): local HEAD is whatever this workspace has. The
# remote tip comes from gh api above.
if ! LOCAL_HEAD="$(git rev-parse HEAD 2>"$TMP/head.err")"; then
  echo "----- git rev-parse HEAD -----"
  cat "$TMP/head.err"
  fail bad_input "git rev-parse HEAD failed"
fi
if [[ ! "$LOCAL_HEAD" =~ ^[0-9a-f]{40}$ ]]; then
  fail bad_input "local HEAD '${LOCAL_HEAD}' is not a 40-hex SHA"
fi
if [[ ! "${PRE_HEAD:-}" =~ ^[0-9a-f]{40}$ ]]; then
  fail bad_input "PRE_HEAD must be a 40-hex SHA (pass steps.pre_head.outputs.pre_head), got '${PRE_HEAD:-}'"
fi
echo "local HEAD = ${LOCAL_HEAD}"
echo "PRE_HEAD = ${PRE_HEAD}"
[[ "$SHA" != "$LOCAL_HEAD" ]] && fail head_mismatch "remote ${BRANCH} ${SHA} != local HEAD ${LOCAL_HEAD}"
[[ "$SHA" == "$PRE_HEAD" ]] && fail stale_head "remote ${BRANCH} ${SHA} equals PRE_HEAD (nothing new was pushed this run)"

# --- 2. a push-triggered ci.yml run for that exact SHA --------------------
echo "Looking for ci.yml run event=push branch=${BRANCH} sha=${SHA}"
for ((i = 1; i <= ATTEMPTS; i++)); do
  if ! gh run list --repo "$REPO" --workflow ci.yml --branch "$BRANCH" --event push \
      --limit 20 --json databaseId,headSha,headBranch,event,status,conclusion,url,createdAt \
      >"$TMP/runs.json" 2>"$TMP/runs.err"; then
    echo "----- gh run list stderr -----"
    cat "$TMP/runs.err"
    fail run_list_error "gh run list failed (auth/API error); cannot confirm push CI for ${SHA}"
  fi
  if ! MATCH="$(jq -ec --arg sha "$SHA" --arg br "$BRANCH" '
      if type == "array"
      then [.[] | select(type == "object" and .event == "push"
                         and .headSha == $sha and .headBranch == $br)]
      else error("gh run list did not return a JSON array")
      end' "$TMP/runs.json" 2>"$TMP/runs.jq.err")"; then
    cat "$TMP/runs.jq.err"
    fail bad_run_json "gh run list returned invalid JSON"
  fi
  if [[ "$(jq 'length' <<<"$MATCH")" -gt 0 ]]; then
    jq . <<<"$MATCH"
    REASON="ok"
    echo "Found push-triggered CI run for ${BRANCH} @ ${SHA}"
    exit 0
  fi
  echo "Attempt ${i}/${ATTEMPTS}: no matching push CI run yet"
  if ((i < ATTEMPTS)); then
    sleep "$SLEEP_S"
  fi
done
echo "----- last gh run list (event=push) -----"
jq -c '.[] | {databaseId, event, headBranch, headSha, status}' "$TMP/runs.json"
fail no_push_run "no event=push ci.yml run found for ${BRANCH} @ ${SHA} after ${ATTEMPTS} attempt(s)"
