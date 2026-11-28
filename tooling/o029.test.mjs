// O-029 vitest wrapper (SRE): the bundle-scan wiring test lives under .github/scripts,
// which vitest does not collect, so ac-coverage would never see AC-O29-9 / TC-12.
// This file runs that suite and asserts on its real output.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const scripts = join(repo, '.github', 'scripts');

function run(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const suites = {};

beforeAll(() => {
  suites.workflow = run(process.execPath, [join(scripts, 'ci-workflow-check.mjs'), repo]);
  suites.workflowTests = run(process.execPath, ['--test', join(scripts, 'ci-workflow-check.test.mjs')]);
  suites.failOpen = run(process.execPath, [join(scripts, 'fail-open-lint.mjs'), repo]);
}, 120_000);

describe('O-029 vitest wrapper (ac-coverage)', () => {
  it('script suites used by AC/TC all exit 0', () => {
    for (const [name, r] of Object.entries(suites)) {
      expect(r.code, `${name}:\n${r.out}`).toBe(0);
    }
  });

  it('(AC-O29-9) (TC-12) real ci.yml runs the bundle scan right after Build, fail-closed', () => {
    const text = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(text).toMatch(
      /^ {6}- name: Build\n {8}env:\n {10}VITE_DATA_MODE: mock\n {8}run: pnpm build\n(?: {6}#.*\n)+ {6}- name: Scan build output for key names\n {8}run: node tooling\/bundle-name-scan\.mjs apps\/web\/dist\n {6}- name: Install gitleaks/m,
    );
    expect(text).not.toMatch(/bundle-name-scan[^\n]*\|\|/);
    expect(suites.workflow.out).toMatch(/ci-workflow-check: OK/);
  });

  it('(AC-O29-9) (TC-12) every mutant of the bundle scan step is caught by ci-workflow-check', () => {
    expect(suites.workflowTests.out).toMatch(/✔ \(AC-O29-9\) \(TC-12\) real ci\.yml has the bundle scan step/);
    for (let n = 1; n <= 10; n += 1) {
      expect(suites.workflowTests.out).toMatch(new RegExp(`✔ mutation BN-M${String(n)} \\(AC-O29-9\\) \\(TC-12\\)`));
    }
  });
});
