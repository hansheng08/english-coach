import {
  err,
  ok,
  PronunciationResultSchema,
  tryCatch,
  type PronunciationProvider,
  type PronunciationResult,
  type ProviderError,
  type Result,
  type WordTiming,
} from '@english-coach/contracts';
import { z } from 'zod';
import { type AzureTransport, type Call, withCall } from './transport.ts';

const SILENT_STATUSES: readonly string[] = ['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout'];

// §5.6.2：Offset／Duration 在不同範例是數字或純數字字串，兩種都收。回應 schema 一律寬鬆（不用 strict）。
const TimeSchema = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]);
const EnvelopeSchema = z.object({ RecognitionStatus: z.string(), NBest: z.array(z.unknown()).optional() });
const BestSchema = z.object({
  PronScore: z.number(),
  Display: z.string().optional(),
  Words: z.array(z.object({ Word: z.string(), Offset: TimeSchema, Duration: TimeSchema })).optional(),
});

const clamp = (n: number): number => Math.min(100, Math.max(0, n));

function base64OfUtf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const endpoint = (region: string): string =>
  `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

function toResult(call: Call, raw: string): Result<PronunciationResult, ProviderError> {
  const json = tryCatch(
    (): unknown => JSON.parse(raw),
    () => null,
  );
  if (!json.ok) return err(call.fail('invalid_response', 'response is not JSON'));
  const envelope = EnvelopeSchema.safeParse(json.value);
  if (!envelope.success) return err(call.fail('invalid_response', 'response has no RecognitionStatus'));
  const { RecognitionStatus: status, NBest: nbest } = envelope.data;

  if (SILENT_STATUSES.includes(status)) {
    return ok({ score0to100: 0, recognizedText: '', words: [], provider: 'azure-speech' });
  }
  if (status === 'Error') return err(call.fail('unavailable', 'RecognitionStatus Error'));
  if (status !== 'Success') return err(call.fail('invalid_response', 'unknown RecognitionStatus'));

  const best = BestSchema.safeParse(nbest?.[0]);
  if (!best.success) return err(call.fail('invalid_response', 'NBest[0] is missing or has no PronScore'));

  const words: WordTiming[] = [];
  for (const w of best.data.Words ?? []) {
    if (w.Word.length === 0) continue;
    const startMs = Math.round(w.Offset / 10_000);
    const endMs = Math.max(startMs, Math.round((w.Offset + w.Duration) / 10_000));
    words.push({ word: w.Word, startMs, endMs, confidence: null });
  }
  const parsed = PronunciationResultSchema.safeParse({
    score0to100: clamp(best.data.PronScore),
    recognizedText: best.data.Display ?? '',
    words,
    provider: 'azure-speech',
  });
  if (!parsed.success) return err(call.fail('invalid_response', 'result does not match PronunciationResult'));
  return ok(parsed.data);
}

export function createPronunciation(t: AzureTransport, region: string): PronunciationProvider {
  return {
    id: 'azure-speech',
    capability: 'pronunciation',
    tier: 'free',
    displayName: 'Azure Speech',
    assess: (audio, referenceText, opts) =>
      withCall(t, 'pronunciation', opts.timeoutMs, async (call) => {
        const assessment = JSON.stringify({
          ReferenceText: referenceText,
          GradingSystem: 'HundredMark',
          Granularity: 'Word',
          Dimension: 'Comprehensive',
          EnableMiscue: false,
        });
        const sent = await call.send(
          endpoint(region),
          {
            'Ocp-Apim-Subscription-Key': t.key,
            'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
            Accept: 'application/json',
            'Pronunciation-Assessment': base64OfUtf8(assessment),
          },
          audio.bytes,
        );
        if (!sent.ok) return sent;
        if (!sent.value.ok) return err(await call.failure(sent.value));
        const text = await call.wait(sent.value.text());
        if (!text.ok) return text;
        return toResult(call, text.value);
      }),
  };
}
