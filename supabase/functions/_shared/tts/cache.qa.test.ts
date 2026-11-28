import { UserIdSchema } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { mp3DurationMs, ttsObjectPath } from './cache.ts';

// QA probes for T-021 cache key and duration (AC-T21-2, AC-T21-5). Expected hashes from an independent sha256.
const USER = UserIdSchema.parse('00000000-0000-4000-8000-000000000021');

describe('T-021 QA tts cache key', () => {
  it('(QA-33) (AC-T21-2) the path is <user>/<lowercase sha256(voice + "\\n" + text)>.mp3', async () => {
    expect(await ttsObjectPath(USER, 'azure:en-US-AvaNeural', 'hi')).toBe(`${USER}/f5dbcbcf81ab80e02a15c68bddb2cd75362504ffadcadd38f50f5c41db8e3902.mp3`);
    expect(await ttsObjectPath(USER, 'azure:en-US-AvaNeural', 'Hello world')).toBe(
      `${USER}/495fdc915cf49dc35810648c1c9aaf7711040dee0610c09209e4ac96b28ced33.mp3`,
    );
    expect(await ttsObjectPath(USER, 'azure:en-US-AndrewNeural', 'Hello world')).toBe(
      `${USER}/450f72a84d8219ae60df0a2ad9f3db5ebe3933b6916216d380be04ff48a5ec26.mp3`,
    );
  });

  it('(QA-34) (AC-T21-5) mp3DurationMs is round(bytes * 8 / 48)', () => {
    expect(mp3DurationMs(30000)).toBe(5000);
    expect(mp3DurationMs(48)).toBe(8);
    expect(mp3DurationMs(9)).toBe(2);
    expect(mp3DurationMs(8)).toBe(1);
  });
});
