#!/usr/bin/env bash
# Verify that Claude's push triggered a ci.yml run (event=push).
# A failed `git fetch` MUST fail this script (no `|| true`).
set -euo pipefail

BRANCH="${1:-}"
if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git branch --show-current)"
fi
if [[ ! "$BRANCH" =~ ^(task|fix)/ ]]; then
  BRANCH="task/${TASK:?TASK or a task/|fix/ branch is required}"
fi

echo "fetching origin/${BRANCH}"
# o004: do not add `|| true` here. A fetch failure means we cannot see the
# remote branch, so skipping the check would be fail-open (TechLead / O-004).
git fetch origin "refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
if ! git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  echo "ERROR: origin/${BRANCH} is missing after a successful fetch."
  exit 1
fi
SHA="$(git rev-parse "origin/${BRANCH}")"
echo "Looking for ci.yml run event=push branch=${BRANCH} sha=${SHA}"
for i in $(seq 1 "${VERIFY_PUSH_ATTEMPTS:-12}"); do
  RUN_JSON="$(gh run list --workflow ci.yml --branch "${BRANCH}" --event push --limit 20 --json databaseId,headSha,event,status,conclusion,url,createdAt)"
  MATCH="$(jq -c --arg sha "$SHA" '[.[] | select(.headSha==$sha)]' <<<"$RUN_JSON")"
  if [[ "$(jq 'length' <<<"$MATCH")" -gt 0 ]]; then
    echo "$MATCH" | jq .
    echo "Found push-triggered CI run for ${SHA}"
    exit 0
  fi
  echo "Attempt ${i}/${VERIFY_PUSH_ATTEMPTS:-12}: no matching push CI run yet, waiting 15s..."
  sleep "${VERIFY_PUSH_SLEEP:-15}"
done
echo "ERROR: no event=push ci.yml run found for ${BRANCH} @ ${SHA} after retries"
gh run list --workflow ci.yml --branch "${BRANCH}" --limit 10
exit 1
