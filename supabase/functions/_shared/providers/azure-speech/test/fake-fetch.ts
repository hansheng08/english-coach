import { parseWav16kMono, type Wav16kMono } from '@english-coach/contracts';
import { expectOk } from '@english-coach/contracts/testing';

export type FetchCall = {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Headers;
  /** 請求內容原樣（字串或位元組）。 */
  readonly body: unknown;
  readonly signal: AbortSignal | null | undefined;
};

export type Reply = (signal: AbortSignal | null | undefined) => Response | Promise<Response>;

/** 依序回覆；回覆用完還被呼叫就丟出（讓多呼叫的 bug 直接失敗）。 */
export function fakeFetch(...replies: readonly Reply[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body,
      signal: init?.signal,
    });
    const reply = replies[calls.length - 1];
    if (reply === undefined) throw new Error(`unexpected fetch call #${String(calls.length)}`);
    return Promise.resolve(reply(init?.signal));
  };
  return { fetch: impl, calls };
}

export const text =
  (status: number, body: string, headers: Record<string, string> = {}): Reply =>
  () =>
    new Response(body, { status, headers });

export const bytes =
  (status: number, size: number): Reply =>
  () =>
    new Response(new Uint8Array(size).fill(1), { status });

/** 永遠不回應，但遵守 signal（真的 fetch 的行為）。 */
export const hangUntilAborted: Reply = (signal) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('The operation was aborted'));
    });
  });

/** 永遠不回應，而且不理會 signal。 */
export const hangIgnoringSignal: Reply = () => new Promise<Response>(() => undefined);

/** 標頭回了，但內容永遠讀不完（也不理會 signal）。 */
export const hangBody: Reply = () =>
  new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 });

export const networkError =
  (message: string): Reply =>
  () =>
    Promise.reject(new TypeError(message));

/** 16 kHz、16-bit、單聲道的 WAV（少量靜音樣本），經 parseWav16kMono 得到 Wav16kMono。 */
export function makeWav(samples = 160): Wav16kMono {
  const dataSize = samples * 2;
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);
  const tag = (offset: number, s: string): void => {
    for (let i = 0; i < 4; i += 1) buf[offset + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, dataSize, true);
  return expectOk(parseWav16kMono(buf));
}
