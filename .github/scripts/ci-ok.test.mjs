import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateNeeds, renderSummary } from './ci-ok.mjs';

const SCRIPT = fileURLToPath(new URL('./ci-ok.mjs', import.meta.url));
const ALL = ['detect', 'actionlint', 'pushguard', 'secrets', 'check', 'bundle', 'db', 'e2e'];
const needs = (over = {}) => Object.fromEntries(ALL.map((n) => [n, { result: over[n] ?? 'success' }]));

test('all success → ok', () => {
  assert.equal(evaluateNeeds(needs()).ok, true);
});
test('any failure → not ok', () => {
  for (const n of ALL) assert.equal(evaluateNeeds(needs({ [n]: 'failure' })).ok, false, n);
});
test('any cancelled → not ok', () => {
  for (const n of ALL) assert.equal(evaluateNeeds(needs({ [n]: 'cancelled' })).ok, false, n);
});
test('required job skipped → not ok', () => {
  for (const n of ['detect', 'actionlint', 'pushguard', 'secrets']) {
    assert.equal(evaluateNeeds(needs({ [n]: 'skipped' })).ok, false, n);
  }
});
test('conditional job skipped → ok and reported', () => {
  const r = evaluateNeeds(needs({ check: 'skipped', bundle: 'skipped', db: 'skipped', e2e: 'skipped' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.skippedConditional, ['check', 'bundle', 'db', 'e2e']);
});
test('missing job result → not ok', () => {
  const n = needs();
  delete n.secrets;
  assert.equal(evaluateNeeds(n).ok, false);
});
test('unknown extra job that failed → not ok', () => {
  assert.equal(evaluateNeeds({ ...needs(), extra: { result: 'failure' } }).ok, false);
});
test('summary lists skipped names', () => {
  const text = renderSummary(evaluateNeeds(needs({ check: 'skipped', e2e: 'skipped' })));
  assert.match(text, /Skipped \(not verified\): check, e2e/);
});

function run(needsObj) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-ok-'));
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, NEEDS_JSON: JSON.stringify(needsObj), GITHUB_STEP_SUMMARY: summary },
    encoding: 'utf8',
  });
  const text = readFileSync(summary, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, text };
}
test('CLI: success exit 0 and writes skipped names to $GITHUB_STEP_SUMMARY', () => {
  const r = run(needs({ check: 'skipped', bundle: 'skipped', db: 'skipped', e2e: 'skipped' }));
  assert.equal(r.status, 0);
  assert.match(r.text, /check, bundle, db, e2e/);
});
test('CLI: failure exits 1', () => {
  assert.equal(run(needs({ secrets: 'failure' })).status, 1);
});
test('CLI: invalid NEEDS_JSON exits 1', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, NEEDS_JSON: 'x' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
});

test('summary always lists skipped jobs', () => {
  const text = renderSummary(evaluateNeeds(needs({})));
  assert.match(text, /Skipped \(not verified\): none/);
});
test('push event with db skipped is marked 未驗證', () => {
  const result = evaluateNeeds(needs({ db: 'skipped', e2e: 'skipped', bundle: 'skipped' }));
  const text = renderSummary(result, { eventName: 'push' });
  assert.match(text, /Skipped \(not verified\): bundle, db, e2e/);
  assert.match(text, /db: 未驗證/);
});
test('pull_request event with db skipped does not add the push 未驗證 line', () => {
  const text = renderSummary(evaluateNeeds(needs({ db: 'skipped' })), { eventName: 'pull_request' });
  assert.match(text, /Skipped \(not verified\): db/);
  assert.doesNotMatch(text, /db: 未驗證/);
});
test('CLI: push + skipped db writes 未驗證', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-ok-'));
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: {
      PATH: process.env.PATH,
      NEEDS_JSON: JSON.stringify(needs({ db: 'skipped', e2e: 'skipped', bundle: 'skipped' })),
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_EVENT_NAME: 'push',
    },
    encoding: 'utf8',
  });
  const text = readFileSync(summary, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0);
  assert.match(text, /db: 未驗證/);
});
