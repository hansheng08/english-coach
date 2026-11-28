import { err, ok, type ProviderError, type Result } from '@english-coach/contracts';
import { classifyGroqError, plainError, type GroqPlainKind } from './errors.ts';

export type GroqTransport = {
  readonly fetch: typeof fetch;
  readonly apiKey: string;
};

/** 一次 transcribe 的整段時間（連接、等標頭、讀內容）共用一個 AbortController 與一個計時器。 */
export type Call = {
  /** 只發一次；不跟轉址（金鑰標頭不能被送到 Location 指的網址）。 */
  send(url: string, form: FormData): Promise<Result<Response, ProviderError>>;
  /** 等一個 promise；逾時回 `timeout`，丟出例外回 `unavailable`。即使底層不理會 signal 也會在 timeoutMs 結束。 */
  wait<T>(promise: Promise<T>): Promise<Result<T, ProviderError>>;
  fail(kind: GroqPlainKind, message: string): ProviderError;
  /** 非 2xx：讀內容後照 §5.7.4 分類（讀內容逾時回 timeout）。 */
  failure(res: Response): Promise<ProviderError>;
};

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : 'unknown error');

/** 開一次呼叫、執行 `fn`，結束（含例外）一定取消計時器。 */
export async function withCall<T>(
  t: GroqTransport,
  timeoutMs: number,
  fn: (call: Call) => Promise<Result<T, ProviderError>>,
): Promise<Result<T, ProviderError>> {
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
  const fail = (kind: GroqPlainKind, message: string): ProviderError => plainError(t.apiKey, kind, message);
  const timeoutError = (): ProviderError => fail('timeout', `no complete response within ${String(timeoutMs)} ms`);
  const stopped = (): ProviderError => (expired ? timeoutError() : fail('unavailable', 'request aborted'));
  const failed = (cause: unknown): ProviderError =>
    expired ? timeoutError() : fail('unavailable', `network error: ${reasonOf(cause)}`);

  const wait = <U>(promise: Promise<U>): Promise<Result<U, ProviderError>> =>
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

  const call: Call = {
    send: (url, form) =>
      wait(
        Promise.resolve().then(() =>
          t.fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${t.apiKey}` },
            body: form,
            redirect: 'manual',
            signal: controller.signal,
          }),
        ),
      ),
    wait,
    fail,
    failure: async (res) => {
      const text = await wait(res.text());
      if (!text.ok) return text.error;
      return classifyGroqError({ status: res.status, headers: res.headers, bodyText: text.value }, t.apiKey);
    },
  };

  try {
    return await fn(call);
  } finally {
    clearTimeout(timer);
  }
}
