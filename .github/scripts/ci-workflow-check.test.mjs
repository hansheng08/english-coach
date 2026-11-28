// O-015 W-5 / W-6 (retro §3.7 C4, C6, C7): the real workflows pass; each mutant fails.
// O-016: CL-1..CL-3 (cost lint), --no-renames (NR) and the PR-description step (PB) mutants.
// O-031: SS-* mutants (Supabase start only via supabase-start.sh; policy-only classification).
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
const SW = '.github/workflows/ci-supersede.yml';
const BN_STEP = '      - name: Scan build output for key names\n        run: node tooling/bundle-name-scan.mjs apps/web/dist\n';
const DBV = '.github/scripts/db-job-verify.sh';
const SBW = '.github/scripts/supabase-start.sh';
const SB_E2E = 'bash .github/scripts/supabase-start.sh -x studio,imgproxy,logflare,vector';
const SB_TC = 'bash .github/scripts/supabase-start.sh -x studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor';
const SB_DB = 'bash "$(dirname "${BASH_SOURCE[0]}")/supabase-start.sh" --workdir "$WORKDIR" -x "$EXCLUDES"';
const DB_VERIFY = '      - name: Verify local Supabase, Auth (signup off), functions health, ADR-009 (1)(2), ADR-010 keys\n        run: bash .github/scripts/db-job-verify.sh\n';
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

test('(AC-O29-9) (TC-12) real ci.yml has the bundle scan step after Build, before gitleaks, fail-closed', () => {
  const b = parseWorkflow(readFileSync(join(ROOT, CI), 'utf8')).jobs.get('bundle');
  const names = b.steps.map((x) => x.name);
  const at = names.indexOf('Scan build output for key names');
  assert.ok(at > names.indexOf('Build') && names.indexOf('Build') >= 0);
  assert.ok(at < names.indexOf('Scan build output'));
  assert.equal(b.steps[at].run, 'node tooling/bundle-name-scan.mjs apps/web/dist');
  assert.equal(b.steps[at].continueOnError, null);
  assert.equal(b.steps[at].if, null);
  assert.equal(b.timeout, '10');
});
test('(AC-O31-5) (AC-O31-10) (TC-15) (TC-17) real ci.yml starts Supabase only via the wrapper; db runs it after setup-cli', () => {
  const wf = parseWorkflow(readFileSync(join(ROOT, CI), 'utf8'));
  assert.equal(wf.jobs.get('e2e').steps.find((x) => x.name === 'Start local Supabase').run, SB_E2E);
  assert.equal(wf.jobs.get('taskcheck').steps.find((x) => x.name === 'Start local Supabase for pnpm db:test').run, `psql --version\n${SB_TC}`);
  const db = wf.jobs.get('db').steps;
  const cli = db.findIndex((x) => (x.uses ?? '').startsWith('supabase/setup-cli@'));
  assert.ok(cli >= 0 && cli < db.findIndex((x) => x.run === 'bash .github/scripts/db-job-verify.sh'));
  assert.equal(db.filter((x) => (x.uses ?? '').startsWith('actions/setup-node@')).length, 0);
  assert.equal(readFileSync(join(ROOT, DBV), 'utf8').split('\n').filter((l) => l.trim() === SB_DB).length, 1);
  assert.deepEqual([wf.jobs.get('taskcheck').timeout, wf.jobs.get('db').timeout, wf.jobs.get('e2e').timeout], ['40', '20', '20']);
  assert.equal(wf.jobs.size, 7);
});
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
  ['WF-M20 e2e command inserts -- before --reporter (O-027)', (d) => edit(d, CI, 'pnpm e2e --reporter=list --reporter=json', 'pnpm e2e -- --reporter=list --reporter=json'), /e2e step must run exactly pnpm e2e --reporter=list --reporter=json/],
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
  // O-028 (AC-O28-9, TC-17): ci-supersede.yml freeze and ci-ok MODE_REASON wiring.
  ['SU-M1 (AC-O28-9) (TC-17) supersede job gains pull-requests: write', (d) => edit(d, SW, '      statuses: write\n', '      statuses: write\n      pull-requests: write\n'), /ci-supersede\.yml \(O-028\): job mark permissions must be exactly/],
  ['SU-M2 (AC-O28-9) (TC-17) checkout of the PR head (ref:)', (d) => edit(d, SW, '          persist-credentials: false\n', '          persist-credentials: false\n          ref: ${{ github.event.workflow_run.head_sha }}\n'), /no ref: \(never check out the PR head/],
  ['SU-M3 (AC-O28-9) (TC-17) persist-credentials: false removed', (d) => edit(d, SW, '        with:\n          persist-credentials: false\n', ''), /checkout must set persist-credentials: false/],
  ['SU-M4 (AC-O28-9) (TC-17) status context renamed to ci-ok-…', (d) => edit(d, '.github/scripts/ci-supersede.sh', 'CONTEXT="ci-push-superseded"', 'CONTEXT="ci-ok-superseded"'), /CONTEXT must be exactly "ci-push-superseded"/],
  ['SU-M5 (AC-O28-9) (TC-17) fork guard removed', (d) => edit(d, SW, '      github.event.workflow_run.head_repository.full_name == github.repository &&\n', ''), /if must start with github\.event\.workflow_run\.head_repository\.full_name == github\.repository &&/],
  ['SU-M6 (AC-O28-9) (TC-17) trigger switched to pull_request_target', (d) => edit(d, SW, '  workflow_run:\n    workflows: [ci]\n    types: [completed]\n', '  pull_request_target:\n'), /on: must be exactly workflow_run/],
  ['SU-M7 (AC-O28-9) (TC-17) a secret is used', (d) => edit(d, SW, '          GH_TOKEN: ${{ github.token }}\n', '          GH_TOKEN: ${{ secrets.MY_PAT }}\n'), /no secrets/],
  ['SU-M8 (AC-O28-9) (TC-17) top-level permissions widened', (d) => edit(d, SW, 'permissions: {}\n', 'permissions: write-all\n'), /top-level permissions must be \{\}/],
  ['SU-M9 (AC-O28-9) (TC-17) extra run step', (d) => edit(d, SW, '        run: bash .github/scripts/ci-supersede.sh\n', '        run: bash .github/scripts/ci-supersede.sh\n      - run: echo hi\n'), /must only run bash \.github\/scripts\/ci-supersede\.sh/],
  ['SU-M10 (AC-O28-8) ci-ok Decide drops MODE_REASON', (d) => edit(d, CI, '          MODE_REASON: ${{ needs.ci-guard.outputs.mode_reason }}\n', ''), /must pass MODE_REASON/],
  ['SU-M11 (AC-O28-8) ci-guard drops the mode_reason output', (d) => edit(d, CI, '      mode_reason: ${{ steps.mode.outputs.mode_reason }}\n', ''), /must output mode_reason/],
  ['SU-M12 (AC-O28-9) ci-supersede-test.sh not wired', (d) => edit(d, CI, '          bash .github/scripts/ci-supersede-test.sh\n', ''), /does not run: bash \.github\/scripts\/ci-supersede-test\.sh/],
  ['BN-M1 (AC-O29-9) (TC-12) bundle scan step removed', (d) => edit(d, CI, BN_STEP, ''), /bundle step "Scan build output for key names" missing/],
  ['BN-M2 (AC-O29-9) (TC-12) bundle scan moved before Build', (d) => { edit(d, CI, BN_STEP, ''); edit(d, CI, '      - name: Build\n', `${BN_STEP}      - name: Build\n`); }, /must come after the Build step/],
  ['BN-M3 (AC-O29-9) (TC-12) bundle scan gets continue-on-error', (d) => edit(d, CI, BN_STEP, `${BN_STEP}        continue-on-error: true\n`), /must not set continue-on-error/],
  ['BN-M4 (AC-O29-9) (TC-12) bundle scan reads another folder', (d) => edit(d, CI, 'bundle-name-scan.mjs apps/web/dist', 'bundle-name-scan.mjs apps/web/src'), /must run exactly node tooling\/bundle-name-scan\.mjs apps\/web\/dist/],
  ['BN-M5 (AC-O29-9) (TC-12) bundle scan ends with || true', (d) => edit(d, CI, 'bundle-name-scan.mjs apps/web/dist', 'bundle-name-scan.mjs apps/web/dist || true'), /must run exactly node tooling\/bundle-name-scan\.mjs apps\/web\/dist/],
  ['BN-M6 (AC-O29-9) (TC-12) bundle scan gets if: false', (d) => edit(d, CI, BN_STEP, `${BN_STEP.replace('\n        run:', '\n        if: false\n        run:')}`), /must not have an if/],
  ['BN-M7 (AC-O29-9) (TC-12) bundle scan moved after the gitleaks scan', (d) => { edit(d, CI, BN_STEP, ''); const p = join(d, CI); const t = readFileSync(p, 'utf8'); const k = '      - name: Scan build output\n'; const at = t.indexOf(k); const end = t.indexOf('\n\n', at); writeFileSync(p, `${t.slice(0, end)}\n${BN_STEP.trimEnd()}${t.slice(end)}`); }, /must come before the gitleaks "Scan build output" step/],
  ['BN-M8 (AC-O29-9) (TC-12) bundle scan duplicated', (d) => edit(d, CI, BN_STEP, `${BN_STEP}${BN_STEP.replace('key names', 'key names 2')}`), /exactly one step running bundle-name-scan, found 2/],
  ['BN-M9 (AC-O29-9) (TC-12) bundle timeout raised', (d) => edit(d, CI, "has_web == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 10", "has_web == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 20"), /bundle timeout-minutes must stay 10/],
  ['BN-M10 (AC-O29-9) (TC-12) bundle scan sets working-directory', (d) => edit(d, CI, BN_STEP, `${BN_STEP}        working-directory: apps\n`), /must not set working-directory/],
  // O-031 (AC-O31-5 / AC-O31-7): Supabase start only through the retry wrapper.
  ['SS-M1 (AC-O31-5) (TC-15) e2e calls supabase start directly', (d) => edit(d, CI, `run: ${SB_E2E}`, 'run: supabase start -x studio,imgproxy,logflare,vector'), /e2e runs supabase start directly/],
  ['SS-M2 (AC-O31-5) (TC-15) taskcheck calls supabase start directly', (d) => edit(d, CI, `          ${SB_TC}`, '          supabase start -x studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor'), /taskcheck runs supabase start directly/],
  ['SS-M3 (AC-O31-5) (TC-15) db-job-verify.sh calls supabase start directly', (d) => edit(d, DBV, SB_DB, 'supabase --workdir "$WORKDIR" start -x "$EXCLUDES" 2>&1 | mask_keys'), /db-job-verify\.sh:\d+: supabase start outside/],
  ['SS-M4 (AC-O31-5) (TC-15) a new script starts Supabase directly', (d) => writeFileSync(join(d, '.github/scripts/extra.sh'), '#!/usr/bin/env bash\n  supabase start\n'), /extra\.sh:2: supabase start outside/],
  ['SS-M5 (AC-O31-5) (TC-15) e2e start flags changed', (d) => edit(d, CI, `run: ${SB_E2E}`, `run: ${SB_E2E},mailpit`), /e2e step "Start local Supabase" must run exactly/],
  ['SS-M6 (AC-O31-5) (TC-15) e2e start gets continue-on-error', (d) => edit(d, CI, `run: ${SB_E2E}\n`, `run: ${SB_E2E}\n        continue-on-error: true\n`), /must not set continue-on-error \(O-031\)/],
  ['SS-M7 (AC-O31-5) (TC-15) taskcheck start loses its if', (d) => edit(d, CI, "        if: hashFiles('supabase/config.toml') != '' && !(github.event_name == 'push' && github.ref_name == 'main')\n        run: |\n          psql", '        run: |\n          psql'), /taskcheck Supabase start must keep if/],
  ['SS-M8 (AC-O31-5) (TC-15) db-job-verify excludes changed', (d) => edit(d, DBV, 'EXCLUDES="studio,', 'EXCLUDES="db,studio,'), /excludes must stay/],
  ['SS-M9 (AC-O31-7) (TC-15) wrapper classifies in shell', (d) => edit(d, SBW, 'reserve_ports\nattempt=1', 'reserve_ports\ngrep -qi "Address already in use" /dev/null\nattempt=1'), /contains failure marker "address already in use"/],
  ['SS-M10 (AC-O31-7) (TC-15) wrapper skips the policy decide', (d) => edit(d, SBW, 'decision="$(node "$POLICY" decide "$attempt" "$kind" "$held")"', 'decision="retry 10"'), /must decide via node "\$POLICY" decide/],
  ['SS-M11 (AC-O31-7) (TC-15) wrapper skips the policy classify', (d) => edit(d, SBW, 'kind="$(node "$POLICY" classify "$log")"', 'kind="port-bind"'), /must classify via node "\$POLICY" classify/],
  ['SS-M12 (AC-O31-6) (TC-15) wrapper drops stop --no-backup', (d) => edit(d, SBW, 'supabase "${pre[@]}" stop --no-backup 2>&1', 'supabase "${pre[@]}" stop 2>&1'), /must clean up with supabase stop --no-backup/],
  ['SS-M13 (AC-O31-10) (TC-17) db verify moved before setup-cli', (d) => { edit(d, CI, DB_VERIFY, ''); edit(d, CI, '      - name: Check Docker\n        run: docker info\n', `      - name: Check Docker\n        run: docker info\n${DB_VERIFY}`); }, /before db-job-verify\.sh \(O-031\)/],
  ['SS-M14 (AC-O31-10) (TC-17) e2e timeout raised', (d) => edit(d, CI, "has_e2e == 'true' && needs.ci-guard.outputs.is_pr == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 20", "has_e2e == 'true' && needs.ci-guard.outputs.is_pr == 'true'\n    runs-on: ubuntu-latest\n    timeout-minutes: 25"), /e2e timeout-minutes must stay 20 \(O-031\)/],
  ['SS-M15 (AC-O31-10) (TC-17) ci.yml budget raised to 8', (d) => setBudget(d, (m) => { m['ci.yml'] = 8; }), /budget must stay 7 jobs/],
  ['SS-M16 (AC-O31-7) (TC-15) wrapper removed', (d) => rmSync(join(d, SBW)), /supabase-start\.sh: missing/],
  ['SS-M17 (AC-O31-5) (TC-15) db job loses setup-cli', (d) => { const p = join(d, CI); const t = readFileSync(p, 'utf8'); const k = "      - uses: supabase/setup-cli@689adcfb80d947100a1eab127289b97d1fb07b13 # v3.2.0\n        with:\n          version: ${{ env.SUPABASE_CLI_VERSION }}\n      # O-031: db-job-verify"; assert.ok(t.includes(k)); writeFileSync(p, t.replace(k, '      # O-031: db-job-verify')); }, /db job must use supabase\/setup-cli/],
  ['WF-M16 old pushguard job comes back', (d) => edit(d, CI, '  check:\n', '  pushguard:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n\n  check:\n'), /job pushguard must not exist/],
];
for (const [name, mutate, want] of MUTANTS) {
  test(`mutation ${name} is caught`, () => {
    const f = withCopy(mutate);
    assert.ok(f.some((x) => want.test(x)), `${name}: findings were\n${f.join('\n') || '(none)'}`);
  });
}
