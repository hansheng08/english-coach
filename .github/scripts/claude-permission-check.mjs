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
//
// Matching model (an approximation; the live Claude Code matcher is
// 未驗證 until observed in a real run-task):
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    return tool === 'Read' ? readRuleMatches(pattern, value) : bashRuleMatches(pattern, value);
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
    if (!/run:\s*bash \.github\/scripts\/verify-push\.sh/.test(m[1])) {
      problems.push('claude-run-task.yml: Verify step does not run .github/scripts/verify-push.sh');
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

export function loadInputs(root) {
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  if (!settings.permissions) throw new Error('.claude/settings.json: permissions missing');
  const workflowYml = readFileSync(join(root, '.github/workflows/claude-run-task.yml'), 'utf8');
  const skillMd = readFileSync(join(root, '.claude/skills/run-task/SKILL.md'), 'utf8');
  const workflowTools = parseWorkflowAllowedTools(workflowYml);
  const skillTools = parseSkillAllowedTools(skillMd);
  const maxTurns = parseWorkflowMaxTurns(workflowYml);
  const verifySh = readFileSync(join(root, '.github/scripts/verify-push.sh'), 'utf8');
  return { perms: settings.permissions, workflowTools, skillTools, skillMd, maxTurns, workflowYml, verifySh };
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
  process.stdout.write('claude-permission-check: OK (real env files denied, .env.example readable, lockfile update aligned, pnpm add/remove not allowed, --max-turns 200, SKILL git-add, separate add/commit/push and built-in tool rules present, checkout persist-credentials false, verify-push without git fetch, claude-code-action SHA-pinned, pnpm db:test allowed, supabase start before Claude)\n');
  process.exitCode = 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
