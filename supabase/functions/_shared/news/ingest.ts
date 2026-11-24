// Finds today's article for one category (ARCHITECTURE §11.2 fallback step 1, §11.1.1, ADR-006 rev. 1).
// Everything outside this module is injected: fetch, clock, the DB "already used?" check (T-025 via _shared/db) and the
// LLM category_match judge (T-023). The article body stays in memory (CLAUDE.md §5 #7).
import { err, ok, type AppError, type NewsCategory, type Result } from '@english-coach/contracts';
import { htmlParagraphs, joinParagraphs, wordCount } from './html.ts';
import { getText, TIMEOUT_MS, type FetchKind, type FetchLike } from './http.ts';
import { extractPageBody } from './page-rules.ts';
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsRules } from './robots.ts';
import { parseRss, type RssItem } from './rss.ts';
import { unavailable, type Candidate, type NewsSource } from './types.ts';
import { isSameSite, normalizeArticleUrl, parseUrl } from './url.ts';

export const MIN_WORDS = 250;
/** At most this many candidates per source go to the LLM; category_match = false is not retried (§11.1.1 point 1). */
export const MAX_JUDGED_PER_SOURCE = 3;

export type NewsEvent =
  | { readonly type: 'source_failed'; readonly sourceId: string; readonly reason: string }
  | { readonly type: 'robots_disallowed'; readonly sourceId: string }
  | { readonly type: 'extract_failed'; readonly sourceId: string };

export type IngestDeps = {
  readonly fetch: FetchLike;
  readonly now: Date;
  readonly lookbackHours: number;
  /** true when the URL or the SHA-256 already exists in news_article. */
  readonly isUsed: (key: { readonly url: string; readonly sha256: string }) => Promise<Result<boolean, AppError>>;
  /** T-023 category_match: true when the article belongs to the category. */
  readonly judge: (candidate: Candidate) => Promise<Result<boolean, AppError>>;
  /** Counts only, never content (§11.1.1). */
  readonly log: (event: NewsEvent) => void;
  /** One cache per daily-prep run: each host's robots.txt is fetched once. */
  readonly robots: Map<string, RobotsRules>;
  readonly timeoutMs?: number;
};

export const isSponsored = (categories: readonly string[]): boolean =>
  categories.some((c) => {
    const v = c.trim().toLowerCase();
    return v === 'sponsored' || v.startsWith('sponsor');
  });

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Ctx = { readonly source: NewsSource; readonly deps: IngestDeps };

const get = (ctx: Ctx, url: string, kind: FetchKind) =>
  getText(url, kind, {
    fetch: ctx.deps.fetch,
    category: ctx.source.category,
    timeoutMs: ctx.deps.timeoutMs ?? TIMEOUT_MS,
    allowUrl: (u) => isSameSite(ctx.source.feedUrl, u),
  });

/** RFC 9309: 2xx → parse; 4xx → allow all; 5xx, timeout or any fetch failure → disallow all. Cached per host. */
async function robotsAllow(ctx: Ctx, target: string): Promise<boolean> {
  const url = parseUrl(target);
  if (url === null) return false;
  let rules = ctx.deps.robots.get(url.host);
  if (rules === undefined) {
    const r = await get(ctx, `${url.origin}/robots.txt`, 'robots');
    rules = !r.ok ? DISALLOW_ALL : r.value.status < 300 ? parseRobots(r.value.text) : r.value.status < 500 ? ALLOW_ALL : DISALLOW_ALL;
    ctx.deps.robots.set(url.host, rules);
  }
  return isAllowed(rules, `${url.pathname}${url.search}`);
}

const urlPatternOk = (pattern: string | null, url: string): boolean | null => {
  if (pattern === null) return true;
  try {
    return new RegExp(pattern).test(url);
  } catch {
    return null;
  }
};

/** Body text for one item: RSS body for rss_full; the same-site article page (robots-checked) for rss_then_page. */
async function bodyOf(ctx: Ctx, item: RssItem, url: string): Promise<string | null> {
  if (ctx.source.fetchMode === 'rss_full') return joinParagraphs(htmlParagraphs(item.bodyHtml, null));
  if (!isSameSite(ctx.source.feedUrl, url)) return null;
  if (!(await robotsAllow(ctx, url))) {
    ctx.deps.log({ type: 'robots_disallowed', sourceId: ctx.source.id });
    return null;
  }
  const page = await get(ctx, url, 'page');
  const host = page.ok && page.value.status < 300 ? parseUrl(page.value.url)?.hostname : undefined;
  const body = page.ok && host !== undefined ? extractPageBody(page.value.text, host) : null;
  if (body === null) ctx.deps.log({ type: 'extract_failed', sourceId: ctx.source.id });
  return body;
}

type SourceResult = Result<Candidate | null, AppError>;

async function fromSource(ctx: Ctx): Promise<SourceResult> {
  const { source, deps } = ctx;
  const failed = (reason: string): SourceResult => {
    deps.log({ type: 'source_failed', sourceId: source.id, reason });
    return ok(null);
  };
  if (!(await robotsAllow(ctx, source.feedUrl))) return failed('robots');
  const feed = await get(ctx, source.feedUrl, 'feed');
  if (!feed.ok) return failed(feed.error.message);
  if (feed.value.status >= 300) return failed(`feed: http ${String(feed.value.status)}`);
  const parsed = parseRss(feed.value.text, source.category);
  if (!parsed.ok) return failed(parsed.error.message);
  const cutoff = deps.now.getTime() - deps.lookbackHours * 3_600_000;
  const items = parsed.value
    .filter((i) => i.publishedAt.getTime() >= cutoff && !isSponsored(i.categories))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  let judged = 0;
  for (const item of items) {
    const url = normalizeArticleUrl(item.link);
    if (url === null) continue;
    const patternOk = urlPatternOk(source.includeUrlPattern, url);
    if (patternOk === null) return failed('bad include_url_pattern');
    if (!patternOk) continue;
    const body = await bodyOf(ctx, item, url);
    if (body === null) continue;
    const words = wordCount(body);
    if (words < MIN_WORDS) continue;
    const sha256 = await sha256Hex(body);
    const used = await deps.isUsed({ url, sha256 });
    if (!used.ok) return used;
    if (used.value) continue;
    const candidate: Candidate = {
      sourceId: source.id,
      category: source.category,
      url,
      title: item.title,
      publishedAt: item.publishedAt,
      body,
      sha256,
      wordCount: words,
    };
    const match = await deps.judge(candidate);
    if (!match.ok) return match;
    if (match.value) return ok(candidate);
    judged += 1;
    if (judged >= MAX_JUDGED_PER_SOURCE) return ok(null);
  }
  return ok(null);
}

/**
 * Tries the enabled sources of `category` by priority 1 → 2 → 3 and returns the first accepted article.
 * A failing source (HTTP error, timeout, robots, bad feed) counts as "no news" and the next source is tried.
 * No source has one → err(news_unavailable) so daily-prep moves on to the next category (§11.2 step 2).
 * Errors from isUsed／judge (DB, provider) are returned as they are.
 */
export async function findArticle(
  category: NewsCategory,
  sources: readonly NewsSource[],
  deps: IngestDeps,
): Promise<Result<Candidate, AppError>> {
  const ordered = sources.filter((s) => s.enabled && s.category === category).sort((a, b) => a.priority - b.priority);
  for (const source of ordered) {
    const r = await fromSource({ source, deps });
    if (!r.ok) return r;
    if (r.value !== null) return ok(r.value);
  }
  return err(unavailable(category, 'no source had a usable article'));
}
