import { describe, expect, it } from 'vitest';
import { mulberry32 as testMulberry32 } from '../test/prng.ts';
import { mulberry32, sampleWithSeed, seedFromString } from './prng.ts';

function take(next: () => number, n: number): number[] {
  return Array.from({ length: n }, () => next());
}

/** 對照實作：介面規定的部分 Fisher–Yates，用測試版的 mulberry32。 */
function reference<T>(items: readonly T[], n: number, seed: number): T[] {
  const indexes = items.map((_, i) => i);
  const k = Math.min(Math.max(n, 0), indexes.length);
  const next = testMulberry32(seed);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(next() * (indexes.length - i));
    [indexes[i], indexes[j]] = [indexes[j] ?? 0, indexes[i] ?? 0];
  }
  return indexes.slice(0, k).flatMap((i) => items.slice(i, i + 1));
}

describe('mulberry32', () => {
  it('(AC-T50-1) (TC-1) same seed gives the same sequence and values stay in [0, 1)', () => {
    expect(take(mulberry32(42), 20)).toEqual(take(mulberry32(42), 20));
    for (const v of take(mulberry32(7), 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('(AC-T50-1) (TC-2) seeds 1 and 20261127 give fixed first five outputs equal to the test helper', () => {
    for (const seed of [1, 20261127]) {
      expect(take(mulberry32(seed), 5)).toEqual(take(testMulberry32(seed), 5));
    }
    expect(take(mulberry32(1), 5)).toEqual(FIXED_1);
    expect(take(mulberry32(20261127), 5)).toEqual(FIXED_SEED);
  });
});

describe('sampleWithSeed', () => {
  it('(AC-T50-2) (TC-3) sample properties: repeatable, distinct, from input, edge sizes, input untouched', () => {
    const items = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const a = sampleWithSeed(items, 4, 7);
    expect(sampleWithSeed(items, 4, 7)).toEqual(a);
    expect(new Set(a).size).toBe(4);
    for (const x of a) expect(items).toContain(x);
    expect(sampleWithSeed(items, 0, 7)).toEqual([]);
    expect(sampleWithSeed(items, -3, 7)).toEqual([]);
    expect([...sampleWithSeed(items, 10, 7)].sort((p, q) => p - q)).toEqual([...items]);
    expect(sampleWithSeed(items, 15, 7)).toHaveLength(10);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('(AC-T50-2) (TC-4) order follows the partial Fisher-Yates algorithm', () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${String(i)}`);
    expect(sampleWithSeed(items, 5, 20261127)).toEqual(reference(items, 5, 20261127));
  });
});

describe('seedFromString', () => {
  it('(AC-T50-3) (TC-5) matches the public FNV-1a 32-bit test values', () => {
    expect(seedFromString('')).toBe(2166136261);
    expect(seedFromString('a')).toBe(3826002220);
    expect(seedFromString('foobar')).toBe(3214735720);
  });

  it('(AC-T50-3) (TC-6) uses UTF-8 bytes, is repeatable and stays a 32-bit integer', () => {
    const v = seedFromString('種子語塊');
    expect(seedFromString('種子語塊')).toBe(v);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(2 ** 32);
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});

const FIXED_1: number[] = [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849];
const FIXED_SEED: number[] = [0.5312688171397895, 0.17145229317247868, 0.6793673252686858, 0.8126092918682843, 0.17537259752862155];
