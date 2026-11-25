import { describe, expect, it } from 'vitest';
import { normalizeWords } from './words.ts';

describe('normalizeWords', () => {
  it("(AC-T10-1) (TC-1) lowercases, strips edge punctuation, keeps inner apostrophes, drops empties", () => {
    expect(normalizeWords("Hello, World! / it's  ok")).toEqual(['hello', 'world', "it's", 'ok']);
    expect(normalizeWords('')).toEqual([]);
    expect(normalizeWords('— /')).toEqual([]);
  });
});
