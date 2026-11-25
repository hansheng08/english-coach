// O-015 W-5 / W-6 (retro §3.7 C4, C6, C7): the real workflows pass; each mutant fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepo, displayName, parseWorkflow, CI_OK_NAME_EXPR } from './ci-workflow-check.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CI = '.github/workflows/ci.yml';

function withCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-wf-'));
  cpSync(join(ROOT, '.github'), join(dir, '.github'), { recursive: true });
  cpSync(join(ROOT, '.claude/hooks/pushguard'), join(dir, '.claude/hooks/pushguard'), { recursive: true });
  mutate(dir);
  const f = checkRepo(dir);
  rmSync(dir, { recursive: true, force: true });
  return f;
}
function edit(dir, rel, from, to) {
  const p = join(dir, rel);
  const s = readFileSync(p, 'utf8');
  assert.ok(s.includes(from), `anchor not found in ${rel}: ${from}`);
  writeFileSync(p, s.replace(from, to));
}

test('real repo: no findings', () => {
  assert.deepEqual(checkRepo(ROOT), []);
});
test('parser sees the real structure (not vacuously OK)', () => {
  const wf = parseWorkflow(readFileSync(join(ROOT, CI), 'utf8'));
  assert.deepEqual(wf.events, ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual([...wf.jobs.keys()], ['ci-guard', 'check', 'taskcheck', 'bundle', 'db', 'e2e', 'ci-ok']);
  const g = wf.jobs.get('ci-guard');
  assert.deepEqual(g.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(g.steps.find((s) => s.name === 'gitleaks (full history)').if, '${{ !cancelled() }}');
  assert.match(g.steps.find((s) => s.name === 'pushguard tests').run, /run-task-usage-limit-test\.sh/);
});
test('C4: ci-ok display name per event', () => {
  const job = { id: 'ci-ok', name: CI_OK_NAME_EXPR };
  assert.equal(displayName(job, 'pull_request'), 'ci-ok');
  assert.equal(displayName(job, 'push'), 'ci-ok (push)');
  assert.equal(displayName(job, 'workflow_dispatch'), 'ci-ok (workflow_dispatch)');
  assert.equal(displayName({ id: 'x', name: "${{ 'ci-ok' }}" }, 'push'), null);
});

const MUTANTS = [
  ['WF-M1 paths-ignore on push (W-5)', (d) => edit(d, CI, "  push:\n    branches: [main, 'task/**', 'fix/**']", "  push:\n    branches: [main, 'task/**', 'fix/**']\n    paths-ignore: ['docs/**']"), /paths-ignore/],
  ['WF-M2 gitleaks gated on mode (C7)', (d) => edit(d, CI, "      - name: gitleaks (full history)\n        if: ${{ !cancelled() }}", "      - name: gitleaks (full history)\n        if: ${{ !cancelled() && steps.mode.outputs.mode == 'full' }}"), /gitleaks \(full history\)" must have exactly if/],
  ['WF-M3 actionlint without !cancelled() (C7)', (d) => edit(d, CI, "      - name: actionlint\n        if: ${{ !cancelled() }}\n", '      - name: actionlint\n'), /"actionlint" must have exactly if/],
  ['WF-M4 check if mode == Full (C5 wiring typo)', (d) => edit(d, CI, "    if: needs.ci-guard.outputs.mode == 'full' && needs.ci-guard.outputs.has_node == 'true'", "    if: needs.ci-guard.outputs.mode == 'Full' && needs.ci-guard.outputs.has_node == 'true'"), /check if must start with/],
  ['WF-M5 ci-ok plain name on every event (C4)', (d) => edit(d, CI, `    name: ${CI_OK_NAME_EXPR}\n`, '    name: ci-ok\n'), /event push: no job may be named ci-ok/],
  ['WF-M6 ci-ok without a name: (C4)', (d) => edit(d, CI, `    name: ${CI_OK_NAME_EXPR}\n`, ''), /ci-ok name must be/],
  ['WF-M7 ci-ok needs without taskcheck', (d) => edit(d, CI, 'needs: [ci-guard, check, bundle, db, e2e, taskcheck]', 'needs: [ci-guard, check, bundle, db, e2e]'), /ci-ok needs must be exactly/],
  ['WF-M8 drop pull-requests: read (C6)', (d) => edit(d, CI, '      contents: read\n      pull-requests: read\n', '      contents: read\n'), /permissions must be exactly/],
  ['WF-M9 drop run-task-usage-limit-test.sh (C7, #42)', (d) => edit(d, CI, '          bash .github/scripts/run-task-usage-limit-test.sh\n', ''), /does not run: bash \.github\/scripts\/run-task-usage-limit-test\.sh/],
  ['WF-M10 job renamed back to guard (C6, R2)', (d) => { const p = join(d, CI); writeFileSync(p, readFileSync(p, 'utf8').replaceAll('ci-guard', 'guard')); }, /job name "guard" is used by/],
  ['WF-M11 another pull_request workflow with a ci-ok job (C4)', (d) => writeFileSync(join(d, '.github/workflows/x.yml'), 'name: x\non:\n  pull_request:\njobs:\n  ci-ok:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n'), /job name "ci-ok" is used by/],
  ['WF-M12 REF_NAME from github.ref (C3)', (d) => edit(d, CI, '          REF_NAME: ${{ github.ref_name }}\n          BEFORE_SHA', '          REF_NAME: ${{ github.ref }}\n          BEFORE_SHA'), /mode step env REF_NAME/],
  ['WF-M13 taskcheck loses the docs + tasks_changed branch', (d) => edit(d, CI, " ||\n       (needs.ci-guard.outputs.mode == 'docs' && needs.ci-guard.outputs.tasks_changed == 'true'))", ')'), /taskcheck if must allow/],
  ['WF-M14 diff without --no-renames (C1)', (d) => edit(d, '.github/scripts/ci-guard-mode.sh', 'git diff --no-renames --name-only "$BEFORE_SHA"', 'git diff --name-only "$BEFORE_SHA"'), /--no-renames/],
  ['WF-M15 new *-test.sh not wired into ci-guard', (d) => writeFileSync(join(d, '.github/scripts/new-thing-test.sh'), 'exit 0\n'), /does not run: bash \.github\/scripts\/new-thing-test\.sh/],
  ['WF-M17 single-brace ${ env.X } in a with: value', (d) => edit(d, CI, "    if: needs.ci-guard.outputs.mode == 'full' && needs.ci-guard.outputs.has_node == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n      - uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: ${{ env.NODE_VERSION }}", "    if: needs.ci-guard.outputs.mode == 'full' && needs.ci-guard.outputs.has_node == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n      - uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: ${ env.NODE_VERSION }"), /single-brace/],
  ['WF-M16 old pushguard job comes back', (d) => edit(d, CI, '  check:\n', '  pushguard:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n\n  check:\n'), /job pushguard must not exist/],
];
for (const [name, mutate, want] of MUTANTS) {
  test(`mutation ${name} is caught`, () => {
    const f = withCopy(mutate);
    assert.ok(f.some((x) => want.test(x)), `${name}: findings were\n${f.join('\n') || '(none)'}`);
  });
}
