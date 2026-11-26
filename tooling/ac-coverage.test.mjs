import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCoverage, run as runCli } from './ac-coverage.mjs';

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

// ---- O-025：Playwright JSON ----
const pwTest = (status, expectedStatus, ...resultStatuses) => ({
  status,
  expectedStatus,
  results: resultStatuses.map((s, retry) => ({ status: s, retry })),
});
const spec = (title, ...tests) => ({ title, tests });
// 巢狀：file suite → describe suite → specs
const pw = (outer, ...specs) => ({ suites: [{ title: 'file.spec.ts', specs: [], suites: [{ title: outer, specs }] }] });
const PASS = pwTest('expected', 'passed', 'passed');
const coverPw = (json, extra = {}) => checkCoverage({ branch: 'task/O-901', tasks, playwright: [json], ...extra });

describe('ac-coverage playwright', () => {
  it('(AC-O25-1) (TC-1) passed nested playwright tests count; mixes with vitest', () => {
    const json = pw('d', spec('(AC-O901-1) (TC-1) a', PASS), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(coverPw(json)).toEqual([]);
    const half = pw('d', spec('(AC-O901-1) (TC-1) a', PASS));
    expect(coverPw(half, { results: results(FULL[1]) })).toEqual([]);
  });

  it('(AC-O25-1) (TC-2) name is outer suite + spec title', () => {
    const json = { suites: [{ title: '(AC-O901-1) (TC-1)', specs: [], suites: [{ title: 'inner', specs: [spec('plain', PASS)] }] }] };
    const r = coverPw(json, { results: results(FULL[1]) });
    expect(r).toEqual([]);
    const specTag = pw('no tags', spec('(AC-O901-1) (TC-1)', PASS), spec('(AC-O901-2) (TC-2)', PASS));
    expect(coverPw(specTag)).toEqual([]);
  });

  it('(AC-O25-2) (TC-3) skipped, not run, and expectedStatus skipped do not count', () => {
    for (const t of [pwTest('skipped', 'skipped'), pwTest('skipped', 'passed'), pwTest('expected', 'skipped'), pwTest('expected', 'passed')]) {
      const json = pw('d', spec('(AC-O901-1) (TC-1) a', t), spec('(AC-O901-2) (TC-2) b', PASS));
      expect(rules(coverPw(json))).toEqual(['CV-MISSING', 'CV-MISSING']);
    }
  });

  it('(AC-O25-2) (TC-4) unexpected or last result failed/timedOut/interrupted -> CV-FAILED', () => {
    const bad = [pwTest('unexpected', 'passed', 'failed'), pwTest('unexpected', 'passed', 'timedOut'), pwTest('expected', 'passed', 'interrupted'), pwTest('flaky', 'passed', 'passed', 'timedOut')];
    for (const t of bad) {
      const json = pw('d', spec('(AC-O901-1) (TC-1) a', t), spec('(AC-O901-2) (TC-2) b', PASS));
      expect(rules(coverPw(json))).toContain('CV-FAILED');
    }
  });

  it('(AC-O25-2) (TC-5) expected-fail (test.fail) is not passed', () => {
    const json = pw('d', spec('(AC-O901-1) (TC-1) a', pwTest('expected', 'failed', 'failed')), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(rules(coverPw(json))).toEqual(['CV-MISSING', 'CV-MISSING']);
  });

  it('(AC-O25-3) (TC-6) flaky that ends passed counts', () => {
    const flaky = pwTest('flaky', 'passed', 'failed', 'passed');
    const json = pw('d', spec('(AC-O901-1) (TC-1) a', flaky), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(coverPw(json)).toEqual([]);
  });

  it('(AC-O25-3) (TC-7) passed then failed does not count', () => {
    const json = pw('d', spec('(AC-O901-1) (TC-1) a', pwTest('flaky', 'passed', 'passed', 'failed')), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(rules(coverPw(json))).toContain('CV-FAILED');
  });

  it('(AC-O25-4) (TC-8) missing/empty/invalid playwright input is INPUT, never success', () => {
    const noStatus = { suites: [{ title: 's', specs: [spec('(AC-O901-1)', { expectedStatus: 'passed', results: [] })] }] };
    const noExpected = { suites: [{ title: 's', specs: [spec('(AC-O901-1)', { status: 'expected', results: [] })] }] };
    for (const bad of [null, [], {}, { suites: {} }, noStatus, noExpected]) {
      expect(rules(coverPw(bad, { results: results(...FULL) }))).toEqual(['INPUT']);
    }
    const dir = mkdtempSync(join(tmpdir(), 'o025-'));
    const write = (name, content) => {
      const p = join(dir, name);
      writeFileSync(p, content);
      return p;
    };
    const base = ['--branch', 'task/O-901', '--tasks-dir', fileURLToPath(new URL('./fixtures/tasks', import.meta.url))];
    const inputs = [join(dir, 'missing.json'), write('empty.json', ''), write('bad.json', '{nope'), write('nosuites.json', '{}')];
    for (const p of inputs) {
      const r = runCli(['--results', write('v.json', JSON.stringify(results(...FULL))), ...base, '--playwright', p]);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('INPUT');
    }
  });

  it('(AC-O25-4) (TC-9) without --playwright only Vitest/TAP is read; --playwright alone is allowed', () => {
    const base = ['--branch', 'task/O-901', '--tasks-dir', fileURLToPath(new URL('./fixtures/tasks', import.meta.url))];
    const dir = mkdtempSync(join(tmpdir(), 'o025-'));
    const v = join(dir, 'v.json');
    writeFileSync(v, JSON.stringify(results(...FULL)));
    expect(runCli(['--results', v, ...base]).code).toBe(0);
    const ok = fileURLToPath(new URL('./fixtures/o025/playwright-ok.json', import.meta.url));
    expect(runCli(['--playwright', ok, ...base]).code).toBe(0);
    expect(runCli(['--playwright', ok, '--playwright', ok, ...base]).code).toBe(0);
    expect(runCli(base).code).not.toBe(0);
  });

  it('(AC-O25-5) (TC-10) mutation guards: each weakening is observable', () => {
    // skipped / expected-fail as passed
    const j1 = pw('d', spec('(AC-O901-1) (TC-1) a', pwTest('skipped', 'skipped')), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(rules(coverPw(j1))).toEqual(['CV-MISSING', 'CV-MISSING']);
    const j2 = pw('d', spec('(AC-O901-1) (TC-1) a', pwTest('expected', 'failed', 'failed')), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(coverPw(j2)).not.toEqual([]);
    // invalid JSON as "nothing found"
    expect(rules(coverPw({ suites: 'x' }, { results: results(...FULL) }))).toEqual(['INPUT']);
    // nested suites must be walked (three levels deep)
    const deep = { suites: [{ title: 'a', specs: [], suites: [{ title: 'b', specs: [], suites: [{ title: 'c', specs: [spec('(AC-O901-1) (TC-1) a', PASS), spec('(AC-O901-2) (TC-2) b', PASS)] }] }] }] };
    expect(coverPw(deep)).toEqual([]);
    // last result, not first
    const j3 = pw('d', spec('(AC-O901-1) (TC-1) a', pwTest('flaky', 'passed', 'passed', 'failed')), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(coverPw(j3)).not.toEqual([]);
    const j4 = pw('d', spec('(AC-O901-1) (TC-1) a', pwTest('flaky', 'passed', 'failed', 'passed')), spec('(AC-O901-2) (TC-2) b', PASS));
    expect(coverPw(j4)).toEqual([]);
  });

  it('(AC-O25-6) (TC-11) changed files have no unallowed fail-open constructs', () => {
    const files = ['./ac-coverage.mjs', './fixtures/o025/playwright-ok.json'];
    for (const f of files) {
      const body = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(body).not.toMatch(/\|\|\s*true|continue-on-error/);
    }
  });
});
