import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyChange, decideMode, isDocPath, parseOpenPrs } from './ci-mode.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures', 'o015');
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

    const light = exec(['decide', '--event', 'push', '--ref', 'task/T-010', '--changed-error', '--pr', join(fx, 'pr-open.json')]);
    expect(light.status).toBe(0);
    expect(JSON.parse(light.stdout)).toMatchObject({ mode: 'light', pr_open: true, pr_number: 51 });
  });

  it('(AC-O15-5) (TC-19) 讀檔失敗或壞 JSON → full、exit 0', () => {
    const missing = join(fx, 'nope.txt');
    const a = exec(['decide', '--event', 'push', '--ref', 'main', '--changed', missing, '--referenced', missing, '--pr-skip']);
    const b = exec(['decide', '--event', 'push', '--ref', 'task/T-010', '--changed-error', '--pr', join(fx, 'nope.json')]);
    const c = exec(['decide', '--event', 'push', '--ref', 'task/T-010', '--changed-error', '--pr', join(fx, 'pr-bad.json')]);
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
