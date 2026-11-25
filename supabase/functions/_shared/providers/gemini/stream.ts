import { err, type LlmStreamRequest, type ProviderError, type Result, type StreamChunk } from '@english-coach/contracts';
import { classifyGeminiError, plainError } from './errors.ts';
import { interpretStreamEvent } from './response.ts';
import { createSseParser } from './sse.ts';
import { buildBody, openCall, streamUrl, type GeminiDeps } from './transport.ts';

/**
 * ARCHITECTURE §5.4.6。不重試：產生 err 或 done 就結束；呼叫端提前停止（generator 被 return）時 finally 會中止底層請求。
 * 判斷成功與否看 HTTP 狀態，不看 content-type（失敗時標頭也是 text/event-stream）。
 */
export async function* runStream(deps: GeminiDeps, req: LlmStreamRequest): AsyncGenerator<Result<StreamChunk, ProviderError>> {
  const ctx = { id: deps.id, apiKey: deps.apiKey, model: req.model };
  const call = openCall(deps, req.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const sent = await call.send(streamUrl(req.model), buildBody(req, false));
    if (!sent.ok) {
      yield sent;
      return;
    }
    const res = sent.value;
    if (!res.ok) {
      const text = await call.wait(res.text());
      yield text.ok ? err(classifyGeminiError({ status: res.status, body: text.value, ...ctx })) : text;
      return;
    }
    if (res.body === null) {
      yield err(plainError(ctx, 'invalid_response', 'stream has no body'));
      return;
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    for (;;) {
      const read = await call.wait(reader.read());
      if (!read.ok) {
        yield read;
        return;
      }
      const { done, value } = read.value;
      const events = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
      for (const data of events) {
        const step = interpretStreamEvent(data, ctx);
        yield* step.chunks;
        if (step.end) return;
      }
      if (done) {
        yield err(plainError(ctx, 'invalid_response', 'stream ended without finishReason'));
        return;
      }
    }
  } finally {
    call.abort();
    void reader?.cancel().catch(() => undefined);
  }
}
