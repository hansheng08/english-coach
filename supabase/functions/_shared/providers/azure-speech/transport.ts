import { err, ok, type ProviderError, type Result } from '@english-coach/contracts';
import { classifyAzureError, plainError, type AzureCapability, type AzurePlainKind } from './errors.ts';

export type AzureTransport = {
  readonly fetch: typeof fetch;
  readonly key: string;
};

/** 一次 assess／synthesize 的整段時間（連接、等標頭、讀內容）共用一個 AbortController 與一個計時器。 */
export type Call = {
  send(url: string, headers: Readonly<Record<string, string>>, body: string | Uint8Array): Promise<Result<Response, ProviderError>>;
  /** 等一個 promise；逾時回 `timeout`，丟出例外回 `unavailable`。即使底層不理會 signal 也會在 timeoutMs 結束。 */
  wait<T>(promise: Promise<T>): Promise<Result<T, ProviderError>>;
  fail(kind: AzurePlainKind, message: string): ProviderError;
  /** 非 2xx：讀內容後照 §5.6.4 分類（讀內容逾時回 timeout）。 */
  failure(res: Response): Promise<ProviderError>;
};

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : 'unknown error');

/** 開一次呼叫、執行 `fn`，結束（含例外）一定取消計時器。 */
export async function withCall<T>(
  t: AzureTransport,
  capability: AzureCapability,
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
  const fail = (kind: AzurePlainKind, message: string): ProviderError => plainError(capability, t.key, kind, message);
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
    send: (url, headers, body) =>
      wait(
        Promise.resolve().then(() =>
          t.fetch(url, {
            method: 'POST',
            headers: { ...headers },
            body: typeof body === 'string' ? body : body.slice(), // slice：BodyInit 只收 ArrayBuffer 底層的位元組
            signal: controller.signal,
          }),
        ),
      ),
    wait,
    fail,
    failure: async (res) => {
      const text = await wait(res.text());
      if (!text.ok) return text.error;
      return classifyAzureError({ status: res.status, headers: res.headers, bodyText: text.value }, capability, t.key);
    },
  };

  try {
    return await fn(call);
  } finally {
    clearTimeout(timer);
  }
}
