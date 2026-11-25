import { describe, expect, it } from 'vitest';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import type { PronunciationResult } from '@english-coach/contracts';
import type { ShadowScore } from '@english-coach/domain';
import { maskWords, scoreShadowAttempt } from './shadowing.ts';

// QA probes for T-011 (ARCHITECTURE §4.6, ADR-004, ticket v2.0 "介面").

function word(w: string, startMs: number, endMs: number): PronunciationResult['words'][number] {
  return { word: w, startMs, endMs, confidence: null };
}

function score(reference: string, recognized: string, durationMs = 3000, words = [word('a', 0, 3000)]): ShadowScore {
  return expectOk(scoreShadowAttempt(reference, durationMs, { recognizedText: recognized, words }));
}

function masked(sentence: string): string[] {
  return maskWords(sentence)
    .filter((t) => t.masked)
    .map((t) => t.text);
}

describe('QA T-011 accuracy uses normalizeWords for alignment and denominator', () => {
  it('(QA-1) lone punctuation and slash in the reference are not in the denominator (not newsWords)', () => {
    // newsWords would count "—" as a word (5 words → 0.8); normalizeWords gives 4 words → 1.
    expect(score('Costs — rise / fast again', 'costs rise fast again').accuracy).toBe(1);
    expect(score('"Rates," she said — "will rise."', 'rates she said will rise').accuracy).toBe(1);
  });
  it('(QA-2) denominator boundary: 4 of 5 normalized words is exactly 0.8 and unlocks at speed ratio exactly 0.7', () => {
    const r = score('Prices / rose — fast in May.', 'prices rose fast in', 2100, [word('a', 1000, 4000)]);
    expect(r.accuracy).toBe(0.8);
    expect(r.speedRatio).toBe(0.7);
    expect(r.unlocked).toBe(true);
    const miss = score('Prices / rose — fast in May.', 'prices rose fast', 2100, [word('a', 1000, 4000)]);
    expect(miss.accuracy).toBeCloseTo(0.6);
    expect(miss.unlocked).toBe(false);
  });
  it('(QA-3) apostrophes are kept and inner hyphens are not split, per normalizeWords', () => {
    expect(score("Don't STOP", "don't stop").accuracy).toBe(1);
    expect(score("I don't", 'I dont').accuracy).toBe(0.5);
    expect(score('we need buy-in', 'we need buy in').accuracy).toBeCloseTo(2 / 3);
  });
  it('(QA-4) empty recognized text is ok with accuracy 0', () => {
    const r = score('one two three', '');
    expect(r.accuracy).toBe(0);
    expect(r.unlocked).toBe(false);
  });
  it('(QA-5) whitespace-only reference is a validation error at referenceText', () => {
    const e = expectErr(scoreShadowAttempt(' \t\n ', 3000, { recognizedText: 'x', words: [] }));
    expect(e.kind).toBe('validation');
    expect(e.issues.map((i) => i.path)).toContain('referenceText');
  });
});

describe('QA T-011 word-level Levenshtein alignment', () => {
  it('(QA-6) order matters: alignment is not a bag of words', () => {
    expect(score('a b c d e', 'e d c b a').accuracy).toBeCloseTo(0.2);
  });
  it('(QA-7) repeated words are counted once per alignment pair', () => {
    expect(score('the cat the dog', 'the the').accuracy).toBe(0.5);
  });
  it('(QA-8) among minimum-cost alignments the one with the most identical words is used', () => {
    expect(score('a b', 'b a').accuracy).toBe(0.5);
    expect(score('a b c', 'c a b').accuracy).toBeCloseTo(2 / 3);
  });
  it('(QA-9) inserted words in the middle are not penalised', () => {
    expect(score('a b c', 'a x b y c').accuracy).toBe(1);
  });
  it('(QA-10) Levenshtein (unit insert/delete/substitute costs), not longest common subsequence', () => {
    // Substituting all 3 costs 3; matching "a" costs 4 (2 inserts + 2 deletes), so no identical pair is aligned.
    expect(score('a b c', 'x y a').accuracy).toBe(0);
    expect(score('x y a', 'a b c').accuracy).toBe(0);
  });
});

describe('QA T-011 speed ratio', () => {
  it('(QA-11) uses first startMs to last endMs, gaps between words included', () => {
    const r = score('a b', 'a b', 1500, [word('a', 1000, 1500), word('b', 3000, 4000)]);
    expect(r.speedRatio).toBe(0.5);
  });
  it('(QA-12) zero or negative spoken length gives speed ratio 0', () => {
    expect(score('a', 'a', 3000, [word('a', 1000, 1000)]).speedRatio).toBe(0);
    const neg = score('a', 'a', 3000, [word('a', 2000, 2500), word('b', 1000, 1500)]);
    expect(neg.speedRatio).toBe(0);
    expect(neg.unlocked).toBe(false);
  });
});

describe('QA T-011 maskWords', () => {
  it('(QA-13) tabs, newlines and repeated spaces never produce empty tokens', () => {
    const tokens = maskWords('  Hello\tworld \n again  ');
    expect(tokens.map((t) => t.text)).toEqual(['Hello', 'world', 'again']);
    expect(masked('  Hello\tworld \n again  ')).toEqual(['world']);
  });
  it('(QA-14) empty and word-less sentences', () => {
    expect(maskWords('')).toEqual([]);
    expect(maskWords('/ — !')).toEqual([
      { text: '/', masked: false },
      { text: '—', masked: false },
      { text: '!', masked: false },
    ]);
  });
  it('(QA-15) consecutive non-word tokens do not shift parity; numbers and wrapped punctuation are words', () => {
    expect(masked('a / / — b c')).toEqual(['b']);
    expect(masked('(We) 3 ... cats, "run" fast')).toEqual(['3', '"run"']);
  });
});
