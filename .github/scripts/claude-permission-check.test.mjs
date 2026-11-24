// Tests for claude-permission-check.mjs (O-005 / Q-27, O-006). Run in CI pushguard.
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
  '.github/scripts/verify-push.sh',
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
  assert.match(r.out, /claude-run-task\.yml --max-turns: 200/);
  assert.match(r.out, /run-task SKILL\.md: git add explicit-path rule and built-in tool reminder present/);
  assert.match(r.out, /claude-run-task\.yml checkout: persist-credentials: false/);
  assert.match(r.out, /verify-push\.sh: no git fetch, gh api git\/ref\/heads, Verify step GH_TOKEN=github\.token/);
  assert.match(r.out, /anthropics\/claude-code-action pinned to a commit SHA/);
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

// B-003 (O-004 re-review): run-task SKILL carries the report-number rule
// (O-009: charter v6 §13 rule 9 replaces v5 rule 11), rule 12 and the
// mandatory 「權限被拒」 report section.
test('B-003 / O-009: run-task SKILL has charter v6 §13 rules #9, #12 and 權限被拒 section', () => {
  const md = readFileSync(join(REPO, '.claude/skills/run-task/SKILL.md'), 'utf8');
  assert.match(md, /報告不貼測試輸出、不手打數字/);
  assert.match(md, /憲章 v6 §13 第 9 條/);
  assert.doesNotMatch(md, /憲章 v5/);
  assert.match(md, /指令被權限擋下時，不得拆成幾條重送或換寫法繞過/);
  assert.match(md, /^## 報告：權限被拒（必填）$/m);
  assert.match(md, /^## 權限被拒$/m);
  assert.match(md, /沒有就寫「0 次」/);
  assert.match(md, /以 execution artifact 為準/);
});

// O-006: --max-turns 200 and SKILL git-add / built-in tool rules.
test('O-006: parseWorkflowMaxTurns and missingSkillSnippets unit cases', async () => {
  const { parseWorkflowMaxTurns, missingSkillSnippets, REQUIRED_SKILL_SNIPPETS } = await import('./claude-permission-check.mjs');
  assert.equal(parseWorkflowMaxTurns('claude_args: \'--max-turns 200 --allowedTools "Read"\''), 200);
  assert.throws(() => parseWorkflowMaxTurns('claude_args: --allowedTools "Read"'), /--max-turns <N> not found/);
  assert.throws(() => parseWorkflowMaxTurns('--max-turns 200\n--max-turns 120'), /conflicting --max-turns values: 200, 120/);
  assert.deepEqual(missingSkillSnippets(REQUIRED_SKILL_SNIPPETS.join('\n')), []);
  assert.deepEqual(missingSkillSnippets(''), REQUIRED_SKILL_SNIPPETS);
});

test('M13 mutation: --max-turns 200 changed to 120 -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.github/workflows/claude-run-task.yml';
    f[k] = f[k].replace('--max-turns 200', '--max-turns 120');
    assert.match(f[k], /--max-turns 120/);
    assert.doesNotMatch(f[k], /--max-turns 200/);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /claude-run-task\.yml --max-turns is 120, expected 200/);
});

test('M14 mutation: remove --max-turns entirely -> exit 1 (fail-closed)', () => {
  const r = runMutated((f) => {
    const k = '.github/workflows/claude-run-task.yml';
    f[k] = f[k].replace('--max-turns 200 ', '');
    assert.doesNotMatch(f[k], /--max-turns/);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--max-turns <N> not found/);
});

test('M15 mutation: --max-turns 200 changed to 199 -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.github/workflows/claude-run-task.yml';
    f[k] = f[k].replace('--max-turns 200', '--max-turns 199');
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /claude-run-task\.yml --max-turns is 199, expected 200/);
});

test('M16 mutation: conflicting --max-turns 200 and 120 -> exit 1 (fail-closed)', () => {
  const r = runMutated((f) => {
    const k = '.github/workflows/claude-run-task.yml';
    f[k] = f[k].replace('--max-turns 200', '--max-turns 200 --max-turns 120');
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /conflicting --max-turns values: 200, 120/);
});

test('M17 mutation: remove git add -A prohibition from SKILL.md -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.claude/skills/run-task/SKILL.md';
    const before = f[k];
    // The phrase is repeated in step 6 and in the commit／push section; drop every copy.
    f[k] = f[k].replaceAll('嚴禁使用 `git add -A`、`git add --all`、`git add .`、`git add -u`', '可用 git add 一次加入多個檔案');
    assert.notEqual(f[k], before);
    assert.doesNotMatch(f[k], /嚴禁使用 `git add -A`/);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run-task SKILL\.md is missing required rule snippet: 嚴禁使用 `git add -A`、`git add --all`、`git add \.`、`git add -u`/);
});

test('M18 mutation: remove built-in tool / sed／head reminder from SKILL.md -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.claude/skills/run-task/SKILL.md';
    // O-009 extended the sentence after `head`, so drop the shared prefix only.
    f[k] = f[k].replace('讀檔、編輯與搜尋請直接用內建 Read／Edit／Write／Grep／Glob 工具，避免透過 Bash 呼叫 `sed` 或 `head`', '');
    assert.doesNotMatch(f[k], /避免透過 Bash 呼叫 `sed` 或 `head`/);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run-task SKILL\.md is missing required rule snippet: 讀檔、編輯與搜尋請直接用內建 Read／Edit／Write／Grep／Glob 工具/);
  assert.match(r.out, /避免透過 Bash 呼叫 `sed` 或 `head`/);
});

// O-007: checkout persist-credentials, verify-push without git fetch,
// claude-code-action SHA pin. Each mutation must make the CLI exit 1.
const WF = '.github/workflows/claude-run-task.yml';
const VP = '.github/scripts/verify-push.sh';

test('O-007 unit: checkoutPersistProblems / verifyPushProblems / claudeActionPinProblems', async () => {
  const m = await import('./claude-permission-check.mjs');
  assert.deepEqual(m.checkoutPersistProblems('    steps:\n      - uses: actions/checkout@v6\n        with:\n          persist-credentials: false\n      - name: x\n'), []);
  assert.match(m.checkoutPersistProblems('    steps:\n      - uses: actions/checkout@v6\n        with:\n          fetch-depth: 0\n      - name: x\n        with:\n          persist-credentials: false\n').join(), /does not set persist-credentials: false/);
  assert.match(m.checkoutPersistProblems('steps:\n  - name: x\n').join(), /no actions\/checkout step found/);
  assert.deepEqual(m.claudeActionPinProblems('uses: anthropics/claude-code-action@eb56b6666facdbd501035f4a0269d8caee2e7a8b # v1'), []);
  assert.match(m.claudeActionPinProblems('uses: anthropics/claude-code-action@v1').join(), /@v1 is not pinned/);
  assert.match(m.claudeActionPinProblems('uses: actions/checkout@v6').join(), /claude-code-action step not found/);
  assert.match(m.verifyPushProblems('# git fetch in a comment is fine\ngit fetch origin x\n', '').join('\n'), /line 2 runs git fetch/);
});

test('M19 mutation: checkout persist-credentials false -> true -> exit 1', () => {
  const r = runMutated((f) => {
    f[WF] = f[WF].replace('          persist-credentials: false', '          persist-credentials: true');
    assert.match(f[WF], /persist-credentials: true/);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /does not set persist-credentials: false/);
  assert.match(r.out, /persist-credentials: true at line \d+/);
});

test('M20 mutation: remove persist-credentials from checkout -> exit 1', () => {
  const r = runMutated((f) => {
    f[WF] = f[WF].replace('          persist-credentials: false\n', '');
    assert.doesNotMatch(f[WF], /^\s*persist-credentials:/m);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /actions\/checkout step at line \d+ does not set persist-credentials: false/);
});

test('M21 mutation: reintroduce git fetch in verify-push.sh -> exit 1', () => {
  const r = runMutated((f) => {
    f[VP] = f[VP].replace('# --- 1. remote branch tip', 'git fetch origin "refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"\n# --- 1. remote branch tip');
    assert.match(f[VP], /^git fetch origin/m);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /verify-push\.sh line \d+ runs git fetch: git fetch origin/);
});

test('M22 mutation: verify-push.sh no longer uses gh api git/ref/heads -> exit 1', () => {
  const r = runMutated((f) => {
    f[VP] = f[VP].replace('gh api "repos/${REPO}/git/ref/heads/${BRANCH}"', 'gh api "repos/${REPO}/branches/${BRANCH}"');
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /verify-push\.sh does not read the branch with gh api/);
});

test('M23 mutation: Verify step without GH_TOKEN: github.token -> exit 1', () => {
  const r = runMutated((f) => {
    const i = f[WF].indexOf('- name: Verify push triggered CI');
    const j = f[WF].indexOf('- name: Detect denied-command resplit');
    assert.ok(i > 0 && j > i);
    const step = f[WF].slice(i, j).replace('          GH_TOKEN: ${{ github.token }}\n', '');
    f[WF] = f[WF].slice(0, i) + step + f[WF].slice(j);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Verify step does not set GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test('M24 mutation: claude-code-action back to @v1 -> exit 1', () => {
  const r = runMutated((f) => {
    f[WF] = f[WF].replace(/anthropics\/claude-code-action@[0-9a-f]{40}/, 'anthropics/claude-code-action@v1');
    assert.match(f[WF], /claude-code-action@v1\b/);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /anthropics\/claude-code-action@v1 is not pinned to a 40-hex commit SHA/);
});

test('M25 mutation: verify-push.sh missing -> exit 1 (fail-closed)', () => {
  const root = mkdtempSync(join(tmpdir(), 'perm-check-'));
  try {
    for (const f of FILES.filter((x) => x !== VP)) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), readFileSync(join(REPO, f), 'utf8'));
    }
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ERROR: claude-permission-check: .*verify-push\.sh/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('M26 mutation (O-009): SKILL step 6 back to a combined commit + push -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.claude/skills/run-task/SKILL.md';
    const before = f[k];
    f[k] = f[k].replace('commit 與 push 從第一次就分成三次各自獨立的 Bash 呼叫', 'commit 之後再 push');
    assert.notEqual(f[k], before);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run-task SKILL\.md is missing required rule snippet: commit 與 push 從第一次就分成三次各自獨立的 Bash 呼叫/);
});

test('M27 mutation (O-009): SKILL allows chaining git with && -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.claude/skills/run-task/SKILL.md';
    const before = f[k];
    f[k] = f[k].replace('不得用 `&&`、`;`、`|`、`2>&1`', '可以用 `&&` 串接');
    assert.notEqual(f[k], before);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /missing required rule snippet: 不得用 `&&`、`;`、`\|`、`2>&1`/);
});

test('M28 mutation (O-009): SKILL push without -u origin <分支名稱> -> exit 1', () => {
  const r = runMutated((f) => {
    const k = '.claude/skills/run-task/SKILL.md';
    const before = f[k];
    f[k] = f[k].replace('`git push -u origin <分支名稱>`', '`git push`');
    assert.notEqual(f[k], before);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /missing required rule snippet: `git push -u origin <分支名稱>`/);
});
