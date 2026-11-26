#!/usr/bin/env bash
# O-009 / O-021: G3 PR comment violation check (charter v7 §9 / §1.1).
# Reads every comment on a PR whose title starts with "[G3]" (issue comments,
# review bodies, review comments), runs tooling/comment-lint.mjs on them and
# writes the result as the commit status "g3-comment-guard" on the PR head.
# All comments are authored by hansheng08, so comment-lint can only classify
# by leading text (TechLead Review / QA ... + local rerun of pnpm check etc.).
#
# Fail-closed: a GitHub API error, unparsable JSON, a comment-lint error or a
# failed status write all exit 1. When the head SHA is known, an API/lint
# error also tries to write a "failure" status so the PR shows red.
# The head SHA is taken only from the PR JSON head.sha (40-hex), never from
# GITHUB_SHA or the merge ref.
# A PR whose title does not start with "[G3]" still writes a success status
# on that head SHA with description "not a [G3] PR; not checked" (O-021).
#
# Env: GH_TOKEN REPO PR_NUMBER RUN_URL; optional TOOLING_DIR (tests), GH_BIN (tests).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
GH="${GH_BIN:-gh}"
CONTEXT="g3-comment-guard"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HEAD_SHA=""

post_status() { # <state> <description>
  "$GH" api -X POST "repos/${REPO}/statuses/${HEAD_SHA}" \
    -f state="$1" -f context="$CONTEXT" -f description="$2" -f target_url="${RUN_URL:-}" > /dev/null
}

die() {
  echo "g3-comment-guard: ERROR: $*" >&2
  if [[ -n "$HEAD_SHA" ]]; then
    if ! post_status failure "g3-comment-guard error: see run log"; then
      echo "g3-comment-guard: ERROR: could not write the failure status either" >&2
    fi
  fi
  exit 1
}

[[ -n "${REPO:-}" ]] || die "REPO is empty"
[[ "${PR_NUMBER:-}" =~ ^[0-9]+$ ]] || die "PR_NUMBER '${PR_NUMBER:-}' is not a number"

"$GH" api "repos/${REPO}/pulls/${PR_NUMBER}" > "$WORK/pr.json" || die "cannot read PR #${PR_NUMBER}"
SHA="$(jq -er '.head.sha | strings' "$WORK/pr.json")" || die "PR JSON has no head.sha"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "head.sha '${SHA}' is not a 40-hex SHA"
HEAD_SHA="$SHA"
TITLE="$(jq -er '.title | strings' "$WORK/pr.json")" || die "PR JSON has no title"
if [[ "$TITLE" != "[G3]"* ]]; then
  post_status success "not a [G3] PR; not checked" || die "cannot write the success status"
  echo "g3-comment-guard: PR #${PR_NUMBER} title does not start with [G3]; not checked"
  exit 0
fi

# Each endpoint is paginated; every page is a JSON array of objects with id and body.
i=0
for ep in "issues/${PR_NUMBER}/comments" "pulls/${PR_NUMBER}/reviews" "pulls/${PR_NUMBER}/comments"; do
  i=$((i + 1))
  "$GH" api --paginate "repos/${REPO}/${ep}?per_page=100" --jq '.[] | {id, body, url: .html_url}' > "$WORK/part$i.jsonl" \
    || die "cannot read ${ep}"
done
jq -s '.' "$WORK"/part*.jsonl > "$WORK/comments.json" || die "comment pages are not valid JSON"
COUNT="$(jq 'length' "$WORK/comments.json")"
echo "g3-comment-guard: PR #${PR_NUMBER} head ${HEAD_SHA}: ${COUNT} comment(s)"

[[ -f "$TOOLING_DIR/comment-lint.mjs" ]] || die "comment-lint.mjs is missing"
set +e
node "$TOOLING_DIR/comment-lint.mjs" --comments "$WORK/comments.json"
LINT=$?
set -e
case "$LINT" in
  0) post_status success "${COUNT} comment(s), no violation" || die "cannot write the success status"
     echo "g3-comment-guard: OK" ;;
  1) post_status failure "G3 comment violation (TechLead Review / QA local rerun); see run log" \
       || die "cannot write the failure status"
     echo "g3-comment-guard: violation found" >&2
     exit 1 ;;
  *) die "comment-lint exited ${LINT}" ;;
esac
