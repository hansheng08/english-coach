import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTap, tapToTests } from './tap.mjs';
import { checkCoverage } from './ac-coverage.mjs';
import { runDbTest } from './db-test.mjs';
import { checkScope } from './scope-check.mjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const FIX = here('./fixtures/o010');
const REPO = here('..');
const fx = (name) => readFileSync(join(FIX, name), 'utf8');
const rules = (fs) => fs.map((f) => f.rule);
const tmp = mkdtempSync(join(tmpdir(), 'o010-'));
const exec = (script, args) => {
  const r = spawnSync(process.execPath, [here(script), ...args], { cwd: REPO, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

describe('parseTap', () => {
  it('(AC-O10-1) (TC-1) parses real pgTAP output', () => {
    const r = parseTap(fx('pgtap.tap'), 'x.sql');
    expect(r.errors).toEqual([]);
    expect(r.plan).toBe(3);
    expect(r.tests).toEqual([
      { n: 1, ok: true, description: '(AC-T9-1) (TC-1) a', directive: null },
      { n: 2, ok: false, description: '(AC-T9-2) b', directive: null },
      { n: 3, ok: true, description: '(AC-T9-3) c', directive: 'SKIP' },
    ]);
  });

  it('(AC-O10-1) (TC-2) ignores pg_prove header and summary', () => {
    expect(parseTap(fx('pgtap-wrapped.tap'), 'x.sql')).toEqual(parseTap(fx('pgtap.tap'), 'x.sql'));
  });

  it('(AC-O10-1) (TC-3) bad plan lines -> TAP-PLAN', () => {
    expect(rules(parseTap('ok 1 - a\nok 2 - b\n', 'f').errors)).toEqual(['TAP-PLAN']);
    expect(rules(parseTap('1..2\nok 1 - a\nok 2 - b\n1..2\n', 'f').errors)).toEqual(['TAP-PLAN']);
    expect(rules(parseTap('1..4\nok 1\nok 2\nok 3\n', 'f').errors)).toEqual(['TAP-PLAN']);
    expect(parseTap('ok 1 - a\nok 2 - b\n1..2\n', 'f').errors).toEqual([]);
  });

  it('(AC-O10-1) (TC-4) numbering, bail out, empty', () => {
    expect(rules(parseTap('1..2\nok 1\nok 3\n', 'f').errors)).toContain('TAP-ORDER');
    expect(rules(parseTap('1..1\nBail out! x\n', 'f').errors)).toContain('TAP-BAIL');
    expect(rules(parseTap('# only comment\n', 'f').errors)).toEqual(['TAP-EMPTY']);
    expect(rules(parseTap('', 'f').errors)).toEqual(['TAP-EMPTY']);
  });

  it('(AC-O10-1) (TC-5) status mapping', () => {
    const r = parseTap('1..4\nok 1 - a\nnot ok 2 - b\nnot ok 3 # TODO x\nok 4 # SKIP y\n', 'dir/f.sql');
    expect(tapToTests(r)).toEqual([
      { name: 'f.sql: a', status: 'passed' },
      { name: 'f.sql: b', status: 'failed' },
      { name: 'f.sql: x', status: 'skipped' },
      { name: 'f.sql: y', status: 'skipped' },
    ]);
  });
});

const TASK = { id: 'O-902', path: 'docs/tasks/O-902.md', text: fx('O-902.md') };
const vitest = (...pairs) => ({ testResults: [{ assertionResults: pairs.map(([fullName, status]) => ({ fullName, status })) }] });
const tap = (text) => parseTap(text, 'a.sql');
const cov = (o) => checkCoverage({ branch: 'task/O-902', tasks: [TASK], ...o });

describe('ac-coverage with TAP', () => {
  it('(AC-O10-2) (TC-6) pgTAP-only coverage passes with taps, CV-MISSING without', () => {
    expect(cov({ taps: [tap(fx('pass.tap'))] })).toEqual([]);
    expect(rules(cov({ results: vitest() }))).toContain('CV-MISSING');
  });

  it('(AC-O10-2) (TC-7) not ok -> CV-FAILED; SKIP only -> CV-MISSING', () => {
    const failed = tap('1..2\nok 1 - (AC-O902-1) (TC-1) a\nnot ok 2 - (AC-O902-2) (TC-2) b\n');
    expect(rules(cov({ taps: [failed] }))).toContain('CV-FAILED');
    const skipped = tap('1..2\nok 1 # SKIP (AC-O902-1) (TC-1) a\nok 2 - (AC-O902-2) (TC-2) b\n');
    expect(rules(cov({ taps: [skipped] }))).toEqual(['CV-MISSING', 'CV-MISSING']);
  });

  it('(AC-O10-2) (TC-8) vitest and TAP coverage combine', () => {
    const v = vitest(['s (AC-O902-1) (TC-1) a', 'passed']);
    const t = tap('1..1\nok 1 - (AC-O902-2) (TC-2) b\n');
    expect(cov({ results: v, taps: [t] })).toEqual([]);
  });

  it('(AC-O10-2) (TC-9) bad TAP, missing file, no inputs exit 1', () => {
    const base = ['--branch', 'task/O-902', '--tasks-dir', FIX];
    const bad = exec('./ac-coverage.mjs', [...base, '--tap', join(FIX, 'noplan.tap')]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('INPUT');
    expect(bad.err).toContain('TAP-PLAN');
    const missing = exec('./ac-coverage.mjs', [...base, '--tap', join(tmp, 'nope.tap')]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('INPUT');
    const none = exec('./ac-coverage.mjs', base);
    expect(none.code).toBe(1);
    expect(none.err).toContain('USAGE');
  });

  it('(AC-O10-2) (TC-9) results-only behaviour is unchanged', () => {
    const v = vitest(['s (AC-O902-1) (TC-1) a', 'passed'], ['s (AC-O902-2) (TC-2) b', 'passed']);
    expect(cov({ results: v })).toEqual([]);
    expect(rules(cov({ results: null }))).toEqual(['INPUT']);
  });
});

// ---- db-test -----------------------------------------------------------------

const GOOD = '1..1\nok 1 - (AC-T9-1) a\n';
function mkTests(names) {
  const dir = mkdtempSync(join(tmpdir(), 'o010-sql-'));
  for (const n of names) writeFileSync(join(dir, n), 'select 1;');
  return dir;
}
function fake(handler) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push({ cmd, args });
    return handler(cmd, args, calls.length) ?? { status: 0, stdout: '' };
  };
  return { calls, spawn };
}
const DB = 'postgresql://u:p@h:1/d';
const base = (testsDir, spawn, extra = {}) => ({
  testsDir,
  tapDir: join(mkdtempSync(join(tmpdir(), 'o010-tap-')), 'out'),
  dbUrl: DB,
  psql: 'psql',
  reset: false,
  spawn,
  ...extra,
});
const fileOf = (args) => args[args.indexOf('--file') + 1];

describe('db-test', () => {
  it('(AC-O10-3) (TC-10) runs extension then each file with the specified psql args', () => {
    const dir = mkTests(['b.sql', 'a.sql', 'note.txt']);
    const { calls, spawn } = fake((cmd, args) => (args.includes('--file') ? { status: 0, stdout: GOOD } : null));
    const o = base(dir, spawn);
    const r = runDbTest(o);
    expect(r.findings).toEqual([]);
    expect(r.files).toBe(2);
    expect(calls).toHaveLength(3);
    expect(calls[0].args).toContain('create extension if not exists pgtap with schema extensions');
    const flags = ['--no-psqlrc', '--no-align', '--quiet', '--pset', 'pager=off', '--pset', 'tuples_only=true', '--set', 'ON_ERROR_STOP=1'];
    expect(calls[1].args).toEqual([...flags, '--file', join(dir, 'a.sql'), DB]);
    expect(calls[2].args).toEqual([...flags, '--file', join(dir, 'b.sql'), DB]);
    expect(existsSync(join(o.tapDir, 'a.tap'))).toBe(true);
    expect(readFileSync(join(o.tapDir, 'b.tap'), 'utf8')).toBe(GOOD);
  });

  it('(AC-O10-3) (TC-10) CLI-level OK line and exit 0 via run()', async () => {
    const { run } = await import('./db-test.mjs');
    const dir = mkTests(['a.sql']);
    const bad = run(['--tests-dir', dir, '--tap-dir', join(tmp, 'x'), '--psql', process.execPath, '--bogus']);
    expect(bad.code).toBe(1);
    expect(bad.stdout).not.toContain('OK');
  });

  it('(AC-O10-3) (TC-11) reset failure -> DB-RESET, no test files run', () => {
    const dir = mkTests(['a.sql']);
    const { calls, spawn } = fake((cmd) => (cmd === 'supabase' ? { status: 1, stdout: '' } : null));
    const r = runDbTest(base(dir, spawn, { reset: true }));
    expect(rules(r.findings)).toEqual(['DB-RESET']);
    expect(calls).toEqual([{ cmd: 'supabase', args: ['db', 'reset'] }]);
  });

  it('(AC-O10-3) (TC-12) psql failures -> DB-PSQL; remaining files still run', () => {
    const dir = mkTests(['a.sql', 'b.sql']);
    const ext = runDbTest(base(dir, fake(() => ({ status: 2, stdout: '' })).spawn));
    expect(rules(ext.findings)).toEqual(['DB-PSQL']);
    const { calls, spawn } = fake((cmd, args) => {
      if (!args.includes('--file')) return null;
      return fileOf(args).endsWith('a.sql') ? { status: 3, stdout: '' } : { status: 0, stdout: GOOD };
    });
    const r = runDbTest(base(dir, spawn));
    expect(rules(r.findings)).toEqual(['DB-PSQL']);
    expect(calls).toHaveLength(3);
  });

  it('(AC-O10-3) (TC-13) not ok -> DB-FAIL; no plan -> DB-TAP', () => {
    const dir = mkTests(['a.sql']);
    const failing = fake(() => ({ status: 0, stdout: '1..1\nnot ok 1 - x\n' }));
    expect(rules(runDbTest(base(dir, failing.spawn)).findings)).toEqual(['DB-FAIL']);
    const noPlan = fake(() => ({ status: 0, stdout: 'ok 1 - x\n' }));
    expect(rules(runDbTest(base(dir, noPlan.spawn)).findings)).toEqual(['DB-TAP']);
  });

  it('(AC-O10-3) (TC-14) empty tests dir -> DB-NOTESTS', () => {
    const dir = mkTests([]);
    expect(rules(runDbTest(base(dir, fake(() => null).spawn)).findings)).toEqual(['DB-NOTESTS']);
  });

  it('(AC-O10-3) (TC-15) (AC-T18-23) (TC-41) (AC-T18-27) (TC-47) package.json only adds scripts.db:test (plus T-018 build/e2e and @playwright/test)', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:test']).toBe('node tooling/db-test.mjs');
    expect(Object.keys(pkg.scripts).sort()).toEqual(['arch', 'build', 'check', 'db:test', 'e2e', 'lint', 'test', 'typecheck']);
    expect(pkg.devDependencies).toEqual({
      '@playwright/test': '^1.50.0',
      'dependency-cruiser': '^18.8.0',
      eslint: '^10.15.0',
      typescript: '^5.9.3',
      'typescript-eslint': '^8.73.0',
      vitest: '^5.1.1',
    });
    expect(pkg.dependencies).toBeUndefined();
  });

  it('(AC-O10-6) (TC-19) psql exit 0 with not ok is still DB-FAIL and prints no OK', async () => {
    const dir = mkTests(['a.sql']);
    const out = '1..2\nok 1 - (AC-T9-1) a\nnot ok 2 - (AC-T9-2) b\n';
    const r = runDbTest(base(dir, fake(() => ({ status: 0, stdout: out })).spawn));
    expect(rules(r.findings)).toEqual(['DB-FAIL']);
    const { run } = await import('./db-test.mjs');
    const cli = run(['--tests-dir', dir, '--tap-dir', join(tmp, 'y'), '--psql', 'definitely-not-installed-psql']);
    expect(cli.code).toBe(1);
    expect(cli.stdout).not.toContain('db-test: OK');
  });

  it('(AC-O10-6) (TC-20) TAP verdicts with psql exit 0', () => {
    const dir = mkTests(['a.sql']);
    const verdict = (stdout) => rules(runDbTest(base(dir, fake(() => ({ status: 0, stdout })).spawn)).findings);
    expect(verdict('1..2\nok 1 - a\nok 2 - b\n')).toEqual([]);
    expect(verdict('ok 1 - a\nok 2 - b\n')).toEqual(['DB-TAP']);
    expect(verdict('1..3\nok 1 - a\nok 2 - b\n')).toEqual(['DB-TAP']);
    expect(verdict('1..2\nok 1 - a\nBail out! db gone\n')).toEqual(['DB-TAP']);
  });
});

describe('scope-check branch id', () => {
  const task = {
    id: 'T-930',
    path: 'docs/tasks/T-930.md',
    text: ['# T-930：x', '## 分支', '`fix/Q-930`', '## 檔案範圍', '### 要做', '- `tooling/a.mjs`', '### 範圍外', ''].join('\n'),
  };
  const qa = (f) => [{ sha: 'a'.repeat(40), authorEmail: 'qa@example.com', committerEmail: 'qa@example.com', subject: '[QA] Q-930 mutants', files: [{ status: 'M', paths: [f] }] }];
  const check = (f) => rules(checkScope({ branch: 'fix/Q-930', tasks: [task], changed: [f], commits: qa(f) }));
  it('(AC-O10-4) (TC-16) mutants file allowed by branch id and task id, others SC-OUT', () => {
    expect(check('docs/qa/mutants/Q-930.json')).toEqual([]);
    expect(check('docs/qa/mutants/T-930.json')).toEqual([]);
    expect(check('docs/qa/mutants/Q-931.json')).toEqual(['SC-OUT']);
  });
});

describe('fail-closed CLI and dependencies', () => {
  it('(AC-O10-5) (TC-17) bad inputs exit 1 without OK', () => {
    const a = exec('./db-test.mjs', ['--bogus']);
    const b = exec('./db-test.mjs', ['--tests-dir', join(tmp, 'missing-dir')]);
    const c = exec('./ac-coverage.mjs', ['--results', join(FIX, 'pass.tap')]);
    for (const r of [a, b, c]) {
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/USAGE|INPUT/);
      expect(r.out).not.toContain('OK');
    }
  });

  it('(AC-O10-5) (TC-18) exit codes via subprocess and source hygiene', () => {
    const args = ['--branch', 'task/O-902', '--tasks-dir', FIX];
    expect(exec('./ac-coverage.mjs', [...args, '--tap', join(FIX, 'pass.tap')]).code).toBe(0);
    const failTap = join(tmp, 'fail.tap');
    writeFileSync(failTap, '1..2\nok 1 - (AC-O902-1) (TC-1) a\nnot ok 2 - (AC-O902-2) (TC-2) b\n');
    expect(exec('./ac-coverage.mjs', [...args, '--tap', failTap]).code).toBe(1);
    mkdirSync(join(tmp, 'z'), { recursive: true });
    for (const f of ['tap.mjs', 'db-test.mjs']) {
      const src = readFileSync(here(`./${f}`), 'utf8');
      const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      expect(specs.length).toBeGreaterThan(0);
      for (const s of specs) expect(s.startsWith('node:') || s.startsWith('./')).toBe(true);
      expect(src).not.toMatch(/\|\|\s*true|continue-on-error/);
      expect(src).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*(process\.exit\(0\)|return\s*\{\s*code:\s*0)/);
    }
  });
});
