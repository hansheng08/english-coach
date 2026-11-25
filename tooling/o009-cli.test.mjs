import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchId } from './task-file.mjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const REPO = here('..');
const FIX = here('./fixtures/o009');
const S = {
  mutants: here('./run-mutants.mjs'),
  summary: here('./verify-summary.mjs'),
  report: here('./report-lint.mjs'),
  comment: here('./comment-lint.mjs'),
  scope: here('./scope-check.mjs'),
  cov: here('./ac-coverage.mjs'),
};
const exec = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: REPO, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = mkdtempSync(join(tmpdir(), 'o009-cli-'));
const tmpFile = (name, content) => {
  const p = join(tmp, name);
  writeFileSync(p, content);
  return p;
};

const fixTask = [
  '# Q-012：修復',
  '',
  '## 分支',
  '`fix/Q-012`',
  '',
  '## 驗收標準',
  '- **AC-Q12-1** 範例',
  '',
  '## 測試案例清單',
  '| TC | 對應 AC | 情境 | 輸入 | 預期輸出／錯誤 |',
  '|---|---|---|---|---|',
  '| TC-1 | AC-Q12-1 | a | b | c |',
  '',
  '## 檔案範圍',
  '### 要做',
  '- `tooling/in-scope.mjs`',
  '### 範圍外',
  '- `apps/**`',
  '',
].join('\n');
const tasksDir = join(tmp, 'tasks');
mkdirSync(tasksDir);
writeFileSync(join(tasksDir, 'Q-012.md'), fixTask);
const qaLog = (files) =>
  `\x1e${'a'.repeat(40)}\x1fqa@example.com\x1fqa@example.com\x1f[QA] Q-012 mutants\n\n${files
    .filter((p) => p.startsWith('docs/qa/mutants/'))
    .map((p) => `M\t${p}`)
    .join('\n')}\n`;
const scope = (branch, files) =>
  exec(S.scope, [
    '--branch',
    branch,
    '--changed',
    tmpFile('changed.txt', `${files.join('\n')}\n`),
    '--commits',
    tmpFile('log.txt', qaLog(files)),
    '--tasks-dir',
    tasksDir,
  ]);

describe('fix branches', () => {
  it('(AC-O9-7) (TC-23) scope-check on fix/Q-012: implicit mutants file, SC-OUT, SC-NOTASK', () => {
    const ok = scope('fix/Q-012', ['tooling/in-scope.mjs', 'docs/qa/mutants/Q-012.json', 'docs/reports/Q-012.md']);
    expect([ok.code, ok.out]).toEqual([0, 'scope-check: OK fix/Q-012\n']);
    const out = scope('fix/Q-012', ['tooling/in-scope.mjs', 'docs/qa/mutants/Q-099.json']);
    expect(out.code).toBe(1);
    expect(out.err).toContain('SC-OUT');
    const none = scope('fix/Q-777', ['tooling/in-scope.mjs']);
    expect(none.code).toBe(1);
    expect(none.err).toContain('SC-NOTASK');
  });

  it('(AC-O9-7) (TC-24) branchId accepts only task/ and fix/ ids; ac-coverage works on a fix branch', () => {
    expect(['task/T-023', 'fix/Q-012', 'main', 'fix/x', 'fix/T-023', 'task/T-23', 'task/T-0233', 'task/X-023', 'xfix/Q-012', 'fix/Q-012/x', 'task/O-009'].map(branchId)).toEqual([
      'T-023', 'Q-012', null, null, null, null, null, null, null, null, 'O-009',
    ]);
    const full = tmpFile('vitest-q12.json', JSON.stringify({ testResults: [{ assertionResults: [{ fullName: 'x (AC-Q12-1) (TC-1) works', status: 'passed' }] }] }));
    const ok = exec(S.cov, ['--branch', 'fix/Q-012', '--results', full, '--tasks-dir', tasksDir]);
    expect([ok.code, ok.out]).toEqual([0, 'ac-coverage: OK fix/Q-012\n']);
    const missing = tmpFile('vitest-none.json', JSON.stringify({ testResults: [] }));
    expect(exec(S.cov, ['--branch', 'fix/Q-012', '--results', missing, '--tasks-dir', tasksDir]).code).toBe(1);
  });
});

describe('o009 CLIs', () => {
  it('(AC-O9-8) (TC-25) bad CLI input exits 1 with USAGE or INPUT and never prints OK', () => {
    const notJson = tmpFile('bad.json', '{nope');
    const missing = join(tmp, 'missing');
    const out = join(tmp, 'out.json');
    const changed = tmpFile('changed2.txt', 'a\n');
    const cases = [
      [S.mutants, []],
      [S.mutants, ['--bogus']],
      [S.mutants, ['--file', missing, '--out', out]],
      [S.mutants, ['--file', notJson, '--out', out]],
      [S.mutants, ['--file', `${FIX}/vitest-full.json`, '--out', out, '--']],
      [S.summary, []],
      [S.summary, ['--bogus']],
      [S.summary, ['--task', 'O-902', '--sha', 'abcdef0', '--vitest', missing, '--changed', changed]],
      [S.summary, ['--task', 'O-902', '--sha', 'abcdef0', '--vitest', notJson, '--changed', changed]],
      [S.report, []],
      [S.report, ['--bogus']],
      [S.report, [missing]],
      [S.comment, []],
      [S.comment, ['--bogus']],
      [S.comment, ['--comments', missing]],
      [S.comment, ['--comments', notJson]],
    ];
    for (const [script, args] of cases) {
      const r = exec(script, args);
      expect(r.code, `${script} ${args.join(' ')}`).toBe(1);
      expect(r.err).toMatch(/USAGE|INPUT/);
      expect(r.out).not.toContain('OK');
    }
  });

  it('(AC-O9-8) (TC-26) child process exit codes: passing input 0, failing input 1', () => {
    const goodReport = mkdtempSync(join(tmpdir(), 'o009-good-'));
    writeFileSync(join(goodReport, 'O-902.md'), readFileSync(`${FIX}/report-ok.md`, 'utf8'));
    expect(exec(S.report, [join(goodReport, 'O-902.md')]).code).toBe(0);
    const badReport = tmpFile('O-902.md', '# O-902 報告\n');
    expect(exec(S.report, [badReport]).code).toBe(1);
    expect(exec(S.comment, ['--comments', `${FIX}/comments-ok.json`]).code).toBe(0);
    expect(exec(S.comment, ['--comments', `${FIX}/comments-bad.json`]).code).toBe(1);
    const changed = tmpFile('changed3.txt', 'a\n');
    const sum = exec(S.summary, ['--task', 'O-902', '--sha', 'abcdef0', '--vitest', `${FIX}/vitest-full.json`, '--changed', changed]);
    expect([sum.code, sum.out.startsWith('## 自動驗證摘要（O-902 @ abcdef0）')]).toEqual([0, true]);

    const root = mkdtempSync(join(tmpdir(), 'o009-cli-root-'));
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    const scenario = join(root, 'scenario.json');
    writeFileSync(scenario, JSON.stringify({ rules: [{ file: join(root, 'a.ts'), contains: 'a = 9', failed: ['s (AC-X-1) t'] }] }));
    const mutants = join(root, 'O-902.json');
    const mutant = { id: 'M1', file: 'a.ts', before: 'a = 1', after: 'a = 9', expectFail: ['(AC-X-1)'] };
    writeFileSync(mutants, JSON.stringify({ task: 'O-902', mutants: [mutant] }));
    const out = join(root, 'out.json');
    const args = ['--file', mutants, '--out', out, '--root', root, '--', process.execPath, `${FIX}/fake-runner.mjs`, '{report}', scenario];
    const good = exec(S.mutants, args);
    expect([good.code, good.out]).toEqual([0, 'run-mutants: KILLED M1\n']);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    writeFileSync(scenario, JSON.stringify({ rules: [] }));
    expect(exec(S.mutants, args).code).toBe(1);
  });

  it('(AC-O9-8) (TC-26) scripts import only node: or relative modules and swallow no errors', () => {
    for (const name of ['task-file', 'scope-check', 'run-mutants', 'verify-summary', 'report-lint', 'comment-lint']) {
      const src = readFileSync(here(`./${name}.mjs`), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) expect(m[1], name).toMatch(/^(node:|\.\/)/);
      expect(src).not.toMatch(/\|\|\s*true/);
      expect(src).not.toContain('continue-on-error');
      expect(src).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
      expect(src).not.toMatch(/process\.exit\(\s*0\s*\)/);
      expect(src).not.toMatch(/\bfetch\(/);
    }
    const mu = readFileSync(here('./run-mutants.mjs'), 'utf8');
    expect(mu).not.toMatch(/['"`]git['"`]|['"`]gh['"`]/);
  });
});
