import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, decodeXmlEntities, htmlParagraphs, joinParagraphs, wordCount } from './html.ts';
import { extractPageBody } from './page-rules.ts';
import { isAllowed, parseRobots } from './robots.ts';
import { MAX_ITEMS, parseRfc822, parseRss } from './rss.ts';
import { FEEDS, INFOQ_PAGE, SILICONANGLE_PAGE, paras, prose, wpFeed } from './test/fixtures.ts';
import { isSameSite, normalizeArticleUrl } from './url.ts';

const text = (html: string): string => joinParagraphs(htmlParagraphs(html, null));

describe('RSS 2.0 reader (ARCHITECTURE §11.1.1 point 4)', () => {
  it('(AC-T22-1) reads all 9 recorded feed structures; the longest content:encoded wins; InfoQ description is entity-escaped HTML', () => {
    const counts = Object.values(FEEDS).map((f) => expectOk(parseRss(f.xml, 'ai')).length);
    expect(counts).toEqual([2, 1, 1, 1, 1, 1, 1, 1, 1]);
    const [, agents] = expectOk(parseRss(FEEDS.tnsAi.xml, 'ai'));
    expect(agents?.title).toBe('Agents learn to share a test lab’s tools');
    expect(agents?.categories).toEqual(['AI', 'AI Agents']);
    expect(agents?.publishedAt.toISOString()).toBe('2026-11-24T08:00:00.000Z');
    expect(wordCount(text(agents?.bodyHtml ?? ''))).toBe(300);
    const [infoq] = expectOk(parseRss(FEEDS.infoq.xml, 'software'));
    expect(infoq?.link).toBe(
      'https://www.infoq.com/news/2026/11/sample-mesh/?utm_campaign=infoq_content&utm_source=infoq&utm_medium=feed&utm_term=global',
    );
    expect(infoq?.publishedAt.toISOString()).toBe('2026-11-24T10:00:00.000Z');
    expect(text(infoq?.bodyHtml ?? '')).toBe(prose(45));
    const [digest] = expectOk(parseRss(FEEDS.semiDigest.xml, 'semiconductor'));
    expect(digest?.link).toContain('/sample-fab-expansion/?utm_source=rss&utm_medium=rss&');
    const [sd] = expectOk(parseRss(FEEDS.sdTimes.xml, 'software'));
    expect(wordCount(text(sd?.bodyHtml ?? ''))).toBe(280); // <li> key takeaways are not <p>
  });

  it('(AC-T22-1) CDATA with "]]", unknown and DOCTYPE entities stay literal; non-RSS-2.0 or non-UTF-8 feeds fail; bad dates are skipped; at most 100 items', () => {
    const item = (title: string, pubDate: string, body: string) => ({ title, link: 'https://thenewstack.io/x/', pubDate, categories: [], description: '', encoded: [body] });
    const [one] = expectOk(parseRss(wpFeed([item('A &amp; B &foo;', 'Tue, 24 Nov 2026 08:00:00 +0000', '<p>x ]] y &lt;</p>')]), 'ai'));
    expect(one?.title).toBe('A & B &foo;');
    expect(one?.bodyHtml).toBe('<p>x ]] y &lt;</p>');
    const twoEncoded = wpFeed([{ ...item('lede first', 'Tue, 24 Nov 2026 08:00:00 +0000', 'Short lede.'), encoded: ['Short lede.', paras(2, 10)] }]);
    expect(expectOk(parseRss(twoEncoded, 'ai'))[0]?.bodyHtml).toBe(paras(2, 10));
    const doctype = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE rss [\n<!ENTITY xxe SYSTEM "file:///etc/passwd">\n<!ENTITY lol "lol">\n]>\n<rss version="2.0"><channel><item><title>T &xxe; &lol;</title><link>https://thenewstack.io/y/</link><pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
    expect(expectOk(parseRss(doctype, 'ai'))[0]?.title).toBe('T &xxe; &lol;');
    expect(expectErr(parseRss('<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', 'ai')).message).toBe('rss: not rss 2.0');
    expect(expectErr(parseRss('<rdf:RDF><channel></channel></rdf:RDF>', 'ai')).kind).toBe('news_unavailable');
    expect(expectErr(parseRss('<?xml version="1.0" encoding="ISO-8859-1"?><rss version="2.0"></rss>', 'software'))).toEqual({
      kind: 'news_unavailable',
      category: 'software',
      message: 'rss: not utf-8',
    });
    const dates = ['Tue, 24 Nov 2026 08:00:00 +0800', '2026-11-24T08:00:00Z', 'Mon, 31 Feb 2026 08:00:00 GMT', '24 Nov 2026 08:00 -0130'];
    expect(dates.map((d) => parseRfc822(d)?.toISOString() ?? null)).toEqual(['2026-11-24T00:00:00.000Z', null, null, '2026-11-24T09:30:00.000Z']);
    expect(expectOk(parseRss(wpFeed(dates.map((d, i) => item(`t${String(i)}`, d, ''))), 'ai')).map((i) => i.title)).toEqual(['t0', 't3']);
    const many = wpFeed(Array.from({ length: 120 }, (_, i) => item(`n${String(i)}`, 'Tue, 24 Nov 2026 08:00:00 GMT', '')));
    expect(expectOk(parseRss(many, 'ai'))).toHaveLength(MAX_ITEMS);
  });
});

describe('HTML to text and page containers (ARCHITECTURE §11.1.1 point 4)', () => {
  it('(AC-T22-2) only <p> text; script／style／noscript dropped; nested tags, void elements, the fixed entity list, NFC and word count', () => {
    const html = `<div><p>One <b>bold</b><br>line</p><script>var p = "<p>no</p>";</script><style>p{}</style><noscript><p>no</p></noscript>
<div><div><p>Two &amp; &hellip; &#8217; &#x2014; &rsquo;&nbsp;&bogus; &#xD800;</p></div></div><img src="x"><p>Café</p><li>not a paragraph</li><p>   </p>`;
    expect(htmlParagraphs(html, null)).toEqual(['One bold line', 'Two & … ’ — ’ &bogus; &#xD800;', 'Café']);
    expect(decodeXmlEntities('&amp;&lt;&gt;&quot;&apos;&#65;&#x42;&nbsp;&hellip;')).toBe('&<>"\'AB&nbsp;&hellip;');
    expect(decodeHtmlEntities('&copy;&reg;&trade;&ldquo;&rdquo;&lsquo;&ndash;&mdash;')).toBe('©®™“”‘–—');
    expect(wordCount(joinParagraphs([prose(120), prose(130)]))).toBe(250);
    expect(htmlParagraphs(paras(3, 5), 'missing')).toEqual([]);
  });

  it('(AC-T22-2) SiliconANGLE and InfoQ use the host container only; no container or no rule → null (never the whole page)', () => {
    const sa = extractPageBody(SILICONANGLE_PAGE, 'siliconangle.com');
    expect(sa?.split('\n\n')).toHaveLength(6);
    expect(sa?.startsWith(`${prose(50)} linked\n\n`)).toBe(true);
    expect(wordCount(sa ?? '')).toBe(276);
    expect(sa).not.toMatch(/Log in|cookies|copyright|Enable JavaScript/);
    const iq = extractPageBody(INFOQ_PAGE, 'www.infoq.com');
    expect(iq?.split('\n\n').slice(-1)).toEqual(['Café and café — &unknown; done']);
    expect(iq).not.toMatch(/Homepage|newsletter|Listen|not text|0:00/);
    expect(wordCount(iq ?? '')).toBe(286);
    expect(extractPageBody(SILICONANGLE_PAGE.replaceAll('single-post-content', 'post-body'), 'siliconangle.com')).toBeNull();
    expect(extractPageBody(INFOQ_PAGE, 'infoq.com')).toBeNull();
    expect(extractPageBody(INFOQ_PAGE, 'thenewstack.io')).toBeNull();
  });
});

describe('URLs and robots.txt (ARCHITECTURE §11.1.1 points 3, 4)', () => {
  it('(AC-T22-3) normalisation drops utm_* and #…, keeps other parameters in order, https only; pages must be on the feed site', () => {
    expect(normalizeArticleUrl('https://WWW.InfoQ.com/news/a/?utm_campaign=x&id=7&UTM_source=y&b=2#top')).toBe('https://www.infoq.com/news/a/?id=7&b=2');
    expect(normalizeArticleUrl('https://www.infoq.com/news/a/?utm_campaign=x&utm_term=global')).toBe('https://www.infoq.com/news/a/');
    expect(normalizeArticleUrl('https://siliconangle.com/a/?q=a%20b&x=')).toBe('https://siliconangle.com/a/?q=a%20b&x=');
    expect(['http://thenewstack.io/a/', 'ftp://x.io/a', 'not a url', 'https://u:p@thenewstack.io/a/'].map(normalizeArticleUrl)).toEqual([null, null, null, null]);
    const feed = 'https://feed.infoq.com/';
    expect(
      ['https://www.infoq.com/news/a/', 'https://infoq.com/a', 'https://feed.infoq.com/x', 'https://evil-infoq.com/a', 'https://infoq.com.evil.io/a', 'http://www.infoq.com/a'].map(
        (u) => isSameSite(feed, u),
      ),
    ).toEqual([true, true, true, false, false, false]);
    expect(isSameSite('https://siliconangle.com/category/ai/feed/', 'https://siliconangle.com/2026/11/24/x/')).toBe(true);
  });

  it('(AC-T22-4) RFC 9309: own group before *, longest match wins, Allow wins a tie, * and $ patterns, empty Disallow allows', () => {
    const txt = [
      'User-agent: *',
      'Disallow: /private/',
      'Allow: /private/open/',
      '',
      'User-agent: GPTBot',
      'User-agent: English-Coach',
      'Disallow: /drafts/',
      'Allow: /drafts/$',
      'Disallow: /*.pdf$',
      'Disallow: /tie',
      'Allow: /tie',
      '# comment',
      'Disallow: /x*/y # trailing comment',
    ].join('\n');
    const own = parseRobots(txt);
    const check = (paths: string[]) => paths.map((p) => isAllowed(own, p));
    expect(check(['/private/a', '/drafts/a', '/drafts/', '/a/b.pdf', '/a/b.pdf?x', '/tie', '/xa/y/z', '/x/z'])).toEqual([true, false, true, false, true, true, false, true]);
    const star = parseRobots(txt, 'other-bot');
    expect(['/private/a', '/private/open/a', '/drafts/a'].map((p) => isAllowed(star, p))).toEqual([false, true, true]);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:\n'), '/any')).toBe(true);
    expect(isAllowed(parseRobots(''), '/any')).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /\n'), '/any')).toBe(false);
  });
});
