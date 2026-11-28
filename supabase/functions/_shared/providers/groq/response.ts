import {
  err,
  ok,
  TranscriptSchema,
  type ProviderError,
  type Result,
  type Transcript,
  type WordTiming,
} from '@english-coach/contracts';
import { z } from 'zod';
import { GROQ_MODEL, plainError } from './errors.ts';

// §5.7.3：寬鬆解析（不用 strict），其他欄位忽略。
const ResponseSchema = z.object({
  text: z.string(),
  duration: z.number().optional(),
  words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).optional(),
  segments: z.array(z.object({ start: z.number(), end: z.number() })).optional(),
});

const toMs = (seconds: number): number => Math.round(seconds * 1000);

/** §5.7.3：`durationMs` 依序取 `duration`、`words`／`segments` 最大的 `end`、0。 */
function durationMsOf(r: z.infer<typeof ResponseSchema>): number {
  if (r.duration !== undefined) return toMs(r.duration);
  const ends = [...(r.words ?? []).map((w) => w.end), ...(r.segments ?? []).map((s) => s.end)];
  return ends.length === 0 ? 0 : toMs(Math.max(...ends));
}

/** 2xx 內容 → `Transcript`（§5.7.3）。`apiKey` 只用來遮蔽訊息。 */
export function mapTranscript(bodyText: string, wordTimestamps: boolean, apiKey: string): Result<Transcript, ProviderError> {
  const invalid = (message: string): Result<never, ProviderError> =>
    err(plainError(apiKey, 'invalid_response', message));
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return invalid('response is not JSON');
  }
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) return invalid('response does not match the expected structure');
  const r = parsed.data;
  const text = r.text.trim();
  const base = { text, language: 'en', durationMs: durationMsOf(r), provider: 'groq', model: GROQ_MODEL } as const;

  let candidate: unknown;
  if (wordTimestamps) {
    const words: WordTiming[] = [];
    for (const w of r.words ?? []) {
      const word = w.word.trim();
      if (word.length === 0) continue;
      const startMs = toMs(w.start);
      words.push({ word, startMs, endMs: Math.max(startMs, toMs(w.end)), confidence: null });
    }
    if (words.length === 0 && text.length > 0) return invalid('word timestamps are missing');
    candidate = { ...base, timing: 'words', words };
  } else {
    candidate = { ...base, timing: 'none' };
  }
  const checked = TranscriptSchema.safeParse(candidate);
  return checked.success ? ok(checked.data) : invalid('transcript failed validation');
}
