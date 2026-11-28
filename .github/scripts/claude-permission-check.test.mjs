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
  '.github/scripts/run-task-post-check.sh',
  // O-032: the task-id / branch definition freeze reads these too.
  '.github/scripts/run-task-validate-id.sh',
  '.github/scripts/run-task-pre-head.sh',
  '.github/scripts/run-task-usage-limit.sh',
  '.github/scripts/taskcheck.sh',
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
  assert.match(r.out, /Bash "pnpm db:test": settings=allow actions=allow skill=listed/);
  assert.match(r.out, /supabase\/setup-cli SHA-pinned and supabase start before Claude/);
  assert.match(r.out, /Edit supabase\/tests\/qa_probe\.sql: deny/);
  assert.match(r.out, /Write root\.qa\.test\.ts: deny/);
  assert.match(r.out, /Edit docs\/qa\/mutants\/T-015\.json: deny \(Edit\(\.\/docs\/qa\/mutants\/\*\.json\)\)/);
  assert.match(r.out, /pre-head before Claude, post-check scope-check --all-non-qa on PRE_HEAD\.\.HEAD/);
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

const YML = '.github/workflows/claude-run-task.yml';
const SK = '.claude/skills/run-task/SKILL.md';
function mut(f, k, from, to) {
  const before = f[k];
  f[k] = f[k].replace(from, to);
  assert.notEqual(f[k], before, `anchor not found in ${k}: ${from}`);
}

test('M29 mutation (O-010): drop Bash(pnpm db:test*) from settings allow -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => {
    const n = p.allow.length;
    p.allow = p.allow.filter((x) => x !== 'Bash(pnpm db:test*)');
    assert.equal(p.allow.length, n - 1);
  }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /settings\.json does not allow "pnpm db:test"/);
});

test('M30 mutation (O-010): pnpm db:test moved to ask -> exit 1 (headless cannot answer ask)', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.ask.push('Bash(pnpm db:test*)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /claude-run-task\.yml \+ settings do not allow "pnpm db:test --tap-dir \.tmp\/pgtap" \(got ask\)/);
});

test('M31 mutation (O-010): drop Bash(pnpm db:test*) from workflow --allowedTools -> exit 1', () => {
  const r = runMutated((f) => mut(f, YML, ', Bash(pnpm db:test*)', ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--allowedTools does not list "pnpm db:test"/);
});

test('M32 mutation (O-010): SKILL allowed-tools without db:test -> exit 1', () => {
  const r = runMutated((f) => mut(f, SK, ', Bash(pnpm db:test*)\n---', '\n---'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run-task SKILL allowed-tools does not list "pnpm db:test"/);
});

test('M33 mutation (O-010): SKILL loses the run-db:test-until-OK rule -> exit 1', () => {
  const r = runMutated((f) => mut(f, SK, '要跑到它印出 `db-test: OK` 為止', '可視情況執行'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /missing required rule snippet: `pnpm db:test` 時，要跑到它印出 `db-test: OK` 為止/);
});

test('M34 mutation (O-010): supabase start removed from claude-run-task.yml -> exit 1', () => {
  const r = runMutated((f) => mut(f, YML, /\n {10}supabase start [^\n]*/, ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no `supabase start` before Run Claude Code/);
});

test('M35 mutation (O-010): supabase/setup-cli back to a tag -> exit 1', () => {
  const r = runMutated((f) => mut(f, YML, /supabase\/setup-cli@[0-9a-f]{40}/, 'supabase/setup-cli@v3'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /supabase\/setup-cli not pinned to a commit SHA \(@v3\)/);
});

test('M36 mutation (O-010): Supabase start marked continue-on-error -> exit 1', () => {
  const r = runMutated((f) => mut(f, YML, '        id: supabase_start\n', '        id: supabase_start\n        continue-on-error: true\n'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /must not be continue-on-error/);
});

test('M37 mutation (O-010): Supabase steps moved after Run Claude Code -> exit 1', () => {
  const r = runMutated((f) => {
    const y = f[YML];
    const a = y.indexOf('      - uses: supabase/setup-cli@');
    const b = y.indexOf('      - name: Run Claude Code');
    const c = y.indexOf('      - name: Summarize permission denials');
    assert.ok(a > 0 && b > a && c > b);
    f[YML] = y.slice(0, a) + y.slice(b, c) + y.slice(a, b) + y.slice(c);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no supabase\/setup-cli step before Run Claude Code/);
});

const PC = '.github/scripts/run-task-post-check.sh';

test('M38 mutation (O-012): drop Edit(**/*.qa.test.ts) deny -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => {
    const n = p.deny.length;
    p.deny = p.deny.filter((x) => x !== 'Edit(**/*.qa.test.ts)');
    assert.equal(p.deny.length, n - 1);
  }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /QA-owned file not denied: Edit root\.qa\.test\.ts -> none/);
});

test('M39 mutation (O-012): drop Write(./supabase/tests/qa_*.sql) deny -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => {
    const n = p.deny.length;
    p.deny = p.deny.filter((x) => x !== 'Write(./supabase/tests/qa_*.sql)');
    assert.equal(p.deny.length, n - 1);
  }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /QA-owned file not denied: Write supabase\/tests\/qa_probe\.sql -> none/);
});

test('M40 mutation (O-012): over-broad Edit(**/*.test.ts) deny blocks ordinary tests -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.deny.push('Edit(**/*.test.ts)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /non-QA file is denied: Edit packages\/domain\/src\/a\.test\.ts/);
});

test('M41 mutation (O-012): over-broad Write(./supabase/tests/**) deny -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.deny.push('Write(./supabase/tests/**)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /non-QA file is denied: Write supabase\/tests\/t004_rls_test\.sql/);
});

test('M42 mutation (O-012): SKILL loses the QA-owned-files rule -> exit 1', () => {
  const r = runMutated((f) => mut(f, SK, 'QA 擁有檔（`**/*.qa.test.ts`、`supabase/tests/qa_*.sql`、`docs/qa/mutants/*.json`）只由 QA 新增或修改', 'QA 檔可改'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /missing required rule snippet: QA 擁有檔/);
});

test('M43 mutation (O-012): pre-head step removed -> exit 1', () => {
  const r = runMutated((f) => mut(f, YML, /      - name: Record branch head before Claude\n[\s\S]*?run: bash \.github\/scripts\/run-task-pre-head\.sh\n/, ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /"Record branch head before Claude" step not found/);
});

test('M44 mutation (O-012): pre-head step moved after Run Claude Code -> exit 1', () => {
  const r = runMutated((f) => {
    const y = f[YML];
    const a = y.indexOf('      # O-012: record the branch');
    const b = y.indexOf('      # O-010: start the local Supabase stack');
    const c = y.indexOf('      - name: Summarize permission denials');
    assert.ok(a > 0 && b > a && c > b);
    f[YML] = y.slice(0, a) + y.slice(b, c) + y.slice(a, b) + y.slice(c);
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /must come before Run Claude Code/);
});

test('M45 mutation (O-012): post-check without PRE_HEAD env -> exit 1', () => {
  const r = runMutated((f) => mut(f, YML, /\n {10}PRE_HEAD: \$\{\{ steps\.pre_head\.outputs\.pre_head \}\}/, ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /post-check step does not set PRE_HEAD/);
});

test('M46 mutation (O-012): post-check without BRANCH env -> exit 1', () => {
  const r = runMutated((f) => mut(f, YML, /\n {10}BRANCH: \$\{\{ steps\.pre_head\.outputs\.branch \}\}/, ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /post-check step does not set BRANCH/);
});

test('M47 mutation (O-012): post-check drops --all-non-qa -> exit 1', () => {
  const r = runMutated((f) => mut(f, PC, ' --all-non-qa --tasks-dir', ' --tasks-dir'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run-task-post-check\.sh does not run scope-check --commits \.\.\. --all-non-qa/);
});

test('M48 mutation (O-012): post-check missing -> exit 1 (fail-closed)', () => {
  const root = mkdtempSync(join(tmpdir(), 'perm-check-'));
  try {
    for (const f of FILES.filter((x) => x !== PC)) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), readFileSync(join(REPO, f), 'utf8'));
    }
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /run-task-post-check\.sh/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('M49 mutation (O-013): drop Edit(./docs/qa/mutants/*.json) deny -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => {
    const n = p.deny.length;
    p.deny = p.deny.filter((x) => x !== 'Edit(./docs/qa/mutants/*.json)');
    assert.equal(p.deny.length, n - 1);
  }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /QA-owned file not denied: Edit docs\/qa\/mutants\/T-015\.json -> none/);
});

test('M50 mutation (O-013): drop Write(./docs/qa/mutants/*.json) deny -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => {
    const n = p.deny.length;
    p.deny = p.deny.filter((x) => x !== 'Write(./docs/qa/mutants/*.json)');
    assert.equal(p.deny.length, n - 1);
  }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /QA-owned file not denied: Write docs\/qa\/mutants\/T-015\.json -> none/);
});

test('M51 mutation (O-013): over-broad Write(./docs/qa/**) deny -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.deny.push('Write(./docs/qa/**)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /non-QA file is denied: Write docs\/qa\/mutants\/sub\/x\.json/);
});

test('M52 mutation (O-013): over-broad Edit(./docs/**/*.md) deny blocks the fix report -> exit 1', () => {
  const r = runMutated((f) => editSettings(f, (p) => { p.deny.push('Edit(./docs/**/*.md)'); }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /non-QA file is denied: Edit docs\/reports\/T-015-fix1\.md/);
});

test('M53 mutation (O-013): SKILL QA-owned list without docs/qa/mutants -> exit 1', () => {
  const r = runMutated((f) => mut(f, SK, '、`docs/qa/mutants/*.json`）只由 QA', '）只由 QA'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /missing required rule snippet: QA 擁有檔/);
});

test('M54 mutation (O-013): post-check scope-check back to the branch tree tasks (no --tasks-dir) -> exit 1', () => {
  const r = runMutated((f) => mut(f, PC, ' --tasks-dir "$MAIN_TASKS/docs/tasks"', ''));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run-task-post-check\.sh does not pass --tasks-dir from main's docs\/tasks/);
});

// ---------------------------------------------------------------------------
// O-032: task id / branch definitions and the checkout-then-Validate order.
// Old and weakened regexes are assembled from pieces so this file itself
// carries no task-id regex other than the frozen definitions (TC-13 scans
// every file under .github/, this one included).
const VID = '.github/scripts/run-task-validate-id.sh';
const PH = '.github/scripts/run-task-pre-head.sh';
const UL = '.github/scripts/run-task-usage-limit.sh';
const TC = '.github/scripts/taskcheck.sh';
const CLS = `[${'TQOAP'}]`;
const DEF_ID = `^${CLS}-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?$`;
const DEF_BR = `^(task/${CLS}-[0-9]{3}[a-z]?|fix/Q-[0-9]{3}[a-z]?)$`;
const OLD_ID = `^${CLS}-[0-9]{3}(-fix[0-9]+)?$`;
const OLD_BR = `^(task/${CLS}-[0-9]{3}|fix/Q-[0-9]{3})$`;

// Like runMutated, but also writes files the mutation adds.
function runMutatedAll(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'perm-check-o032-'));
  try {
    const files = {};
    for (const f of FILES) files[f] = readFileSync(join(REPO, f), 'utf8');
    mutate(files);
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), text);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function stepText(yml, startsWith) {
  const i = yml.indexOf(startsWith);
  assert.ok(i >= 0, `step ${startsWith} not found`);
  const next = yml.indexOf('\n      - ', i + 1);
  return yml.slice(i, next < 0 ? yml.length : next + 1);
}

function expectO32Fail(name, mutate, re) {
  test(`${name} -> exit 1`, () => {
    const r = runMutatedAll(mutate);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, re);
  });
}

test('(AC-O32-5) (AC-O32-8) (TC-13) (TC-19) real repo: frozen definitions, constants equal the spec text', async () => {
  const m = await import('./claude-permission-check.mjs');
  assert.equal(m.TASK_ID_RE_SRC, DEF_ID);
  assert.equal(m.BRANCH_RE_SRC, DEF_BR);
  const r = run(REPO);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /O-032: every task-id \/ branch regex under \.github\/ is a frozen definition/);
  assert.match(r.out, /checkout \(no if\) step 1, Validate step 2, id used only after Validate/);
});

test('(AC-O32-6) (TC-14) (TC-15) real claude-run-task.yml: order, always(), names', async () => {
  const m = await import('./claude-permission-check.mjs');
  const yml = readFileSync(join(REPO, WF), 'utf8');
  assert.deepEqual(m.runTaskOrderProblems(yml), []);
  const steps = yml.slice(yml.indexOf('\n    steps:\n')).split('\n').filter((l) => /^ {6}- /.test(l));
  assert.match(steps[0], /^ {6}- uses: actions\/checkout@/);
  assert.equal(steps[1], '      - name: Validate task id');
  assert.match(yml, /\nconcurrency:\n  group: claude-run-task-\$\{\{ github\.event\.client_payload\.task \}\}\n  cancel-in-progress: false\n/);
  assert.match(yml, /\n {10}name: run-task-outcome-\$\{\{ github\.event\.client_payload\.task \}\}\n/);
  assert.match(yml, /\n {10}name: claude-execution-output-\$\{\{ github\.event\.client_payload\.task \}\}-\$\{\{ github\.run_id \}\}\n/);
});

test('(AC-O32-5) (TC-13) unit: definitions pass, an old or weakened regex anywhere under .github fails', async () => {
  const m = await import('./claude-permission-check.mjs');
  const base = {};
  for (const f of FILES.filter((x) => x.startsWith('.github/scripts/'))) base[f] = readFileSync(join(REPO, f), 'utf8');
  assert.deepEqual(m.taskIdRegexProblems(base), []);
  for (const bad of [OLD_ID, OLD_BR, DEF_ID.replace('[a-z]?', '[A-Za-z]?'), DEF_ID.replace('[a-z]?', '[a-z]*'), DEF_ID.replace('[1-9][0-9]*', '[0-9]+')]) {
    const p = m.taskIdRegexProblems({ ...base, '.github/workflows/x.yml': `run: '[[ $T =~ ${bad} ]]'\n` });
    assert.match(p.join('\n'), /\.github\/workflows\/x\.yml:1: task-id regex is not one of the O-032 definitions/, bad);
  }
});

// (AC-O32-9) (TC-20): every listed weakening of the SRE side must fail.
expectO32Fail('O32-M1 mutation (AC-O32-9) (TC-20): Validate regex back to the old form', (f) => mut(f, VID, DEF_ID, OLD_ID), /run-task-validate-id\.sh:\d+: task-id regex is not one of the O-032 definitions/);
expectO32Fail('O32-M2 mutation (AC-O32-9) (TC-20): suffix allows uppercase', (f) => mut(f, VID, DEF_ID, DEF_ID.replace('[a-z]?', '[A-Za-z]?')), /run-task-validate-id\.sh:\d+: task-id regex is not one/);
expectO32Fail('O32-M3 mutation (AC-O32-9) (TC-20): suffix allows several letters', (f) => mut(f, VID, DEF_ID, DEF_ID.replace('[a-z]?', '[a-z]*')), /run-task-validate-id\.sh:\d+: task-id regex is not one/);
expectO32Fail('O32-M4 mutation (AC-O32-9) (TC-20): -fix0 allowed again', (f) => mut(f, VID, DEF_ID, DEF_ID.replace('[1-9][0-9]*', '[0-9]+')), /run-task-validate-id\.sh:\d+: task-id regex is not one/);
expectO32Fail('O32-M5 mutation (AC-O32-9) (TC-20): pre-head branch regex back to the old form', (f) => mut(f, PH, DEF_BR, OLD_BR), /run-task-pre-head\.sh:\d+: task-id regex is not one/);
expectO32Fail('O32-M6 mutation (AC-O32-9) (TC-20): post-check branch regex back to the old form', (f) => mut(f, PC, DEF_BR, OLD_BR), /run-task-post-check\.sh:\d+: task-id regex is not one/);
expectO32Fail('O32-M7 mutation (AC-O32-9) (TC-20): taskcheck branch regex back to the old form', (f) => mut(f, TC, DEF_BR, OLD_BR), /taskcheck\.sh:\d+: task-id regex is not one/);
expectO32Fail('O32-M8 mutation (AC-O32-9) (TC-20): usage-limit id regex back to the old form', (f) => mut(f, UL, DEF_ID, OLD_ID), /run-task-usage-limit\.sh:\d+: task-id regex is not one/);
expectO32Fail('O32-M9 mutation (AC-O32-5) (TC-13): old regex in a new workflow file', (f) => { f['.github/workflows/new.yml'] = `x: '${OLD_ID}'\n`; }, /\.github\/workflows\/new\.yml:1: task-id regex is not one/);
expectO32Fail('O32-M10 mutation (AC-O32-5): pre-head drops the id check (definition no longer used)', (f) => mut(f, PH, `[[ "\${TASK:-}" =~ ${DEF_ID} ]] || die "invalid TASK '\${TASK:-}'"\n`, ''), /run-task-pre-head\.sh does not use the O-032 task id definition/);
expectO32Fail('O32-M11 mutation (AC-O32-9) (TC-20): Validate moved before checkout', (f) => {
  const co = stepText(f[WF], '      - uses: actions/checkout@');
  const va = stepText(f[WF], '      - name: Validate task id');
  f[WF] = f[WF].replace(co, '@@CO@@').replace(va, co).replace('@@CO@@', va);
}, /step 1 is not actions\/checkout \(O-032\)/);
expectO32Fail('O32-M12 mutation (AC-O32-9) (TC-20): checkout gets an if', (f) => mut(f, WF, '      - uses: actions/checkout@v6\n', '      - uses: actions/checkout@v6\n        if: ${{ github.event.client_payload.task != \'\' }}\n'), /the first checkout has an `if` \(O-032\)/);
expectO32Fail('O32-M13 mutation (AC-O32-9) (TC-20): persist-credentials removed from step 1', (f) => mut(f, WF, '          persist-credentials: false\n', ''), /step 1 checkout does not set persist-credentials: false \(O-032\)/);
expectO32Fail('O32-M14 mutation (AC-O32-9) (TC-20): Notify loses always()', (f) => {
  const n = stepText(f[WF], '      - name: Notify Grok chief of staff');
  f[WF] = f[WF].replace(n, n.replace('        if: always()\n', ''));
}, /"Notify Grok chief of staff" is not if: always\(\)/);
expectO32Fail('O32-M15 mutation (AC-O32-6): Upload run-task outcome loses always()', (f) => {
  const n = stepText(f[WF], '      - name: Upload run-task outcome');
  f[WF] = f[WF].replace(n, n.replace('        if: always()\n', '        if: success()\n'));
}, /"Upload run-task outcome" is not if: always\(\)/);
expectO32Fail('O32-M16 mutation (AC-O32-9) (TC-20): validate script echoes the raw value', (f) => mut(f, VID, '"$safe" >&2', '"$TASK" >&2'), /run-task-validate-id\.sh uses TASK outside the match \/ sanitize lines/);
expectO32Fail('O32-M17 mutation (AC-O32-4): Validate passes the id on the command line', (f) => mut(f, WF, '        run: bash .github/scripts/run-task-validate-id.sh\n', '        run: bash .github/scripts/run-task-validate-id.sh "${{ github.event.client_payload.task }}"\n'), /Validate does not run \.github\/scripts\/run-task-validate-id\.sh|Validate puts the task id somewhere other than env TASK/);
expectO32Fail('O32-M18 mutation (AC-O32-4): validate script reads $1', (f) => mut(f, VID, 'safe="${TASK-}"', 'safe="${1-}"'), /run-task-validate-id\.sh reads arguments/);
expectO32Fail('O32-M19 mutation (AC-O32-4): LC_ALL=C removed', (f) => mut(f, VID, 'export LC_ALL=C\n', ''), /run-task-validate-id\.sh does not export LC_ALL=C/);
expectO32Fail('O32-M20 mutation (AC-O32-6) (TC-14): Task lint moved before Validate', (f) => {
  const tl = stepText(f[WF], '      - name: Task lint');
  const va = stepText(f[WF], '      - name: Validate task id');
  f[WF] = f[WF].replace(tl, '').replace(va, tl + va);
}, /"Validate task id" must be step 2|uses the task id before Validate/);
expectO32Fail('O32-M21 mutation (AC-O32-6) (TC-15): concurrency group changed', (f) => mut(f, WF, '  group: claude-run-task-${{ github.event.client_payload.task }}\n', '  group: claude-run-task-${{ github.run_id }}\n'), /concurrency group \/ cancel-in-progress changed/);
expectO32Fail('O32-M22 mutation (AC-O32-6) (TC-15): cancel-in-progress true', (f) => mut(f, WF, '  cancel-in-progress: false\n', '  cancel-in-progress: true\n'), /concurrency group \/ cancel-in-progress changed/);
expectO32Fail('O32-M23 mutation (AC-O32-6) (TC-15): run-task-outcome artifact renamed', (f) => mut(f, WF, 'name: run-task-outcome-${{ github.event.client_payload.task }}', 'name: run-task-outcome-${{ github.run_id }}'), /run-task-outcome artifact name changed/);
expectO32Fail('O32-M24 mutation (AC-O32-6) (TC-15): claude-execution-output artifact renamed', (f) => mut(f, WF, 'name: claude-execution-output-${{ github.event.client_payload.task }}-${{ github.run_id }}', 'name: claude-execution-output-${{ github.run_id }}'), /claude-execution-output artifact name changed/);
expectO32Fail('O32-M25 mutation (AC-O32-10): Validate gets continue-on-error', (f) => mut(f, WF, '        run: bash .github/scripts/run-task-validate-id.sh\n', '        continue-on-error: true\n        run: bash .github/scripts/run-task-validate-id.sh\n'), /Validate has an `if` or continue-on-error/);
