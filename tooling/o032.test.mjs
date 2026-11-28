// O-032 vitest wrapper (SRE): the task-id validation, Notify and script tests
// live under .github/scripts, which vitest does not collect, so ac-coverage
// would never see AC-O32-4 ~ AC-O32-11 / TC-8 ~ TC-22. This file runs those
// suites and asserts on their real output.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintText } from '../.github/scripts/fail-open-lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const scripts = join(repo, '.github', 'scripts');

function run(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const suites = {};

beforeAll(() => {
  suites.validateId = run('bash', [join(scripts, 'run-task-validate-id-test.sh')]);
  suites.preHead = run('bash', [join(scripts, 'run-task-pre-head-test.sh')]);
  suites.postCheck = run('bash', [join(scripts, 'run-task-post-check-test.sh')]);
  suites.usageLimit = run('bash', [join(scripts, 'run-task-usage-limit-test.sh')]);
  suites.taskcheck = run('bash', [join(scripts, 'taskcheck-test.sh')]);
  suites.permCheck = run(process.execPath, [join(scripts, 'claude-permission-check.mjs'), repo]);
  suites.permTests = run(process.execPath, ['--test', join(scripts, 'claude-permission-check.test.mjs')]);
  suites.failOpen = run(process.execPath, [join(scripts, 'fail-open-lint.mjs'), repo]);
}, 300_000);

const okLines = (out, tag) => out.split('\n').filter((l) => l.startsWith('CASE OK') && l.includes(tag));

describe('O-032 vitest wrapper (ac-coverage)', () => {
  it('script suites used by AC/TC all exit 0', () => {
    for (const [name, r] of Object.entries(suites)) {
      expect(r.code, `${name}:\n${r.out}`).toBe(0);
    }
  });

  it('(AC-O32-4) (TC-8) (TC-9) (TC-10) (TC-11) validate-id: valid / invalid ids, safe output, locale', () => {
    const out = suites.validateId.out;
    expect(out).toMatch(/CASE OK: \(AC-O32-4\) \(TC-8\) \d+ valid ids exit 0 with empty stdout; \(TC-9\) \d+ invalid ids and unset exit 1/);
    expect(out).toMatch(/CASE OK: \(AC-O32-4\) \(TC-10\) \d+ hostile values: one line, no ::, no control character, <= 200 chars/);
    expect(okLines(out, '(TC-11)')).toHaveLength(6);
    expect(out).not.toMatch(/CASE FAIL/);
  });

  it('(AC-O32-5) (TC-12) the four scripts accept T-025a / task/T-025a and keep rejecting bad shapes', () => {
    expect(okLines(suites.preHead.out, '(AC-O32-5) (TC-12)').length).toBeGreaterThanOrEqual(13);
    expect(okLines(suites.postCheck.out, '(AC-O32-5) (TC-12)').length).toBeGreaterThanOrEqual(11);
    expect(okLines(suites.usageLimit.out, '(AC-O32-5) (TC-12)').length).toBeGreaterThanOrEqual(11);
    expect(suites.taskcheck.out).toMatch(/===== CASE: \(AC-O32-5\) \(TC-12\) task\/T-925a push: scope-check then ac-coverage =====\nexit=0 \(expected 0\)/);
    expect(suites.taskcheck.out).toMatch(/===== CASE: \(AC-O32-5\) \(TC-12\) fix\/Q-925a push: report-lint and mutants with the suffix id =====\nexit=0 \(expected 0\)/);
    expect(okLines(suites.taskcheck.out, '(AC-O32-5) (TC-12) same branch error message')).toHaveLength(8);
    for (const s of ['preHead', 'postCheck', 'usageLimit']) expect(suites[s].out).not.toMatch(/CASE FAIL/);
  });

  it('(AC-O32-5) (TC-13) every task-id / branch regex under .github/ is a frozen definition', () => {
    expect(suites.permCheck.out).toMatch(/O-032: every task-id \/ branch regex under \.github\/ is a frozen definition/);
    expect(suites.permTests.out).toMatch(/✔ \(AC-O32-5\) \(TC-13\) unit: definitions pass, an old or weakened regex anywhere under \.github fails/);
  });

  // O-033 moved Validate to step 3 (the trusted snapshot is step 2).
  it('(AC-O32-6) (TC-14) (TC-15) checkout first, Validate before any id use, always() and names frozen', () => {
    expect(suites.permCheck.out).toMatch(/claude-run-task\.yml: checkout \(no if\) step 1, Snapshot step 2, Validate step 3, id used only after Validate, Notify\/outcome upload always\(\), names unchanged/);
    expect(suites.permTests.out).toMatch(/✔ \(AC-O32-6\) \(TC-14\) \(TC-15\) real claude-run-task\.yml: order, always\(\), names/);
  });

  it('(AC-O32-7) (TC-16) (TC-17) (TC-18) Notify after a failed Validate sends exactly one failure', () => {
    const out = suites.validateId.out;
    expect(okLines(out, '(AC-O32-7) (TC-16)')).toHaveLength(10);
    expect(out).toMatch(/CASE OK: \(AC-O32-7\) \(TC-17\) no WEBHOOK_URL -> exit 0, no POST/);
    expect(out).toMatch(/CASE OK: \(AC-O32-7\) \(TC-17\) \(AC-O33-8\) \(TC-19\) without the trusted root \(work tree scripts present\) -> exit [1-9]\d*, no POST/);
    expect(out).toMatch(/CASE OK: \(AC-O32-7\) \(TC-18\) all skipped -> failure, not success/);
  });

  it('(AC-O32-8) (TC-19) freeze in claude-permission-check, new test wired into the existing ci.yml step', () => {
    expect(suites.permCheck.out).toMatch(/claude-permission-check: OK \(.*O-032 task id definitions and checkout-then-Validate order frozen, O-033 guard scripts from the trusted snapshot after the branch switch\)/);
    const ci = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/\n {10}bash \.github\/scripts\/run-task-usage-limit-test\.sh\n {10}bash \.github\/scripts\/run-task-validate-id-test\.sh\n/);
    expect(suites.permTests.out).toMatch(/✔ \(AC-O32-5\) \(AC-O32-8\) \(TC-13\) \(TC-19\) real repo: frozen definitions/);
  });

  it('(AC-O32-9) (TC-20) every listed weakening is caught', () => {
    const out = suites.validateId.out;
    for (let n = 1; n <= 9; n += 1) expect(out).toMatch(new RegExp(`MUTANT KILLED VM${String(n)} `));
    expect(out).toMatch(/MUTANT KILLED NM1: skipped as success/);
    for (let n = 1; n <= 25; n += 1) expect(suites.permTests.out).toMatch(new RegExp(`✔ O32-M${String(n)} mutation .* -> exit 1`));
    expect(out).not.toMatch(/mutant survived/);
  });

  it('(AC-O32-10) (TC-21) no unallowlisted || true / continue-on-error; bad input exits non-zero', () => {
    expect(suites.failOpen.out).toMatch(/fail-open-lint: no unallowlisted/);
    const files = [
      '.github/scripts/run-task-validate-id.sh', '.github/scripts/run-task-validate-id-test.sh',
      '.github/scripts/run-task-pre-head.sh', '.github/scripts/run-task-post-check.sh',
      '.github/scripts/run-task-usage-limit.sh', '.github/scripts/taskcheck.sh',
      '.github/workflows/claude-run-task.yml', '.github/scripts/claude-permission-check.mjs',
    ];
    for (const f of files) expect(lintText(readFileSync(join(repo, f), 'utf8'), f), f).toEqual([]);
    const bad = spawnSync('bash', [join(scripts, 'run-task-validate-id.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH, TASK: 'T-025A' } });
    expect(bad.status).toBe(1);
  });

  it('(AC-O32-11) (TC-22) RUNBOOK states the id format and the checkout-then-Validate order in one sentence', () => {
    const rb = readFileSync(join(repo, 'docs', 'RUNBOOK.md'), 'utf8');
    const line = rb.split('\n').find((l) => l.startsWith('**派工編號與驗證順序（O-032）**'));
    expect(line).toBeDefined();
    expect(line).toContain('`^[TQOAP]-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?$`');
    expect(line).toMatch(/第一步 checkout.*第三步才由 `run-task-validate-id\.sh`/); // O-033: Snapshot is step 2
    expect(line).toContain('`outcome=failure`');
  });
});
