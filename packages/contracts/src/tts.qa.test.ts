import { describe, expect, it } from 'vitest';
import { TtsResponseSchema } from './tts.ts';

// QA probe for T-021 TtsResponseSchema (AC-T21-1, ARCHITECTURE §4.19: durationMs is a positive integer).
const PATH = `00000000-0000-4000-8000-000000000021/${'a'.repeat(64)}.mp3`;
const base = { audioUrl: 'https://qa.test/a.mp3', path: PATH, cached: false, meta: { ttsProvider: 'azure-speech', voice: 'azure:en-US-AvaNeural' } };

describe('T-021 QA TtsResponseSchema', () => {
  it('(QA-46) (AC-T21-1) durationMs must be a positive integer: 1 passes; 0, -1 and 1.5 fail', () => {
    expect(TtsResponseSchema.safeParse({ ...base, durationMs: 1 }).success).toBe(true);
    for (const durationMs of [0, -1, 1.5]) {
      expect(TtsResponseSchema.safeParse({ ...base, durationMs }).success, String(durationMs)).toBe(false);
    }
  });
});
