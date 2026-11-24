import { err, ok, type AppError, type Result } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getText, MAX_BYTES, USER_AGENT, type HttpOptions } from './http.ts';
import { findArticle, isSponsored, MAX_JUDGED_PER_SOURCE, type IngestDeps, type NewsEvent } from './ingest.ts';
import type { RobotsRules } from './robots.ts';
import { FEEDS, FIXTURE_NOW, fakeFetch, paras, recordedWeb, wpFeed, type Route } from './test/fixtures.ts';
import type { Candidate, NewsSource } from './types.ts';

// Tests never use the network: every fetch is injected, and the global fetch is a spy that rejects.
const globalFetch = vi.fn(() => Promise.reject(new Error('global fetch must not be called')));
beforeEach(() => {
  vi.stubGlobal('fetch', globalFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalFetch.mockClear();
});

const source = (
  id: string,
  category: NewsSource['category'],
  priority: 1 | 2 | 3,
  feedUrl: string,
  fetchMode: NewsSource['fetchMode'] = 'rss_full',
): NewsSource => ({ id, name: id, feedUrl, category, priority, fetchMode, includeUrlPattern: null, enabled: true });

/** ARCHITECTURE §11.1 (same feeds as the seed migration). */
const SOURCES: NewsSource[] = [
  source('tns-ai', 'ai', 1, FEEDS.tnsAi.url),
  source('siliconangle', 'ai', 2, FEEDS.siliconAngle.url, 'rss_then_page'),
  source('marktechpost', 'ai', 3, FEEDS.marktechpost.url),
  source('sdtimes', 'software', 1, FEEDS.sdTimes.url),
  source('infoq', 'software', 2, FEEDS.infoq.url, 'rss_then_page'),
  source('tns-all', 'software', 3, FEEDS.tnsAll.url),
  source('semieng', 'semiconductor', 1, FEEDS.semiEngineering.url),
  source('eenews', 'semiconductor', 2, FEEDS.eeNews.url),
  source('semidigest', 'semiconductor', 3, FEEDS.semiDigest.url),
];

type Opts = { judge?: (c: Candidate) => Result<boolean, AppError>; used?: (url: string) => Result<boolean, AppError> };
const harness = (routes: Record<string, Route>, opts: Opts = {}) => {
  const web = fakeFetch(routes);
  const judged: Candidate[] = [];
  const events: NewsEvent[] = [];
  const deps: IngestDeps = {
    fetch: web.fetch,
    now: FIXTURE_NOW,
    lookbackHours: 48,
    isUsed: ({ url }) => Promise.resolve(opts.used?.(url) ?? ok(false)),
    judge: (c) => {
      judged.push(c);
      return Promise.resolve(opts.judge?.(c) ?? ok(true));
    },
    log: (e) => {
      events.push(e);
    },
    robots: new Map<string, RobotsRules>(),
    timeoutMs: 50,
  };
  return { deps, urls: () => web.calls.map((c) => c.url), web, judged, events };
};

const http = (fetch: HttpOptions['fetch'], allow = true): HttpOptions => ({ fetch, category: 'ai', timeoutMs: 50, allowUrl: () => allow });

describe('fetch guards (ARCHITECTURE §11.1.1 point 4)', () => {
  it('(AC-T22-5) sends our User-Agent with manual redirects; times out; aborts a streamed body over the limit; checks content-type and UTF-8', async () => {
    const web = fakeFetch({ 'https://thenewstack.io/ai/feed/': { status: 200, type: 'application/rss+xml', body: '<rss/>' } });
    expect(expectOk(await getText('https://thenewstack.io/ai/feed/', 'feed', http(web.fetch))).text).toBe('<rss/>');
    const init = web.calls[0]?.init;
    expect([new Headers(init?.headers).get('user-agent'), init?.redirect, init?.method]).toEqual([USER_AGENT, 'manual', 'GET']);
    const hang = (_url: string, i: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        i.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    expect(expectErr(await getText('https://thenewstack.io/ai/feed/', 'feed', http(hang))).message).toBe('feed: timeout');
    let pulled = 0;
    const chunk = new Uint8Array(256 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull: (c) => {
        pulled += 1;
        c.enqueue(chunk);
        if (pulled === 100) c.close();
      },
    });
    const big = fakeFetch({ 'https://x.io/p': { status: 200, type: 'text/html', body: stream } });
    expect(expectErr(await getText('https://x.io/p', 'page', http(big.fetch))).message).toBe('page: too large');
    expect(pulled).toBeLessThanOrEqual(MAX_BYTES.page / chunk.byteLength + 2);
    const routes: Record<string, Route> = {
      'https://x.io/json': { status: 200, type: 'application/json', body: '{}' },
      'https://x.io/none': { status: 200, body: '<rss/>' },
      'https://x.io/latin1': { status: 200, type: 'text/html', body: new ReadableStream({ start: (c) => { c.enqueue(new Uint8Array([0x63, 0x61, 0x66, 0xe9])); c.close(); } }) },
      'https://x.io/robots.txt': { status: 503, type: 'text/plain', body: 'busy' },
    };
    const misc = fakeFetch(routes);
    expect(expectErr(await getText('https://x.io/json', 'feed', http(misc.fetch))).message).toBe('feed: content-type');
    expect(expectErr(await getText('https://x.io/none', 'feed', http(misc.fetch))).message).toBe('feed: content-type');
    expect(expectErr(await getText('https://x.io/latin1', 'page', http(misc.fetch))).message).toBe('page: not utf-8');
    expect(expectOk(await getText('https://x.io/robots.txt', 'robots', http(misc.fetch)))).toEqual({ status: 503, url: 'https://x.io/robots.txt', text: '' });
    expect(expectErr(await getText('https://x.io/json', 'feed', http(misc.fetch, false))).message).toBe('feed: url not allowed');
  });

  it('(AC-T22-3) redirects: at most 3, each target re-checked; a redirect off the feed site is rejected before it is fetched', async () => {
    const hop = (n: number, to: string): [string, Route] => [`https://siliconangle.com/r${String(n)}`, { status: 301, location: to }];
    const web = fakeFetch(
      Object.fromEntries([
        hop(1, '/r2'),
        hop(2, 'https://siliconangle.com/r3'),
        hop(3, '/page'),
        hop(4, 'https://evil.example/page'),
        hop(5, '/r1'),
        ['https://siliconangle.com/page', { status: 200, type: 'text/html', body: '<p>ok</p>' }],
      ]),
    );
    const sameSite: HttpOptions = { ...http(web.fetch), allowUrl: (u) => new URL(u).hostname === 'siliconangle.com' };
    expect(expectOk(await getText('https://siliconangle.com/r1', 'page', sameSite)).url).toBe('https://siliconangle.com/page');
    expect(expectErr(await getText('https://siliconangle.com/r4', 'page', sameSite)).message).toBe('page: url not allowed');
    expect(expectErr(await getText('https://siliconangle.com/r5', 'page', sameSite)).message).toBe('page: too many redirects');
    expect(web.calls.map((c) => c.url)).not.toContain('https://evil.example/page');
  });
});

describe('findArticle (ARCHITECTURE §11.2 step 1, §11.1.1 points 1–3)', () => {
  it('(AC-T22-6) priority order: a failing primary falls back to the rss_then_page backup; utm_* removed; body only from the page container', async () => {
    const h = harness({ ...recordedWeb(), [FEEDS.tnsAi.url]: { status: 500, type: 'text/html', body: '' } });
    const a = expectOk(await findArticle('ai', SOURCES, h.deps));
    expect([a.sourceId, a.url, a.wordCount, a.sha256]).toEqual([
      'siliconangle',
      'https://siliconangle.com/2026/11/24/sample-chip-compiler/',
      276,
      a.sha256,
    ]);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.events).toEqual([{ type: 'source_failed', sourceId: 'tns-ai', reason: 'feed: http 500' }]);
    const s = harness(recordedWeb());
    const sw = expectOk(await findArticle('software', SOURCES.filter((x) => x.id !== 'sdtimes'), s.deps));
    expect([sw.sourceId, sw.url, sw.wordCount]).toEqual(['infoq', 'https://www.infoq.com/news/2026/11/sample-mesh/', 286]);
    expect(s.urls()).toContain('https://www.infoq.com/news/2026/11/sample-mesh/');
  });

  it('(AC-T22-6) sponsored, too old, under 250 words and already used are skipped before the LLM; at most 3 judged per source, no retry; nothing → news_unavailable', async () => {
    const h = harness(recordedWeb());
    const first = expectOk(await findArticle('ai', SOURCES, h.deps));
    expect([first.sourceId, first.title]).toEqual(['tns-ai', 'Agents learn to share a test lab’s tools']); // the newer item is sponsor-*
    expect([['Sponsored'], ['AI', ' SPONSORED '], ['sponsor-sample'], ['AI', 'Security']].map(isSponsored)).toEqual([true, true, true, false]);
    const semi = harness(recordedWeb(), { used: (u) => ok(u.includes('chiplet')) });
    expect(expectOk(await findArticle('semiconductor', SOURCES, semi.deps)).sourceId).toBe('semidigest'); // eeNews item is 4 days old
    const item = (n: number, words: number) => ({
      title: `n${String(n)}`,
      link: `https://thenewstack.io/n${String(n)}/`,
      pubDate: `Tue, 24 Nov 2026 0${String(n)}:00:00 +0000`,
      categories: ['AI'],
      description: '',
      encoded: [paras(1, words)],
    });
    const five = wpFeed([item(1, 260), item(2, 260), item(3, 249), item(4, 260), item(5, 260)]);
    const no = harness({ ...recordedWeb(), [FEEDS.tnsAi.url]: { status: 200, type: 'application/rss+xml', body: five } }, { judge: () => ok(false) });
    const sources = SOURCES.filter((x) => x.id === 'tns-ai' || x.id === 'marktechpost');
    expect(expectErr(await findArticle('ai', sources, no.deps))).toEqual({ kind: 'news_unavailable', category: 'ai', message: 'no source had a usable article' });
    expect(no.judged.map((c) => `${c.sourceId}:${c.title}`)).toEqual(['tns-ai:n5', 'tns-ai:n4', 'tns-ai:n2', 'marktechpost:A sample model release']);
    expect(MAX_JUDGED_PER_SOURCE).toBe(3);
    const off = harness(recordedWeb());
    expect(expectErr(await findArticle('ai', SOURCES.map((x) => ({ ...x, enabled: false })), off.deps)).kind).toBe('news_unavailable');
    expect(off.urls()).toEqual([]);
    const dbDown = harness(recordedWeb(), { used: () => err({ kind: 'db_failed', message: 'down' }) });
    expect(expectErr(await findArticle('ai', SOURCES, dbDown.deps))).toEqual({ kind: 'db_failed', message: 'down' });
  });

  it('(AC-T22-4) robots.txt: 4xx allows, 5xx disallows (next source), a disallowed path is skipped; each host is fetched once', async () => {
    const h = harness({ ...recordedWeb(), 'https://thenewstack.io/robots.txt': { status: 503, type: 'text/plain', body: '' } });
    expect(expectOk(await findArticle('ai', SOURCES, h.deps)).sourceId).toBe('siliconangle');
    expect(h.urls().filter((u) => u.startsWith('https://thenewstack.io/'))).toEqual(['https://thenewstack.io/robots.txt']);
    expect(h.events[0]).toEqual({ type: 'source_failed', sourceId: 'tns-ai', reason: 'robots' });
    const ban = harness({ ...recordedWeb(), 'https://siliconangle.com/robots.txt': { status: 200, type: 'text/plain', body: 'User-agent: english-coach\nDisallow: /2026/\n' } });
    const sa = SOURCES.filter((x) => x.id === 'siliconangle');
    expect(expectErr(await findArticle('ai', sa, ban.deps)).kind).toBe('news_unavailable');
    expect(ban.events).toEqual([{ type: 'robots_disallowed', sourceId: 'siliconangle' }]);
    expect(ban.urls()).toEqual(['https://siliconangle.com/robots.txt', FEEDS.siliconAngle.url]);
    const both = harness(recordedWeb(), { judge: () => ok(false) });
    expectErr(await findArticle('ai', SOURCES.filter((x) => x.id === 'tns-ai'), both.deps));
    expectErr(await findArticle('software', SOURCES.filter((x) => x.id === 'tns-all'), both.deps));
    expect(both.urls()).toEqual(['https://thenewstack.io/robots.txt', FEEDS.tnsAi.url, FEEDS.tnsAll.url]);
  });

  it('(AC-T22-7) no network: all 3 categories run on the recorded fixtures only; the global fetch is never called; off-site links are never fetched', async () => {
    const offsite = wpFeed([{ title: 'Off site', link: 'https://elsewhere.example/a/', pubDate: 'Tue, 24 Nov 2026 11:00:00 +0000', categories: [], description: '<p>x</p>', encoded: [] }]);
    const h = harness({ ...recordedWeb(), [FEEDS.siliconAngle.url]: { status: 200, type: 'application/rss+xml', body: offsite } }, { judge: (c) => ok(c.sourceId !== 'tns-ai') });
    const picked: string[] = [];
    for (const category of ['ai', 'software', 'semiconductor'] as const) {
      const r = await findArticle(category, SOURCES, h.deps);
      picked.push(r.ok ? r.value.sourceId : r.error.message);
    }
    expect(globalFetch.mock.calls.length).toBe(0);
    expect(picked).toEqual(['marktechpost', 'sdtimes', 'semieng']);
    const known = new Set([...Object.keys(recordedWeb()), 'https://siliconangle.com/robots.txt', 'https://www.marktechpost.com/robots.txt', 'https://sdtimes.com/robots.txt', 'https://semiengineering.com/robots.txt']);
    expect(h.urls().filter((u) => !known.has(u))).toEqual([]);
    expect(h.urls()).not.toContain('https://elsewhere.example/a/');
  });
});
