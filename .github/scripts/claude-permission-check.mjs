// O-005 / Q-27: static rule check for Claude Code permissions.
//
// Verifies, against the real files, that:
//   1. real env files (.env, .env.local, .env.production, ... at root and
//      nested) are denied by `.claude/settings.json` Read rules;
//   2. `.env.example` (root and nested) is NOT denied (deny always beats
//      allow in Claude Code, so a broad `Read(**/.env.*)` would block it);
//   3. `pnpm install --no-frozen-lockfile` is permitted consistently in
//      `.claude/settings.json`, the `--allowedTools` list of
//      `.github/workflows/claude-run-task.yml`, and the run-task SKILL
//      `allowed-tools`, while `pnpm add *`, `pnpm remove *` and
//      package-adding `pnpm install <pkg>` stay not-allowed;
//   4. `.github/workflows/claude-run-task.yml` sets `--max-turns 200`
//      (O-006; T-003 run 45314135320 completed 170 turns and the action
//      then failed because 170 exceeded the previous limit of 120);
//   5. run-task SKILL.md requires explicit-path `git add` (forbids
//      `-A` / `--all` / `.` / `-u`) and tells the model to use built-in
//      Read/Edit/Write/Grep/Glob instead of Bash `sed` or `head`;
//   6. (O-007) every `actions/checkout` step in claude-run-task.yml sets
//      `persist-credentials: false` (RUNBOOK §1.1) and no step sets it true;
//   7. (O-007) `.github/scripts/verify-push.sh` runs no `git fetch` (it
//      failed with the revoked App token in run 45323782247) and reads the
//      branch with `gh api .../git/ref/heads/`; the Verify step passes
//      `GH_TOKEN: ${{ github.token }}`;
//   8. (O-007) `anthropics/claude-code-action` is pinned to a 40-hex SHA.
//   9. (O-009) run-task SKILL.md sends git add / git commit / git push as
//      three separate standalone Bash calls from the start (O-008 run
//      45418884942: a denied compound push followed by a lone push was
//      flagged as a resplit) and cites charter v6 §13 rule 9 for reports.
//  10. (O-010) `pnpm db:test` (with or without --tap-dir) is allowed in
//      settings.json, in the workflow --allowedTools and listed in the SKILL
//      allowed-tools; the SKILL tells the model to run it until `db-test: OK`;
//      claude-run-task.yml installs a SHA-pinned supabase/setup-cli and runs
//      `supabase start` before the Claude step, with no continue-on-error.
//  11. (O-012, O-013) QA-owned files (**/*.qa.test.ts,
//      supabase/tests/qa_*.sql, docs/qa/mutants/*.json)
//      are denied for Write and Edit in settings.json while ordinary tests
//      and other SQL stay writable; the SKILL states that only QA changes
//      them; claude-run-task.yml records the branch head before Claude and
//      passes PRE_HEAD/BRANCH to the post-check, and run-task-post-check.sh
//      runs scope-check --all-non-qa on that range.
//  12. (O-032) task id / branch definitions are frozen: every regex under
//      .github/ that names the task-id prefix class is one of the two
//      definitions of docs/tasks/O-032.md (TASK_ID_RE_SRC, BRANCH_RE_SRC), and
//      the validate / pre-head / post-check / usage-limit / taskcheck scripts
//      use them; run-task-validate-id.sh sets LC_ALL=C, reads TASK from env
//      only and never prints the raw value; claude-run-task.yml has checkout
//      (no `if`, persist-credentials: false) as step 1 and Validate as step 3
//      (O-033 put the snapshot at step 2), no step before Validate uses the
//      id, Notify and Upload run-task outcome stay if: always(), concurrency
//      group and artifact names unchanged.
//  13. (O-033) "Snapshot trusted scripts" (step 2) copies .github/scripts and
//      tooling to $RUNNER_TEMP/trusted; every step from the task-branch switch
//      on runs guard scripts / tools only from there (TOOLING_DIR trusted),
//      and only the snapshot writes the trusted root
//      (tooling/trusted-scripts.mjs trustedScriptProblems).
//
// Matching model (an approximation; the live Claude Code matcher is
// 未驗證 until observed in a real run-task):
//   - Read/Write/Edit share the path rules below
//   - Read(./x)  -> path x relative to the repo root only
//   - Read(**/x) -> x at any depth, including the repo root
//   - Read(/x)   -> relative to the settings file's project root (same as ./)
//   - Read(x) without a slash -> basename match at any depth (gitignore style)
//   - `**` matches across `/`, `*` and `?` stay within one path segment
//   - Bash(cmd) -> whole-command match, `*` matches any characters
//   - precedence: deny > ask > allow (headless runs cannot answer `ask`)
//
// Usage: node .github/scripts/claude-permission-check.mjs [repoRoot]
// Exit 0 when every check passes, 1 otherwise (fail-closed: unreadable or
// unparsable files are errors).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// O-033: the trusted-snapshot rules (Claude-written pure function).
import { trustedScriptProblems } from '../../tooling/trusted-scripts.mjs';

export const REAL_ENV_FILES = [
  '.env',
  'apps/web/.env',
  'supabase/functions/.env',
  '.env.local',
  'apps/web/.env.local',
  '.env.development',
  'apps/web/.env.development',
  '.env.development.local',
  '.env.production',
  'apps/web/.env.production',
  '.env.production.local',
  '.env.staging',
  '.env.test',
  'apps/web/.env.test.local',
  '.env.preview',
  '.env.secret',
  '.env.prod',
  '.env.dev',
  '.env.keys',
];

export const EXAMPLE_ENV_FILES = [
  '.env.example',
  'apps/web/.env.example',
  'supabase/functions/.env.example',
];

export const APPROVED_LOCKFILE_UPDATE = 'pnpm install --no-frozen-lockfile';
export const FROZEN_INSTALL = 'pnpm install --frozen-lockfile';
export const UNAPPROVED_COMMANDS = [
  'pnpm add zod',
  'pnpm add -D vitest',
  'pnpm remove zod',
  'pnpm install zod',
  'pnpm install --no-frozen-lockfile zod',
  'pnpm i zod',
];

export const EXPECTED_MAX_TURNS = 200;

// O-010: pgTAP runner the model may call on Actions.
export const DB_TEST_COMMANDS = ['pnpm db:test', 'pnpm db:test --tap-dir .tmp/pgtap'];

// O-012: QA-owned files Claude must not Write/Edit, and look-alikes it may.
export const QA_OWNED_PATHS = [
  'root.qa.test.ts',
  'packages/domain/src/a.qa.test.ts',
  'apps/web/src/b.qa.test.ts',
  'supabase/tests/qa_probe.sql',
  // O-013: QA's mutants files.
  'docs/qa/mutants/T-015.json',
];
export const NOT_QA_PATHS = [
  'packages/domain/src/a.test.ts',
  'packages/domain/src/a.qa.test.tsx',
  'tooling/o012.test.mjs',
  'supabase/tests/t004_rls_test.sql',
  'supabase/tests/sub/qa_x.sql',
  'tooling/fixtures/o012/sample-fail.txt',
  'docs/qa/mutants/sub/x.json',
  'docs/qa/T-015.json',
  'docs/reports/T-015-fix1.md',
  'tooling/fixtures/o013/tasks/T-915.md',
];

// Substrings that must all appear in run-task SKILL.md (O-006).
export const REQUIRED_SKILL_SNIPPETS = [
  '一律使用 `git add <明確檔案路徑>`',
  '嚴禁使用 `git add -A`、`git add --all`、`git add .`、`git add -u`',
  '會遭權限擋下並依第 12 條停下',
  '讀檔、編輯與搜尋請直接用內建 Read／Edit／Write／Grep／Glob 工具',
  '避免透過 Bash 呼叫 `sed` 或 `head`',
  // O-009: add / commit / push as three standalone calls; report rule v6.
  'commit 與 push 從第一次就分成三次各自獨立的 Bash 呼叫',
  '`git push -u origin <分支名稱>`',
  '不得用 `&&`、`;`、`|`、`2>&1`',
  '憲章 v6 §13 第 9 條',
  // O-010: pgTAP via pnpm db:test; psql exit code is not the verdict.
  '`pnpm db:test` 時，要跑到它印出 `db-test: OK` 為止',
  // O-012: QA-owned files are QA's alone.
  'QA 擁有檔（`**/*.qa.test.ts`、`supabase/tests/qa_*.sql`、`docs/qa/mutants/*.json`）只由 QA 新增或修改',
];

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function pathGlobToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRe(c);
    }
  }
  return new RegExp(`^${out}$`);
}

// Returns true when a Read(<pattern>) rule matches repo-relative `path`.
export function readRuleMatches(pattern, path) {
  if (pattern.startsWith('~/') || pattern.startsWith('//')) return false;
  if (pattern.startsWith('./')) return pathGlobToRegExp(pattern.slice(2)).test(path);
  if (pattern.startsWith('**/')) {
    const rest = pattern.slice(3);
    return pathGlobToRegExp(rest).test(path) || pathGlobToRegExp(`**/${rest}`).test(path);
  }
  if (pattern.startsWith('/')) return pathGlobToRegExp(pattern.slice(1)).test(path);
  if (!pattern.includes('/')) {
    const base = path.split('/').pop();
    return pathGlobToRegExp(pattern).test(base);
  }
  return pathGlobToRegExp(pattern).test(path);
}

export function bashRuleMatches(pattern, command) {
  const re = new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
  return re.test(command);
}

const PATH_TOOLS = new Set(['Read', 'Write', 'Edit']);

function parseRule(rule) {
  const m = /^(\w+)\((.*)\)$/s.exec(rule.trim());
  if (!m) return { tool: rule.trim(), pattern: null };
  return { tool: m[1], pattern: m[2] };
}

function matchesAny(rules, tool, value) {
  return rules.filter((r) => {
    const { tool: t, pattern } = parseRule(r);
    if (t !== tool) return false;
    if (pattern === null) return true;
    return PATH_TOOLS.has(tool) ? readRuleMatches(pattern, value) : bashRuleMatches(pattern, value);
  });
}

// deny > ask > allow; returns { decision, rules }.
export function decide(perms, tool, value, extraAllow = []) {
  const deny = matchesAny(perms.deny ?? [], tool, value);
  if (deny.length) return { decision: 'deny', rules: deny };
  const ask = matchesAny(perms.ask ?? [], tool, value);
  if (ask.length) return { decision: 'ask', rules: ask };
  const allow = matchesAny([...(perms.allow ?? []), ...extraAllow], tool, value);
  if (allow.length) return { decision: 'allow', rules: allow };
  return { decision: 'none', rules: [] };
}

// Split "A, Bash(x, y), C" on top-level commas only.
export function splitToolList(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseWorkflowAllowedTools(yml) {
  const m = /--allowedTools\s+"([^"]+)"/.exec(yml);
  if (!m) throw new Error('claude-run-task.yml: --allowedTools "..." not found');
  return splitToolList(m[1]);
}

// Collect every `--max-turns <digits>` in the workflow. Fail-closed if none
// are present or if the values disagree. Does not default to 200.
export function parseWorkflowMaxTurns(yml) {
  const matches = [...yml.matchAll(/--max-turns\s+(\d+)/g)];
  if (!matches.length) throw new Error('claude-run-task.yml: --max-turns <N> not found');
  const values = [...new Set(matches.map((m) => Number(m[1])))];
  if (values.some((n) => !Number.isInteger(n))) {
    throw new Error('claude-run-task.yml: --max-turns value is not an integer');
  }
  if (values.length !== 1) {
    throw new Error(`claude-run-task.yml: conflicting --max-turns values: ${values.join(', ')}`);
  }
  return values[0];
}

// O-007: every actions/checkout step must set persist-credentials: false.
// A step is the block from its "- " line to the next "- " at the same indent
// (or a line with less indent). Returns a list of problems (empty = OK).
export function checkoutPersistProblems(yml) {
  const lines = yml.split(/\r?\n/);
  const problems = [];
  let checkouts = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(-\s+)?uses:\s*actions\/checkout@/.test(lines[i])) continue;
    checkouts++;
    let start = i;
    while (start > 0 && !/^\s*-\s/.test(lines[start])) start--;
    const indent = lines[start].search(/\S/);
    let end = start + 1;
    while (end < lines.length) {
      const l = lines[end];
      if (l.trim() !== '' && l.search(/\S/) <= indent) break;
      end++;
    }
    const block = lines.slice(start, end).join('\n');
    if (!/^\s*persist-credentials:\s*false\s*(#.*)?$/m.test(block)) {
      problems.push(`actions/checkout step at line ${i + 1} does not set persist-credentials: false`);
    }
  }
  if (checkouts === 0) problems.push('no actions/checkout step found');
  lines.forEach((l, i) => {
    if (/^\s*persist-credentials:\s*(true|['"]?true['"]?)\s*(#.*)?$/.test(l)) {
      problems.push(`persist-credentials: true at line ${i + 1}`);
    }
  });
  return problems;
}

// O-007: verify-push.sh must not git fetch (non-comment lines) and must read
// the ref via gh api; the Verify step must pass GH_TOKEN from github.token.
export function verifyPushProblems(verifySh, yml) {
  const problems = [];
  verifySh.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*#/.test(l)) return;
    if (/\bgit\s+fetch\b/.test(l)) problems.push(`verify-push.sh line ${i + 1} runs git fetch: ${l.trim()}`);
  });
  if (!/gh api "repos\/\$\{REPO\}\/git\/ref\/heads\/\$\{BRANCH\}"/.test(verifySh)) {
    problems.push('verify-push.sh does not read the branch with gh api "repos/${REPO}/git/ref/heads/${BRANCH}"');
  }
  const m = /- name: Verify push triggered CI\n([\s\S]*?)(?=\n\s*- name:|$)/.exec(yml);
  if (!m) {
    problems.push('claude-run-task.yml: "Verify push triggered CI" step not found');
  } else {
    if (!/^\s*GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}\s*$/m.test(m[1])) {
      problems.push('claude-run-task.yml: Verify step does not set GH_TOKEN: ${{ github.token }}');
    }
    // O-033: from the trusted snapshot (the step runs after the branch switch).
    if (!/run:\s*bash "\$\{RUNNER_TEMP\}\/trusted\/\.github\/scripts\/verify-push\.sh"/.test(m[1])) {
      problems.push('claude-run-task.yml: Verify step does not run "${RUNNER_TEMP}/trusted/.github/scripts/verify-push.sh"');
    }
  }
  return problems;
}

export function claudeActionPinProblems(yml) {
  const uses = [...yml.matchAll(/uses:\s*anthropics\/claude-code-action@(\S+)/g)].map((m) => m[1]);
  if (!uses.length) return ['claude-run-task.yml: anthropics/claude-code-action step not found'];
  return uses
    .filter((ref) => !/^[0-9a-f]{40}$/.test(ref))
    .map((ref) => `anthropics/claude-code-action@${ref} is not pinned to a 40-hex commit SHA`);
}

export function missingSkillSnippets(md) {
  return REQUIRED_SKILL_SNIPPETS.filter((s) => !md.includes(s));
}

export function parseSkillAllowedTools(md) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!fm) throw new Error('run-task SKILL.md: frontmatter not found');
  const line = fm[1].split('\n').find((l) => l.startsWith('allowed-tools:'));
  if (!line) throw new Error('run-task SKILL.md: allowed-tools not found');
  return splitToolList(line.slice('allowed-tools:'.length));
}

// O-010: Supabase must be installed (SHA-pinned) and started before Claude,
// and neither step may be continue-on-error (fail-closed).
export function supabaseStartProblems(yml) {
  const problems = [];
  const claudeIdx = yml.indexOf('- name: Run Claude Code');
  if (claudeIdx < 0) return ['claude-run-task.yml: "Run Claude Code" step not found'];
  const before = yml.slice(0, claudeIdx);
  const setup = /uses:\s*supabase\/setup-cli@([^\s#]+)/.exec(before);
  if (!setup) problems.push('claude-run-task.yml: no supabase/setup-cli step before Run Claude Code');
  else if (!/^[0-9a-f]{40}$/.test(setup[1])) problems.push(`claude-run-task.yml: supabase/setup-cli not pinned to a commit SHA (@${setup[1]})`);
  if (!/^\s+supabase start\b/m.test(before)) problems.push('claude-run-task.yml: no `supabase start` before Run Claude Code');
  if (setup && /continue-on-error:\s*true/.test(before.slice(setup.index))) problems.push('claude-run-task.yml: Supabase install/start must not be continue-on-error');
  return problems;
}

// O-012: pre-head step before Claude, PRE_HEAD/BRANCH into the post-check,
// and the post-check running scope-check --all-non-qa on that range.
export function qaOwnerWiringProblems(yml, postCheckSh) {
  const problems = [];
  const claudeIdx = yml.indexOf('- name: Run Claude Code');
  const preIdx = yml.indexOf('- name: Record branch head before Claude');
  if (preIdx < 0) problems.push('claude-run-task.yml: "Record branch head before Claude" step not found');
  else if (claudeIdx < 0 || preIdx > claudeIdx) problems.push('claude-run-task.yml: "Record branch head before Claude" must come before Run Claude Code');
  else if (!/- name: Record branch head before Claude\n\s+id: pre_head\n[\s\S]*?run: bash \.github\/scripts\/run-task-pre-head\.sh/.test(yml.slice(preIdx, claudeIdx))) {
    problems.push('claude-run-task.yml: pre-head step must have id pre_head and run .github/scripts/run-task-pre-head.sh');
  }
  const m = /- name: Report lint and automatic verification summary\n([\s\S]*?)(?=\n\s*- name:|$)/.exec(yml);
  if (!m) problems.push('claude-run-task.yml: post-check step not found');
  else {
    if (!/^\s*PRE_HEAD:\s*\$\{\{\s*steps\.pre_head\.outputs\.pre_head\s*\}\}\s*$/m.test(m[1])) problems.push('claude-run-task.yml: post-check step does not set PRE_HEAD from steps.pre_head.outputs.pre_head');
    if (!/^\s*BRANCH:\s*\$\{\{\s*steps\.pre_head\.outputs\.branch\s*\}\}\s*$/m.test(m[1])) problems.push('claude-run-task.yml: post-check step does not set BRANCH from steps.pre_head.outputs.branch');
  }
  const code = postCheckSh.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  if (!/scope-check\.mjs"? [^\n]*--commits [^\n]*--all-non-qa/.test(code)) problems.push('run-task-post-check.sh does not run scope-check --commits ... --all-non-qa');
  // O-013: task files from main (BASE_REF), not the branch tree.
  if (!/git archive --format=tar "\$BASE_REF" docs\/tasks/.test(code) || !/scope-check\.mjs"? [^\n]*--tasks-dir "\$MAIN_TASKS\/docs\/tasks"/.test(code)) {
    problems.push("run-task-post-check.sh does not pass --tasks-dir from main's docs/tasks (git archive $BASE_REF) to scope-check");
  }
  return problems;
}

// O-032: frozen definitions (docs/tasks/O-032.md 「定義」). Plain strings, the
// exact text the shell scripts carry.
export const TASK_ID_RE_SRC = '^[TQOAP]-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?$';
export const BRANCH_RE_SRC = '^(task/[TQOAP]-[0-9]{3}[a-z]?|fix/Q-[0-9]{3}[a-z]?)$';
const ID_PREFIX_CLASS = `[${'TQOAP'}]`;
export const O032_SCRIPT_DEFS = {
  'run-task-validate-id.sh': [TASK_ID_RE_SRC],
  'run-task-pre-head.sh': [TASK_ID_RE_SRC, BRANCH_RE_SRC],
  'run-task-post-check.sh': [TASK_ID_RE_SRC, BRANCH_RE_SRC],
  'run-task-usage-limit.sh': [TASK_ID_RE_SRC],
  'taskcheck.sh': [BRANCH_RE_SRC],
};
const VALIDATE_TASK_LINES = ['if [[ -n "${TASK-}" && "${TASK}" =~ $TASK_ID_RE ]]; then', 'safe="${TASK-}"'];

function codeLines(text) {
  return text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
}

// files: { '<path under root>': text } for every file under .github/.
export function taskIdRegexProblems(files) {
  const problems = [];
  for (const path of Object.keys(files).sort()) {
    files[path].split(/\r?\n/).forEach((line, i) => {
      if (!line.includes(ID_PREFIX_CLASS)) return;
      const rest = line.split(TASK_ID_RE_SRC).join('').split(BRANCH_RE_SRC).join('');
      if (rest.includes(ID_PREFIX_CLASS)) problems.push(`${path}:${i + 1}: task-id regex is not one of the O-032 definitions`);
    });
  }
  for (const [name, defs] of Object.entries(O032_SCRIPT_DEFS)) {
    const text = files[`.github/scripts/${name}`];
    if (typeof text !== 'string') { problems.push(`.github/scripts/${name} not found (O-032)`); continue; }
    const code = codeLines(text).join('\n');
    for (const d of defs) {
      if (!code.includes(d)) problems.push(`.github/scripts/${name} does not use the O-032 ${d === TASK_ID_RE_SRC ? 'task id' : 'branch'} definition`);
    }
  }
  const v = files['.github/scripts/run-task-validate-id.sh'];
  if (typeof v === 'string') {
    const code = codeLines(v);
    if (!code.some((l) => /^export LC_ALL=C\s*$/.test(l))) problems.push('run-task-validate-id.sh does not export LC_ALL=C');
    if (code.some((l) => /\$(\{?[0-9@*#]|\{#)/.test(l))) problems.push('run-task-validate-id.sh reads arguments (the id must come from env TASK only)');
    for (const l of code) {
      if (/\bTASK\b/.test(l) && !VALIDATE_TASK_LINES.includes(l.trim())) problems.push(`run-task-validate-id.sh uses TASK outside the match / sanitize lines: ${l.trim()}`);
    }
  }
  return problems;
}

function stepBlocks(yml) {
  const start = yml.indexOf('\n    steps:\n');
  if (start < 0) return null;
  const blocks = [];
  for (const line of yml.slice(start + '\n    steps:\n'.length).split('\n')) {
    if (/^ {6}- /.test(line)) blocks.push([line]);
    else if (blocks.length && !/^ {6}#/.test(line)) blocks[blocks.length - 1].push(line);
  }
  return blocks.map((b) => b.join('\n'));
}

// O-032: checkout first (no if), Validate after it, nothing before Validate
// uses the id; Notify / Upload run-task outcome always(); names unchanged.
// O-033: "Snapshot trusted scripts" is step 2, so Validate is now step 3.
export function runTaskOrderProblems(yml) {
  const problems = [];
  const blocks = stepBlocks(yml);
  if (!blocks || blocks.length < 2) return ['claude-run-task.yml: steps not found (O-032)'];
  const named = (n) => blocks.findIndex((b) => b.startsWith(`      - name: ${n}\n`));
  const first = blocks[0];
  if (!/^ {6}- uses: actions\/checkout@/.test(first)) problems.push('claude-run-task.yml: step 1 is not actions/checkout (O-032)');
  if (/^\s+if:/m.test(first)) problems.push('claude-run-task.yml: the first checkout has an `if` (O-032)');
  if (!/^ {10}persist-credentials: false\s*$/m.test(first)) problems.push('claude-run-task.yml: step 1 checkout does not set persist-credentials: false (O-032)');
  if (!/^ {10}fetch-depth: 0\s*$/m.test(first)) problems.push('claude-run-task.yml: step 1 checkout does not set fetch-depth: 0 (O-032)');
  const vi = named('Validate task id');
  if (named('Snapshot trusted scripts') !== 1) problems.push('claude-run-task.yml: "Snapshot trusted scripts" must be step 2 (O-033)');
  if (vi !== 2) problems.push(`claude-run-task.yml: "Validate task id" must be step 3 (found at ${vi < 0 ? 'none' : vi + 1}) (O-032, O-033)`);
  else {
    const v = blocks[2];
    if (!/^ {8}run: bash \.github\/scripts\/run-task-validate-id\.sh\s*$/m.test(v)) problems.push('claude-run-task.yml: Validate does not run .github/scripts/run-task-validate-id.sh (O-032)');
    if (!/^ {10}TASK: \$\{\{ github\.event\.client_payload\.task \}\}\s*$/m.test(v)) problems.push('claude-run-task.yml: Validate does not get TASK from env (O-032)');
    if (/^\s+(if|continue-on-error):/m.test(v)) problems.push('claude-run-task.yml: Validate has an `if` or continue-on-error (O-032)');
    if ((v.match(/client_payload\.task/g) ?? []).length !== 1) problems.push('claude-run-task.yml: Validate puts the task id somewhere other than env TASK (O-032)');
  }
  const firstUse = blocks.findIndex((b) => /client_payload\.task|\bTASK\b/.test(b));
  if (firstUse >= 0 && firstUse < 2) problems.push(`claude-run-task.yml: step ${firstUse + 1} uses the task id before Validate (O-032)`);
  for (const n of ['Task lint', 'Record branch head before Claude', 'Check out existing task branch', 'Run Claude Code']) {
    const i = named(n);
    if (i < 0) problems.push(`claude-run-task.yml: "${n}" step not found (O-032)`);
    else if (vi < 0 || i <= vi) problems.push(`claude-run-task.yml: "${n}" must come after Validate (O-032)`);
  }
  for (const n of ['Notify Grok chief of staff', 'Upload run-task outcome']) {
    const i = named(n);
    if (i < 0 || !/^ {8}if: always\(\)\s*$/m.test(blocks[i])) problems.push(`claude-run-task.yml: "${n}" is not if: always() (O-032)`);
  }
  if (!yml.includes('\nconcurrency:\n  group: claude-run-task-${{ github.event.client_payload.task }}\n  cancel-in-progress: false\n')) {
    problems.push('claude-run-task.yml: concurrency group / cancel-in-progress changed (O-032)');
  }
  const up = named('Upload run-task outcome');
  if (up < 0 || !blocks[up].includes('\n          name: run-task-outcome-${{ github.event.client_payload.task }}\n')) problems.push('claude-run-task.yml: run-task-outcome artifact name changed (O-032)');
  if (!yml.includes('\n          name: claude-execution-output-${{ github.event.client_payload.task }}-${{ github.run_id }}\n')) problems.push('claude-run-task.yml: claude-execution-output artifact name changed (O-032)');
  return problems;
}

function readTree(root, dir, out) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) readTree(root, rel, out);
    else if (e.isFile()) out[rel] = readFileSync(join(root, rel), 'utf8');
  }
  return out;
}

export function loadInputs(root) {
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  if (!settings.permissions) throw new Error('.claude/settings.json: permissions missing');
  const workflowYml = readFileSync(join(root, '.github/workflows/claude-run-task.yml'), 'utf8');
  const skillMd = readFileSync(join(root, '.claude/skills/run-task/SKILL.md'), 'utf8');
  const workflowTools = parseWorkflowAllowedTools(workflowYml);
  const skillTools = parseSkillAllowedTools(skillMd);
  const maxTurns = parseWorkflowMaxTurns(workflowYml);
  const verifySh = readFileSync(join(root, '.github/scripts/verify-push.sh'), 'utf8');
  const postCheckSh = readFileSync(join(root, '.github/scripts/run-task-post-check.sh'), 'utf8');
  const githubFiles = readTree(root, '.github', {});
  return { perms: settings.permissions, workflowTools, skillTools, skillMd, maxTurns, workflowYml, verifySh, postCheckSh, githubFiles };
}

export function checkPermissions(inputs) {
  const { perms, workflowTools, skillTools } = inputs;
  const errors = [];
  const report = [];

  for (const p of REAL_ENV_FILES) {
    const d = decide(perms, 'Read', p);
    report.push(`Read ${p}: ${d.decision}${d.rules.length ? ` (${d.rules[0]})` : ''}`);
    if (d.decision !== 'deny') errors.push(`real env file not denied: Read ${p} -> ${d.decision}`);
  }
  for (const p of EXAMPLE_ENV_FILES) {
    const d = decide(perms, 'Read', p);
    report.push(`Read ${p}: ${d.decision === 'deny' ? `deny (${d.rules.join(', ')})` : 'not denied'}`);
    if (d.decision === 'deny') errors.push(`example env file is denied: Read ${p} by ${d.rules.join(', ')}`);
  }

  const lockLocal = decide(perms, 'Bash', APPROVED_LOCKFILE_UPDATE);
  const lockActions = decide(perms, 'Bash', APPROVED_LOCKFILE_UPDATE, workflowTools);
  const lockSkill = matchesAny(skillTools, 'Bash', APPROVED_LOCKFILE_UPDATE);
  report.push(`Bash "${APPROVED_LOCKFILE_UPDATE}": settings=${lockLocal.decision} actions=${lockActions.decision} skill=${lockSkill.length ? 'listed' : 'not listed'}`);
  if (lockLocal.decision !== 'allow') errors.push(`settings.json does not allow "${APPROVED_LOCKFILE_UPDATE}" (got ${lockLocal.decision})`);
  if (lockActions.decision !== 'allow') errors.push(`claude-run-task.yml + settings do not allow "${APPROVED_LOCKFILE_UPDATE}" (got ${lockActions.decision})`);
  if (!matchesAny(workflowTools, 'Bash', APPROVED_LOCKFILE_UPDATE).length) errors.push(`claude-run-task.yml --allowedTools does not list "${APPROVED_LOCKFILE_UPDATE}"`);
  if (!lockSkill.length) errors.push(`run-task SKILL allowed-tools does not list "${APPROVED_LOCKFILE_UPDATE}"`);

  const frozenLocal = decide(perms, 'Bash', FROZEN_INSTALL);
  const frozenActions = decide(perms, 'Bash', FROZEN_INSTALL, workflowTools);
  report.push(`Bash "${FROZEN_INSTALL}": settings=${frozenLocal.decision} actions=${frozenActions.decision}`);
  if (frozenLocal.decision !== 'allow' || frozenActions.decision !== 'allow') errors.push(`"${FROZEN_INSTALL}" must stay allowed (settings=${frozenLocal.decision} actions=${frozenActions.decision})`);

  for (const cmd of UNAPPROVED_COMMANDS) {
    const local = decide(perms, 'Bash', cmd);
    const actions = decide(perms, 'Bash', cmd, workflowTools);
    const skill = matchesAny(skillTools, 'Bash', cmd);
    report.push(`Bash "${cmd}": settings=${local.decision} actions=${actions.decision} skill=${skill.length ? `listed (${skill[0]})` : 'not listed'}`);
    if (local.decision === 'allow') errors.push(`settings.json allows unapproved "${cmd}" via ${local.rules.join(', ')}`);
    if (actions.decision === 'allow') errors.push(`claude-run-task.yml allows unapproved "${cmd}" via ${actions.rules.join(', ')}`);
    if (skill.length) errors.push(`run-task SKILL allowed-tools allows unapproved "${cmd}" via ${skill.join(', ')}`);
  }

  for (const cmd of DB_TEST_COMMANDS) {
    const local = decide(perms, 'Bash', cmd);
    const actions = decide(perms, 'Bash', cmd, workflowTools);
    const listed = matchesAny(workflowTools, 'Bash', cmd);
    const skill = matchesAny(skillTools, 'Bash', cmd);
    report.push(`Bash "${cmd}": settings=${local.decision} actions=${actions.decision} skill=${skill.length ? 'listed' : 'not listed'}`);
    if (local.decision !== 'allow') errors.push(`settings.json does not allow "${cmd}" (got ${local.decision})`);
    if (actions.decision !== 'allow') errors.push(`claude-run-task.yml + settings do not allow "${cmd}" (got ${actions.decision})`);
    if (!listed.length) errors.push(`claude-run-task.yml --allowedTools does not list "${cmd}"`);
    if (!skill.length) errors.push(`run-task SKILL allowed-tools does not list "${cmd}"`);
  }

  // O-012: QA-owned files denied for Write/Edit; look-alikes stay writable.
  for (const tool of ['Write', 'Edit']) {
    for (const p of QA_OWNED_PATHS) {
      const d = decide(perms, tool, p);
      report.push(`${tool} ${p}: ${d.decision}${d.rules.length ? ` (${d.rules[0]})` : ''}`);
      if (d.decision !== 'deny') errors.push(`QA-owned file not denied: ${tool} ${p} -> ${d.decision}`);
    }
    for (const p of NOT_QA_PATHS) {
      const d = decide(perms, tool, p);
      if (d.decision === 'deny') errors.push(`non-QA file is denied: ${tool} ${p} by ${d.rules.join(', ')}`);
    }
  }

  const maxTurns = inputs.maxTurns;
  report.push(`claude-run-task.yml --max-turns: ${maxTurns}`);
  if (maxTurns !== EXPECTED_MAX_TURNS) {
    errors.push(`claude-run-task.yml --max-turns is ${maxTurns}, expected ${EXPECTED_MAX_TURNS}`);
  }

  const skillMd = inputs.skillMd ?? '';
  const missing = missingSkillSnippets(skillMd);
  if (missing.length) {
    for (const s of missing) {
      errors.push(`run-task SKILL.md is missing required rule snippet: ${s}`);
    }
  } else {
    report.push('run-task SKILL.md: git add explicit-path rule and built-in tool reminder present');
  }

  // O-007 checks. Missing inputs are errors (fail-closed), not skips.
  const yml = inputs.workflowYml;
  const verifySh = inputs.verifySh;
  if (typeof yml !== 'string' || typeof verifySh !== 'string') {
    errors.push('O-007 inputs missing: claude-run-task.yml and verify-push.sh text are required');
  } else {
    const persist = checkoutPersistProblems(yml);
    errors.push(...persist);
    if (!persist.length) report.push('claude-run-task.yml checkout: persist-credentials: false');
    const vp = verifyPushProblems(verifySh, yml);
    errors.push(...vp);
    if (!vp.length) report.push('verify-push.sh: no git fetch, gh api git/ref/heads, Verify step GH_TOKEN=github.token');
    const pin = claudeActionPinProblems(yml);
    errors.push(...pin);
    if (!pin.length) report.push('claude-run-task.yml: anthropics/claude-code-action pinned to a commit SHA');
    const sb = supabaseStartProblems(yml);
    errors.push(...sb);
    if (!sb.length) report.push('claude-run-task.yml: supabase/setup-cli SHA-pinned and supabase start before Claude');
    if (typeof inputs.postCheckSh !== 'string') {
      errors.push('O-012 input missing: run-task-post-check.sh text is required');
    } else {
      const qa = qaOwnerWiringProblems(yml, inputs.postCheckSh);
      errors.push(...qa);
      if (!qa.length) report.push('claude-run-task.yml: pre-head before Claude, post-check scope-check --all-non-qa on PRE_HEAD..HEAD');
    }
    // O-032. Missing input is an error (fail-closed), not a skip.
    if (inputs.githubFiles === null || typeof inputs.githubFiles !== 'object') {
      errors.push('O-032 input missing: the .github/ file map is required');
    } else {
      const ids = taskIdRegexProblems(inputs.githubFiles);
      errors.push(...ids);
      if (!ids.length) report.push('O-032: every task-id / branch regex under .github/ is a frozen definition; validate-id env-only, LC_ALL=C, no raw echo');
    }
    const order = runTaskOrderProblems(yml);
    errors.push(...order);
    if (!order.length) report.push('claude-run-task.yml: checkout (no if) step 1, Snapshot step 2, Validate step 3, id used only after Validate, Notify/outcome upload always(), names unchanged');
    // O-033: after the task-branch switch, guard scripts and tools only from
    // the trusted snapshot (docs/tasks/O-033.md 「定義」).
    const trusted = trustedScriptProblems(yml).map((p) => `claude-run-task.yml: ${p} (O-033)`);
    errors.push(...trusted);
    if (!trusted.length) report.push('O-033: Snapshot trusted scripts at step 2; every step after the task-branch switch runs .github/scripts and tooling from $RUNNER_TEMP/trusted, TOOLING_DIR trusted');
  }
  return { errors, report };
}

function main() {
  const root = process.argv[2] ?? process.cwd();
  let result;
  try {
    result = checkPermissions(loadInputs(root));
  } catch (err) {
    process.stdout.write(`ERROR: claude-permission-check: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${result.report.join('\n')}\n`);
  if (result.errors.length) {
    process.stdout.write(`ERROR: claude-permission-check: ${result.errors.length} problem(s)\n${result.errors.map((e) => `  - ${e}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('claude-permission-check: OK (real env files denied, .env.example readable, lockfile update aligned, pnpm add/remove not allowed, --max-turns 200, SKILL git-add, separate add/commit/push and built-in tool rules present, checkout persist-credentials false, verify-push without git fetch, claude-code-action SHA-pinned, pnpm db:test allowed, supabase start before Claude, QA-owned files denied and --all-non-qa post-check wired, O-032 task id definitions and checkout-then-Validate order frozen, O-033 guard scripts from the trusted snapshot after the branch switch)\n');
  process.exitCode = 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
