import { describe, expect, it } from 'vitest';
import { EveningSpeechStatsSchema, WeeklyMetricSchema } from './metrics.ts';

describe('WeeklyMetricSchema (AC-T6-12)', () => {
  const week = {
    weekStart: '2026-11-16',
    masteredNew: 2,
    masteredCumulative: 4,
    firstAnswerCount: 1,
    pauseFillerPerMinute: 2,
    pauseFillerCountAvg: 4,
    wpmAvg: 90,
    noScriptChunkTargets: 8,
    noScriptChunkSpoken: 4,
    noScriptChunkSpokenRate: 0.5,
  };

  it('accepts the pgTAP expected row for 2026-11-16 and an empty week', () => {
    expect(WeeklyMetricSchema.safeParse(week).success).toBe(true);
    const empty = { ...week, masteredNew: 0, firstAnswerCount: 0, pauseFillerPerMinute: null, pauseFillerCountAvg: null, wpmAvg: null, noScriptChunkTargets: 0, noScriptChunkSpoken: 0, noScriptChunkSpokenRate: null };
    expect(WeeklyMetricSchema.safeParse(empty).success).toBe(true);
  });

  it('rejects a spoken rate above 1 and a fractional count', () => {
    expect(WeeklyMetricSchema.safeParse({ ...week, noScriptChunkSpokenRate: 1.5 }).success).toBe(false);
    expect(WeeklyMetricSchema.safeParse({ ...week, masteredNew: 1.5 }).success).toBe(false);
  });
});

describe('EveningSpeechStatsSchema (AC-T6-12)', () => {
  it('accepts zero duration and rejects negative or fractional values', () => {
    expect(EveningSpeechStatsSchema.safeParse({ pauseCount: 0, fillerCount: 0, wpm: 0, speechDurationMs: 0 }).success).toBe(true);
    expect(EveningSpeechStatsSchema.safeParse({ pauseCount: -1, fillerCount: 0, wpm: 0, speechDurationMs: 0 }).success).toBe(false);
    expect(EveningSpeechStatsSchema.safeParse({ pauseCount: 0, fillerCount: 0, wpm: 0, speechDurationMs: 1.5 }).success).toBe(false);
  });
});
