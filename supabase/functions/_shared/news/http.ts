// The only network code of _shared/news. `fetch` is always injected (tests pass recorded fixtures; daily-prep passes
// globalThis.fetch). Guards from ARCHITECTURE §11.1.1 point 4: timeout, streamed size limit, content-type, manual redirects.
import { err, ok, type NewsCategory, type Result } from '@english-coach/contracts';
import { unavailable, type NewsUnavailable } from './types.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type FetchKind = 'feed' | 'page' | 'robots';

export const USER_AGENT = 'english-coach personal reader';
export const TIMEOUT_MS = 10_000;
export const MAX_BYTES: Readonly<Record<FetchKind, number>> = { feed: 2 * 1024 * 1024, page: 1024 * 1024, robots: 256 * 1024 };
export const MAX_REDIRECTS = 3;

export type HttpText = { readonly status: number; readonly url: string; readonly text: string };

export type HttpOptions = {
  readonly fetch: FetchLike;
  readonly category: NewsCategory;
  readonly timeoutMs: number;
  /** Checked for the first URL and again for every redirect target (§7: only news_source URLs). */
  readonly allowUrl: (url: string) => boolean;
};

const contentTypeOk = (kind: FetchKind, type: string | null): boolean => {
  if (kind === 'robots') return true;
  const t = (type ?? '').toLowerCase();
  return kind === 'feed' ? t.includes('xml') || t.includes('rss') : t.includes('html');
};

async function readLimited(res: Response, limit: number): Promise<Uint8Array | null> {
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(r.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const discard = async (res: Response): Promise<void> => {
  await res.body?.cancel().catch(() => undefined);
};

/**
 * GET with our User-Agent. 2xx → ok({ status, url, text }); other final statuses → ok with text ''.
 * Network error, timeout, body over the limit, non-UTF-8 body, wrong content-type, or a redirect that leaves the allowed
 * URLs (or more than 3 redirects) → err(news_unavailable) with a short reason code.
 */
export async function getText(url: string, kind: FetchKind, o: HttpOptions): Promise<Result<HttpText, NewsUnavailable>> {
  const signal = AbortSignal.timeout(o.timeoutMs);
  const fail = (reason: string): Result<HttpText, NewsUnavailable> =>
    err(unavailable(o.category, `${kind}: ${signal.aborted ? 'timeout' : reason}`));
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!o.allowUrl(current)) return fail('url not allowed');
    let res: Response;
    try {
      res = await o.fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: kind === 'feed' ? 'application/rss+xml, application/xml' : '*/*' },
      });
    } catch {
      return fail('network');
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await discard(res);
      if (location === null) return fail('redirect without location');
      try {
        current = new URL(location, current).toString();
      } catch {
        return fail('bad redirect');
      }
      continue;
    }
    if (res.type === 'opaqueredirect' || res.status === 0) return fail('opaque redirect');
    if (res.status < 200 || res.status >= 300) {
      await discard(res);
      return ok({ status: res.status, url: current, text: '' });
    }
    if (!contentTypeOk(kind, res.headers.get('content-type'))) {
      await discard(res);
      return fail('content-type');
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readLimited(res, MAX_BYTES[kind]);
    } catch {
      return fail('network');
    }
    if (bytes === null) return fail('too large');
    try {
      return ok({ status: res.status, url: current, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
    } catch {
      return fail('not utf-8');
    }
  }
  return fail('too many redirects');
}
