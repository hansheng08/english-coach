import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  splitStatements,
  normalizeStatement,
  isResplitFragment,
  findResplits,
} from './detect-resplit.mjs';

const SCRIPT = fileURLToPath(new URL('./detect-resplit.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/claude-execution-T-012-resplit.json', import.meta.url));

test('splitStatements handles &&, ;, and quotes', () => {
  assert.deepEqual(
    splitStatements('git add a && git commit -m "x && y"; git push -u origin b 2>&1'),
    ['git add a', 'git commit -m "x && y"', 'git push -u origin b 2>&1'],
  );
});

test('normalizeStatement drops redirections', () => {
  assert.equal(normalizeStatement('git push -u origin task/T-012 2>&1'), 'git push -u origin task/T-012');
});

test('compound denial vs later fragment is a resplit', () => {
  const denied =
    'git add docs/reports/T-012.md && git commit -q -m "msg" && git status --short; echo "[status done]"; git push -u origin task/T-012 2>&1';
  assert.equal(isResplitFragment(denied, 'git push -u origin task/T-012'), true);
  assert.equal(isResplitFragment(denied, 'git status --short'), false);
  assert.equal(isResplitFragment(denied, 'git add docs/reports/T-012.md'), false);
  assert.equal(isResplitFragment(denied, 'pnpm test'), false);
});

test('later git status after a compound denial is not a resplit; later git push is', () => {
  const denied =
    'git add a && git commit -q -m "msg" && git status --short; git push -u origin task/T-012 2>&1';
  const events = [
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', id: 'd1', input: { command: denied } }] },
    },
    {
      type: 'result',
      permission_denials: [{ tool_use_id: 'd1', tool_name: 'Bash', tool_input: { command: denied } }],
    },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', id: 's', input: { command: 'git status --short' } }] },
    },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', id: 'p', input: { command: 'git push -u origin task/T-012' } }] },
    },
  ];
  const hits = findResplits(events);
  assert.equal(hits.some((h) => /git status/.test(h.later)), false);
  assert.equal(hits.some((h) => /git push -u origin task\/T-012/.test(h.later)), true);
});

test('single denied command only matches the same command, not a later unrelated one', () => {
  assert.equal(isResplitFragment('cat secrets.txt', 'cat secrets.txt'), true);
  assert.equal(isResplitFragment('cat secrets.txt', 'pnpm test'), false);
});

test('T-012 artifact (run 45205560119): later git push is a resplit of the denied compound', () => {
  const events = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const hits = findResplits(events);
  assert.ok(hits.length >= 1, `expected at least one hit, got ${hits.length}`);
  assert.ok(hits.some((h) => /git push -u origin task\/T-012/.test(h.later)));
});

test('CLI: real fixture exits 1 and prints ERROR', () => {
  const r = spawnSync(process.execPath, [SCRIPT, FIXTURE], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ERROR: detect-resplit/);
  assert.match(r.stdout, /git push -u origin task\/T-012/);
});

test('CLI: clean execution (no denials) exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resplit-'));
  const file = join(dir, 'ok.json');
  writeFileSync(file, JSON.stringify([
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'pnpm test' } }] },
    },
    { type: 'result', permission_denials: [] },
  ]));
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no bypass found/);
});
