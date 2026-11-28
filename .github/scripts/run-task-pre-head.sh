#!/usr/bin/env bash
# O-012: runs in claude-run-task.yml BEFORE the Claude step. Resolves the
# branch the task file names (`## 分支`, via tooling/task-file.mjs) and the
# commit that branch points at right now (origin/<branch>, or origin/main
# when the branch does not exist yet). run-task-post-check.sh then checks
# every commit in <pre_head>..HEAD with scope-check --all-non-qa, so any
# commit Claude makes that touches a QA-owned file fails the run regardless
# of its message prefix or author.
# Writes branch=<name> and pre_head=<40-hex> to GITHUB_OUTPUT.
# Fail-closed: a missing/unparsable task file, a branch that is not
# task/<id> or fix/Q-<nnn>, or an unresolvable ref exits 1 (Claude is skipped).
# Env: TASK GITHUB_OUTPUT; optional TOOLING_DIR (tests), TASKS_DIR (tests).
set -euo pipefail

TOOLING_DIR="${TOOLING_DIR:-tooling}"
TASKS_DIR="${TASKS_DIR:-docs/tasks}"
die() { echo "run-task-pre-head: ERROR: $*" >&2; exit 1; }

[[ "${TASK:-}" =~ ^[TQOAP]-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?$ ]] || die "invalid TASK '${TASK:-}'"
[[ -n "${GITHUB_OUTPUT:-}" ]] || die "GITHUB_OUTPUT is not set"
[[ -f "${TASKS_DIR}/${TASK}.md" ]] || die "task file ${TASKS_DIR}/${TASK}.md does not exist"

TASK_FILE_MJS="$(cd "$TOOLING_DIR" && pwd)/task-file.mjs"
BRANCH="$(node --input-type=module -e '
const [mod, dir, id] = process.argv.slice(1);
const { loadTasks, parseTaskFile } = await import(mod);
const r = loadTasks(dir);
if (!r.ok) { console.error(r.message); process.exit(1); }
const t = r.tasks.find((x) => x.id === id);
if (t === undefined) { console.error(`task ${id} not found`); process.exit(1); }
const b = parseTaskFile(t).branch;
if (typeof b !== "string" || b === "") { console.error(`task ${id} has no branch`); process.exit(1); }
process.stdout.write(b);
' "$TASK_FILE_MJS" "$TASKS_DIR" "$TASK")" || die "cannot read the branch of ${TASK}"
[[ "$BRANCH" =~ ^(task/[TQOAP]-[0-9]{3}[a-z]?|fix/Q-[0-9]{3}[a-z]?)$ ]] || die "branch '${BRANCH}' is not task/<id> or fix/Q-<nnn>"

if PRE_HEAD="$(git rev-parse --verify -q "refs/remotes/origin/${BRANCH}^{commit}")"; then
  echo "run-task-pre-head: ${BRANCH} exists at ${PRE_HEAD}"
else
  PRE_HEAD="$(git rev-parse --verify "refs/remotes/origin/main^{commit}")" || die "cannot resolve origin/main"
  echo "run-task-pre-head: ${BRANCH} does not exist yet; using origin/main ${PRE_HEAD}"
fi
[[ "$PRE_HEAD" =~ ^[0-9a-f]{40}$ ]] || die "pre_head '${PRE_HEAD}' is not a 40-hex SHA"
{
  echo "branch=${BRANCH}"
  echo "pre_head=${PRE_HEAD}"
} >> "$GITHUB_OUTPUT"
