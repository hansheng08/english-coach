import { describe, expect, it } from 'vitest';
import { TranscriptSchema } from '@english-coach/contracts';
import type { Transcript } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { PAUSE_THRESHOLD_MS, computeSpeechMetrics } from './speech-metrics.ts';

type W = readonly [word: string, startMs: number, endMs: number];

function words(ws: readonly W[], durationMs = 60000): Transcript {
  return TranscriptSchema.parse({
    text: ws.map((w) => w[0]).join(' '),
    language: 'en',
    durationMs,
    provider: 'groq',
    model: 'whisper-large-v3-turbo',
    timing: 'words',
    words: ws.map(([word, startMs, endMs]) => ({ word, startMs, endMs, confidence: null })),
  });
}

// Spoken words laid out back to back, 100 ms each, with no gaps.
function spoken(list: readonly string[], durationMs = 60000): Transcript {
  return words(list.map((w, i): W => [w, i * 100, i * 100 + 100]), durationMs);
}

function repeated(n: number, durationMs: number): Transcript {
  return spoken(Array.from({ length: n }, () => 'word'), durationMs);
}

describe('computeSpeechMetrics: pauses', () => {
  it('threshold is 2000 ms', () => {
    expect(PAUSE_THRESHOLD_MS).toBe(2000);
  });

  it('counts only gaps strictly greater than 2000 ms', () => {
    // gaps between neighbours: 2000, 2001, 5000, -50 (overlap), 0
    const t = words([
      ['a', 3000, 4000],
      ['b', 6000, 7000], // gap 2000
      ['c', 9001, 10000], // gap 2001
      ['d', 15000, 16000], // gap 5000
      ['e', 15950, 17000], // gap -50
      ['f', 17000, 18000], // gap 0
    ]);
    expect(expectOk(computeSpeechMetrics(t, [])).pauseCount).toBe(2);
  });

  it('ignores silence before the first and after the last word', () => {
    const t = words([['a', 3000, 3500], ['b', 3600, 4000]], 10000);
    expect(expectOk(computeSpeechMetrics(t, [])).pauseCount).toBe(0);
  });

  it('single word has no pause', () => {
    expect(expectOk(computeSpeechMetrics(words([['a', 3000, 3500]], 10000), [])).pauseCount).toBe(0);
  });

  it('(AC-T12F1-3) counts a pause between the last two words', () => {
    // gaps: 100, 2100
    const t = words([['a', 0, 100], ['b', 200, 300], ['c', 2400, 2500]]);
    expect(expectOk(computeSpeechMetrics(t, [])).pauseCount).toBe(1);
  });
});

describe('computeSpeechMetrics: fillers', () => {
  const list = ['um', 'uh', 'you know'];

  it('counts um, uh and a two-word phrase ignoring case and punctuation', () => {
    const t = spoken(['Um,', 'I', 'think', 'UH', 'you', 'know.', 'so']);
    expect(expectOk(computeSpeechMetrics(t, list)).fillerCount).toBe(3);
  });

  it('does not count "you" without "know" after it', () => {
    const t = spoken(['you', 'see', 'you', 'there']);
    expect(expectOk(computeSpeechMetrics(t, list)).fillerCount).toBe(0);
  });

  it('does not count words that merely contain a filler', () => {
    const t = spoken(['umbrella', 'summer', 'uhh']);
    expect(expectOk(computeSpeechMetrics(t, list)).fillerCount).toBe(0);
  });

  it('prefers the longest phrase and does not overlap', () => {
    const t = spoken(['you', 'know']);
    expect(expectOk(computeSpeechMetrics(t, ['you', 'you know'])).fillerCount).toBe(1);
    expect(expectOk(computeSpeechMetrics(t, ['you know', 'you'])).fillerCount).toBe(1);
  });

  it('(AC-T12F1-1) prefers the longest phrase when its parts are also fillers', () => {
    const t = spoken(['you', 'know']);
    expect(expectOk(computeSpeechMetrics(t, ['you', 'know', 'you know'])).fillerCount).toBe(1);
  });

  it('(AC-T12F1-2) does not count overlapping phrases twice', () => {
    const t = spoken(['you', 'know', 'you']);
    expect(expectOk(computeSpeechMetrics(t, ['you know', 'know you'])).fillerCount).toBe(1);
  });

  it("(AC-T12F1-5) keeps a trailing apostrophe when normalizing", () => {
    const t = spoken(["goin'"]);
    expect(expectOk(computeSpeechMetrics(t, ['goin'])).fillerCount).toBe(0);
    expect(expectOk(computeSpeechMetrics(t, ["goin'"])).fillerCount).toBe(1);
  });

  it('counts a repeated phrase back to back without overlap', () => {
    const t = spoken(['you', 'know', 'you', 'know', 'know']);
    expect(expectOk(computeSpeechMetrics(t, ['you know'])).fillerCount).toBe(2);
  });

  it('empty list gives 0', () => {
    expect(expectOk(computeSpeechMetrics(spoken(['um', 'uh']), [])).fillerCount).toBe(0);
  });

  it('list entries are normalized too', () => {
    const t = spoken(['um', 'you', 'know']);
    expect(expectOk(computeSpeechMetrics(t, ['  UM! ', '"You   Know,"'])).fillerCount).toBe(2);
  });

  it('keeps apostrophes and skips words that normalize to empty', () => {
    const t = spoken(['...', "I'm", '--', 'um']);
    const m = expectOk(computeSpeechMetrics(t, ["i'm", '', '...']));
    expect(m.fillerCount).toBe(1);
    expect(m.wordCount).toBe(4);
  });
});

describe('computeSpeechMetrics: counts and wpm', () => {
  it.each<[number, number, number]>([
    [90, 60000, 90],
    [7, 4000, 105],
    [10, 7000, 85.7],
  ])('%d words in %d ms -> %d wpm', (n, durationMs, wpm) => {
    const m = expectOk(computeSpeechMetrics(repeated(n, durationMs), []));
    expect(m.wordCount).toBe(n);
    expect(m.wpm).toBe(wpm);
  });

  it('(AC-T12F1-4) rounds wpm to one decimal place', () => {
    // 60000 / 7000 = 8.571...
    expect(expectOk(computeSpeechMetrics(repeated(1, 7000), [])).wpm).toBe(8.6);
  });

  it('counts fillers in wordCount', () => {
    const m = expectOk(computeSpeechMetrics(spoken(['um', 'hi']), ['um']));
    expect(m.wordCount).toBe(2);
  });

  it('empty words gives all zeros', () => {
    expect(expectOk(computeSpeechMetrics(words([]), ['um']))).toEqual({
      pauseCount: 0,
      fillerCount: 0,
      wordCount: 0,
      wpm: 0,
    });
  });
});

describe('computeSpeechMetrics: errors', () => {
  it('timing none -> validation error at timing', () => {
    const t = TranscriptSchema.parse({
      text: 'hi',
      language: 'en',
      durationMs: 1000,
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      timing: 'none',
    });
    const e = expectErr(computeSpeechMetrics(t, []));
    expect(e.kind).toBe('validation');
    expect(e.issues[0]?.path).toBe('timing');
  });

  it('durationMs 0 -> validation error at durationMs', () => {
    const e = expectErr(computeSpeechMetrics(spoken(['a'], 0), []));
    expect(e.kind).toBe('validation');
    expect(e.issues[0]?.path).toBe('durationMs');
  });

  it('unsorted startMs -> validation error at words', () => {
    const t = words([['a', 500, 600], ['b', 100, 200]]);
    const e = expectErr(computeSpeechMetrics(t, []));
    expect(e.kind).toBe('validation');
    expect(e.issues[0]?.path).toBe('words');
  });

  it('equal startMs is allowed', () => {
    const t = words([['a', 100, 200], ['b', 100, 300]]);
    expect(computeSpeechMetrics(t, []).ok).toBe(true);
  });
});
