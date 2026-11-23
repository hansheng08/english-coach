import { describe, expect, it } from 'vitest';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { all, andThen, err, isErr, isOk, map, mapErr, ok, tryCatch, tryCatchAsync, unwrapOr } from './result.ts';
import type { Result } from './result.ts';

// 宣告型別為聯集的值會被 TS 依指定縮小成 Ok／Err；經過函式回傳就保持 Result<T, E>。
const good = (): Result<number, string> => ok(2);
const bad = (): Result<number, string> => err('e');

describe('Result helpers (ARCHITECTURE §5.0.2)', () => {
  it('ok / err build the documented shapes', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('e')).toEqual({ ok: false, error: 'e' });
  });

  it('isOk / isErr tell the two shapes apart', () => {
    expect([isOk(good()), isErr(good()), isOk(bad()), isErr(bad())]).toEqual([true, false, false, true]);
  });

  it('map transforms ok and leaves err untouched', () => {
    expect(map(good(), (n) => n * 2)).toEqual(ok(4));
    expect(map(bad(), (n) => n * 2)).toEqual(err('e'));
  });

  it('mapErr transforms err and leaves ok untouched', () => {
    expect(mapErr(bad(), (e) => e.length)).toEqual(err(1));
    expect(mapErr(good(), (e) => e.length)).toEqual(ok(2));
  });

  it('andThen chains on ok and short-circuits on err', () => {
    expect(andThen(good(), (n) => ok(n + 1))).toEqual(ok(3));
    expect(andThen(good(), () => err('later'))).toEqual(err('later'));
    expect(andThen(bad(), (n) => ok(n + 1))).toEqual(err('e'));
  });

  it('unwrapOr returns the value on ok and the fallback on err', () => {
    expect(unwrapOr(good(), 9)).toBe(2);
    expect(unwrapOr(bad(), 9)).toBe(9);
  });

  it('all collects every value when all succeed', () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    expect(all<number, string>([])).toEqual(ok([]));
  });

  it('all returns the FIRST err when several fail', () => {
    const rs: Result<number, string>[] = [ok(1), err('first'), ok(2), err('second')];
    expect(all(rs)).toEqual(err('first'));
  });

  it('tryCatch returns ok for a normal call and err(onThrow(cause)) when it throws', () => {
    expect(tryCatch(() => 5, () => 'x')).toEqual(ok(5));
    const cause = new Error('boom');
    const r = tryCatch(
      () => {
        throw cause;
      },
      (c) => ({ wrapped: c }),
    );
    expect(r).toEqual(err({ wrapped: cause }));
  });

  it('tryCatchAsync returns ok for a resolved promise and err(onThrow(cause)) for a rejected one', async () => {
    expect(await tryCatchAsync(() => Promise.resolve(5), () => 'x')).toEqual(ok(5));
    const cause = new Error('boom');
    const r = await tryCatchAsync(
      () => Promise.reject(cause),
      (c) => ({ wrapped: c }),
    );
    expect(r).toEqual(err({ wrapped: cause }));
  });

  it('tryCatchAsync also converts a synchronous throw inside the async function', async () => {
    const r = await tryCatchAsync(
      () => {
        throw new Error('sync');
      },
      () => 'converted',
    );
    expect(r).toEqual(err('converted'));
  });

  it('expectOk / expectErr narrow the result (used here as the test helpers)', () => {
    expect(expectOk(ok(7))).toBe(7);
    expect(expectErr(err('e'))).toBe('e');
  });
});
