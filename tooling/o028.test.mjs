// O-028 vitest wrapper (SRE): the wiring tests live under .github/scripts, which
// vitest does not collect, so ac-coverage would never see AC-O28-8 / AC-O28-9.
// This file runs those suites and asserts on their real output.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const scripts = join(repo, '.github', 'scripts');
const workflows = join(repo, '.github', 'workflows');

function run(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const suites = {};

beforeAll(() => {
  suites.ciOk = run(process.execPath, ['--test', join(scripts, 'ci-ok.test.mjs')]);
  suites.guardMode = run('bash', [join(scripts, 'ci-guard-mode-test.sh')]);
  suites.supersede = run('bash', [join(scripts, 'ci-supersede-test.sh')]);
  suites.workflow = run(process.execPath, [join(scripts, 'ci-workflow-check.mjs'), repo]);
  suites.workflowTests = run(process.execPath, ['--test', join(scripts, 'ci-workflow-check.test.mjs')]);
  suites.failOpen = run(process.execPath, [join(scripts, 'fail-open-lint.mjs'), repo]);
}, 120_000);

describe('O-028 vitest wrapper (ac-coverage)', () => {
  it('script suites used by AC/TC all exit 0', () => {
    for (const [name, r] of Object.entries(suites)) {
      expect(r.code, `${name}:\n${r.out}`).toBe(0);
    }
  });

  it('(AC-O28-8) (TC-16) ci-ok accepts light without a PR number only for task/** + tests-only-no-pr', () => {
    expect(suites.ciOk.out).toMatch(/✔ \(AC-O28-8\) \(TC-16\) tests-only-no-pr light on task\/\*\* without PR number → ok/);
    expect(suites.ciOk.out).toMatch(/✔ \(AC-O28-8\) \(TC-16\) light reason \/ PR number \/ ref mismatches → not ok/);
    expect(suites.ciOk.out).toMatch(/✔ mutation CK-M10 \(AC-O28-8\)/);
    expect(suites.ciOk.out).toMatch(/✔ mutation CK-M11 \(AC-O28-8\)/);
    expect(suites.guardMode.out).toMatch(/^ok {3}O16 \(AC-O28-8\)/m);
    expect(suites.guardMode.out).toMatch(/^ok {3}O17 \(AC-O28-8\)/m);
    expect(suites.guardMode.out).toMatch(/ci-guard-mode-test: all cases matched/);
  });

  it('(AC-O28-8) (TC-16) ci-guard wiring: QA-only push without PR is light, product file / zero BEFORE / force push are full', () => {
    for (const id of ['O1', 'O2', 'O3', 'O4', 'O6', 'O8', 'O10', 'O11']) {
      expect(suites.guardMode.out).toMatch(new RegExp(`^ok {3}${id} `, 'm'));
    }
    expect(suites.guardMode.out).toMatch(/^ok {3}mutant 'O-028 force push \(ancestor check\) ignored' killed/m);
  });

  it('(AC-O28-9) (TC-17) ci-supersede.yml is frozen: workflow_run, minimal permissions, fork guard, no ref, persist-credentials false', () => {
    const text = readFileSync(join(workflows, 'ci-supersede.yml'), 'utf8');
    expect(text).toMatch(/^ {2}workflow_run:\n {4}workflows: \[ci\]\n {4}types: \[completed\]$/m);
    expect(text).toMatch(/^permissions: \{\}$/m);
    expect(text).toMatch(/^ {6}contents: read\n {6}actions: read\n {6}statuses: write$/m);
    expect(text).toMatch(/^ {10}persist-credentials: false$/m);
    expect(text).not.toMatch(/^\s+ref\s*:/m);
    expect(text).not.toMatch(/secrets\./);
    expect(suites.workflow.out).toMatch(/ci-workflow-check: OK/);
    for (const m of ['SU-M1', 'SU-M2', 'SU-M3', 'SU-M4', 'SU-M5', 'SU-M6', 'SU-M7', 'SU-M8', 'SU-M9']) {
      expect(suites.workflowTests.out).toMatch(new RegExp(`✔ mutation ${m} \\(AC-O28-9\\)`));
    }
  });

  it('(AC-O28-9) (TC-17) supersede wiring marks only when PR ci-ok is green and push is red', () => {
    for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S9', 'S11', 'S13']) {
      expect(suites.supersede.out).toMatch(new RegExp(`^ok {3}${id} `, 'm'));
    }
    expect(suites.supersede.out).toMatch(/ci-supersede-test: all cases matched/);
    expect(suites.failOpen.code, suites.failOpen.out).toBe(0);
  });
});
