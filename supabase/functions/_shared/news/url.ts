// URL normalisation and the same-site rule for article pages (ARCHITECTURE §11.1.1 point 3).

/** `new URL` without the exception. */
export const parseUrl = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

/**
 * https only; host lower-cased (URL does this); `#…` dropped; every `utm_*` query parameter dropped; the other parameters
 * keep their order and their original encoding. Returns null when the URL is not usable.
 */
export function normalizeArticleUrl(raw: string): string | null {
  const url = parseUrl(raw.trim());
  if (url === null || url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((p) => p !== '' && !p.toLowerCase().startsWith('utm_'));
  url.hash = '';
  url.search = kept.length === 0 ? '' : `?${kept.join('&')}`;
  return url.toString();
}

/** feed host minus a leading `www.` or `feed.` (e.g. feed.infoq.com → infoq.com). */
const siteOf = (host: string): string => host.replace(/^(www|feed)\./, '');

/** A page may be fetched only when it is https and its host is the feed's site or a subdomain of it. */
export function isSameSite(feedUrl: string, pageUrl: string): boolean {
  const feed = parseUrl(feedUrl);
  const page = parseUrl(pageUrl);
  if (feed === null || page === null || page.protocol !== 'https:' || page.username !== '' || page.password !== '') return false;
  const site = siteOf(feed.hostname);
  return page.hostname === site || page.hostname.endsWith(`.${site}`);
}
