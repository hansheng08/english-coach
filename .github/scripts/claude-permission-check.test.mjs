// Tests for claude-permission-check.mjs (O-005 / Q-27). Run in CI pushguard.
// Includes exit-code assertions on the real repo and mutation tests that copy
// the three input files to a temp dir, inject one bad rule, and assert the
// CLI exits 1 with a message naming the problem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readRuleMatches,
  bashRuleMatches,
  splitToolList,
  decide,
} from './claude-permission-check.mjs';

const SCRIPT = fileURLToPath(new URL('./claude-permission-check.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const FILES = [
  '.claude/settings.json',
  '.claude/skills/run-task/SKILL.md',
  '.github/workflows/claude-run-task.yml',
];

function run(root) {
  const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Copy the real inputs to a temp root, apply `mutate(files)`, run the CLI.
function runMutated(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'perm-check-'));
  try {
    const files = {};
    for (const f of FILES) files[f] = readFileSync(join(REPO, f), 'utf8');
    mutate(files);
    for (const f of FILES) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), files[f]);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function editSettings(files, fn) {
  const s = JSON.parse(files['.claude/settings.json']);
  fn(s.permissions);
  files['.claude/settings.json'] = JSON.stringify(s, null, 2);
}

test('real repo passes with exit 0', () => {
  const r = run(REPO);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /claude-permission-check: OK/);
});

test('matcher: ./ is root-only, **/ is any depth including root', () => {
  assert.equal(readRuleMatches('./.env', '.env'), true);
  assert.equal(readRuleMatches('./.env', 'apps/web/.env'), false);
  assert.equal(readRuleMatches('**/.env', '.env'), true);
  assert.equal(readRuleMatches('**/.env', 'apps/web/.env'), true);
  assert.equal(readRuleMatches('**/.env.*.local', 'apps/web/.env.production.local'), true);
  assert.equal(readRuleMatches('**/.env.*', '.env.example'), true);
  assert.equal(readRuleMatches('**/.env.prod*', 'apps/web/.env.example'), false);
  assert.equal(readRuleMatches('~/.ssh/**', '.ssh/id'), false);
});

test('matcher: Bash * is a wildcard, no * is exact', () => {
  assert.equal(bashRuleMatches('pnpm install --no-frozen-lockfile', 'pnpm install --no-frozen-lockfile'), true);
  assert.equal(bashRuleMatches('pnpm install --no-frozen-lockfile', 'pnpm install --no-frozen-lockfile zod'), false);
  assert.equal(bashRuleMatches('pnpm install *', 'pnpm install zod'), true);
  assert.equal(bashRuleMatches('pnpm add *', 'pnpm add zod'), true);
});

test('decide: deny beats allow, ask beats allow', () => {
  const perms = { allow: ['Read(**/.env.example)'], ask: ['Bash(pnpm add *)'], deny: ['Read(**/.env.*)'] };
  assert.equal(decide(perms, 'Read', '.env.example').decision, 'deny');
  assert.equal(decide(perms, 'Bash', 'pnpm add zod', ['Bash(pnpm add *)']).decision, 'ask');
  assert.equal(decide(perms, 'Bash', 'pnpm i zod').decision, 'none');
});

test('splitToolList keeps commas inside parentheses', () => {
  assert.deepEqual(splitToolList(' Read, Bash(a, b), Glob '), ['Read', 'Bash(a, b)', 'Glob']);
});

test('M1 mutation: broad Read(**/.env.*) in deny blocks .env.example -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => p.deny.push('Read(**/.env.*)')));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /example env file is denied: Read \.env\.example by Read\(\*\*\/\.env\.\*\)/);
});

test('M2 mutation: drop .env.local deny rules -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => {
    p.deny = p.deny.filter((x) => x !== 'Read(./.env.local)' && x !== 'Read(**/.env.local)');
  }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /real env file not denied: Read \.env\.local/);
});

test('M3 mutation: keep only root ./.env (nested apps/web/.env readable) -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.deny = p.deny.filter((x) => x !== 'Read(**/.env)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /real env file not denied: Read apps\/web\/\.env /);
});

test('M4 mutation: drop .env.prod* deny rules -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.deny = p.deny.filter((x) => !x.includes('.env.prod')); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /real env file not denied: Read \.env\.production/);
});

test('M5 mutation: Bash(pnpm add *) in settings allow (and not ask) -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => {
    p.ask = p.ask.filter((x) => x !== 'Bash(pnpm add *)');
    p.allow.push('Bash(pnpm add *)');
  }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /settings\.json allows unapproved "pnpm add zod"/);
});

test('M6 mutation: workflow --allowedTools back to Bash(pnpm install *) -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.github/workflows/claude-run-task.yml';
    f[k] = f[k].replace('Bash(pnpm install --frozen-lockfile*), Bash(pnpm install --no-frozen-lockfile)', 'Bash(pnpm install *)');
    assert.match(f[k], /Bash\(pnpm install \*\)/);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /claude-run-task\.yml allows unapproved "pnpm install zod" via Bash\(pnpm install \*\)/);
});

test('M7 mutation: remove the lockfile rule from settings allow -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.allow = p.allow.filter((x) => x !== 'Bash(pnpm install --no-frozen-lockfile)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /settings\.json does not allow "pnpm install --no-frozen-lockfile"/);
});

test('M8 mutation: lockfile rule moved to ask -> exit 1 (headless cannot answer ask)', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.ask.push('Bash(pnpm install --no-frozen-lockfile)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /does not allow "pnpm install --no-frozen-lockfile" \(got ask\)/);
});

test('M9 mutation: remove the lockfile rule from workflow --allowedTools -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.github/workflows/claude-run-task.yml';
    f[k] = f[k].replace(' Bash(pnpm install --no-frozen-lockfile),', '');
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /claude-run-task\.yml --allowedTools does not list "pnpm install --no-frozen-lockfile"/);
});

test('M10 mutation: SKILL allowed-tools back to Bash(pnpm install *) -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.claude/skills/run-task/SKILL.md';
    f[k] = f[k].replace('Bash(pnpm install --frozen-lockfile*), Bash(pnpm install --no-frozen-lockfile)', 'Bash(pnpm install *)');
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run-task SKILL allowed-tools allows unapproved "pnpm install zod"/);
});

test('M11 mutation: unparsable settings.json -> exit 1 (fail-closed)', () => {
  const r = runMutated((f) => { f['.claude/settings.json'] = '{ not json'; });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ERROR: claude-permission-check:/);
});

test('M12 mutation: workflow without --allowedTools -> exit 1 (fail-closed)', () => {
  const r = runMutated((f) => {
    const k = '.github/workflows/claude-run-task.yml';
    f[k] = f[k].replace('--allowedTools', '--allowed-tools-renamed');
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--allowedTools "\.\.\." not found/);
});

// B-003 (O-004 re-review): run-task SKILL carries charter v5 §13 rules 11/12
// and the mandatory 「權限被拒」 report section.
test('B-003: run-task SKILL has charter v5 §13 rules #11, #12 and 權限被拒 section', () => {
  const md = readFileSync(join(REPO, '.claude/skills/run-task/SKILL.md'), 'utf8');
  assert.match(md, /數字與輸出一律從原始輸出或 execution artifact 複製，不得手打或改寫/);
  assert.match(md, /指令被權限擋下時，不得拆成幾條重送或換寫法繞過/);
  assert.match(md, /^## 報告：權限被拒（必填）$/m);
  assert.match(md, /^## 權限被拒$/m);
  assert.match(md, /沒有就寫「0 次」/);
  assert.match(md, /以 execution artifact 為準/);
});
