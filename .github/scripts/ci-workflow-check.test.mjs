// O-015 W-5 / W-6 (retro §3.7 C4, C6, C7): the real workflows pass; each mutant fails.
// O-016: CL-1..CL-3 (cost lint), --no-renames (NR) and the PR-description step (PB) mutants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepo, displayName, parseWorkflow, BUDGET_FILE, CI_OK_NAME_EXPR, PR_BODY_STEP } from './ci-workflow-check.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CI = '.github/workflows/ci.yml';
const W = '.github/workflows/';
const TC = '.github/scripts/taskcheck.sh';
const PC = '.github/scripts/run-task-post-check.sh';
const setBudget = (d, f) => { const p = join(d, BUDGET_FILE); const b = JSON.parse(readFileSync(p, 'utf8')); f(b.max_jobs); writeFileSync(p, JSON.stringify(b)); };

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
  assert.equal(g.timeout, '10');
  assert.equal(wf.concurrency.group, 'ci-${{ github.workflow }}-${{ github.ref }}');
  const pb = g.steps.find((s) => s.name === PR_BODY_STEP);
  assert.equal(pb.run, 'bash .github/scripts/pr-body-check.sh');
  assert.equal(pb.env.PR_NUMBER, '${{ github.event.pull_request.number }}');
});
test('O-016: every workflow parsed with a timeout and a concurrency group (not vacuously OK)', () => {
  const budget = JSON.parse(readFileSync(join(ROOT, BUDGET_FILE), 'utf8')).max_jobs;
  const files = readdirSync(join(ROOT, '.github/workflows')).filter((n) => n.endsWith('.yml')).sort();
  assert.deepEqual(Object.keys(budget).sort(), files);
  for (const f of files) {
    const wf = parseWorkflow(readFileSync(join(ROOT, '.github/workflows', f), 'utf8'));
    assert.ok(wf.jobs.size >= 1, f);
    assert.ok(wf.concurrency && wf.concurrency.group, `${f} concurrency group`);
    for (const j of wf.jobs.values()) assert.match(String(j.timeout), /^[0-9]+$/, `${f}:${j.id}`);
  }
  assert.equal(parseWorkflow(readFileSync(join(ROOT, '.github/workflows/claude.yml'), 'utf8')).jobs.get('claude').timeout, '30');
  assert.equal(parseWorkflow(readFileSync(join(ROOT, '.github/workflows/notify-grok.yml'), 'utf8')).jobs.get('notify').timeout, '5');
  assert.equal(parseWorkflow(readFileSync(join(ROOT, '.github/workflows/poc-spike.yml'), 'utf8')).jobs.get('spike').timeout, '20');
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
  ['WF-M18 taskcheck needs only ci-guard (O-025)', (d) => edit(d, CI, '    needs: [ci-guard, e2e]', '    needs: ci-guard'), /taskcheck must need ci-guard and e2e/],
  ['WF-M19 taskcheck if drops e2e skipped (O-025)', (d) => edit(d, CI, "      (needs.e2e.result == 'success' || needs.e2e.result == 'failure' || needs.e2e.result == 'skipped') &&\n      ", ''), /taskcheck if must run when e2e is success, failure, or skipped/],
  ['WF-M14 diff without --no-renames (C1)', (d) => edit(d, '.github/scripts/ci-guard-mode.sh', 'git diff --no-renames --name-only "$BEFORE_SHA"', 'git diff --name-only "$BEFORE_SHA"'), /--no-renames/],
  ['WF-M15 new *-test.sh not wired into ci-guard', (d) => writeFileSync(join(d, '.github/scripts/new-thing-test.sh'), 'exit 0\n'), /does not run: bash \.github\/scripts\/new-thing-test\.sh/],
  ['WF-M17 single-brace ${ env.X } in a with: value', (d) => edit(d, CI, "    if: needs.ci-guard.outputs.mode == 'full' && needs.ci-guard.outputs.has_node == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n      - uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: ${{ env.NODE_VERSION }}", "    if: needs.ci-guard.outputs.mode == 'full' && needs.ci-guard.outputs.has_node == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n      - uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: ${ env.NODE_VERSION }"), /single-brace/],
  // O-016 CL-1: timeout-minutes on every job, integer 1..60.
  ['CL-M1 claude.yml job without timeout-minutes', (d) => edit(d, W + 'claude.yml', '    timeout-minutes: 30\n', ''), /claude\.yml: job claude has no timeout-minutes \(CL-1\)/],
  ['CL-M2 ci-ok timeout-minutes: 0', (d) => edit(d, CI, '    if: always()\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n', '    if: always()\n    runs-on: ubuntu-latest\n    timeout-minutes: 0\n'), /ci\.yml: job ci-ok timeout-minutes must be an integer 1\.\.60 \(CL-1\), got 0/],
  ['CL-M3 notify-grok timeout-minutes: 120', (d) => edit(d, W + 'notify-grok.yml', '    timeout-minutes: 5\n', '    timeout-minutes: 120\n'), /notify-grok\.yml: job notify timeout-minutes must be an integer 1\.\.60 \(CL-1\), got 120/],
  ['CL-M4 timeout-minutes as an expression', (d) => edit(d, W + 'poc-spike.yml', '    timeout-minutes: 20\n', "    timeout-minutes: ${{ inputs.t }}\n"), /poc-spike\.yml: job spike timeout-minutes must be an integer/],
  // CL-2: top-level concurrency with a group.
  ['CL-M5 notify-grok without concurrency', (d) => edit(d, W + 'notify-grok.yml', 'concurrency:\n  group: notify-grok-${{ github.event.pull_request.number }}\n  cancel-in-progress: false\n', ''), /notify-grok\.yml: no top-level concurrency \(CL-2\)/],
  ['CL-M6 poc-spike concurrency without group', (d) => edit(d, W + 'poc-spike.yml', '  group: poc-spike-${{ inputs.ref }}\n', ''), /poc-spike\.yml: concurrency has no group \(CL-2\)/],
  ['CL-M7 notify-grok inline concurrency', (d) => edit(d, W + 'notify-grok.yml', 'concurrency:\n  group: notify-grok-${{ github.event.pull_request.number }}\n  cancel-in-progress: false\n', 'concurrency: x\n'), /notify-grok\.yml: concurrency must be a block/],
  // CL-3: job count <= .github/ci-budget.json; every workflow listed; file readable.
  ['CL-M8 ci.yml gains a job, budget unchanged', (d) => edit(d, CI, '  check:\n', '  extra:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: echo\n\n  check:\n'), /ci\.yml: 8 jobs exceed the budget of 7/],
  ['CL-M9 budget file misses a workflow', (d) => setBudget(d, (m) => { delete m['notify-grok.yml']; }), /workflow notify-grok\.yml is not listed \(CL-3\)/],
  ['CL-M10 budget file is bad JSON', (d) => writeFileSync(join(d, BUDGET_FILE), '{ "max_jobs": '), /ci-budget\.json: cannot read or parse \(CL-3\)/],
  ['CL-M11 budget file missing', (d) => rmSync(join(d, BUDGET_FILE)), /ci-budget\.json: cannot read or parse \(CL-3\)/],
  ['CL-M12 budget keeps a removed workflow (stale)', (d) => rmSync(join(d, W + 'notify-grok.yml')), /notify-grok\.yml is not a workflow \(stale entry, CL-3\)/],
  ['CL-M13 budget limit 0', (d) => setBudget(d, (m) => { m['claude.yml'] = 0; }), /claude\.yml limit must be a positive integer/],
  // O-016 (retro M5): --no-renames at each of the 4 diffs.
  ['NR-M1 taskcheck main-push task-lint diff without --no-renames', (d) => edit(d, TC, 'git diff --no-renames --name-only --diff-filter=AM "$BEFORE_SHA"', 'git diff --name-only --diff-filter=AM "$BEFORE_SHA"'), /taskcheck\.sh:\d+: git diff without --no-renames/],
  ['NR-M2 taskcheck scope-check diff without --no-renames', (d) => edit(d, TC, 'git diff --no-renames --name-only "${BASE}...${HEAD}" > "$CHANGED"', 'git diff --name-only "${BASE}...${HEAD}" > "$CHANGED"'), /taskcheck\.sh:\d+: git diff without --no-renames/],
  ['NR-M3 taskcheck report-lint diff without --no-renames', (d) => edit(d, TC, 'git diff --no-renames --name-only --diff-filter=AM "${BASE}...${HEAD}"', 'git diff --name-only --diff-filter=AM "${BASE}...${HEAD}"'), /taskcheck\.sh:\d+: git diff without --no-renames/],
  ['NR-M4 post-check summary diff without --no-renames', (d) => edit(d, PC, 'git diff --no-renames --name-only "${BASE_REF}...${HEAD_SHA}"', 'git diff --name-only "${BASE_REF}...${HEAD_SHA}"'), /run-task-post-check\.sh:\d+: git diff without --no-renames/],
  ['NR-M5 a new git diff call not registered', (d) => edit(d, PC, 'CHANGED="$OUT_DIR/run-task-changed.txt"\n', 'CHANGED="$OUT_DIR/run-task-changed.txt"\ngit diff --no-renames --stat HEAD\n'), /expected 1 git diff call\(s\), found 2/],
  // O-016: PR-description step.
  ['PB-W1 PR-description step removed', (d) => edit(d, CI, "      - name: 'PR description: Actions 分鐘數影響'\n", "      - name: 'PR description'\n"), /step "PR description: Actions 分鐘數影響" missing/],
  ['PB-W2 PR-description step on every event', (d) => edit(d, CI, "        if: ${{ !cancelled() && github.event_name == 'pull_request' }}\n", '        if: ${{ !cancelled() }}\n'), /"PR description: Actions 分鐘數影響" must have exactly if/],
  ['PB-W3 PR-description step uses the push sha', (d) => edit(d, CI, '          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n        run: bash .github/scripts/pr-body-check.sh', '          HEAD_SHA: ${{ github.sha }}\n        run: bash .github/scripts/pr-body-check.sh'), /env HEAD_SHA must be/],
  ['PB-W4 pull_request gains types with edited', (d) => edit(d, CI, '  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n    types: [opened, synchronize, reopened, edited]\n'), /pull_request must keep the default types/],
  ['PB-W5 pr-body-check-test.sh not wired', (d) => edit(d, CI, '          bash .github/scripts/pr-body-check-test.sh\n', ''), /does not run: bash \.github\/scripts\/pr-body-check-test\.sh/],
  ['WF-M16 old pushguard job comes back', (d) => edit(d, CI, '  check:\n', '  pushguard:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n\n  check:\n'), /job pushguard must not exist/],
];
for (const [name, mutate, want] of MUTANTS) {
  test(`mutation ${name} is caught`, () => {
    const f = withCopy(mutate);
    assert.ok(f.some((x) => want.test(x)), `${name}: findings were\n${f.join('\n') || '(none)'}`);
  });
}
