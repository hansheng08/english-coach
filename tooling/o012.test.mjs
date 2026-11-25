import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_EMAILS, QA_GLOBS, checkQaOwnership, isQaCommit, isQaOwned, parseCommitLog } from './qa-owner.mjs';
import { checkScope } from './scope-check.mjs';
import { runDbTest } from './db-test.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const fx = join(here, 'fixtures', 'o012');
const scopeCli = join(here, 'scope-check.mjs');
const tmps = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'o012-'));
  tmps.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const sha = (n) => String(n).padStart(40, 'a').slice(-40).replace(/[^0-9a-f]/g, 'a');
const GROK = 'grokbot@example.com';
const CLAUDE = '209825114+claude[bot]@users.noreply.github.com';
const commit = (n, subject, files, a = GROK, c = GROK) => ({ sha: sha(n), authorEmail: a, committerEmail: c, subject, files });
const f = (status, ...paths) => ({ status, paths });
const logText = (cs) =>
  cs
    .map((c) => `\x1e${c.sha}\x1f${c.authorEmail}\x1f${c.committerEmail}\x1f${c.subject}\n\n${c.files.map((x) => `${x.status}\t${x.paths.join('\t')}`).join('\n')}\n`)
    .join('');
const rules = (fs) => fs.map((x) => x.rule);
const QA_TS = 'packages/x/a.qa.test.ts';
const QA_SQL = 'supabase/tests/qa_a.sql';

const runScope = (branch, changed, { commits, extra = [] } = {}) => {
  const d = tmp();
  const cl = join(d, 'changed.txt');
  writeFileSync(cl, `${changed.join('\n')}\n`);
  const args = [scopeCli, '--branch', branch, '--changed', cl, '--tasks-dir', join(fx, 'tasks'), ...extra];
  if (typeof commits === 'string') {
    const lg = join(d, 'log.txt');
    writeFileSync(lg, commits);
    args.push('--commits', lg);
  }
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('o012 qa-owner', () => {
  it('(AC-O12-1) (TC-1) isQaOwned classifies 9 paths', () => {
    expect(QA_GLOBS).toEqual(['**/*.qa.test.ts', 'supabase/tests/qa_*.sql', 'docs/qa/mutants/*.json']);
    const yes = ['x.qa.test.ts', 'packages/a/b.qa.test.ts', 'supabase/tests/qa_x.sql'];
    const no = ['a.qa.test.tsx', 'a.qa.test.ts.txt', 'a.test.ts', 'supabase/tests/sub/qa_x.sql', 'supabase/tests/t004_rls_test.sql', 'tooling/qa_x.sql'];
    expect(yes.map(isQaOwned)).toEqual([true, true, true]);
    expect(no.map(isQaOwned)).toEqual([false, false, false, false, false, false]);
  });

  it('(AC-O12-2) (TC-2) QA files outside the allow list or inside the deny list pass', () => {
    const r = runScope('task/T-940', [QA_SQL, QA_TS], {
      commits: logText([commit(1, '[QA] T-940 tests', [f('A', QA_SQL), f('A', QA_TS)])]),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('scope-check: OK task/T-940');
  });

  it('(AC-O12-2) (TC-3) non-QA files keep SC-DENY', () => {
    const r1 = runScope('task/T-940', ['supabase/tests/t9.sql']);
    const r2 = runScope('task/T-940', ['packages/x/a.test.ts']);
    expect(r1.code).toBe(1);
    expect(r1.stderr).toContain('SC-DENY');
    expect(r2.stderr).toContain('SC-DENY');
  });

  it('(AC-O12-2) (TC-4) fix/Q-* branch allows QA files', () => {
    const r = runScope('fix/Q-940', ['packages/x/b.qa.test.ts'], {
      commits: logText([commit(2, '[QA] Q-940 fix', [f('M', 'packages/x/b.qa.test.ts')])]),
    });
    expect(r.code).toBe(0);
  });

  it('(AC-O12-3) (TC-5) parseCommitLog parses plain, rename, delete and merge commits', () => {
    const text = logText([
      commit(1, '[QA] one', [f('A', 'a.txt'), f('M', 'b.txt'), f('D', 'c.txt')]),
      commit(2, '[Claude] two', [f('R100', 'old.txt', 'new.txt')]),
      commit(3, 'merge', [f('MM', QA_SQL)], 'a@x', 'b@x'),
    ]);
    const { commits, errors } = parseCommitLog(text, 'log.txt');
    expect(errors).toEqual([]);
    expect(commits).toHaveLength(3);
    expect(commits[0]).toEqual({
      sha: sha(1),
      authorEmail: GROK,
      committerEmail: GROK,
      subject: '[QA] one',
      files: [f('A', 'a.txt'), f('M', 'b.txt'), f('D', 'c.txt')],
    });
    expect(commits[1]?.files).toEqual([f('R100', 'old.txt', 'new.txt')]);
    expect(commits[2]).toMatchObject({ authorEmail: 'a@x', committerEmail: 'b@x', files: [f('MM', QA_SQL)] });
  });

  it('(AC-O12-3) (TC-6) bad logs give SC-LOG; CLI exits 1 with INPUT', () => {
    const three = `\x1e${sha(1)}\x1fa\x1fb\n\nM\tx\n`;
    const short = `\x1e${'a'.repeat(39)}\x1fa\x1fb\x1fs\n`;
    const nopath = `\x1e${sha(1)}\x1fa\x1fb\x1fs\n\nM\n`;
    for (const t of [three, short, nopath]) {
      const r = parseCommitLog(t, 'log.txt');
      expect(rules(r.errors)).toEqual(['SC-LOG']);
      const cli = runScope('task/T-940', [QA_TS], { commits: t });
      expect(cli.code).toBe(1);
      expect(cli.stderr).toContain('INPUT');
      expect(cli.stdout).not.toContain('OK');
    }
    const d = tmp();
    const cl = join(d, 'changed.txt');
    writeFileSync(cl, 'tooling/a.mjs\n');
    const missing = spawnSync(
      process.execPath,
      [scopeCli, '--branch', 'task/T-940', '--changed', cl, '--commits', join(d, 'nope.txt'), '--tasks-dir', join(fx, 'tasks')],
      { encoding: 'utf8' },
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('INPUT');
  });

  it('(AC-O12-4) (TC-7) QA commits may add, modify and delete QA files', () => {
    const log = logText([commit(1, '[QA] T-940 tests', [f('A', QA_TS), f('M', QA_SQL), f('D', 'x/old.qa.test.ts')])]);
    const r = runScope('task/T-940', [QA_TS, QA_SQL], { commits: log });
    expect(r.code).toBe(0);
  });

  it('(AC-O12-4) (TC-8) Claude commits deleting or modifying QA files fail', () => {
    const cs = [commit(1, '[Claude] T-940 x', [f('D', QA_TS), f('M', QA_SQL)], CLAUDE, CLAUDE)];
    const out = checkQaOwnership({ changed: [], commits: cs, allNonQa: false });
    expect(rules(out)).toEqual(['SC-QA-OWNER', 'SC-QA-OWNER']);
    expect(out[0]?.message).toContain('[Claude]');
    const r = runScope('task/T-940', [QA_SQL], { commits: logText(cs) });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('SC-QA-OWNER');
  });

  it('(AC-O12-4) (TC-9) other roles and unprefixed commits fail', () => {
    for (const subject of ['[TechLead] T-940 x', '[SRE] T-940 x', 'no prefix']) {
      const c = commit(1, subject, [f('M', QA_TS)]);
      expect(rules(checkQaOwnership({ changed: [QA_TS], commits: [c], allNonQa: false }))).toEqual(['SC-QA-OWNER']);
    }
  });

  it('(AC-O12-4) (TC-10) [QA] prefix with a bot author or committer fails', () => {
    expect(BOT_EMAILS.length).toBeGreaterThan(0);
    const a = commit(1, '[QA] x', [f('M', QA_TS)], CLAUDE, GROK);
    const b = commit(2, '[QA] x', [f('M', QA_TS)], GROK, 'github-actions[bot]@users.noreply.github.com');
    expect(isQaCommit(a)).toBe(false);
    expect(isQaCommit(b)).toBe(false);
    expect(isQaCommit(commit(3, '[QA] x', []))).toBe(true);
    expect(isQaCommit(commit(4, '[QA]x', []))).toBe(false);
    expect(rules(checkQaOwnership({ changed: [QA_TS], commits: [a], allNonQa: false }))).toEqual(['SC-QA-OWNER']);
    expect(rules(checkQaOwnership({ changed: [QA_TS], commits: [b], allNonQa: false }))).toEqual(['SC-QA-OWNER']);
  });

  it('(AC-O12-4) (TC-11) renames and merge changes count', () => {
    const cs = [
      commit(1, '[Claude] x', [f('R100', 'a.qa.test.ts', 'a.test.ts')], CLAUDE, CLAUDE),
      commit(2, '[Claude] y', [f('R100', 'a.test.ts', 'b.qa.test.ts')], CLAUDE, CLAUDE),
      commit(3, 'Merge', [f('MM', QA_SQL)]),
    ];
    const out = checkQaOwnership({ changed: [], commits: cs, allNonQa: false });
    expect(out.map((x) => x.file)).toEqual(['a.qa.test.ts', 'b.qa.test.ts', QA_SQL]);
    expect(new Set(rules(out))).toEqual(new Set(['SC-QA-OWNER']));
  });

  it('(AC-O12-4) (TC-12) --all-non-qa makes [QA] commits fail', () => {
    const log = logText([commit(1, '[QA] T-940 tests', [f('A', QA_TS)])]);
    const r = runScope('task/T-940', [QA_TS], { commits: log, extra: ['--all-non-qa'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('SC-QA-OWNER');
    expect(r.stdout).not.toContain('OK');
  });

  it('(AC-O12-5) (TC-13) missing or unrelated log gives SC-QA-NOLOG', () => {
    const none = runScope('task/T-940', [QA_TS]);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('SC-QA-NOLOG');
    expect(none.stdout).not.toContain('OK');
    const other = runScope('task/T-940', [QA_TS], { commits: logText([commit(1, '[QA] x', [f('M', 'tooling/a.mjs')])]) });
    expect(other.code).toBe(1);
    expect(other.stderr).toContain('SC-QA-NOLOG');
    expect(other.stdout).not.toContain('OK');
  });

  it('(AC-O12-5) (TC-14) old usage without QA files behaves as before', () => {
    const r = runScope('task/T-940', ['tooling/a.mjs']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('scope-check: OK task/T-940\n');
    const t = { id: 'T-940', path: 'x.md', text: readFileSync(join(fx, 'tasks', 'T-940.md'), 'utf8') };
    expect(checkScope({ branch: 'task/T-940', tasks: [t], changed: ['tooling/a.mjs'] })).toEqual([]);
  });
});

describe('o012 runners', () => {
  it('(AC-O12-6) (TC-15) vitest runs *.qa.test.ts files from the config include', () => {
    const root = tmp();
    mkdirSync(join(root, 'tests'), { recursive: true });
    mkdirSync(join(root, 'packages', 'x'), { recursive: true });
    copyFileSync(join(fx, 'sample-fail.txt'), join(root, 'tests', 'p.qa.test.ts'));
    copyFileSync(join(fx, 'sample-pass.txt'), join(root, 'packages', 'x', 'a.qa.test.ts'));
    const r = spawnSync(
      process.execPath,
      [join(repo, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', join(repo, 'vitest.config.ts'), '--root', root, '--globals', '--reporter=json'],
      { encoding: 'utf8', timeout: 120_000 },
    );
    expect(r.status).toBe(1);
    const inline = r.stdout.indexOf('{') >= 0 ? r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1) : null;
    const written = /JSON report written to (.+)/.exec(`${r.stdout}\n${r.stderr}`)?.[1]?.trim();
    const json = JSON.parse(inline ?? readFileSync(written ?? join(root, '.vitest', 'json', 'output.json'), 'utf8'));
    const byName = Object.fromEntries(json.testResults.map((t) => [t.name.replaceAll('\\', '/'), t.status]));
    const key = (suffix) => Object.keys(byName).find((k) => k.endsWith(suffix));
    expect(byName[key('tests/p.qa.test.ts') ?? '']).toBe('failed');
    expect(byName[key('packages/x/a.qa.test.ts') ?? '']).toBe('passed');
  }, 150_000);

  it('(AC-O12-6) (TC-16) vitest.config.ts only gained one include', () => {
    const text = readFileSync(join(repo, 'vitest.config.ts'), 'utf8');
    expect(text).toContain("'**/*.qa.test.ts'");
    for (const p of [
      "'tooling/**/*.test.ts'",
      "'tooling/**/*.test.mjs'",
      "'packages/**/*.test.{ts,tsx}'",
      "'apps/**/*.test.{ts,tsx}'",
      "'supabase/**/*.test.{ts,tsx}'",
    ]) {
      expect(text).toContain(p);
    }
    expect(text).toContain("exclude: ['**/node_modules/**', '**/dist/**', 'tooling/fixtures/**']");
  });

  it('(AC-O12-7) (TC-17) db-test runs qa_*.sql and a TAP not ok fails it', () => {
    const dir = tmp();
    const tests = join(dir, 'tests');
    mkdirSync(tests);
    writeFileSync(join(tests, 'qa_probe.sql'), 'select 1;\n');
    writeFileSync(join(tests, 'a_t.sql'), 'select 1;\n');
    const called = [];
    const spawn = (_cmd, args) => {
      const i = args.indexOf('--file');
      if (i < 0) return { status: 0, stdout: '' };
      const file = args[i + 1];
      called.push(file);
      const stdout = file.endsWith('qa_probe.sql') ? '1..1\nnot ok 1 - x\n' : '1..1\nok 1 - y\n';
      return { status: 0, stdout };
    };
    const r = runDbTest({ testsDir: tests, tapDir: join(dir, 'tap'), dbUrl: 'postgresql://x', psql: 'psql', reset: false, spawn });
    expect(called).toEqual([join(tests, 'a_t.sql'), join(tests, 'qa_probe.sql')]);
    expect(r.findings.map((x) => x.rule)).toEqual(['DB-FAIL']);
    expect(r.findings[0]?.file).toContain('qa_probe.sql');
    const defaults = readFileSync(join(here, 'db-test.mjs'), 'utf8');
    expect(defaults).toContain("v['tests-dir'] ?? 'supabase/tests'");
  });

  it('(AC-O12-8) (TC-18) sources only import node: and ./, no error swallowing, no QA-named fixtures', () => {
    for (const name of ['qa-owner.mjs', 'scope-check.mjs']) {
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
    const rel = walk(fx).map((p) => p.slice(repo.length + 1).replaceAll('\\', '/'));
    expect(rel.length).toBeGreaterThan(0);
    expect(rel.filter(isQaOwned)).toEqual([]);
  });
});
