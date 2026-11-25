import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseTaskId, mutantsPathFor } from './task-file.mjs';
import { QA_GLOBS, isQaOwned, isQaTestFile } from './qa-owner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures', 'o013');
const tasksBoth = join(fx, 'tasks');
const scopeCli = join(here, 'scope-check.mjs');
const summaryCli = join(here, 'verify-summary.mjs');
const coverageCli = join(here, 'ac-coverage.mjs');
const tmps = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'o013-'));
  tmps.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const sha = (n) => String(n).padStart(40, 'a').slice(-40).replace(/[^0-9a-f]/g, 'a');
const QA_USER = 'qa@example.com';
const CLAUDE = '209825114+claude[bot]@users.noreply.github.com';
const commit = (n, subject, files, a = QA_USER, c = QA_USER) => ({ sha: sha(n), authorEmail: a, committerEmail: c, subject, files });
const f = (status, ...paths) => ({ status, paths });
const logText = (cs) =>
  cs
    .map((c) => `\x1e${c.sha}\x1f${c.authorEmail}\x1f${c.committerEmail}\x1f${c.subject}\n\n${c.files.map((x) => `${x.status}\t${x.paths.join('\t')}`).join('\n')}\n`)
    .join('');
const claudeCommit = (n, files) => commit(n, '[Claude] T-915 x', files, CLAUDE, CLAUDE);

const MUT = 'docs/qa/mutants/T-915.json';
const QA_TS = 'packages/x/a.qa.test.ts';
const REPORT = 'docs/reports/T-915-fix1.md';

const runScope = (changed, { commits, tasksDir = tasksBoth, extra = [], branch = 'task/T-915' } = {}) => {
  const d = tmp();
  const cl = join(d, 'changed.txt');
  writeFileSync(cl, `${changed.join('\n')}\n`);
  const args = [scopeCli, '--branch', branch, '--changed', cl, '--tasks-dir', tasksDir, ...extra];
  if (typeof commits === 'string') {
    const lg = join(d, 'log.txt');
    writeFileSync(lg, commits);
    args.push('--commits', lg);
  }
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

const onlyT915 = () => {
  const d = tmp();
  copyFileSync(join(tasksBoth, 'T-915.md'), join(d, 'T-915.md'));
  return d;
};

const runSummary = (task) => {
  const d = tmp();
  const ch = join(d, 'changed.txt');
  writeFileSync(ch, 'tooling/a.mjs\n');
  const vt = join(d, 'vitest.json');
  writeFileSync(vt, JSON.stringify({ testResults: [{ assertionResults: [{ status: 'passed' }] }] }));
  const r = spawnSync(process.execPath, [summaryCli, '--task', task, '--sha', 'abcdef0', '--vitest', vt, '--changed', ch], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('o013 task ids', () => {
  it('(AC-O13-1) (TC-1) baseTaskId returns the base id', () => {
    const ids = ['T-015', 'T-015-fix1', 'T-015-fix12', 'O-012', 'Q-930-fix2'];
    expect(ids.map(baseTaskId)).toEqual(['T-015', 'T-015', 'T-015', 'O-012', 'Q-930']);
  });

  it('(AC-O13-1) (TC-2) bad ids give null', () => {
    for (const id of ['T-15-fix1', 'T-015-fix', 'T-015-fix0', 'T-015-fix1-fix2', '']) {
      expect(baseTaskId(id)).toBeNull();
      expect(mutantsPathFor(id)).toBeNull();
    }
  });

  it('(AC-O13-1) (TC-3) mutantsPathFor uses the base id', () => {
    expect(mutantsPathFor('T-015-fix1')).toBe('docs/qa/mutants/T-015.json');
    expect(mutantsPathFor('O-012')).toBe('docs/qa/mutants/O-012.json');
  });
});

describe('o013 verify-summary', () => {
  it('(AC-O13-2) (TC-4) summary uses the base id mutants path', () => {
    const r = runSummary('T-915-fix1');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('未執行（沒有 docs/qa/mutants/T-915.json）');
    expect(r.stdout).toContain('T-915-fix1');
  });

  it('(AC-O13-2) (TC-5) (AC-O13-7) old ids behave as before and bad ids exit 1', () => {
    const ok = runSummary('O-902');
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('docs/qa/mutants/O-902.json');
    const bad = runSummary('T-915-fix0');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('USAGE');
    expect(bad.stdout).toBe('');
  });
});

describe('o013 qa-owned mutants', () => {
  it('(AC-O13-3) (TC-6) classification', () => {
    expect(QA_GLOBS).toContain('docs/qa/mutants/*.json');
    expect(isQaOwned('docs/qa/mutants/T-015.json')).toBe(true);
    expect(isQaTestFile('docs/qa/mutants/T-015.json')).toBe(false);
    for (const p of ['docs/qa/mutants/sub/x.json', 'docs/qa/mutants/T-015.json.bak', 'tooling/fixtures/o013/T-015.json']) {
      expect(isQaOwned(p)).toBe(false);
    }
    const o12yes = ['x.qa.test.ts', 'packages/a/b.qa.test.ts', 'supabase/tests/qa_x.sql'];
    const o12no = ['a.qa.test.tsx', 'a.qa.test.ts.txt', 'a.test.ts', 'supabase/tests/sub/qa_x.sql', 'supabase/tests/t004_rls_test.sql', 'tooling/qa_x.sql'];
    expect(o12yes.map(isQaOwned)).toEqual([true, true, true]);
    expect(o12yes.map(isQaTestFile)).toEqual([true, true, true]);
    expect(o12no.map(isQaOwned)).toEqual([false, false, false, false, false, false]);
  });

  it('(AC-O13-4) (TC-7) QA commit may modify its mutants file', () => {
    const r = runScope([MUT], { commits: logText([commit(1, '[QA] T-915 mutants', [f('M', MUT)])]) });
    expect(r.code).toBe(0);
  });

  it('(AC-O13-4) (TC-8) other task numbers are out of scope', () => {
    const other = 'docs/qa/mutants/T-916.json';
    const r = runScope([other], { commits: logText([commit(1, '[QA] x', [f('A', other)])]) });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('SC-OUT');
    expect(r.stdout).not.toContain('OK');
  });

  it('(AC-O13-4) (TC-9) non-QA changes to a mutants file fail', () => {
    for (const status of ['A', 'M', 'D']) {
      const r = runScope([MUT], { commits: logText([claudeCommit(1, [f(status, MUT)])]) });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('SC-QA-OWNER');
    }
    const all = runScope([MUT], { commits: logText([commit(1, '[QA] x', [f('M', MUT)])]), extra: ['--all-non-qa'] });
    expect(all.code).toBe(1);
    expect(all.stderr).toContain('SC-QA-OWNER');
  });

  it('(AC-O13-4) (TC-10) mutants file without a commit list gives SC-QA-NOLOG', () => {
    const r = runScope([MUT]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('SC-QA-NOLOG');
    expect(r.stdout).not.toContain('OK');
  });
});

describe('o013 incident regression', () => {
  const inScope = ['tooling/scope-check.mjs', 'tooling/task-file.mjs', REPORT];
  const claudeRun = () => logText([claudeCommit(2, [f('M', 'tooling/scope-check.mjs'), f('M', 'tooling/task-file.mjs'), f('A', REPORT)])]);

  it('(AC-O13-5) (TC-11) run range with a fix task passes', () => {
    const r = runScope(inScope, { commits: claudeRun(), extra: ['--all-non-qa'] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('scope-check: OK task/T-915');
  });

  it('(AC-O13-5) (TC-12) without the fix task file the report is SC-OUT', () => {
    const r = runScope(inScope, { commits: claudeRun(), extra: ['--all-non-qa'], tasksDir: onlyT915() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`SC-OUT: ${'不在任務單允許的檔案範圍內'}`);
    expect(r.stderr).toContain(REPORT);
    expect(r.stdout).not.toContain('OK');
  });

  it('(AC-O13-5) (TC-13) push range with an earlier QA commit passes without --all-non-qa', () => {
    const log = logText([
      commit(1, '[QA] T-915 tests', [f('A', QA_TS), f('A', MUT)]),
      claudeCommit(2, [f('M', 'tooling/scope-check.mjs'), f('A', REPORT)]),
    ]);
    const r = runScope([QA_TS, MUT, 'tooling/scope-check.mjs', REPORT], { commits: log });
    expect(r.code).toBe(0);
  });

  it('(AC-O13-5) (TC-14) Claude touching QA files fails under --all-non-qa', () => {
    for (const p of [QA_TS, MUT]) {
      const r = runScope([p], { commits: logText([claudeCommit(2, [f('M', p)])]), extra: ['--all-non-qa'] });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('SC-QA-OWNER');
      expect(r.stdout).not.toContain('OK');
    }
  });

  it('(AC-O13-5) (TC-18) reports only for task numbers that exist on the branch', () => {
    for (const p of ['docs/reports/T-916-fix1.md', 'docs/reports/T-915-fix2.md']) {
      const r = runScope([p], { commits: claudeRun(), extra: ['--all-non-qa'] });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('SC-OUT');
    }
  });
});

describe('o013 ac-coverage', () => {
  const vitest = (names) =>
    JSON.stringify({ testResults: [{ assertionResults: names.map((n) => ({ fullName: n, status: 'passed' })) }] });
  const runCoverage = (names) => {
    const d = tmp();
    const p = join(d, 'v.json');
    writeFileSync(p, vitest(names));
    const r = spawnSync(process.execPath, [coverageCli, '--branch', 'task/T-915', '--results', p, '--tasks-dir', tasksBoth], { encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  it('(AC-O13-6) (TC-15) uncovered fix task AC gives CV-MISSING', () => {
    const r = runCoverage(['(AC-T915-1) a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('CV-MISSING');
    expect(r.stderr).toContain('T-915-fix1');
    expect(r.stdout).not.toContain('OK');
  });

  it('(AC-O13-6) (TC-16) covered fix task AC passes', () => {
    const r = runCoverage(['(AC-T915-1) a', '(AC-T915-2) b']);
    expect(r.code).toBe(0);
  });
});

describe('o013 fail-closed', () => {
  it('(AC-O13-7) (TC-17) sources import only node: and ./, no error swallowing, no QA-named fixtures', () => {
    for (const name of ['task-file.mjs', 'qa-owner.mjs', 'scope-check.mjs', 'verify-summary.mjs']) {
      const src = readFileSync(join(here, name), 'utf8');
      const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      expect(specs.length).toBeGreaterThan(0);
      for (const s of specs) expect(s.startsWith('node:') || s.startsWith('./')).toBe(true);
      expect(src).not.toMatch(/\|\|\s*true/);
      expect(src).not.toContain('continue-on-error');
      expect(src).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*(process\.exit\(0\)|return\s+\{\s*code:\s*0)/);
    }
    const walk = (d) =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const rel = walk(fx).map((p) => p.slice(join(here, '..').length + 1).replaceAll('\\', '/'));
    expect(rel.length).toBeGreaterThan(0);
    expect(rel.filter(isQaOwned)).toEqual([]);
    mkdirSync(tmp(), { recursive: true });
  });
});
