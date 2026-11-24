import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintReport, run } from './report-lint.mjs';

const FIX = fileURLToPath(new URL('./fixtures/o009', import.meta.url));
const OK_TEXT = readFileSync(`${FIX}/report-ok.md`, 'utf8');
const lint = (text, id = 'O-902') => lintReport({ id, path: `docs/reports/${id}.md`, text });
const rules = (fs) => fs.map((f) => f.rule);
const withLine = (line) => OK_TEXT.replace('## 未完成事項', `${line}\n\n## 未完成事項`);
const padTo = (n) => {
  const lines = OK_TEXT.split('\n');
  lines.pop();
  while (lines.length < n) lines.push('補充。');
  return `${lines.join('\n')}\n`;
};

describe('report-lint', () => {
  it('(AC-O9-5) (TC-16) a valid report passes, through the CLI as well', () => {
    expect(lint(OK_TEXT)).toEqual([]);
    const copy = join(mkdtempSync(join(tmpdir(), 'o009-rl-')), 'O-902.md');
    writeFileSync(copy, OK_TEXT);
    const r = run([copy]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`report-lint: OK ${copy}\n`);
  });

  it('(AC-O9-5) (TC-17) wrong title, missing section, and the 80/81 line boundary', () => {
    expect(rules(lint(OK_TEXT, 'O-903'))).toEqual(['RL-TITLE']);
    expect(rules(lint(OK_TEXT.replace('# O-902 報告', '# O-902')))).toEqual(['RL-TITLE']);
    const noDenied = OK_TEXT.replace('## 權限被拒', '## 其他');
    expect(rules(lint(noDenied))).toEqual(['RL-SECTION']);
    expect(lint(padTo(80))).toEqual([]);
    expect(padTo(80).split('\n')).toHaveLength(81);
    const over = lint(padTo(81));
    expect(rules(over)).toEqual(['RL-LINES']);
    expect(over[0].line).toBe(81);
  });

  it('(AC-O9-5) (TC-18) pasted test output and hand-typed numbers fail; unrelated lines do not', () => {
    const bad = [' Test Files  3 passed (3)', '   Duration  1.2s', 'Files=2, Tests=116', '共 12 個測試'];
    for (const line of bad) expect(lint(withLine(line)), line).not.toEqual([]);
    expect(rules(lint(withLine(' Test Files  3 passed (3)')))).toEqual(['RL-PASTE', 'RL-NUMBER']);
    expect(rules(lint(withLine('共 12 個測試')))).toEqual(['RL-NUMBER']);
    for (const line of ['✓ works', '  × broke', '❯ x', 'Result: PASS', '  Start at  10:00', 'ran 5 tests', '3 mutants', '7 Passed']) {
      expect(lint(withLine(line)), line).not.toEqual([]);
    }
    for (const line of ['AC-O9-1 測試', 'TC-18 passed', 'v1.2 tests', 'abc3 tests', '✓works', 'Tests are fine', '5 testing notes']) {
      expect(lint(withLine(line)), line).toEqual([]);
    }
    expect(lint(OK_TEXT.replace('3 次', '3 次，其中 2 tests 被擋'))).toEqual([]);
    expect(lint(OK_TEXT.replace('無。\n\n## 需要', '```\n ✓ pasted\n```\n\n## 需要'))).not.toEqual([]);
  });

  it('(AC-O9-5) (TC-17) (TC-18) every error is listed, and the CLI prints one line per finding', () => {
    const text = `# O-999 報告\n\n## 完成摘要\n共 3 個測試\nTests  3 passed (3)\n`;
    const found = rules(lint(text));
    expect(found).toEqual(['RL-TITLE', 'RL-SECTION', 'RL-SECTION', 'RL-SECTION', 'RL-NUMBER', 'RL-PASTE', 'RL-NUMBER']);
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const r = run([`${dir}/fixtures/o009/missing.md`]);
    expect([r.code, r.stderr.includes('INPUT')]).toEqual([1, true]);
  });

  it('(AC-O9-5) the existing docs/reports/O-008.md result is fixed', () => {
    const path = fileURLToPath(new URL('../docs/reports/O-008.md', import.meta.url));
    expect(rules(lintReport({ id: 'O-008', path, text: readFileSync(path, 'utf8') }))).toEqual([]);
  });
});
