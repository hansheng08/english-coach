import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', '.github', 'scripts', 'g3-comment-guard-test.sh');

let code = 1;
let out = '';

beforeAll(() => {
  const r = spawnSync('bash', [script], { encoding: 'utf8' });
  code = r.status ?? 1;
  out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
});

const cases = [
  '(AC-O21-1) (TC-1) (AC-O21-5) (TC-8) non-G3',
  '(AC-O21-2) (TC-2) clean G3 PR',
  '(AC-O21-3) (TC-3) first run non-G3',
  '(AC-O21-3) (TC-4) first run clean [G3]',
  '(AC-O21-4) (TC-5) non-G3 status write fails',
  '(AC-O21-4) (TC-6) missing head SHA',
  '(AC-O21-4) (TC-7) non-G3 ignores GITHUB_SHA',
  '(AC-O21-4) (TC-9) PR API error',
];

describe('g3-comment-guard O-021', () => {
  it('(AC-O21-5) bash GH_BIN suite exits 0', () => {
    expect(code, out).toBe(0);
    expect(out).toContain('g3-comment-guard-test: all cases matched');
  });

  for (const name of cases) {
    it(`${name} appears as CASE OK in the GH_BIN suite`, () => {
      expect(code, out).toBe(0);
      expect(out).toContain(`CASE OK: ${name}`);
    });
  }
});
