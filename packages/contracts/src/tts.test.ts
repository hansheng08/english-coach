import { describe, expect, it } from 'vitest';
import { DEFAULT_TTS_VOICE, normalizeTtsText, TtsRequestSchema, TtsResponseSchema, TTS_TEXT_MAX_CHARS } from './tts.ts';

const UID = '00000000-0000-4000-8000-0000000000aa';
const response = {
  audioUrl: 'https://example.supabase.co/storage/v1/object/sign/tts/x.mp3?token=t',
  path: `${UID}/${'a'.repeat(64)}.mp3`,
  durationMs: 4200,
  cached: false,
  meta: { ttsProvider: 'azure-speech', voice: 'azure:en-US-AvaNeural' },
};

describe('normalizeTtsText (AC-T21-1)', () => {
  it('(AC-T21-1) (TC-1) strips "/", collapses whitespace, applies NFC and trims', () => {
    expect(normalizeTtsText('Hello / world')).toBe('Hello world');
    expect(normalizeTtsText('a  \n b')).toBe('a b');
    expect(normalizeTtsText('é')).toBe('é');
    expect(normalizeTtsText(' x ')).toBe('x');
  });

  it('(AC-T21-1) (TC-1) DEFAULT_TTS_VOICE is the documented Azure voice', () => {
    expect(DEFAULT_TTS_VOICE).toBe('azure:en-US-AvaNeural');
  });
});

describe('TtsRequestSchema / TtsResponseSchema (AC-T21-1)', () => {
  it('(AC-T21-1) (TC-2) accepts 1,000 characters and rejects 1,001', () => {
    expect(TtsRequestSchema.safeParse({ text: 'a'.repeat(TTS_TEXT_MAX_CHARS) }).success).toBe(true);
    expect(TtsRequestSchema.safeParse({ text: 'a'.repeat(TTS_TEXT_MAX_CHARS + 1) }).success).toBe(false);
  });

  it('(AC-T21-1) (TC-2) rejects text that is empty after normalization, and extra fields such as voice', () => {
    expect(TtsRequestSchema.safeParse({ text: ' / ' }).success).toBe(false);
    expect(TtsRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(TtsRequestSchema.safeParse({ text: 'hi', voice: 'azure:en-US-AvaNeural' }).success).toBe(false);
  });

  it('(AC-T21-1) (TC-2) the parsed text is the normalized one', () => {
    const r = TtsRequestSchema.safeParse({ text: ' Hello /  world ' });
    expect(r.success ? r.data.text : null).toBe('Hello world');
  });

  it('(AC-T21-1) (TC-2) the response has five fields and fails without meta', () => {
    expect(Object.keys(TtsResponseSchema.shape).sort()).toEqual(['audioUrl', 'cached', 'durationMs', 'meta', 'path']);
    expect(TtsResponseSchema.safeParse(response).success).toBe(true);
    expect(TtsResponseSchema.safeParse({ ...response, meta: undefined }).success).toBe(false);
  });
});
