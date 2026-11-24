import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  collectPermissionDenials,
  collectDuration,
  collectTestSummary,
  summarizeFile,
  renderSummary,
  hasResultEvent,
} from './run-task-summary.mjs';

const SCRIPT = fileURLToPath(new URL('./run-task-summary.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/claude-execution-T-012-resplit.json', import.meta.url));

test('T-012 fixture: one denial, duration, vitest summary', () => {
  const events = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const denials = collectPermissionDenials(events);
  assert.equal(denials.length, 1);
  assert.match(denials[0].command, /git push -u origin task\/T-012/);
  const dur = collectDuration(events);
  assert.equal(dur.durationMs, 200140);
  const tests = collectTestSummary(events);
  assert.match(tests, /Test Files\s+16 passed/);
  assert.match(tests, /Tests\s+321 passed/);
  assert.match(tests, /exit 0/);
});

test('CLI prints Duration and denial count from the fixture', () => {
  const r = spawnSync(process.execPath, [SCRIPT, FIXTURE], {
    encoding: 'utf8',
    env: { ...process.env, TASK: 'T-012', RUN_URL: 'https://example.test/run' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /run-task summary \(T-012\)/);
  assert.match(r.stdout, /Permission denials: 1/);
  assert.match(r.stdout, /Duration: 3m 20s/);
  assert.match(r.stdout, /Test Files\s+16 passed/);
});

test('missing denials and tests are reported as zero / not found', () => {
  const events = [{ type: 'result', duration_ms: 10, permission_denials: [] }];
  assert.equal(collectPermissionDenials(events).length, 0);
  assert.equal(collectTestSummary(events), 'not found');
  assert.equal(collectDuration(events).durationMs, 10);
});

test('missing result event prints Duration unknown and Permission denials unknown', () => {
  const events = [{ type: 'assistant', message: { content: [] } }];
  assert.equal(hasResultEvent(events), false);
  assert.equal(collectDuration(events), null);
  const md = renderSummary({
    task: 'T-000',
    duration: collectDuration(events),
    denials: collectPermissionDenials(events),
    testSummary: collectTestSummary(events),
    resultPresent: hasResultEvent(events),
  });
  assert.match(md, /Duration: unknown/);
  assert.match(md, /Permission denials: unknown/);
  assert.doesNotMatch(md, /Permission denials: 0/);
});

test('collectTestSummary accepts vitest output without an exit N line', () => {
  const events = [{
    type: 'user',
    message: { content: [{ type: 'tool_result', content: 'Test Files  2 passed (2)\nTests  10 passed (10)\nDuration  1.2s\n' }] },
  }];
  const text = collectTestSummary(events);
  assert.match(text, /Test Files\s+2 passed/);
  assert.notEqual(text, 'not found');
});
