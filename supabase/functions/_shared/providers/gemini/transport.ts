import { err, ok, type LlmModelId, type LlmStreamRequest, type ProviderError, type Result } from '@english-coach/contracts';
import { plainError, type ErrorContext } from './errors.ts';

export type GeminiDeps = {
  readonly id: 'gemini' | 'gemini-paid';
  readonly apiKey: string;
  readonly fetch: typeof fetch;
};

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const generateUrl = (model: LlmModelId): string => `${BASE_URL}/${model}:generateContent`;
export const streamUrl = (model: LlmModelId): string => `${BASE_URL}/${model}:streamGenerateContent?alt=sse`;

/** ARCHITECTURE §5.4.3：只送這幾個欄位；不送 thinkingConfig、temperature、topP、topK、responseJsonSchema。 */
export function buildBody(req: Pick<LlmStreamRequest, 'system' | 'prompt' | 'maxOutputTokens'>, json: boolean): string {
  return JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: json
      ? { maxOutputTokens: req.maxOutputTokens, responseMimeType: 'application/json' }
      : { maxOutputTokens: req.maxOutputTokens },
  });
}

/** 一次 generate／stream 的整段時間（連接、等標頭、讀內容）共用一個 AbortController 與一個計時器。 */
export type Call = {
  send(url: string, body: string): Promise<Result<Response, ProviderError>>;
  /** 等一個 promise；逾時回 `timeout`，丟出例外回 `unavailable`。即使底層不理會 signal 也會在 timeoutMs 結束。 */
  wait<T>(promise: Promise<T>): Promise<Result<T, ProviderError>>;
  /** 正常結束：只取消計時器。 */
  finish(): void;
  /** 取消計時器並中止底層請求（串流結束或呼叫端提前停止）。 */
  abort(): void;
};

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : 'unknown error');

export function openCall(deps: GeminiDeps, timeoutMs: number): Call {
  const ctx: ErrorContext = { id: deps.id, apiKey: deps.apiKey };
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);
  const aborted = new Promise<void>((resolve) => {
    controller.signal.addEventListener('abort', () => {
      resolve();
    });
  });
  const timeoutError = (): ProviderError => plainError(ctx, 'timeout', `no complete response within ${String(timeoutMs)} ms`);
  const stopped = (): ProviderError => (expired ? timeoutError() : plainError(ctx, 'unavailable', 'request aborted'));
  const failed = (cause: unknown): ProviderError =>
    expired ? timeoutError() : plainError(ctx, 'unavailable', `network error: ${reasonOf(cause)}`);

  const wait = <T>(promise: Promise<T>): Promise<Result<T, ProviderError>> =>
    new Promise((resolve) => {
      void promise.then(
        (value) => {
          resolve(ok(value));
        },
        (cause: unknown) => {
          resolve(err(failed(cause)));
        },
      );
      void aborted.then(() => {
        resolve(err(stopped()));
      });
    });

  return {
    send: (url, body) =>
      wait(
        Promise.resolve().then(() =>
          deps.fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.apiKey },
            body,
            signal: controller.signal,
          }),
        ),
      ),
    wait,
    finish: () => {
      clearTimeout(timer);
    },
    abort: () => {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
