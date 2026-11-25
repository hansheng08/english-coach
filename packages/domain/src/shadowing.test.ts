import { describe, expect, it } from 'vitest';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import type { PronunciationResult } from '@english-coach/contracts';
import * as domain from '@english-coach/domain';
import { canUnlock, maskWords, scoreShadowAttempt } from './shadowing.ts';

const TEN = 'one two three four five six seven eight nine ten';

function word(w: string, startMs: number, endMs: number): PronunciationResult['words'][number] {
  return { word: w, startMs, endMs, confidence: null };
}

function pr(recognizedText: string, words: PronunciationResult['words'] = [word('a', 0, 3000)]) {
  return { recognizedText, words };
}

function accuracyOf(reference: string, recognized: string): number {
  return expectOk(scoreShadowAttempt(reference, 3000, pr(recognized))).accuracy;
}

describe('canUnlock', () => {
  it('(AC-T11-1) (TC-1) accuracy threshold is inclusive at 0.8', () => {
    expect(canUnlock(0.8, 1)).toBe(true);
    expect(canUnlock(0.799, 1)).toBe(false);
  });
  it('(AC-T11-1) (TC-2) speed ratio threshold is inclusive at 0.7', () => {
    expect(canUnlock(1, 0.7)).toBe(true);
    expect(canUnlock(1, 0.699)).toBe(false);
  });
});

describe('scoreShadowAttempt accuracy', () => {
  it('(AC-T11-2) (TC-3) identical text gives 1', () => {
    expect(accuracyOf(TEN, TEN)).toBe(1);
  });
  it('(AC-T11-2) (TC-4) one omitted or substituted word gives 0.9', () => {
    expect(accuracyOf(TEN, 'one two three four five six seven eight nine')).toBeCloseTo(0.9);
    expect(accuracyOf(TEN, 'one two three four five six seven eight nine zzz')).toBeCloseTo(0.9);
  });
  it('(AC-T11-2) (TC-5) extra spoken word is not penalised', () => {
    expect(accuracyOf(TEN, `${TEN} eleven`)).toBe(1);
  });
  it('(AC-T11-2) (TC-6) denominator is the reference word count', () => {
    expect(accuracyOf(TEN, 'one three five seven nine')).toBe(0.5);
  });
  it('(AC-T11-3) (TC-7) case and edge punctuation are ignored', () => {
    expect(accuracyOf('We need buy-in.', 'we NEED buy-in')).toBe(1);
  });
  it('(AC-T11-3) (TC-8) slash and lone punctuation are not words', () => {
    expect(accuracyOf('Costs rise / fast — again', 'costs rise fast again')).toBe(1);
  });
  it('(AC-T11-4) (TC-9) reference without words is a validation error', () => {
    for (const text of ['', '— / !']) {
      const e = expectErr(scoreShadowAttempt(text, 3000, pr('x')));
      expect(e.kind).toBe('validation');
      expect(e.issues[0]?.path).toBe('referenceText');
    }
  });
});

describe('scoreShadowAttempt speed ratio', () => {
  it('(AC-T11-5) (TC-10) trims leading and trailing silence', () => {
    const r = expectOk(scoreShadowAttempt(TEN, 3000, pr(TEN, [word('a', 500, 1000), word('b', 1000, 4500)])));
    expect(r.speedRatio).toBe(0.75);
  });
  it('(AC-T11-5) (TC-11) above 1 is not clamped', () => {
    const r = expectOk(scoreShadowAttempt(TEN, 4000, pr(TEN, [word('a', 0, 3000)])));
    expect(r.speedRatio).toBeCloseTo(1.3333, 3);
  });
  it('(AC-T11-5) (TC-12) no timestamps gives 0 and locked', () => {
    const r = expectOk(scoreShadowAttempt(TEN, 3000, pr(TEN, [])));
    expect(r.speedRatio).toBe(0);
    expect(r.unlocked).toBe(false);
  });
  it('(AC-T11-5) (TC-13) non-positive reference duration is a validation error', () => {
    for (const d of [0, -1]) {
      const e = expectErr(scoreShadowAttempt(TEN, d, pr(TEN)));
      expect(e.kind).toBe('validation');
      expect(e.issues[0]?.path).toBe('referenceDurationMs');
    }
  });
});

describe('scoreShadowAttempt unlock', () => {
  it('(AC-T11-6) (TC-14) unlocked follows canUnlock', () => {
    const ref = TEN;
    const nine = 'one two three four five six seven eight nine';
    const seven = 'one two three four five six seven';
    // speed ratio 0.75: 3000 / 4000
    expect(expectOk(scoreShadowAttempt(ref, 3000, pr(nine, [word('a', 0, 4000)]))).unlocked).toBe(true);
    // speed ratio 0.6: 3000 / 5000
    expect(expectOk(scoreShadowAttempt(ref, 3000, pr(nine, [word('a', 0, 5000)]))).unlocked).toBe(false);
    // accuracy 0.7, speed ratio 1
    expect(expectOk(scoreShadowAttempt(ref, 3000, pr(seven, [word('a', 0, 3000)]))).unlocked).toBe(false);
  });
  it('(AC-T11-6) (TC-15) pronunciation score does not matter', () => {
    const base = { recognizedText: TEN, words: [word('a', 0, 3000)], provider: 'azure-speech' as const };
    const low: PronunciationResult = { ...base, score0to100: 0 };
    const high: PronunciationResult = { ...base, score0to100: 100 };
    expect(scoreShadowAttempt(TEN, 3000, low)).toEqual(scoreShadowAttempt(TEN, 3000, high));
  });
});

describe('maskWords', () => {
  const sentence = 'We need / buy-in from the team.';
  it('(AC-T11-7) (TC-16) masks odd-position words, first always shown', () => {
    const tokens = maskWords(sentence);
    expect(tokens.filter((t) => t.text !== '/').map((t) => t.text)).toEqual(['We', 'need', 'buy-in', 'from', 'the', 'team.']);
    expect(tokens.filter((t) => t.masked).map((t) => t.text)).toEqual(['need', 'from', 'team.']);
    expect(tokens[0]?.masked).toBe(false);
  });
  it('(AC-T11-7) (TC-17) n words mask floor(n/2)', () => {
    expect(maskWords('hello').filter((t) => t.masked)).toHaveLength(0);
    const five = maskWords('a b c d e');
    expect(five.filter((t) => t.masked).map((t) => t.text)).toEqual(['b', 'd']);
  });
  it('(AC-T11-7) (TC-18) keeps token text and order', () => {
    const tokens = maskWords(sentence);
    expect(tokens).toHaveLength(7);
    expect(tokens.map((t) => t.text).join(' ')).toBe(sentence);
  });
  it('(AC-T11-8) (TC-19) slash and lone punctuation are never masked and do not shift parity', () => {
    const tokens = maskWords('A / b — c d');
    expect(tokens.filter((t) => t.text === '/' || t.text === '—').every((t) => !t.masked)).toBe(true);
    expect(tokens.filter((t) => t.masked).map((t) => t.text)).toEqual(['b', 'd']);
  });
  it('(AC-T11-8) (TC-20) is reproducible', () => {
    expect(maskWords(sentence)).toEqual(maskWords(sentence));
  });
});

describe('package exports', () => {
  it('(AC-T11-9) (TC-21) exposes shadowing API from @english-coach/domain', () => {
    expect(domain.SHADOW_MIN_ACCURACY).toBe(0.8);
    expect(domain.SHADOW_MIN_SPEED_RATIO).toBe(0.7);
    expect(domain.canUnlock).toBe(canUnlock);
    expect(domain.maskWords).toBe(maskWords);
    expect(domain.scoreShadowAttempt).toBe(scoreShadowAttempt);
  });
});
