#!/usr/bin/env bash
# O-016: on pull_request, the PR description's「## Actions 分鐘數影響」must be
# filled in when the PR changes .github/workflows/** (tooling/pr-body-lint.mjs).
# The description is read from the API (the CURRENT text), not from the event
# payload, so a rerun after editing the description sees the edit. ci.yml does
# not trigger on `edited` (that would re-run all of CI on every description
# edit): after fixing the description, push a new commit or rerun the job.
# Fail-closed: a missing input, git error, gh error or lint failure exits 1.
# Env: REPO PR_NUMBER BASE_SHA HEAD_SHA GH_TOKEN; optional RUNNER_TEMP,
#      TOOLING_DIR (tests).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
OUT_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
die() { echo "pr-body-check: ERROR: $*" >&2; exit 1; }

for v in REPO PR_NUMBER BASE_SHA HEAD_SHA; do
  [[ -n "${!v:-}" ]] || die "${v} is empty"
done
[[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]] || die "PR_NUMBER '${PR_NUMBER}' is not a PR number"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "REPO '${REPO}' is not owner/name"

CHANGED="$OUT_DIR/pr-body-changed.txt"
BODY="$OUT_DIR/pr-body.md"
# --no-renames: moving a workflow out of .github/workflows/ still counts as changing it.
git diff --no-renames --name-only "${BASE_SHA}...${HEAD_SHA}" > "$CHANGED" || die "git diff ${BASE_SHA}...${HEAD_SHA} failed"
gh api "repos/${REPO}/pulls/${PR_NUMBER}" --jq '.body // ""' > "$BODY" || die "gh api repos/${REPO}/pulls/${PR_NUMBER} failed (cannot read the current PR description)"
echo "pr-body-check: PR #${PR_NUMBER}, $(wc -l < "$CHANGED" | tr -d ' ') changed file(s), $(awk '/^\.github\/workflows\// { n++ } END { print n + 0 }' "$CHANGED") under .github/workflows/"
if ! node "$TOOLING_DIR/pr-body-lint.mjs" --body "$BODY" --changed "$CHANGED"; then
  echo "pr-body-check: fill in「## Actions 分鐘數影響」in the PR description, then push a new commit or rerun this job (description edits do not trigger ci.yml)" >&2
  exit 1
fi
