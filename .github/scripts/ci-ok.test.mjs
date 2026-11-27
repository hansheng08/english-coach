import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as real from './ci-ok.mjs';

const SCRIPT = fileURLToPath(new URL('./ci-ok.mjs', import.meta.url));
const ALL = ['ci-guard', 'check', 'bundle', 'db', 'e2e', 'taskcheck'];
const needs = (over = {}) => Object.fromEntries(ALL.map((n) => [n, { result: over[n] ?? 'success' }]));
// Contexts as ci.yml passes them (repo today: has_node, has_supabase; no web, no e2e).
const base = { hasNode: true, hasWeb: false, hasSupabase: true, hasE2e: false, tasksChanged: false, headRef: '', prNumber: '' };
const PR = { ...base, mode: 'full', event: 'pull_request', refName: '51/merge', headRef: 'task/T-010' };
const PUSH_TASK_FULL = { ...base, mode: 'full', event: 'push', refName: 'task/T-010' };
const PUSH_MAIN_FULL = { ...base, mode: 'full', event: 'push', refName: 'main' };
const DOCS = { ...base, mode: 'docs', event: 'push', refName: 'main' };
const DOCS_TASKS = { ...DOCS, tasksChanged: true };
const LIGHT = { ...base, mode: 'light', event: 'push', refName: 'task/T-010', prNumber: '51', modeReason: 'branch-with-open-pr' };
const LIGHT_QA = { ...base, mode: 'light', event: 'push', refName: 'task/T-010', prNumber: '', modeReason: 'tests-only-no-pr' };
// Jobs that ci.yml skips by design in each context (they must be allowed to skip).
const PR_SKIPS = { bundle: 'skipped', e2e: 'skipped' };
const PUSH_FULL_SKIPS = { bundle: 'skipped', db: 'skipped', e2e: 'skipped' };
const DOCS_SKIPS = { check: 'skipped', bundle: 'skipped', db: 'skipped', e2e: 'skipped', taskcheck: 'skipped' };
const LIGHT_SKIPS = DOCS_SKIPS;

test('PR full, every expected job success → ok; bundle/e2e skipped are listed', () => {
  const r = real.evaluateNeeds(needs(PR_SKIPS), PR);
  assert.equal(r.ok, true, r.failures.join('\n'));
  assert.deepEqual(r.skippedConditional, ['bundle', 'e2e']);
});
test('any failure or cancelled → not ok (every mode)', () => {
  for (const ctx of [PR, PUSH_TASK_FULL, DOCS, LIGHT]) {
    for (const n of ALL) {
      assert.equal(real.evaluateNeeds(needs({ [n]: 'failure' }), ctx).ok, false, `${ctx.mode} ${n} failure`);
      assert.equal(real.evaluateNeeds(needs({ [n]: 'cancelled' }), ctx).ok, false, `${ctx.mode} ${n} cancelled`);
    }
  }
});
test('ci-guard skipped or missing → not ok (required job must run)', () => {
  for (const ctx of [PR, DOCS, LIGHT]) {
    assert.equal(real.evaluateNeeds(needs({ ...DOCS_SKIPS, 'ci-guard': 'skipped' }), ctx).ok, false);
    const n = needs(DOCS_SKIPS);
    delete n['ci-guard'];
    assert.equal(real.evaluateNeeds(n, ctx).ok, false);
  }
});
test('missing conditional job result → not ok; unknown extra job failure → not ok', () => {
  const n = needs(PR_SKIPS);
  delete n.taskcheck;
  assert.deepEqual(real.evaluateNeeds(n, PR).failures, ['taskcheck: missing']);
  assert.equal(real.evaluateNeeds({ ...needs(PR_SKIPS), extra: { result: 'failure' } }, PR).ok, false);
});

// C5: the jobs a mode must run cannot be "skipped = passed".
test('C5: full + has_node → check skipped is a failure (PR and push)', () => {
  for (const ctx of [PR, PUSH_TASK_FULL, PUSH_MAIN_FULL]) {
    const r = real.evaluateNeeds(needs({ ...PUSH_FULL_SKIPS, check: 'skipped' }), ctx);
    assert.equal(r.ok, false, ctx.event);
    assert.ok(r.failures.includes('check: skipped (mode full requires it)'), r.failures.join('\n'));
  }
});
test('C5: PR from task/ or fix/ → taskcheck skipped is a failure', () => {
  for (const headRef of ['task/T-010', 'fix/Q-001']) {
    assert.equal(real.evaluateNeeds(needs({ ...PR_SKIPS, taskcheck: 'skipped' }), { ...PR, headRef }).ok, false, headRef);
  }
});
test('C5: has_supabase PR → db skipped is a failure', () => {
  assert.equal(real.evaluateNeeds(needs({ ...PR_SKIPS, db: 'skipped' }), PR).ok, false);
});
test('C5: docs + tasks_changed → taskcheck skipped is a failure; docs without tasks → ok', () => {
  assert.equal(real.evaluateNeeds(needs(DOCS_SKIPS), DOCS_TASKS).ok, false);
  assert.equal(real.evaluateNeeds(needs({ ...DOCS_SKIPS, taskcheck: 'success' }), DOCS_TASKS).ok, true);
  assert.equal(real.evaluateNeeds(needs(DOCS_SKIPS), DOCS).ok, true);
});
test('C5: has_web / has_e2e (future) → bundle and e2e must run in full PR', () => {
  const ctx = { ...PR, hasWeb: true, hasE2e: true };
  assert.equal(real.evaluateNeeds(needs({ bundle: 'skipped' }), ctx).ok, false);
  assert.equal(real.evaluateNeeds(needs({ e2e: 'skipped' }), ctx).ok, false);
  assert.equal(real.evaluateNeeds(needs(), ctx).ok, true);
});
test('push full on task branch: db/e2e/bundle skipped by design → ok, listed as not verified', () => {
  const r = real.evaluateNeeds(needs(PUSH_FULL_SKIPS), PUSH_TASK_FULL);
  assert.equal(r.ok, true, r.failures.join('\n'));
  assert.deepEqual(r.skippedConditional, ['bundle', 'db', 'e2e']);
});
test('light: heavy jobs skipped → ok; summary says the PR run is authoritative', () => {
  const r = real.evaluateNeeds(needs(LIGHT_SKIPS), LIGHT);
  assert.equal(r.ok, true, r.failures.join('\n'));
  const text = real.renderSummary(r, LIGHT);
  assert.match(text, /light 模式：PR #51 的 pull_request run 為準/);
  assert.match(text, /`ci-ok \(push\)`/);
});
test('docs: summary says check is not verified', () => {
  const text = real.renderSummary(real.evaluateNeeds(needs(DOCS_SKIPS), DOCS), DOCS);
  assert.match(text, /docs 模式：只改文件，check、bundle、e2e 依路徑略過（未驗證）/);
  assert.match(text, /Skipped \(not verified\): check, bundle, db, e2e, taskcheck/);
});

// Context validation (fail-closed).
test('context: PR or workflow_dispatch with docs/light → not ok', () => {
  for (const mode of ['docs', 'light']) {
    assert.equal(real.evaluateNeeds(needs(DOCS_SKIPS), { ...PR, mode, prNumber: '51' }).ok, false, `PR ${mode}`);
    assert.equal(real.evaluateNeeds(needs(DOCS_SKIPS), { ...PR, event: 'workflow_dispatch', refName: 'main', mode, prNumber: '51' }).ok, false);
  }
});
test('context: docs off main, light off task/fix, light without PR number → not ok', () => {
  assert.equal(real.evaluateNeeds(needs(DOCS_SKIPS), { ...DOCS, refName: 'task/T-010' }).ok, false);
  assert.equal(real.evaluateNeeds(needs(DOCS_SKIPS), { ...LIGHT, refName: 'main' }).ok, false);
  for (const prNumber of ['', '0', 'x', '-1']) assert.equal(real.evaluateNeeds(needs(DOCS_SKIPS), { ...LIGHT, prNumber }).ok, false, prNumber);
});
test('context: missing/invalid mode, event, ref or flag → not ok', () => {
  for (const bad of [{ mode: '' }, { mode: 'Full' }, { mode: undefined }, { event: 'issue_comment' }, { refName: '' }, { hasNode: 'yes' }, { tasksChanged: undefined }]) {
    assert.equal(real.evaluateNeeds(needs(PR_SKIPS), { ...PR, ...bad }).ok, false, JSON.stringify(bad));
  }
  assert.equal(real.evaluateNeeds(needs(PR_SKIPS), undefined).ok, false);
});

// O-028: light without a PR number only for task/** + tests-only-no-pr + empty PR number.
test('(AC-O28-8) (TC-16) tests-only-no-pr light on task/** without PR number → ok; summary says the push green does not count', () => {
  const r = real.evaluateNeeds(needs(LIGHT_SKIPS), LIGHT_QA);
  assert.equal(r.ok, true, r.failures.join('\n'));
  const text = real.renderSummary(r, LIGHT_QA);
  assert.match(text, /本 push run 綠燈不算數，以之後 G3 PR 的 pull_request run 為準/);
  assert.doesNotMatch(text, /PR #/);
});
test('(AC-O28-8) (TC-16) light reason / PR number / ref mismatches → not ok', () => {
  const bad = [
    { ...LIGHT, prNumber: '' },
    { ...LIGHT_QA, refName: 'fix/Q-1' },
    { ...LIGHT_QA, prNumber: '51' },
    { ...LIGHT_QA, modeReason: '' },
    { ...LIGHT, modeReason: 'branch-without-pr' },
    { ...LIGHT_QA, modeReason: 'Tests-only-no-pr' },
  ];
  for (const ctx of bad) assert.equal(real.evaluateNeeds(needs(LIGHT_SKIPS), ctx).ok, false, JSON.stringify(ctx));
});
test('(AC-O28-8) (TC-16) CLI: MODE_REASON is read from env (missing reason on light fails)', () => {
  const env = { ...ENV_PR, CI_MODE: 'light', EVENT_NAME: 'push', REF_NAME: 'task/T-010', HEAD_REF: '', PR_NUMBER: '' };
  assert.equal(runCli(needs(LIGHT_SKIPS), { ...env, MODE_REASON: 'tests-only-no-pr' }).status, 0);
  assert.equal(runCli(needs(LIGHT_SKIPS), env).status, 1);
});

function runCli(needsObj, env) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-ok-'));
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, NEEDS_JSON: JSON.stringify(needsObj), GITHUB_STEP_SUMMARY: summary, ...env },
    encoding: 'utf8',
  });
  const text = readFileSync(summary, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, text };
}
const ENV_PR = { CI_MODE: 'full', EVENT_NAME: 'pull_request', REF_NAME: '51/merge', HEAD_REF: 'task/T-010', PR_NUMBER: '', HAS_NODE: 'true', HAS_WEB: 'false', HAS_SUPABASE: 'true', HAS_E2E: 'false', TASKS_CHANGED: 'false' };
test('CLI: PR success exit 0 and writes skipped names to $GITHUB_STEP_SUMMARY', () => {
  const r = runCli(needs(PR_SKIPS), ENV_PR);
  assert.equal(r.status, 0, r.text);
  assert.match(r.text, /Skipped \(not verified\): bundle, e2e/);
});
test('CLI: failure exits 1; CI_MODE missing exits 1; invalid NEEDS_JSON exits 1', () => {
  assert.equal(runCli(needs({ ...PR_SKIPS, 'ci-guard': 'failure' }), ENV_PR).status, 1);
  const { CI_MODE: _m, ...noMode } = ENV_PR;
  assert.equal(runCli(needs(PR_SKIPS), noMode).status, 1);
  const r = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, ...ENV_PR, NEEDS_JSON: 'x' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
});
test('CLI: push + skipped db writes 未驗證 and the not-green line', () => {
  const r = runCli(needs(PUSH_FULL_SKIPS), { ...ENV_PR, EVENT_NAME: 'push', REF_NAME: 'task/T-010', HEAD_REF: '' });
  assert.equal(r.status, 0, r.text);
  assert.match(r.text, /db: 未驗證/);
  assert.match(r.text, /綠燈不算數/);
});

// Mutation tests: each mutant of ci-ok.mjs must make at least one scenario above give the wrong answer.
const SRC = readFileSync(SCRIPT, 'utf8');
async function mutant(from, to) {
  assert.ok(SRC.includes(from), `mutation anchor not found: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), 'ci-ok-mut-'));
  const file = join(dir, 'ci-ok.mjs');
  writeFileSync(file, SRC.replace(from, to));
  const m = await import(pathToFileURL(file).href);
  rmSync(dir, { recursive: true, force: true });
  return m;
}
const killers = [
  ['ci-guard skipped', (m) => m.evaluateNeeds(needs({ ...DOCS_SKIPS, 'ci-guard': 'skipped' }), DOCS).ok === false],
  ['PR check skipped', (m) => m.evaluateNeeds(needs({ ...PR_SKIPS, check: 'skipped' }), PR).ok === false],
  ['PR taskcheck skipped', (m) => m.evaluateNeeds(needs({ ...PR_SKIPS, taskcheck: 'skipped' }), PR).ok === false],
  ['PR db skipped', (m) => m.evaluateNeeds(needs({ ...PR_SKIPS, db: 'skipped' }), PR).ok === false],
  ['docs tasks taskcheck skipped', (m) => m.evaluateNeeds(needs(DOCS_SKIPS), DOCS_TASKS).ok === false],
  ['PR in light mode', (m) => m.evaluateNeeds(needs(LIGHT_SKIPS), { ...PR, mode: 'light', prNumber: '51' }).ok === false],
  ['workflow_dispatch on main in docs mode', (m) => m.evaluateNeeds(needs(DOCS_SKIPS), { ...DOCS, event: 'workflow_dispatch' }).ok === false],
  ['bad mode', (m) => m.evaluateNeeds(needs(PR_SKIPS), { ...PR, mode: 'Full' }).ok === false],
  ['push with empty mode (ci-guard output missing)', (m) => m.evaluateNeeds(needs(PUSH_FULL_SKIPS), { ...PUSH_TASK_FULL, mode: '' }).ok === false],
  ['light without PR', (m) => m.evaluateNeeds(needs(LIGHT_SKIPS), { ...LIGHT, prNumber: '' }).ok === false],
  ['tests-only light on fix/', (m) => m.evaluateNeeds(needs(LIGHT_SKIPS), { ...LIGHT_QA, refName: 'fix/Q-1' }).ok === false],
  ['tests-only light with PR number', (m) => m.evaluateNeeds(needs(LIGHT_SKIPS), { ...LIGHT_QA, prNumber: '51' }).ok === false],
  ['light with unknown reason', (m) => m.evaluateNeeds(needs(LIGHT_SKIPS), { ...LIGHT, modeReason: 'x' }).ok === false],
];
const MUTANTS = [
  ['CK-M1 drop ci-guard from REQUIRED', "export const REQUIRED = ['ci-guard'];", 'export const REQUIRED = [];'],
  ['CK-M2 expected jobs ignored (skipped = passed again)', 'else if (expected.has(name))', 'else if (false)'],
  ['CK-M3 full check rule removed', "if (full && ctx.hasNode) exp.add('check');", ''],
  ['CK-M4 PR taskcheck rule removed', '|| (pr && isBranch(ctx.headRef))', ''],
  ['CK-M5 db rule removed', "if (full && ctx.hasSupabase && pr) exp.add('db');", ''],
  ['CK-M6 docs taskcheck rule removed', "|| (ctx.mode === 'docs' && ctx.tasksChanged)", ''],
  ['CK-M7 PR may be light/docs', "if (ctx.event !== 'push' && ctx.mode !== 'full')", 'if (false)'],
  ['CK-M8 mode not validated', 'if (!MODES.includes(ctx.mode))', 'if (false)'],
  ['CK-M9 light PR number not checked', "if (!/^[1-9][0-9]*$/.test(String(ctx.prNumber)))", 'if (false)'],
  ['CK-M10 (AC-O28-8) tests-only light allowed off task/', "if (!String(ctx.refName).startsWith('task/'))", 'if (false)'],
  ['CK-M11 (AC-O28-8) tests-only light with PR number', "if (ctx.prNumber !== '')", 'if (false)'],
  ['CK-M12 (AC-O28-8) unknown light reason accepted', 'problems.push(`light with unknown reason', 'void (`light with unknown reason'],
];
for (const [name, from, to] of MUTANTS) {
  test(`mutation ${name} is killed`, async () => {
    const m = await mutant(from, to);
    const survived = killers.every(([, k]) => k(m));
    assert.equal(survived, false, `${name} survived every scenario`);
  });
}
test('mutation harness: the real module passes every killer scenario', () => {
  for (const [label, k] of killers) assert.equal(k(real), true, label);
});
