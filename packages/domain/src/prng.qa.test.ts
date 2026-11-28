// QA probes for T-050 (prng.ts). Reference values were computed once with TextEncoder + FNV-1a 32-bit.
import { describe, expect, it } from 'vitest';
import { mulberry32 as testMulberry32 } from '../test/prng.ts';
import { mulberry32, sampleWithSeed, seedFromString } from './prng.ts';

function take(next: () => number, n: number): number[] {
  return Array.from({ length: n }, () => next());
}

describe('QA T-050 mulberry32', () => {
  it('(QA-1) equals the test helper for many seeds, including coerced ones (negative, fraction, > 2^32, NaN, Infinity)', () => {
    const seeds = [0, 1, 2, 42, 7, 20261127, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 5, -1, -2.5, 1.5, 123456789.75, Number.NaN, Number.POSITIVE_INFINITY];
    for (const seed of seeds) expect(take(mulberry32(seed), 200), String(seed)).toEqual(take(testMulberry32(seed), 200));
  });

  it('(QA-2) the seed is coerced with >>> 0: NaN behaves like 0 and 2^32 + k like k', () => {
    expect(take(mulberry32(Number.NaN), 10)).toEqual(take(mulberry32(0), 10));
    expect(take(mulberry32(2 ** 32 + 9), 10)).toEqual(take(mulberry32(9), 10));
    expect(take(mulberry32(-1), 10)).toEqual(take(mulberry32(2 ** 32 - 1), 10));
  });

  it('(QA-3) separate instances do not share state', () => {
    const a = mulberry32(5);
    const first = a();
    const b = mulberry32(5);
    expect(b()).toBe(first);
    a();
    a();
    expect(b()).toBe(take(mulberry32(5), 2)[1]);
  });
});

describe('QA T-050 sampleWithSeed', () => {
  const same = (size: number): number[] => Array.from({ length: size }, (_, i) => i);

  it('(QA-4) a smaller n is a prefix of a larger n for the same seed (partial Fisher-Yates)', () => {
    for (const seed of [1, 7, 20261127, 4294967295]) {
      const long = sampleWithSeed(same(50), 30, seed);
      for (const n of [0, 1, 5, 17, 30]) expect(sampleWithSeed(same(50), n, seed), `${String(seed)}/${String(n)}`).toEqual(long.slice(0, n));
    }
  });

  it('(QA-5) different seeds give different orders and every seed gives a permutation when n >= length', () => {
    const items = same(30);
    const orders = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const all = sampleWithSeed(items, 30, seed);
      expect([...all].sort((p, q) => p - q)).toEqual(items);
      orders.add(all.join(','));
    }
    expect(orders.size).toBe(10);
  });

  it('(QA-6) the empty array, undefined elements and object identity are all kept', () => {
    expect(sampleWithSeed([], 5, 1)).toEqual([]);
    const withUndefined = sampleWithSeed([undefined, undefined, 1], 3, 3);
    expect(withUndefined).toHaveLength(3);
    const a = { id: 1 };
    const b = { id: 2 };
    const out = sampleWithSeed([a, b], 2, 11);
    expect(out.filter((x) => x === a)).toHaveLength(1);
    expect(out.filter((x) => x === b)).toHaveLength(1);
  });

  it('(QA-7) the first pick follows floor(r0 * length) with r0 from mulberry32', () => {
    const items = same(37);
    for (const seed of [1, 99, 20261127]) {
      const r0 = testMulberry32(seed)();
      expect(sampleWithSeed(items, 1, seed)).toEqual([Math.floor(r0 * 37)]);
    }
  });

  it('(QA-8) the input array and its order are not modified for a plain (unfrozen) array', () => {
    const items = same(12);
    sampleWithSeed(items, 12, 3);
    expect(items).toEqual(same(12));
  });
});

describe('QA T-050 seedFromString', () => {
  const cases: [string, string, number][] = [
    ['2-byte', '\u00e9', 513665217],
    ['DEL 0x7f (last 1-byte)', '\u007f', 4195109838],
    ['U+0080 (first 2-byte)', '\u0080', 1537247071],
    ['U+07FF (last 2-byte)', '\u07ff', 281926787],
    ['U+0800 (first 3-byte)', '\u0800', 3144653239],
    ['U+D7FF (before surrogates)', '\ud7ff', 2764989806],
    ['U+E000 (after surrogates)', '\ue000', 4071403929],
    ['U+FFFF (last 3-byte)', '\uffff', 21469476],
    ['emoji (4-byte)', '\ud83d\ude00', 866293256],
    ['U+10000 (first 4-byte)', '\ud800\udc00', 364204981],
    ['U+10FFFF (last 4-byte)', '\udbff\udfff', 1103215674],
    ['lone high surrogate D800 becomes U+FFFD', '\ud800', 55024714],
    ['lone high surrogate DBFF becomes U+FFFD', '\udbff', 55024714],
    ['lone low surrogate DC00 becomes U+FFFD', '\udc00', 55024714],
    ['lone low surrogate DFFF becomes U+FFFD', '\udfff', 55024714],
    ['mixed ASCII and a pair', 'a\ud83d\ude00b', 2292408745],
    ['Han characters', '\u7a2e\u5b50\u8a9e\u584a', 1255826154],
    ['Latin-1 word', '\u00f1and\u00fa', 3029286091],
    ['ASCII followed by a lone surrogate', 'abc\ud83d', 167239292],
  ];

  it('(QA-9) matches FNV-1a over the TextEncoder UTF-8 bytes at every encoding boundary', () => {
    for (const [name, text, expected] of cases) expect(seedFromString(text), name).toBe(expected);
  });

  it('(QA-10) a lone surrogate hashes like U+FFFD and differs from the neighbouring code points', () => {
    expect(seedFromString('\ud800')).toBe(seedFromString('\ufffd'));
    expect(seedFromString('\ud7ff')).not.toBe(seedFromString('\ufffd'));
    expect(seedFromString('\ue000')).not.toBe(seedFromString('\ufffd'));
  });

  it('(QA-11) results are 32-bit unsigned integers for long strings', () => {
    const v = seedFromString('x'.repeat(5000));
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(2 ** 32);
  });
});
