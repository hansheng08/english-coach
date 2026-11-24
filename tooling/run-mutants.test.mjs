import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, run, runMutants, validateMutants } from './run-mutants.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/o009/fake-runner.mjs', import.meta.url));
const A_SRC = 'export const a = 1;\n';
const B_SRC = 'export const b = 2;\n';
const M1 = { id: 'M1', file: 'src/a.ts', before: 'a = 1', after: 'a = 9', expectFail: ['(AC-X-1)'] };
const M2 = { id: 'M2', file: 'src/b.ts', before: 'b = 2', after: 'b = 9', expectFail: ['(AC-X-1)'] };
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const rules = (fs) => fs.map((f) => f.rule);

// 在 os.tmpdir() 建立專案副本；回傳路徑與以假執行器為準的 runner。
function project(mutants, scenarioRules, { task = 'O-902', extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'o009-mu-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.ts'), A_SRC);
  writeFileSync(join(root, 'src/b.ts'), B_SRC);
  const base = (rel) => join(root, rel);
  const scenario = join(root, 'scenario.json');
  writeFileSync(
    scenario,
    JSON.stringify({ rules: scenarioRules.map((r) => ({ ...r, file: base(r.file), ...(r.touch ? { touch: { ...r.touch, file: base(r.touch.file) } } : {}) })) }),
  );
  const file = join(root, `${task}.json`);
  writeFileSync(file, JSON.stringify({ task, mutants, ...extra }));
  return { root, file, runner: [process.execPath, FAKE, '{report}', scenario], a: base('src/a.ts'), b: base('src/b.ts'), out: join(root, 'out.json') };
}
const cli = (p, extraArgs = []) => run(['--file', p.file, '--out', p.out, '--root', p.root, ...extraArgs, '--', ...p.runner]);
const killRules = [
  { file: 'src/a.ts', contains: 'a = 9', failed: ['suite (AC-X-1) catches a'] },
  { file: 'src/b.ts', contains: 'b = 9', failed: ['suite (AC-X-1) catches b'] },
];
const countingSpawn = () => {
  const spy = { calls: 0, spawn: (...args) => { spy.calls += 1; return spawnSync(...args); } };
  return spy;
};

describe('run-mutants validation', () => {
  it('(AC-O9-1) (TC-1) a valid mutants file has no findings', () => {
    const p = project([M1, M2], killRules);
    expect(validateMutants({ task: 'O-902', mutants: [M1, M2] }, { task: 'O-902', root: p.root })).toEqual([]);
    expect(cli(p).code).toBe(0);
  });

  it('(AC-O9-1) (TC-2) schema violations -> MU-SCHEMA and the runner is never called', () => {
    const bad = [
      [[M1, M2], { extra: { extra: 1 } }],
      [[M1], { task: 'O-903' }],
      [[], {}],
      [[M1, { ...M2, id: 'M1' }], {}],
      [[{ ...M1, after: M1.before }], {}],
      [[{ ...M1, expectFail: [] }], {}],
      [[{ ...M1, extra: 1 }], {}],
      [[{ ...M1, before: '' }], {}],
      [[{ ...M1, id: 'X1' }], {}],
    ];
    for (const [mutants, opt] of bad) {
      const p = project(mutants, [], opt.extra ? { extra: opt.extra } : {});
      const spy = countingSpawn();
      const data = JSON.parse(readFileSync(p.file, 'utf8'));
      if (opt.task !== undefined) data.task = opt.task;
      writeFileSync(p.file, JSON.stringify(data));
      const r = execute({ file: p.file, root: p.root, runner: p.runner, spawn: spy.spawn });
      expect(rules(r.findings), JSON.stringify(mutants)).toContain('MU-SCHEMA');
      expect(spy.calls).toBe(0);
    }
    const p = project([M1], []);
    writeFileSync(p.file, '[1]');
    expect(rules(execute({ file: p.file, root: p.root, runner: p.runner }).findings)).toEqual(['MU-SCHEMA']);
  });

  it('(AC-O9-1) (TC-3) illegal targets -> MU-TARGET and the runner is never called', () => {
    const targets = ['../x.ts', '/etc/passwd', 'src/missing.ts', 'a.test.ts', 'docs/x.md', 'src/a.spec.ts', '.github/x.yml', 'node_modules/x/y.js', 'src'];
    for (const file of targets) {
      const p = project([{ ...M1, file }], []);
      mkdirSync(join(p.root, 'docs'), { recursive: true });
      writeFileSync(join(p.root, 'docs/x.md'), 'x');
      writeFileSync(join(p.root, 'a.test.ts'), 'x');
      writeFileSync(join(p.root, 'src/a.spec.ts'), 'x');
      const spy = countingSpawn();
      const r = execute({ file: p.file, root: p.root, runner: p.runner, spawn: spy.spawn });
      expect(rules(r.findings), file).toEqual(['MU-TARGET']);
      expect(spy.calls).toBe(0);
    }
  });
});

describe('run-mutants judging', () => {
  it('(AC-O9-2) (AC-O9-3) (TC-4) (TC-10) all mutants killed -> exit 0, KILLED lines, report matches, files restored', () => {
    const p = project([M1, M2], killRules);
    const before = [sha(p.a), sha(p.b)];
    const r = cli(p);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('run-mutants: KILLED M1\nrun-mutants: KILLED M2\n');
    const report = JSON.parse(readFileSync(p.out, 'utf8'));
    expect(report).toMatchObject({ task: 'O-902', total: 2, killed: 2, survived: [] });
    expect(report.results.map((x) => x.status)).toEqual(['killed', 'killed']);
    expect(report.results[0].failedTests).toEqual(['suite (AC-X-1) catches a']);
    expect([sha(p.a), sha(p.b)]).toEqual(before);
    expect(runMutants({ file: p.file, root: p.root, runner: p.runner })).toEqual(report);
  });

  it('(AC-O9-2) (AC-O9-3) (TC-5) (TC-10) a survivor -> MU-SURVIVED M2, exit 1, files restored', () => {
    const p = project([M1, M2], [killRules[0]]);
    const before = [sha(p.a), sha(p.b)];
    const r = cli(p);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/MU-SURVIVED: M2/);
    expect(r.stderr.trim().split('\n').at(-1)).toBe('run-mutants: 1 error(s)');
    expect(r.stdout).toBe('run-mutants: KILLED M1\n');
    expect(JSON.parse(readFileSync(p.out, 'utf8'))).toMatchObject({ total: 2, killed: 1, survived: ['M2'] });
    expect([sha(p.a), sha(p.b)]).toEqual(before);
  });

  it('(AC-O9-2) (TC-6) failing tests that do not match expectFail -> MU-UNEXPECTED', () => {
    const p = project([M1], [{ file: 'src/a.ts', contains: 'a = 9', failed: ['suite (AC-Y-9) something else'] }]);
    const r = cli(p);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('MU-UNEXPECTED');
    expect(JSON.parse(readFileSync(p.out, 'utf8')).results[0]).toEqual({ id: 'M1', status: 'unexpected', failedTests: ['suite (AC-Y-9) something else'] });
  });

  it('(AC-O9-2) (TC-7) a failing baseline -> MU-BASELINE and no mutation is applied', () => {
    const calls = [];
    const p = project([M1, M2], [{ file: 'src/a.ts', contains: 'a = 1', failed: ['suite (AC-X-1) already red'] }]);
    const spy = (cmd, args, opts) => { calls.push(readFileSync(p.a, 'utf8')); return spawnSync(cmd, args, opts); };
    const r = execute({ file: p.file, root: p.root, runner: p.runner, spawn: spy });
    expect(rules(r.findings)).toEqual(['MU-BASELINE']);
    expect(calls).toEqual([A_SRC]);
    expect(readFileSync(p.a, 'utf8')).toBe(A_SRC);
    expect(cli(p).code).toBe(1);
    const noReport = project([M1], [{ file: 'src/a.ts', contains: 'a = 1', exit: 0, report: 'none' }]);
    expect(rules(execute({ file: noReport.file, root: noReport.root, runner: noReport.runner }).findings)).toEqual(['MU-BASELINE']);
  });

  it('(AC-O9-2) (TC-8) an anchor that appears 0 or 2 times -> MU-ANCHOR', () => {
    const zero = project([{ ...M1, before: 'nope' }], []);
    expect(rules(execute({ file: zero.file, root: zero.root, runner: zero.runner }).findings)).toEqual(['MU-ANCHOR']);
    const two = project([M1], []);
    writeFileSync(two.a, 'a = 1;\na = 1;\n');
    expect(rules(execute({ file: two.file, root: two.root, runner: two.runner }).findings)).toEqual(['MU-ANCHOR']);
    expect(readFileSync(two.a, 'utf8')).toBe('a = 1;\na = 1;\n');
  });

  it('(AC-O9-2) (TC-9) a runner that fails without a usable report -> MU-RUNNER', () => {
    for (const report of ['none', 'bad']) {
      const p = project([M1], [{ file: 'src/a.ts', contains: 'a = 9', report }]);
      const r = cli(p);
      expect(r.code, report).toBe(1);
      expect(r.stderr).toContain('MU-RUNNER');
    }
  });
});

describe('run-mutants restore', () => {
  it('(AC-O9-3) (TC-11) a timeout or a thrown error still restores the target and exits 1', () => {
    const hang = project([M1, M2], [{ file: 'src/a.ts', contains: 'a = 9', hang: true }, killRules[1]]);
    const r = execute({ file: hang.file, root: hang.root, runner: hang.runner, timeoutMs: 2000 });
    expect(rules(r.findings)).toEqual(['MU-RUNNER']);
    expect(r.report.results.map((x) => x.status)).toEqual(['unexpected', 'killed']);
    expect(readFileSync(hang.a, 'utf8')).toBe(A_SRC);

    const boom = project([M1], killRules);
    let n = 0;
    const spawn = (...args) => {
      n += 1;
      if (n === 2) throw new Error('boom');
      return spawnSync(...args);
    };
    const r2 = execute({ file: boom.file, root: boom.root, runner: boom.runner, spawn });
    expect(rules(r2.findings)).toEqual(['MU-RUNNER']);
    expect(readFileSync(boom.a, 'utf8')).toBe(A_SRC);
  }, 30_000);

  it('(AC-O9-3) (TC-12) a runner that rewrites another target -> MU-RESTORE, exit 1', () => {
    const p = project([M1, M2], [
      killRules[0],
      { file: 'src/b.ts', contains: 'b = 9', failed: ['suite (AC-X-1) catches b'], touch: { file: 'src/a.ts', content: 'tampered' } },
    ]);
    const r = cli(p);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('MU-RESTORE');
    expect(readFileSync(p.a, 'utf8')).toBe(A_SRC);
  });
});
