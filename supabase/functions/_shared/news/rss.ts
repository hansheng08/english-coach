// Minimal RSS 2.0 reader (ARCHITECTURE §11.1.1 point 4). Pure: string in, Result out; no DOM or Deno API.
import { err, ok, type NewsCategory, type Result } from '@english-coach/contracts';
import { decodeXmlEntities } from './html.ts';
import { unavailable, type NewsUnavailable } from './types.ts';

export type RssItem = {
  readonly title: string;
  readonly link: string;
  readonly publishedAt: Date;
  readonly categories: readonly string[];
  /** Longest <content:encoded>, else <description>, else ''. Still HTML. */
  readonly bodyHtml: string;
};

export const MAX_ITEMS = 100;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RFC822 =
  /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:([+-])(\d{2})(\d{2})|GMT|UTC|UT|Z)$/;

/** RFC 822 date as used by RSS 2.0 (numeric offset or GMT／UT／UTC／Z). Anything else → null (the item is skipped). */
export function parseRfc822(raw: string): Date | null {
  const m = RFC822.exec(raw.trim());
  if (m === null) return null;
  const [, d, mon, y, hh, mm, ss, sign, oh, om] = m;
  const month = MONTHS.indexOf((mon ?? '').toLowerCase());
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  const second = Number(ss ?? '0');
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  const offsetMin = sign === undefined ? 0 : (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const midnight = Date.UTC(Number(y), month, day);
  if (new Date(midnight).getUTCDate() !== day) return null; // e.g. 31 Feb
  return new Date(midnight + ((hour * 60 + minute) * 60 + second) * 1000 - offsetMin * 60_000);
}

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const MARK = '\u0000';

/** Text of an element: CDATA kept as is, everything else XML-entity-decoded. */
const textOf = (inner: string, cdata: readonly string[]): string =>
  inner
    .split(new RegExp(`${MARK}(\\d+)${MARK}`))
    .map((part, i) => (i % 2 === 1 ? (cdata[Number(part)] ?? '') : decodeXmlEntities(part)))
    .join('');

const elements = (xml: string, tag: string): string[] => {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}\\s*>)`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1] ?? '');
};

/** Parses an RSS 2.0 feed (UTF-8 only). DOCTYPE／ENTITY declarations are dropped and never expanded. */
export function parseRss(xml: string, category: NewsCategory): Result<RssItem[], NewsUnavailable> {
  const decl = /^﻿?\s*<\?xml\b([^?]*)\?>/.exec(xml);
  const encoding = decl === null ? null : /\bencoding\s*=\s*["']([^"']+)["']/i.exec(decl[1] ?? '');
  if (encoding !== null && encoding[1]?.toLowerCase() !== 'utf-8') return err(unavailable(category, 'rss: not utf-8'));
  const cdata: string[] = [];
  const body = xml
    .replace(CDATA, (_m, inner: string) => `${MARK}${String(cdata.push(inner) - 1)}${MARK}`)
    .replace(/<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  if (!/<rss\b[^>]*\bversion\s*=\s*["']2\.0["']/.test(body)) return err(unavailable(category, 'rss: not rss 2.0'));
  const items: RssItem[] = [];
  for (const inner of elements(body, 'item').slice(0, MAX_ITEMS)) {
    const one = (tag: string): string => textOf(elements(inner, tag)[0] ?? '', cdata).trim();
    const publishedAt = parseRfc822(one('pubDate'));
    const title = one('title').replace(/\s+/g, ' ');
    const link = one('link');
    if (publishedAt === null || title === '' || link === '') continue;
    const encoded = elements(inner, 'content:encoded').map((e) => textOf(e, cdata));
    const longest = encoded.reduce((a, b) => (b.length > a.length ? b : a), '');
    items.push({
      title,
      link,
      publishedAt,
      categories: elements(inner, 'category').map((e) => textOf(e, cdata).trim()),
      bodyHtml: longest !== '' ? longest : textOf(elements(inner, 'description')[0] ?? '', cdata),
    });
  }
  return ok(items);
}
