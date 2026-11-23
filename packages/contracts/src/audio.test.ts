import { describe, expect, it } from 'vitest';
import { expectErr, expectOk } from '../test/index.ts';
import { parseWav16kMono } from './audio.ts';

function ascii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** 在記憶體中組出 WAV（44 byte 標頭＋靜音）。 */
function makeWav(opts: { sampleRate?: number; channels?: number; bits?: number; seconds?: number; riff?: string }): Uint8Array {
  const sampleRate = opts.sampleRate ?? 16_000;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const seconds = opts.seconds ?? 1;
  const dataSize = Math.round(sampleRate * seconds) * channels * (bits / 8);
  const bytes = new Uint8Array(44 + dataSize);
  const v = new DataView(bytes.buffer);
  ascii(v, 0, opts.riff ?? 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  ascii(v, 8, 'WAVE');
  ascii(v, 12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, (sampleRate * channels * bits) / 8, true);
  v.setUint16(32, (channels * bits) / 8, true);
  v.setUint16(34, bits, true);
  ascii(v, 36, 'data');
  v.setUint32(40, dataSize, true);
  return bytes;
}

describe('parseWav16kMono (§5.0.5)', () => {
  it('accepts 16 kHz mono 16-bit 1 s and reports durationMs', () => {
    const bytes = makeWav({});
    const wav = expectOk(parseWav16kMono(bytes));
    expect(wav.durationMs).toBe(1000);
    expect(wav.bytes).toBe(bytes);
  });

  it('accepts exactly 30 s (the default maximum is inclusive)', () => {
    expect(expectOk(parseWav16kMono(makeWav({ seconds: 30 }))).durationMs).toBe(30_000);
  });

  it('rejects 8 kHz with a validation error', () => {
    expect(expectErr(parseWav16kMono(makeWav({ sampleRate: 8000 }))).kind).toBe('validation');
  });

  it('rejects stereo with a validation error', () => {
    expect(expectErr(parseWav16kMono(makeWav({ channels: 2 }))).kind).toBe('validation');
  });

  it('rejects audio longer than 30 s with a validation error', () => {
    expect(expectErr(parseWav16kMono(makeWav({ seconds: 31 }))).kind).toBe('validation');
  });

  it('rejects a non-RIFF file with a validation error', () => {
    expect(expectErr(parseWav16kMono(makeWav({ riff: 'RIFX' }))).kind).toBe('validation');
    expect(expectErr(parseWav16kMono(new Uint8Array([1, 2, 3]))).kind).toBe('validation');
  });

  it('rejects 8-bit audio with a validation error', () => {
    expect(expectErr(parseWav16kMono(makeWav({ bits: 8 }))).kind).toBe('validation');
  });

  it('maxDurationMs parameter takes effect', () => {
    const bytes = makeWav({ seconds: 2 });
    expect(expectErr(parseWav16kMono(bytes, 1500)).kind).toBe('validation');
    expect(expectOk(parseWav16kMono(bytes, 2000)).durationMs).toBe(2000);
  });

  it('error carries message and one issue', () => {
    const e = expectErr(parseWav16kMono(makeWav({ channels: 2 })));
    expect(e.issues).toHaveLength(1);
    expect(e.message.length).toBeGreaterThan(0);
  });
});
