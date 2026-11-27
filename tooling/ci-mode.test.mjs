import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { classifyChange, classifyQa, decideMode, isDocPath, isQaPath, parseOpenPrs, run } from './ci-mode.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures', 'o015');
const fx28 = join(here, 'fixtures', 'o028');
const QA_ERR = ['--qa-changed-error', '--prev-skip'];
const cli = join(here, 'ci-mode.mjs');
const exec = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

const pr = (over = {}) => ({ number: 51, state: 'open', head: { ref: 'task/T-010' }, base: { ref: 'main' }, ...over });
const DOCS = { docsOnly: true, tasksChanged: false, reason: 'docs-only' };
const MIXED = { docsOnly: false, tasksChanged: false, reason: 'code-path' };
const OPEN = { prOpen: true, prNumber: 51 };
const mode = (input) => decideMode(input).mode;

describe('isDocPath / classifyChange', () => {
  it('(AC-O15-1) (TC-1) 文件路徑 → true', () => {
    for (const p of ['docs/TASKS.md', 'docs/tasks/O-015.md', 'docs/adr/ADR-001.md', 'README.md', 'CLAUDE.md']) {
      expect(isDocPath(p)).toBe(true);
    }
  });

  it('(AC-O15-1) (TC-2) 非文件與怪路徑 → false 且不丟例外', () => {
    const bad = [
      'docs/poc/A-003/README.md',
      'docs/qa/mutants/T-015.json',
      '.claude/skills/run-task/SKILL.md',
      'tooling/fixtures/tasks/O-901.md',
      'apps/web/README.md',
      'README.MD',
      '.github/pull_request_template.md',
      '/docs/x.md',
      'docs/../apps/x.ts',
      '',
      null,
    ];
    for (const p of bad) expect(isDocPath(p)).toBe(false);
  });

  it('(AC-O15-2) (TC-3) 純文件 → docsOnly', () => {
    expect(classifyChange(['docs/TASKS.md', 'README.md'], [])).toEqual(DOCS);
  });

  it('(AC-O15-2) (TC-4) 文件＋程式 → code-path', () => {
    expect(classifyChange(['docs/TASKS.md', 'apps/web/src/main.ts'], [])).toEqual(MIXED);
  });

  it('(AC-O15-2) (TC-5) 被引用的文件 → referenced', () => {
    const r = classifyChange(['docs/ARCHITECTURE.md'], ['docs/ARCHITECTURE.md']);
    expect(r.docsOnly).toBe(false);
    expect(r.reason).toBe('referenced');
  });

  it('(AC-O15-2) (TC-6) 任務單 → tasksChanged', () => {
    expect(classifyChange(['docs/tasks/O-015.md'], [])).toEqual({ docsOnly: true, tasksChanged: true, reason: 'docs-only' });
    expect(classifyChange(['docs/tasks/O-015.md', 'tooling/x.mjs'], [])).toEqual({
      docsOnly: false,
      tasksChanged: true,
      reason: 'code-path',
    });
  });

  it('(AC-O15-2) (TC-7) 壞輸入 → false', () => {
    expect(classifyChange([], []).reason).toBe('empty');
    expect(classifyChange('docs/a.md', [])).toMatchObject({ docsOnly: false, reason: 'bad-input' });
    expect(classifyChange([1], [])).toMatchObject({ docsOnly: false, reason: 'bad-input' });
    expect(classifyChange(['docs/a.md'], null)).toMatchObject({ docsOnly: false, reason: 'bad-input' });
    expect(classifyChange([], []).docsOnly).toBe(false);
  });
});

describe('parseOpenPrs', () => {
  it('(AC-O15-3) (TC-8) 1 筆符合 → true、51', () => {
    expect(parseOpenPrs([pr()], 'task/T-010')).toEqual(OPEN);
  });

  it('(AC-O15-3) (TC-9) 兩筆取最小 number', () => {
    expect(parseOpenPrs([pr({ number: 60 }), pr({ number: 52 })], 'task/T-010')).toEqual({ prOpen: true, prNumber: 52 });
  });

  it('(AC-O15-3) (TC-10) 空陣列 → false', () => {
    expect(parseOpenPrs([], 'task/T-010')).toEqual({ prOpen: false, prNumber: null });
  });

  it('(AC-O15-3) (TC-11) 回應不對 → unknown', () => {
    const unknown = { prOpen: 'unknown', prNumber: null };
    const b = 'task/T-010';
    expect(parseOpenPrs([pr({ head: { ref: 'task/T-011' } })], b)).toEqual(unknown);
    expect(parseOpenPrs([pr({ base: { ref: 'develop' } })], b)).toEqual(unknown);
    expect(parseOpenPrs([pr({ state: 'closed' })], b)).toEqual(unknown);
    expect(parseOpenPrs([pr({ number: 0 })], b)).toEqual(unknown);
    expect(parseOpenPrs([pr({ number: '51' })], b)).toEqual(unknown);
    expect(parseOpenPrs([null], b)).toEqual(unknown);
    expect(parseOpenPrs([pr(), null], b)).toEqual(unknown);
    expect(parseOpenPrs({}, b)).toEqual(unknown);
    expect(parseOpenPrs('x', b)).toEqual(unknown);
    expect(parseOpenPrs([pr()], '')).toEqual(unknown);
  });
});

describe('decideMode', () => {
  it('(AC-O15-4) (TC-12) pull_request 一律 full', () => {
    expect(mode({ event: 'pull_request', ref: 'task/T-010', change: DOCS, pr: OPEN })).toBe('full');
  });

  it('(AC-O15-4) (TC-13) main 純文件 → docs', () => {
    expect(mode({ event: 'push', ref: 'main', change: DOCS, pr: 'skip' })).toBe('docs');
  });

  it('(AC-O15-4) (TC-14) main 混合或失敗 → full', () => {
    expect(mode({ event: 'push', ref: 'main', change: MIXED, pr: 'skip' })).toBe('full');
    expect(mode({ event: 'push', ref: 'main', change: 'error', pr: 'skip' })).toBe('full');
  });

  it('(AC-O15-4) (TC-15) task／fix 分支有 PR → light', () => {
    expect(mode({ event: 'push', ref: 'task/T-010', change: MIXED, pr: OPEN })).toBe('light');
    expect(mode({ event: 'push', ref: 'fix/T-015-fix1', change: MIXED, pr: OPEN })).toBe('light');
  });

  it('(AC-O15-4) (TC-16) task 分支查不到 → full，且不用 docs 模式', () => {
    const base = { event: 'push', ref: 'task/T-010', change: MIXED };
    for (const p of [{ prOpen: false, prNumber: null }, { prOpen: 'unknown', prNumber: null }, 'error', 'skip']) {
      expect(mode({ ...base, pr: p })).toBe('full');
    }
    expect(mode({ ...base, change: DOCS, pr: { prOpen: false, prNumber: null } })).toBe('full');
  });

  it('(AC-O15-4) (TC-17) 其他情況 → full', () => {
    expect(mode({ event: 'workflow_dispatch', ref: 'main', change: DOCS, pr: 'skip' })).toBe('full');
    expect(mode({ event: 'push', ref: 'poc/x', change: DOCS, pr: OPEN })).toBe('full');
    expect(mode(null)).toBe('full');
    expect(mode({ event: '', ref: 'main', change: DOCS, pr: 'skip' })).toBe('full');
  });
});

describe('CLI', () => {
  const changed = ['--changed', join(fx, 'changed-docs.txt'), '--referenced', join(fx, 'referenced-empty.txt')];

  it('(AC-O15-5) (TC-18) 正常輸出 JSON', () => {
    const docs = exec(['decide', '--event', 'push', '--ref', 'main', ...changed, '--pr-skip']);
    expect(docs.status).toBe(0);
    expect(JSON.parse(docs.stdout)).toMatchObject({ mode: 'docs', docs_only: true, tasks_changed: false, pr_open: null, pr_number: null });

    const light = exec(['decide', '--event', 'push', '--ref', 'task/T-010', '--changed-error', ...QA_ERR, '--pr', join(fx, 'pr-open.json')]);
    expect(light.status).toBe(0);
    expect(JSON.parse(light.stdout)).toMatchObject({ mode: 'light', pr_open: true, pr_number: 51 });
  });

  it('(AC-O15-5) (TC-19) 讀檔失敗或壞 JSON → full、exit 0', () => {
    const missing = join(fx, 'nope.txt');
    const a = exec(['decide', '--event', 'push', '--ref', 'main', '--changed', missing, '--referenced', missing, '--pr-skip']);
    const b = exec(['decide', '--event', 'push', '--ref', 'task/T-010', '--changed-error', ...QA_ERR, '--pr', join(fx, 'nope.json')]);
    const c = exec(['decide', '--event', 'push', '--ref', 'task/T-010', '--changed-error', ...QA_ERR, '--pr', join(fx, 'pr-bad.json')]);
    for (const r of [a, b, c]) {
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).mode).toBe('full');
    }
    expect(JSON.parse(c.stdout).pr_open).toBe('unknown');
  });

  it('(AC-O15-5) (TC-20) 用法錯誤 → USAGE、exit 1、stdout 無 JSON', () => {
    const cases = [
      [],
      ['foo'],
      ['decide', '--ref', 'main', '--changed-error', '--pr-skip'],
      ['decide', '--event', 'push', '--ref', 'main', '--ref', 'x', '--changed-error', '--pr-skip'],
      ['decide', '--event', 'push', '--ref', 'main', '--changed', join(fx, 'changed-docs.txt'), '--pr-skip'],
      ['decide', '--event', 'push', '--ref', 'main', '--changed-error', '--pr-error', '--pr-skip'],
    ];
    for (const args of cases) {
      const r = exec(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('ci-mode: FAIL');
      expect(r.stderr).toContain('USAGE');
      expect(r.stdout).toBe('');
    }
  });
});

const QA_FILES = [
  'packages/domain/src/plan.qa.test.ts',
  'apps/web/src/App.test.tsx',
  'supabase/tests/t004_rls_test.sql',
  'test/e2e/t018.spec.ts',
  'docs/qa/mutants/T-018.json',
];
const NO_PR = { prOpen: false, prNumber: null };
const QA_ONLY = { qaOnly: true, reason: 'qa-only' };
const push = (ref, over = {}) => ({ event: 'push', ref, change: MIXED, pr: NO_PR, qa: QA_ONLY, ...over });
const decideCli = (mod, ref, extra) =>
  mod.run(['decide', '--event', 'push', '--ref', ref, '--changed-error', ...extra]);
const outOf = (r) => JSON.parse(r.stdout);

describe('isQaPath / classifyQa（O-028）', () => {
  it('(AC-O28-1) (TC-1) QA 檔四類 → true', () => {
    for (const p of QA_FILES) expect(isQaPath(p)).toBe(true);
    expect(classifyQa(QA_FILES)).toEqual(QA_ONLY);
  });

  it('(AC-O28-1) (TC-2) 非 QA 檔 → false', () => {
    const bad = [
      'apps/web/test/setup.ts',
      'packages/contracts/test/index.ts',
      'supabase/functions/api/test/fake.ts',
      'apps/web/src/types.d.ts',
      'test/e2e/tsconfig.json',
      'tooling/ci-mode.test.mjs',
      '.github/scripts/taskcheck-test.sh',
      '.claude/settings.json',
      'pnpm-lock.yaml',
      'package.json',
      'vitest.config.ts',
      'apps/web/src/__snapshots__/a.snap',
      'apps/web/src/__snapshots__/a.test.ts',
      'supabase/tests/sub/x_test.sql',
      'supabase/tests/x.sql',
      '../x.test.ts',
      '/apps/x.test.ts',
      'apps\\x.test.ts',
      'apps/web/src/App.tsx',
      '',
      null,
    ];
    for (const p of bad) expect(isQaPath(p)).toBe(false);
  });

  it('(AC-O28-3) (TC-5) classifyQa：混入非 QA 檔、空清單、壞輸入 → qaOnly false', () => {
    expect(classifyQa([...QA_FILES, 'apps/web/src/App.tsx']).qaOnly).toBe(false);
    expect(classifyQa([]).qaOnly).toBe(false);
    expect(classifyQa('x').qaOnly).toBe(false);
    expect(classifyQa([1]).qaOnly).toBe(false);
  });
});

describe('decideMode tests-only-no-pr（O-028）', () => {
  it('(AC-O28-2) (TC-3) task 無 PR 只改 QA 檔 → light／tests-only-no-pr', () => {
    expect(decideMode(push('task/T-018'))).toEqual({ mode: 'light', reason: 'tests-only-no-pr' });
  });

  it('(AC-O28-2) (TC-4) fix／main／PR 事件不得是 tests-only-no-pr', () => {
    expect(decideMode(push('fix/Q-1'))).toEqual({ mode: 'full', reason: 'branch-without-pr' });
    expect(decideMode(push('main')).reason).not.toBe('tests-only-no-pr');
    expect(decideMode(push('task/T-018', { event: 'pull_request' }))).toMatchObject({ mode: 'full' });
  });

  it('(AC-O28-3) (TC-5) (TC-6) (TC-7) fail-closed → full', () => {
    expect(mode(push('task/T-018', { qa: classifyQa([...QA_FILES, 'apps/web/src/App.tsx']) }))).toBe('full');
    expect(mode(push('task/T-018', { qa: 'error' }))).toBe('full');
    expect(mode(push('task/T-018', { qa: classifyQa([]) }))).toBe('full');
    expect(mode(push('task/T-018', { qa: undefined }))).toBe('full');
    for (const p of ['error', 'skip', { prOpen: 'unknown', prNumber: null }]) {
      expect(mode(push('task/T-018', { pr: p }))).toBe('full');
    }
  });

  it('(AC-O28-2) 有開著的 PR 仍是 branch-with-open-pr', () => {
    expect(decideMode(push('task/T-018', { pr: OPEN }))).toEqual({ mode: 'light', reason: 'branch-with-open-pr' });
  });
});

describe('CLI qa 選項（O-028）', () => {
  const base = ['decide', '--event', 'push', '--ref', 'task/T-018', '--changed-error', '--pr', join(fx28, 'pr-none.json')];
  const qaFile = join(fx28, 'qa-files.txt');

  it('(AC-O28-2) (TC-3) CLI：QA 檔清單 → light、pr_number null、qa_only true', () => {
    const r = exec([...base, '--qa-changed', qaFile, '--prev-skip']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      mode: 'light',
      reason: 'tests-only-no-pr',
      pr_number: null,
      qa_only: true,
      qa_batch_warning: false,
    });
  });

  it('(AC-O28-3) (TC-5) (TC-6) CLI：混入產品檔、檔案不存在、清單空、--qa-changed-error → full', () => {
    const inputs = [
      ['--qa-changed', join(fx28, 'qa-mixed.txt')],
      ['--qa-changed', join(fx28, 'missing.txt')],
      ['--qa-changed', join(fx28, 'empty.txt')],
      ['--qa-changed-error'],
    ];
    for (const qa of inputs) {
      const r = exec([...base, ...qa, '--prev-skip']);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ mode: 'full', qa_only: false, qa_batch_warning: false });
    }
  });

  it('(AC-O28-3) (TC-7) CLI：PR 查詢失敗 → full', () => {
    const r = exec(['decide', '--event', 'push', '--ref', 'task/T-018', '--changed-error', '--pr-error', '--qa-changed', qaFile, '--prev-skip']);
    expect(JSON.parse(r.stdout)).toMatchObject({ mode: 'full', pr_open: 'unknown' });
  });

  it('(AC-O28-4) (TC-8) 連續兩次只改 QA → qa_batch_warning true，mode 與 exit code 不變', () => {
    const warned = exec([...base, '--qa-changed', qaFile, '--prev-qa-changed', qaFile]);
    const plain = exec([...base, '--qa-changed', qaFile, '--prev-skip']);
    expect(warned.status).toBe(0);
    expect(plain.status).toBe(warned.status);
    expect(JSON.parse(warned.stdout)).toMatchObject({ qa_batch_warning: true, mode: JSON.parse(plain.stdout).mode });
  });

  it('(AC-O28-4) (TC-9) 不該警告的情況 → false', () => {
    const mixedPrev = exec([...base, '--qa-changed', qaFile, '--prev-qa-changed', join(fx28, 'qa-mixed.txt')]);
    const missingPrev = exec([...base, '--qa-changed', qaFile, '--prev-qa-changed', join(fx28, 'missing.txt')]);
    const withPr = exec(['decide', '--event', 'push', '--ref', 'task/T-010', '--changed-error', '--pr', join(fx, 'pr-open.json'), '--qa-changed', qaFile, '--prev-qa-changed', qaFile]);
    const full = exec([...base, '--qa-changed', join(fx28, 'qa-mixed.txt'), '--prev-qa-changed', qaFile]);
    for (const r of [mixedPrev, missingPrev, withPr, full]) {
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).qa_batch_warning).toBe(false);
    }
    expect(JSON.parse(withPr.stdout).reason).toBe('branch-with-open-pr');
  });

  it('(AC-O28-2) (AC-O28-3) 用法：task／fix 缺 qa 選項，或其他 ref 傳了 qa 選項 → USAGE', () => {
    const cases = [
      [...base],
      [...base, '--qa-changed', qaFile],
      [...base, '--prev-skip'],
      [...base, '--qa-changed', qaFile, '--qa-changed-error', '--prev-skip'],
      [...base, '--qa-changed', qaFile, '--prev-skip', '--prev-qa-changed', qaFile],
      ['decide', '--event', 'push', '--ref', 'main', '--changed-error', '--pr-skip', '--qa-changed-error', '--prev-skip'],
      ['decide', '--event', 'push', '--ref', 'main', '--changed-error', '--pr-skip', '--prev-skip'],
    ];
    for (const args of cases) {
      const r = exec(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('USAGE');
      expect(r.stdout).toBe('');
    }
  });
});

// 突變：複製實作到暫存資料夾、改一個地方，檢查函式必須判出「壞了」。
const SRC = readFileSync(cli, 'utf8');
const TASK_FILE_SRC = join(here, 'task-file.mjs');

async function loadMutant(replacer) {
  const dir = mkdtempSync(join(tmpdir(), 'o028-'));
  copyFileSync(TASK_FILE_SRC, join(dir, 'task-file.mjs'));
  const [from, to] = replacer;
  expect(SRC).toContain(from);
  writeFileSync(join(dir, 'ci-mode.mjs'), SRC.replace(from, to));
  return import(pathToFileURL(join(dir, 'ci-mode.mjs')).href);
}

// 回傳「行為不符」的項目；真實實作必須是空陣列。
function brokenBehaviours(mod) {
  const broken = [];
  const d = (ref, over) => mod.decideMode(push(ref, over));
  if (mod.isQaPath('tooling/ci-mode.test.mjs') || mod.isQaPath('vitest.config.ts')) broken.push('tooling-or-config-is-qa');
  if (d('fix/Q-1').mode !== 'full') broken.push('fix-light');
  if (d('task/T-018', { pr: 'error' }).mode !== 'full') broken.push('pr-error-light');
  if (d('task/T-018', { pr: { prOpen: 'unknown', prNumber: null } }).mode !== 'full') broken.push('pr-unknown-light');
  const r = decideCli(mod, 'task/T-018', ['--pr', join(fx28, 'pr-none.json'), '--qa-changed', join(fx28, 'qa-files.txt'), '--prev-qa-changed', join(fx28, 'qa-files.txt')]);
  if (r.code !== 0 || outOf(r).qa_batch_warning !== true) broken.push('warning-changes-exit');
  return broken;
}

describe('突變必須被抓到（O-028）', () => {
  it('(AC-O28-10) (TC-14) 真實實作沒有任何行為不符', () => {
    expect(brokenBehaviours({ isQaPath, decideMode, run })).toEqual([]);
  });

  const mutants = [
    ['把 tooling 當 QA 檔', ["if (path.startsWith('docs/qa/')) return true;", "if (path.startsWith('docs/qa/') || path.startsWith('tooling/')) return true;"], 'tooling-or-config-is-qa'],
    ['設定檔當 QA 檔', ["if (path.startsWith('docs/qa/')) return true;", "if (path.startsWith('docs/qa/') || path.endsWith('.config.ts')) return true;"], 'tooling-or-config-is-qa'],
    ['fix 也降 light', ["noPr && ref.startsWith('task/') && isObj(input.qa)", 'noPr && isObj(input.qa)'], 'fix-light'],
    ['PR 查詢失敗仍降 light', ['const noPr = isObj(pr) && pr.prOpen === false;', 'const noPr = !(isObj(pr) && pr.prOpen === true);'], 'pr-error-light'],
    ['警告讓 exit code 非 0', ['return { code: 0, stdout: `${JSON.stringify(out)}', 'return { code: out.qa_batch_warning ? 1 : 0, stdout: `${JSON.stringify(out)}'], 'warning-changes-exit'],
  ];
  for (const [name, replacer, expected] of mutants) {
    it(`(AC-O28-10) (TC-14) 突變「${name}」→ 被抓到`, async () => {
      const mod = await loadMutant(replacer);
      expect(brokenBehaviours(mod)).toContain(expected);
    });
  }
});

describe('依賴與吞錯', () => {
  it('(AC-O15-6) (TC-21) 只 import node: 與 ./，無吞錯寫法，無 QA 擁有檔樣式', () => {
    for (const f of ['ci-mode.mjs', 'ci-mode.test.mjs']) {
      const src = readFileSync(join(here, f), 'utf8');
      for (const m of src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        expect(m[1].startsWith('node:') || m[1].startsWith('./') || m[1] === 'vitest').toBe(true);
      }
    }
    const impl = readFileSync(cli, 'utf8');
    expect(impl).not.toMatch(/\|\|\s*true/);
    expect(impl).not.toContain('continue-on-error');
    expect(impl).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
    for (const name of readdirSync(fx)) {
      expect(name).not.toMatch(/\.qa\.test\.ts$/);
      expect(name).not.toMatch(/^qa_.*\.sql$/);
    }
  });
});
