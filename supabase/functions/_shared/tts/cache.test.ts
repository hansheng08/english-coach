import { UserIdSchema, VOICE_IDS, normalizeTtsText } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { mp3DurationMs, ttsObjectPath } from './cache.ts';

const USER = UserIdSchema.parse('00000000-0000-4000-8000-0000000000aa');
const VOICE = VOICE_IDS[0];
const pathOf = (text: string, voice: (typeof VOICE_IDS)[number] = VOICE): Promise<string> =>
  ttsObjectPath(USER, voice, normalizeTtsText(text));

describe('ttsObjectPath (AC-T21-2)', () => {
  it('(AC-T21-2) (TC-3) the same sentence with or without "/", extra spaces, or NFD maps to one path', async () => {
    expect(await pathOf('Hello / world')).toBe(await pathOf('Hello world'));
    expect(await pathOf('Hello   world\n')).toBe(await pathOf('Hello world'));
    expect(await pathOf('café time')).toBe(await pathOf('café time'));
  });

  it('(AC-T21-2) (TC-3) another voice gives another path, and the format is <uuid>/<64 lowercase hex>.mp3', async () => {
    const a = await pathOf('Hello world');
    expect(await pathOf('Hello world', VOICE_IDS[1])).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.mp3$/);
    expect(a.startsWith(`${USER}/`)).toBe(true);
  });

  it('(AC-T21-2) (TC-3) the hash input is voice + newline + text', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${VOICE}\nHello world`));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await pathOf('Hello world')).toBe(`${USER}/${hex}.mp3`);
  });
});

describe('mp3DurationMs (AC-T21-5)', () => {
  it('(AC-T21-5) (TC-6) 30,000 bytes at 48 kbps is 5,000 ms', () => {
    expect(mp3DurationMs(30000)).toBe(5000);
  });
});
