import { afterEach, beforeEach, expect, vi } from 'vitest';

export type FetchCall = {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  /** 請求內容（JSON.parse 後）。 */
  readonly body: unknown;
  readonly signal: AbortSignal | null | undefined;
};

export type Reply = (signal: AbortSignal | null | undefined) => Response | Promise<Response>;

const encoder = new TextEncoder();

/** 依序回覆；回覆用完還被呼叫就丟出（讓多呼叫的 bug 直接失敗）。 */
export function fakeFetch(...replies: readonly Reply[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    const raw = init?.body;
    calls.push({
      url,
      method: init?.method,
      headers: headers ?? {},
      body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
      signal: init?.signal,
    });
    const reply = replies[calls.length - 1];
    if (reply === undefined) throw new Error(`unexpected fetch call #${String(calls.length)}`);
    return Promise.resolve(reply(init?.signal));
  };
  return { fetch: impl, calls };
}

/** 一般 JSON 回應。 */
export const json =
  (status: number, body: string): Reply =>
  () =>
    new Response(body, { status, headers: { 'content-type': 'application/json; charset=UTF-8' } });

/** 標頭是 text/event-stream 的回應（成功的串流，或開始前失敗：實測內容是一般 JSON）。 */
export const sse =
  (status: number, body: string): Reply =>
  () =>
    new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });

/** 把串流內容切成多段位元組送出（每段可以切在 CRLF 中間），最後可選擇讓讀取失敗。 */
export const sseChunks =
  (pieces: readonly string[], failWith?: Error): Reply =>
  () => {
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = pieces[i];
        i += 1;
        if (piece !== undefined) controller.enqueue(encoder.encode(piece));
        else if (failWith !== undefined) controller.error(failWith);
        else controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

/** 標頭回了、第一段也送了，但之後永遠不結束。 */
export const sseThenHang =
  (first: string): Reply =>
  () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(first));
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

/** 永遠不回應，但遵守 signal（真的 fetch 的行為）。 */
export const hangUntilAborted: Reply = (signal) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('The operation was aborted'));
    });
  });

/** 永遠不回應，而且不理會 signal（用來確認 adapter 自己也會在 timeoutMs 結束）。 */
export const hangIgnoringSignal: Reply = () => new Promise<Response>(() => undefined);

/** fetch 本身丟出網路錯誤。 */
export const networkError =
  (message: string): Reply =>
  () =>
    Promise.reject(new TypeError(message));

/** 讓測試不連網：全域 fetch 換成一呼叫就失敗的函式，每個測試結束時確認呼叫次數是 0（AC-T15-12）。 */
export function installNoNetwork(): void {
  let globalFetchCalls = 0;
  beforeEach(() => {
    globalFetchCalls = 0;
    vi.stubGlobal('fetch', () => {
      globalFetchCalls += 1;
      return Promise.reject(new Error('real network is not allowed in tests'));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(globalFetchCalls).toBe(0);
  });
}
