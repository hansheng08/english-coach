import { describe, expect, it } from 'vitest';
import { normalizeWords } from './words.ts';

describe('QA T-010 normalizeWords', () => {
  it('(QA-1) (AC-T10-1) splits on any whitespace, lowercases, strips only edge characters', () => {
    expect(normalizeWords('  Hello\tWORLD\nfoo  ')).toEqual(['hello', 'world', 'foo']);
    expect(normalizeWords('(Hello) "quoted," end...')).toEqual(['hello', 'quoted', 'end']);
    expect(normalizeWords('e-mail U.S. 3.5 rock&roll')).toEqual(['e-mail', 'u.s', '3.5', 'rock&roll']);
    expect(normalizeWords("don't 'tis rock'n'roll' 2024")).toEqual(["don't", "'tis", "rock'n'roll'", '2024']);
  });

  it('(QA-2) (AC-T10-1) drops tokens that become empty after stripping', () => {
    expect(normalizeWords('a / b — c ... d -- e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(normalizeWords('   ')).toEqual([]);
    expect(normalizeWords('!!! ?? —— //')).toEqual([]);
  });
});
