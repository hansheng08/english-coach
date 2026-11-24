import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintText, lintRepo, formatHits } from './fail-open-lint.mjs';

const SCRIPT = fileURLToPath(new URL('./fail-open-lint.mjs', import.meta.url));

test('flags || true and continue-on-error without allow comment', () => {
  const src = [
    'git fetch origin "$BR" || true',
    'continue-on-error: true',
    'echo ok',
  ].join('\n');
  const hits = lintText(src, 'x.yml');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].kind, '|| true');
  assert.equal(hits[1].kind, 'continue-on-error');
});

test('flags || : and || exit 0, and rejects a blank o004-allow reason', () => {
  const src = [
    'git fetch origin "$BR" || :',
    'git fetch origin "$BR" || exit 0',
    '# o004-allow:',
    'git fetch origin "$BR" || true',
  ].join('\n');
  const hits = lintText(src, 'x.yml');
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['|| :', '|| exit 0', '|| true']);
});

test('o004-allow on same or previous line is accepted', () => {
  const src = [
    'kill "$pid" || true  # o004-allow: cleanup, final check still hard-fails',
    '# o004-allow: Playwright upload is best-effort after a failed run',
    'continue-on-error: true',
  ].join('\n');
  assert.equal(lintText(src, 'x.yml').length, 0);
});

test('deliberate-failure fixture repo exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'failopen-'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  mkdirSync(join(dir, '.github/scripts'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/ci.yml'), 'run: git fetch origin || true\n');
  const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ERROR: fail-open-lint/);
  assert.match(r.stdout, /\|\| true/);
});

test('formatHits empty is a pass line', () => {
  assert.match(formatHits([]), /no unallowlisted/);
});
