import { describe, expect, it } from 'vitest';
import { expectErr, expectOk } from '../test/index.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

describe('@english-coach/contracts/testing', () => {
  it('expectOk returns the value of an ok result', () => {
    const r: Result<number, string> = ok(3);
    expect(expectOk(r)).toBe(3);
  });

  it('expectOk throws on err', () => {
    const r: Result<number, string> = err('bad');
    expect(() => expectOk(r)).toThrow('expected ok');
  });

  it('expectErr returns the error of an err result', () => {
    const r: Result<number, string> = err('bad');
    expect(expectErr(r)).toBe('bad');
  });

  it('expectErr throws on ok', () => {
    const r: Result<number, string> = ok(3);
    expect(() => expectErr(r)).toThrow('expected err');
  });
});
