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
//      package-adding `pnpm install <pkg>` stay not-allowed.
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

export function parseSkillAllowedTools(md) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!fm) throw new Error('run-task SKILL.md: frontmatter not found');
  const line = fm[1].split('\n').find((l) => l.startsWith('allowed-tools:'));
  if (!line) throw new Error('run-task SKILL.md: allowed-tools not found');
  return splitToolList(line.slice('allowed-tools:'.length));
}

export function loadInputs(root) {
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  if (!settings.permissions) throw new Error('.claude/settings.json: permissions missing');
  const workflowTools = parseWorkflowAllowedTools(
    readFileSync(join(root, '.github/workflows/claude-run-task.yml'), 'utf8'),
  );
  const skillTools = parseSkillAllowedTools(
    readFileSync(join(root, '.claude/skills/run-task/SKILL.md'), 'utf8'),
  );
  return { perms: settings.permissions, workflowTools, skillTools };
}

export function checkPermissions({ perms, workflowTools, skillTools }) {
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
  process.stdout.write('claude-permission-check: OK (real env files denied, .env.example readable, lockfile update aligned, pnpm add/remove not allowed)\n');
  process.exitCode = 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
