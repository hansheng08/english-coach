import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acPrefix, baseTaskId, branchId, mutantsPathFor, parseTaskFile, tasksForBranch } from './task-file.mjs';
import { lintTask } from './task-lint.mjs';
import { checkScope } from './scope-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const TASK_TEXT = (id, branch) =>
  [
    `# ${id}：字母尾碼`,
    '',
    '> ## ⚠️ 強制工作規則',
    ...Array.from({ length: 12 }, (_, k) => `> ${String(k + 1)}. 規則`),
    '',
    '## 分支',
    `\`${branch}\``,
    '## 背景',
    'x',
    '## 目標',
    'x',
    '## 介面',
    'x',
    '## 驗收標準',
    '- AC-T25-1：x',
    '## 測試案例',
    '| TC | 對應 AC | 情境 | 輸入 | 預期輸出／錯誤 |',
    '|---|---|---|---|---|',
    '| TC-1 | AC-T25-1 | a | b | c |',
    '## 檔案範圍',
    '### 要做',
    '- `tooling/a.mjs`（新增）',
    '### 範圍外',
    '- `apps/**`',
    '## 限制',
    'x',
    '## 驗證方式',
    'x',
    '## 結束時',
    'x',
    '',
  ].join('\n');

const mk = (id, branch) => ({ id, path: `docs/tasks/${id}.md`, text: TASK_TEXT(id, branch) });
const rules = (fs) => fs.map((f) => f.rule);

describe('task id with letter suffix', () => {
  it('(AC-O32-1) (TC-1) valid ids resolve to the base id and mutants path', () => {
    const cases = [
      ['T-025a', 'T-025a'],
      ['T-025a-fix1', 'T-025a'],
      ['T-025', 'T-025'],
      ['O-030', 'O-030'],
      ['T-012-fix1', 'T-012'],
      ['Q-012a', 'Q-012a'],
    ];
    for (const [id, base] of cases) {
      expect(baseTaskId(id)).toBe(base);
      expect(mutantsPathFor(id)).toBe(`docs/qa/mutants/${base}.json`);
    }
  });

  it('(AC-O32-1) (AC-O32-3) (TC-2) (TC-7) invalid ids return null', () => {
    const bad = [
      'T-025A', 'T-025ab', 'T-25a', 'T-025-a', 'X-025', 'T-025a-fix', 'T-025a-fix0', 'T-025a-fix01',
      '', 'T-025a\n', '\nT-025a', 'T-025a\nO-030', '../T-025a', 'T-025a/../x', 12, null, undefined,
    ];
    for (const id of bad) {
      expect(baseTaskId(id), String(id)).toBeNull();
      expect(mutantsPathFor(id), String(id)).toBeNull();
    }
  });

  it('(AC-O32-1) (TC-3) branch names', () => {
    expect(branchId('task/T-025a')).toBe('T-025a');
    expect(branchId('task/T-025')).toBe('T-025');
    expect(branchId('fix/Q-012')).toBe('Q-012');
    expect(branchId('fix/Q-012a')).toBe('Q-012a');
    expect(branchId('task/T-025a\n')).toBeNull();
    expect(branchId(5)).toBeNull();
  });

  it('(AC-O32-3) (TC-7) branches are not loosened', () => {
    for (const b of ['task/T-025ab', 'task/T-025A', 'task/T-025a/x', 'task/T-025a-fix1', 'fix/T-025a', 'fix/Q-012ab', 'main', '']) {
      expect(branchId(b), b).toBeNull();
    }
  });

  it('(AC-O32-2) (TC-4) acPrefix ignores the suffix', () => {
    for (const id of ['T-025a', 'T-025b', 'T-025a-fix1', 'T-025']) expect(acPrefix(id)).toBe('T25');
  });

  it('(AC-O32-2) (TC-5) parse and lint a letter-suffix task file', () => {
    const t = mk('T-025a', 'task/T-025a');
    const parsed = parseTaskFile(t);
    expect(parsed.branch).toBe('task/T-025a');
    expect(parsed.acIds).toEqual(['AC-T25-1']);
    expect(rules(lintTask(t))).not.toContain('TL-TITLE');
  });

  it('(AC-O32-2) (TC-6) scope-check with the letter-suffix task', () => {
    const t = mk('T-025a', 'task/T-025a');
    const run = (changed, tasks = [t], branch = 'task/T-025a') => checkScope({ branch, tasks, changed });
    expect(run(['tooling/a.mjs', 'docs/reports/T-025a.md'])).toEqual([]);
    expect(rules(run(['docs/reports/T-025.md']))).toEqual(['SC-OUT']);
    expect(rules(run(['x/y.ts']))).toEqual(['SC-OUT']);
    const fix = mk('T-025a-fix1', 'task/T-025a');
    expect(run(['docs/reports/T-025a-fix1.md'], [t, fix])).toEqual([]);
  });

  it('(AC-O32-2) (AC-O32-3) (TC-7) branch task/T-025 does not match the T-025a task', () => {
    const t = mk('T-025a', 'task/T-025a');
    expect(tasksForBranch('task/T-025', [t])).toEqual([]);
    expect(rules(checkScope({ branch: 'task/T-025', tasks: [t], changed: ['tooling/a.mjs'] }))).toEqual(['SC-NOTASK']);
  });

  it('(AC-O32-2) (TC-5) task file can come from a temp directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'o032-'));
    try {
      const p = join(dir, 'T-025a.md');
      writeFileSync(p, TASK_TEXT('T-025a', 'task/T-025a'));
      expect(parseTaskFile({ id: 'T-025a', text: readFileSync(p, 'utf8') }).branch).toBe('task/T-025a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(AC-O32-9) (TC-20) mutants of task-file.mjs are caught by these tests', () => {
    const src = readFileSync(join(here, 'task-file.mjs'), 'utf8');
    expect(src).toContain('/^([TQOAP]-\\d{3}[a-z]?)(?:-fix[1-9]\\d*)?$/');
    expect(src).toContain('/^(?:task\\/([TQOAP]-\\d{3}[a-z]?)|fix\\/(Q-\\d{3}[a-z]?))$/');
    // the mutant regexes (old form, uppercase, multi-letter, -fix0) must all fail an assertion above
    const mutants = [
      /^([TQOAP]-\d{3})(?:-fix[1-9]\d*)?$/,
      /^([TQOAP]-\d{3}[A-Za-z]?)(?:-fix[1-9]\d*)?$/,
      /^([TQOAP]-\d{3}[a-z]*)(?:-fix[1-9]\d*)?$/,
      /^([TQOAP]-\d{3}[a-z]?)(?:-fix\d+)?$/,
    ];
    const good = ['T-025a', 'T-025a-fix1'];
    const bad = ['T-025A', 'T-025ab', 'T-025a-fix0', 'T-025a-fix01'];
    for (const re of mutants) {
      const caught = good.some((g) => re.exec(g) === null || (re.exec(g)?.[1] ?? '') !== 'T-025a') || bad.some((b) => re.exec(b) !== null);
      expect(caught, String(re)).toBe(true);
    }
  });
});
