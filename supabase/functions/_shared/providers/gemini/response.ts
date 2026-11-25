import { err, ok, tryCatch, type LlmModelId, type ProviderError, type Result, type StreamChunk } from '@english-coach/contracts';
import { z } from 'zod';
import { classifyGeminiError, parseErrorBody, plainError, type ErrorContext } from './errors.ts';

// 回應 schema（ARCHITECTURE §5.4.3）：不用 strict，thoughtSignature、serviceTier、modelVersion 等多出欄位一律忽略。
const PartSchema = z.object({ text: z.string().optional(), thought: z.boolean().optional() });
const CandidateSchema = z.object({
  content: z.object({ parts: z.array(PartSchema).optional() }).optional(),
  finishReason: z.string().optional(), // 串流中間段沒有
});
const UsageSchema = z.object({
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  thoughtsTokenCount: z.number().optional(), // 兩個 flash-lite 不送 thinkingConfig 時沒有這個欄位
});
const ResponseSchema = z.object({
  candidates: z.array(CandidateSchema).optional(), // 被擋下時只有 promptFeedback
  usageMetadata: UsageSchema.optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});
type GeminiResponse = z.infer<typeof ResponseSchema>;
type Candidate = z.infer<typeof CandidateSchema>;

/** 串起 `thought !== true` 且非空的 text（依序）。 */
function textOf(candidate: Candidate): string {
  return (candidate.content?.parts ?? [])
    .flatMap((p) => (p.thought !== true && p.text !== undefined && p.text.length > 0 ? [p.text] : []))
    .join('');
}

/** 串流的 usageMetadata 是累計值：呼叫端只傳最後一段的，不相加。缺 promptTokenCount 或 candidatesTokenCount 時是 null。 */
function usageOf(usage: GeminiResponse['usageMetadata']): { inputTokens: number; outputTokens: number } | null {
  if (usage?.promptTokenCount === undefined || usage.candidatesTokenCount === undefined) return null;
  return { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) };
}

/** ARCHITECTURE §5.4.5。 */
type Finish =
  | { readonly kind: 'finish'; readonly reason: 'stop' | 'max_tokens' | 'safety' }
  | { readonly kind: 'fail'; readonly error: 'auth' | 'invalid_response' };

function mapFinishReason(reason: string): Finish {
  switch (reason) {
    case 'STOP':
      return { kind: 'finish', reason: 'stop' };
    case 'MAX_TOKENS':
    case 'CONTINUATION':
      return { kind: 'finish', reason: 'max_tokens' };
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'LANGUAGE':
    case 'ESCALATION':
      return { kind: 'finish', reason: 'safety' };
    case 'PUP_LIMITED_DISABLED':
      return { kind: 'fail', error: 'auth' };
    default:
      return { kind: 'fail', error: 'invalid_response' };
  }
}

const parseJson = (text: string): Result<unknown, null> =>
  tryCatch(
    (): unknown => JSON.parse(text),
    () => null,
  );

/** `retry` 為 true 只有一種情況：finishReason 是 STOP，但 JSON.parse 或 zod 失敗（§5.4.4）。 */
export type GenerateFailure = { readonly error: ProviderError; readonly retry: boolean };

export function interpretGenerate<T>(body: string, schema: z.ZodType<T>, ctx: ErrorContext): Result<T, GenerateFailure> {
  const fail = (message: string, retry = false): Result<T, GenerateFailure> =>
    err({ error: plainError(ctx, 'invalid_response', message), retry });

  const json = parseJson(body);
  if (!json.ok) return fail('response is not JSON');
  const envelope = ResponseSchema.safeParse(json.value);
  if (!envelope.success) return fail('response has an unexpected shape');
  const blocked = envelope.data.promptFeedback?.blockReason;
  if (blocked !== undefined && blocked.length > 0) return fail(`blocked: ${blocked}`);
  const candidate = envelope.data.candidates?.[0];
  if (candidate === undefined) return fail('response has no candidates');
  const reason = candidate.finishReason;
  if (reason === undefined) return fail('candidate has no finishReason');

  const finish = mapFinishReason(reason);
  switch (finish.kind) {
    case 'fail':
      return err({ error: plainError(ctx, finish.error, `finishReason ${reason}`), retry: false });
    case 'finish': {
      if (finish.reason !== 'stop') return fail(`finishReason ${reason}`);
      const value = parseJson(textOf(candidate));
      if (!value.ok) return fail('model output is not JSON', true);
      const checked = schema.safeParse(value.value);
      if (!checked.success) {
        const paths = checked.error.issues.map((i) => i.path.join('.')).join(', ');
        return fail(`model output failed schema validation (${paths})`, true);
      }
      return ok(checked.data);
    }
    default: {
      const unreachable: never = finish;
      return unreachable;
    }
  }
}

/** 一個 SSE 事件的處理結果：要產生的片段，以及是否結束（done 或 err 之後不再讀）。 */
export type StreamStep = { readonly chunks: readonly Result<StreamChunk, ProviderError>[]; readonly end: boolean };

export function interpretStreamEvent(data: string, ctx: ErrorContext & { readonly model: LlmModelId }): StreamStep {
  const fail = (e: ProviderError): StreamStep => ({ chunks: [err(e)], end: true });

  const json = parseJson(data);
  if (!json.ok) return fail(plainError(ctx, 'invalid_response', 'stream event is not JSON'));
  const errorBody = parseErrorBody(data);
  if (errorBody !== null) {
    // 串流途中出錯（格式未驗證）：依 error.code 對應；沒有 code 當 500。
    return fail(classifyGeminiError({ status: errorBody.code ?? 500, body: data, ...ctx }));
  }
  const parsed = ResponseSchema.safeParse(json.value);
  if (!parsed.success) return fail(plainError(ctx, 'invalid_response', 'stream event has an unexpected shape'));

  const blocked = parsed.data.promptFeedback?.blockReason;
  if (blocked !== undefined && blocked.length > 0) {
    return { chunks: [ok({ type: 'done', finishReason: 'safety', usage: null })], end: true };
  }
  const candidate = parsed.data.candidates?.[0];
  const chunks: Result<StreamChunk, ProviderError>[] = [];
  const text = candidate === undefined ? '' : textOf(candidate);
  if (text.length > 0) chunks.push(ok({ type: 'delta', text }));

  const reason = candidate?.finishReason;
  if (reason === undefined) return { chunks, end: false };
  const finish = mapFinishReason(reason);
  switch (finish.kind) {
    case 'finish':
      chunks.push(ok({ type: 'done', finishReason: finish.reason, usage: usageOf(parsed.data.usageMetadata) }));
      break;
    case 'fail':
      chunks.push(err(plainError(ctx, finish.error, `finishReason ${reason}`)));
      break;
    default: {
      const unreachable: never = finish;
      return unreachable;
    }
  }
  return { chunks, end: true };
}
