import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { acPrefix, matchGlob, parseTaskFile } from './task-file.mjs';

describe('task-file', () => {
  it('(AC-O8-5) (TC-20) matchGlob: * and ? stay inside a segment, ** crosses segments', () => {
    expect(matchGlob('tooling/*.mjs', 'tooling/a.mjs')).toBe(true);
    expect(matchGlob('tooling/*.mjs', 'tooling/sub/a.mjs')).toBe(false);
    expect(matchGlob('tooling/**', 'tooling/sub/a.mjs')).toBe(true);
    expect(matchGlob('a/**/b', 'a/b')).toBe(true);
    expect(matchGlob('a.b', 'aXb')).toBe(false);
    expect(matchGlob('vitest.config.ts', 'vitest.config.ts')).toBe(true);
  });

  it('(AC-O8-4) (TC-15) acPrefix maps task ids to AC prefixes', () => {
    expect(acPrefix('T-023')).toBe('T23');
    expect(acPrefix('T-012-fix1')).toBe('T12');
    expect(acPrefix('O-008')).toBe('O8');
  });

  it('(AC-O8-1) (TC-1) parseTaskFile extracts branch, ACs, TC rows and scope lists', () => {
    const text = readFileSync(new URL('./fixtures/tasks/O-901.md', import.meta.url), 'utf8');
    const p = parseTaskFile({ id: 'O-901', path: 'O-901.md', text });
    expect(p.branch).toBe('task/O-901');
    expect(p.acIds).toEqual(['AC-O901-1', 'AC-O901-2']);
    expect(p.tcRows.map((r) => [r.tc, r.acs])).toEqual([['TC-1', ['AC-O901-1']], ['TC-2', ['AC-O901-2']]]);
    expect(p.allow).toEqual(['tooling/*.mjs']);
    expect(p.deny).toEqual(['apps/**']);
  });

  it('(AC-O8-1) (TC-2) parseTaskFile reads this repo task file', () => {
    const text = readFileSync(new URL('../docs/tasks/O-008.md', import.meta.url), 'utf8');
    const p = parseTaskFile({ id: 'O-008', path: 'docs/tasks/O-008.md', text });
    expect(p.branch).toBe('task/O-008');
    expect(p.acIds).toHaveLength(8);
    expect(p.tcRows).toHaveLength(27);
    expect(p.allow).toContain('tooling/task-file.mjs');
    expect(p.deny).toContain('apps/**');
  });
});
