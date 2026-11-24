import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkCoverage } from './ac-coverage.mjs';

const text = readFileSync(new URL('./fixtures/tasks/O-901.md', import.meta.url), 'utf8');
const tasks = [{ id: 'O-901', path: 'docs/tasks/O-901.md', text }];
const results = (...pairs) => ({ testResults: [{ assertionResults: pairs.map(([fullName, status]) => ({ fullName, status })) }] });
const cover = (r, branch = 'task/O-901') => checkCoverage({ branch, tasks, results: r });
const rules = (fs) => fs.map((f) => f.rule);

const FULL = [
  ['s (AC-O901-1) (TC-1) a', 'passed'],
  ['s (AC-O901-2) (TC-2) b', 'passed'],
];

describe('ac-coverage', () => {
  it('(AC-O8-6) (TC-22) every AC and TC covered by a passed test -> no findings', () => {
    expect(cover(results(...FULL))).toEqual([]);
  });

  it('(AC-O8-6) (TC-23) missing AC, look-alike id, and TC test without the row AC -> CV-MISSING', () => {
    expect(rules(cover(results(FULL[0])))).toContain('CV-MISSING');
    expect(rules(cover(results(['s (AC-O901-10) (TC-1)', 'passed'], FULL[1])))).toEqual(['CV-MISSING', 'CV-MISSING']);
    const wrongAc = results(['s (AC-O901-1) a', 'passed'], ['s (TC-1) (AC-O901-2) a', 'passed'], FULL[1]);
    expect(cover(wrongAc).map((f) => f.message.split('（')[0])).toEqual(['TC-1']);
    expect(rules(cover(results(...FULL), 'task/NOPE'))).toEqual(['CV-NOTASK']);
  });

  it('(AC-O8-6) (TC-24) a failed test -> CV-FAILED; skipped/todo/pending do not count', () => {
    const failed = results(...FULL, ['s (AC-O901-1) other', 'failed']);
    expect(rules(cover(failed))).toContain('CV-FAILED');
    for (const status of ['skipped', 'pending', 'todo']) {
      const r = results(['s (AC-O901-1) (TC-1)', status], FULL[1]);
      expect(rules(cover(r))).toEqual(['CV-MISSING', 'CV-MISSING']);
    }
  });

  it('(AC-O8-6) (TC-24) malformed results are rejected as INPUT, never as success', () => {
    for (const bad of [null, [], {}, { testResults: {} }, { testResults: [{}] }, { testResults: [{ assertionResults: [{ status: 'passed' }] }] }]) {
      expect(rules(cover(bad))).toEqual(['INPUT']);
    }
  });
});
