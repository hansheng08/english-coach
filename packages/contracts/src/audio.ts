import type { Brand } from './brand.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import type { ValidationError } from './validation.ts';

/** 已確認是 RIFF/WAVE、PCM 16-bit、16 kHz、單聲道、≤ 30 s 的音訊。只能由 parseWav16kMono 產生（本檔是唯一可以 `as Wav16kMono` 的地方）。 */
export type Wav16kMono = Brand<{ readonly bytes: Uint8Array; readonly durationMs: number }, 'Wav16kMono'>;

/** STT 的輸入。晚上的回答是瀏覽器錄的 WebM/Opus；跟讀是 WAV。 */
export type AudioPayload =
  | { readonly format: 'wav-pcm16-16k-mono'; readonly wav: Wav16kMono }
  | { readonly format: 'webm-opus'; readonly bytes: Uint8Array }; // 大小上限由 endpoint 的 schema 檢查

const DEFAULT_MAX_DURATION_MS = 30_000;
const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;

function invalid(message: string): Result<never, ValidationError> {
  return err({ kind: 'validation', issues: [{ path: 'audio', message }], message });
}

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

export function parseWav16kMono(
  bytes: Uint8Array,
  maxDurationMs: number = DEFAULT_MAX_DURATION_MS,
): Result<Wav16kMono, ValidationError> {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    return invalid('not a RIFF/WAVE file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataBytes: number | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return invalid('truncated fmt chunk');
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      dataBytes = Math.min(size, bytes.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }

  if (format === null) return invalid('missing fmt chunk');
  if (format.audioFormat !== 1) return invalid('not PCM audio');
  if (format.bitsPerSample !== 16) return invalid('not 16-bit audio');
  if (format.sampleRate !== SAMPLE_RATE) return invalid('sample rate is not 16 kHz');
  if (format.channels !== 1) return invalid('audio is not mono');
  if (dataBytes === null) return invalid('missing data chunk');

  const durationMs = Math.round((dataBytes / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000);
  if (durationMs > maxDurationMs) return invalid('audio is longer than the maximum duration');

  return ok({ bytes, durationMs } as Wav16kMono);
}
