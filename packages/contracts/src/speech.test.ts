import { describe, expect, it } from 'vitest';
import { PronunciationResultSchema, TranscriptSchema, WordTimingSchema } from './speech.ts';

const word = { word: 'hi', startMs: 0, endMs: 100, confidence: 0.9 };
const base = {
  text: 'hi',
  language: 'en',
  durationMs: 1000,
  provider: 'groq',
  model: 'whisper-large-v3-turbo',
} as const;

describe('WordTimingSchema', () => {
  it('accepts a valid timing, including null confidence and endMs === startMs', () => {
    expect(WordTimingSchema.safeParse(word).success).toBe(true);
    expect(WordTimingSchema.safeParse({ ...word, confidence: null }).success).toBe(true);
    expect(WordTimingSchema.safeParse({ ...word, startMs: 5, endMs: 5 }).success).toBe(true);
  });
  it('rejects endMs < startMs', () => {
    expect(WordTimingSchema.safeParse({ ...word, startMs: 200, endMs: 100 }).success).toBe(false);
  });
  it('rejects an empty word and out-of-range confidence', () => {
    expect(WordTimingSchema.safeParse({ ...word, word: '' }).success).toBe(false);
    expect(WordTimingSchema.safeParse({ ...word, confidence: 1.1 }).success).toBe(false);
  });
});

describe('TranscriptSchema', () => {
  it('accepts timing "words" with words and timing "none" without', () => {
    expect(TranscriptSchema.safeParse({ ...base, timing: 'words', words: [word] }).success).toBe(true);
    expect(TranscriptSchema.safeParse({ ...base, timing: 'none' }).success).toBe(true);
  });
  it('rejects timing "words" without words', () => {
    expect(TranscriptSchema.safeParse({ ...base, timing: 'words' }).success).toBe(false);
  });
  it('rejects an unknown timing, language or model', () => {
    expect(TranscriptSchema.safeParse({ ...base, timing: 'maybe' }).success).toBe(false);
    expect(TranscriptSchema.safeParse({ ...base, timing: 'none', language: 'zh' }).success).toBe(false);
    expect(TranscriptSchema.safeParse({ ...base, timing: 'none', model: 'gpt' }).success).toBe(false);
  });
});

describe('PronunciationResultSchema', () => {
  const ok = { score0to100: 80, recognizedText: 'hi', words: [word], provider: 'azure-speech' };
  it('accepts 0, 100 and a valid result', () => {
    expect(PronunciationResultSchema.safeParse(ok).success).toBe(true);
    expect(PronunciationResultSchema.safeParse({ ...ok, score0to100: 0 }).success).toBe(true);
    expect(PronunciationResultSchema.safeParse({ ...ok, score0to100: 100 }).success).toBe(true);
  });
  it('rejects a score of 101 or -1', () => {
    expect(PronunciationResultSchema.safeParse({ ...ok, score0to100: 101 }).success).toBe(false);
    expect(PronunciationResultSchema.safeParse({ ...ok, score0to100: -1 }).success).toBe(false);
  });
});
