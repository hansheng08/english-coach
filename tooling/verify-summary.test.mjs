import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, renderSummary } from './verify-summary.mjs';

const FIX = fileURLToPath(new URL('./fixtures/o009', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'o009-vs-'));
const tmpFile = (name, content) => {
  const p = join(tmp, name);
  writeFileSync(p, content);
  return p;
};
const changed = tmpFile('changed.txt', 'tooling/a.mjs\n\ntooling/b.mjs\ndocs/reports/O-902.md\n');
const mutants = tmpFile(
  'mutants.json',
  JSON.stringify({
    task: 'O-902',
    total: 3,
    killed: 1,
    survived: ['M2'],
    results: [
      { id: 'M1', status: 'killed', failedTests: ['x'] },
      { id: 'M2', status: 'survived', failedTests: [] },
      { id: 'M3', status: 'unexpected', failedTests: ['y'] },
    ],
  }),
);
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const base = ['--task', 'O-902', '--sha', SHA, '--vitest', `${FIX}/vitest-full.json`, '--changed', changed];

describe('verify-summary', () => {
  it('(AC-O9-4) (TC-13) full summary: all four sections match the inputs', () => {
    const r = run([...base, '--execution', `${FIX}/execution.json`, '--mutants', mutants]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const out = r.stdout;
    expect(out.split('\n')[0]).toBe('## 自動驗證摘要（O-902 @ abcdef0）');
    const order = ['### 測試', '### 突變', '### 權限被拒', '### 變更檔案'].map((h) => out.indexOf(h));
    expect(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1]))).toBe(true);
    expect(out).toContain('- 測試檔：2');
    expect(out).toContain('- passed：3');
    expect(out).toContain('- failed：1');
    expect(out).toContain('- skipped：1');
    expect(out).toContain('結果：失敗');
    expect(out).toContain('- killed／total：1／3');
    expect(out).toContain('- M2：survived');
    expect(out).toContain('- M3：unexpected');
    expect(out).not.toContain('- M1：');
    expect(out).toContain('- 次數：2');
    expect(out).toContain('`Bash`：`cat a.txt`');
    expect(out).toContain('`Bash`：`git status --short | head`');
    expect(out).toContain('- 數量：3');
    expect(out).toContain('- `tooling/a.mjs`');
    expect(out).not.toContain('OK');
  });

  it('(AC-O9-4) (TC-14) optional inputs missing -> the not-run and not-applicable lines; all passing -> 通過', () => {
    const r = run(base);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('未執行（沒有 docs/qa/mutants/O-902.json）');
    expect(r.stdout).toContain('不適用（未提供 execution 紀錄）');
    const green = renderSummary({
      task: 'O-902',
      sha: SHA,
      vitest: { testResults: [{ assertionResults: [{ status: 'passed' }, { status: 'todo' }, { status: 'skipped' }] }] },
      changed: [],
    });
    expect(green).toContain('結果：通過');
    expect(green).toContain('- skipped：2');
    expect(green).toContain('- 數量：0');
  });

  it('(AC-O9-4) (TC-15) bad inputs -> exit 1, INPUT, empty stdout', () => {
    const noResults = tmpFile('no-results.json', '{}');
    const noResultEvent = tmpFile('exec-none.json', JSON.stringify([{ type: 'system' }]));
    const execNotArray = tmpFile('exec-obj.json', '{}');
    const badMutants = tmpFile('bad-mutants.json', JSON.stringify({ task: 'O-902' }));
    const badJson = tmpFile('bad.json', '{nope');
    const withVitest = (v) => ['--task', 'O-902', '--sha', SHA, '--vitest', v, '--changed', changed];
    const cases = [
      withVitest(noResults),
      withVitest(badJson),
      [...base, '--execution', noResultEvent],
      [...base, '--execution', execNotArray],
      [...base, '--mutants', badMutants],
      ['--task', 'O-902', '--sha', 'xyz', '--vitest', `${FIX}/vitest-full.json`, '--changed', changed],
      ['--task', 'O-902', '--sha', 'abc12', '--vitest', `${FIX}/vitest-full.json`, '--changed', changed],
    ];
    for (const argv of cases) {
      const r = run(argv);
      expect(r.code, argv.join(' ')).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('INPUT');
    }
  });
});
