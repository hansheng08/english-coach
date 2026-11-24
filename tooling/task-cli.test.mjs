import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const SCRIPTS = {
  lint: here('./task-lint.mjs'),
  scope: here('./scope-check.mjs'),
  cov: here('./ac-coverage.mjs'),
};
const FIX = here('./fixtures/tasks');
const REPO = here('..');
const exec = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: REPO, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = mkdtempSync(join(tmpdir(), 'o008-'));
const tmpFile = (name, content) => {
  const p = join(tmp, name);
  writeFileSync(p, content);
  return p;
};

describe('task tooling CLIs', () => {
  it('(AC-O8-7) (TC-25) bad CLI input exits 1 with USAGE or INPUT and never prints OK', () => {
    const notJson = tmpFile('bad.json', '{nope');
    const noResults = tmpFile('empty.json', '{}');
    const cases = [
      [SCRIPTS.lint, []],
      [SCRIPTS.lint, ['--bogus']],
      [SCRIPTS.lint, [join(tmp, 'missing.md')]],
      [SCRIPTS.scope, []],
      [SCRIPTS.scope, ['--bogus', 'x']],
      [SCRIPTS.scope, ['--branch', 'task/O-901', '--changed', join(tmp, 'missing.txt'), '--tasks-dir', FIX]],
      [SCRIPTS.scope, ['--branch', 'task/O-901', '--changed']],
      [SCRIPTS.cov, []],
      [SCRIPTS.cov, ['--bogus']],
      [SCRIPTS.cov, ['--branch', 'task/O-901', '--results', join(tmp, 'missing.json'), '--tasks-dir', FIX]],
      [SCRIPTS.cov, ['--branch', 'task/O-901', '--results', notJson, '--tasks-dir', FIX]],
      [SCRIPTS.cov, ['--branch', 'task/O-901', '--results', noResults, '--tasks-dir', FIX]],
    ];
    for (const [script, args] of cases) {
      const r = exec(script, args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err).toMatch(/USAGE|INPUT/);
      expect(r.out).not.toContain('OK');
    }
  });

  it('(AC-O8-7) (AC-O8-1) (AC-O8-4) (TC-26) (TC-16) child process exit codes and output format', () => {
    const ok = exec(SCRIPTS.lint, [`${FIX}/O-901.md`]);
    expect([ok.code, ok.out]).toEqual([0, `task-lint: OK ${FIX}/O-901.md\n`]);

    const bad = readFileSync(`${FIX}/O-901.md`, 'utf8').replace('## 限制\n範例。\n\n', '').replace('## 目標', '```sql\nselect 1;\n```\n\n## 目標');
    const badPath = join(tmp, 'O-901.md');
    writeFileSync(badPath, bad);
    const r = exec(SCRIPTS.lint, [badPath]);
    expect(r.code).toBe(1);
    expect(r.err.trim().split('\n')).toHaveLength(3);
    expect(r.err).toMatch(/^task-lint: FAIL .*O-901\.md:\d+: TL-SECTION: /m);
    expect(r.err.trim().split('\n').at(-1)).toBe('task-lint: 2 error(s)');
    expect(r.err).toContain('TL-SQL');
    expect(r.out).toBe('');

    const scopeOk = exec(SCRIPTS.scope, ['--branch', 'task/O-901', '--changed', `${FIX}/changed-ok.txt`, '--tasks-dir', FIX]);
    expect([scopeOk.code, scopeOk.out]).toEqual([0, 'scope-check: OK task/O-901\n']);
    const scopeBad = exec(SCRIPTS.scope, ['--branch', 'task/O-901', '--changed', `${FIX}/changed-bad.txt`, '--tasks-dir', FIX]);
    expect(scopeBad.code).toBe(1);
    expect(scopeBad.err).toContain('SC-DENY');

    const covOk = exec(SCRIPTS.cov, ['--branch', 'task/O-901', '--results', `${FIX}/vitest-ok.json`, '--tasks-dir', FIX]);
    expect([covOk.code, covOk.out]).toEqual([0, 'ac-coverage: OK task/O-901\n']);
    const covBad = exec(SCRIPTS.cov, ['--branch', 'task/O-901', '--results', `${FIX}/vitest-missing.json`, '--tasks-dir', FIX]);
    expect(covBad.code).toBe(1);
    expect(covBad.err).toContain('CV-MISSING');
  });

  it('(AC-O8-7) (AC-O8-8) (TC-27) scripts import only node: or relative modules and swallow no errors', () => {
    for (const name of ['task-file', 'task-lint', 'scope-check', 'ac-coverage']) {
      const src = readFileSync(here(`./${name}.mjs`), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) expect(m[1]).toMatch(/^(node:|\.\/)/);
      expect(src).not.toMatch(/\|\|\s*true/);
      expect(src).not.toContain('continue-on-error');
      expect(src).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
      expect(src).not.toMatch(/process\.exit\(\s*0\s*\)/);
      expect(src).not.toMatch(/\bfetch\(/);
    }
  });
});
