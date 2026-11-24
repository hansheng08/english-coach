// Recorded structure samples (ARCHITECTURE §11.1.1 point 4 "測試樣本"). The tag structure of each feed／page follows
// the 2026-11-24 recording; every title and body below is our own text, so no original article text is in the repo.

const WORDS = 'our test lab wrote this sample sentence to check how the news reader counts and keeps plain words'.split(' ');

/** `n` words of our own text, as one paragraph string. */
export const prose = (n: number, offset = 0): string =>
  Array.from({ length: n }, (_, i) => WORDS[(i + offset) % WORDS.length] ?? 'word').join(' ');

/** `count` <p> paragraphs of `each` words. */
export const paras = (count: number, each: number): string =>
  Array.from({ length: count }, (_, i) => `<p>${prose(each, i)}</p>`).join('\n');

const WP_HEAD = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"
  xmlns:slash="http://purl.org/rss/1.0/modules/slash/"
  >
<channel>
  <title>Sample feed</title>
  <atom:link href="https://example.invalid/feed/" rel="self" type="application/rss+xml" />
  <link>https://example.invalid</link>
  <description>Sample</description>`;

export type WpItem = {
  readonly title: string;
  readonly link: string;
  readonly pubDate: string;
  readonly categories: readonly string[];
  readonly description: string;
  /** WordPress puts these in CDATA; The New Stack has 2 (full text first, a short lede second). */
  readonly encoded: readonly string[];
};

const wpItem = (i: WpItem): string => `
  <item>
    <title>${i.title}</title>
    <link>${i.link}</link>
    <dc:creator><![CDATA[Sample Author]]></dc:creator>
    <pubDate>${i.pubDate}</pubDate>
${i.categories.map((c) => `    <category><![CDATA[${c}]]></category>`).join('\n')}
    <guid isPermaLink="false">${i.link}</guid>
          <description><![CDATA[${i.description}]]></description>
${i.encoded.map((e) => `    <content:encoded><![CDATA[${e}]]></content:encoded>`).join('\n')}
  </item>`;

/** WordPress-style feed (The New Stack, SiliconANGLE, MarkTechPost, SD Times, Semiconductor Engineering, eeNews Europe, Semiconductor Digest). */
export const wpFeed = (items: readonly WpItem[]): string => `${WP_HEAD}${items.map(wpItem).join('')}
</channel>
</rss>
`;

/** InfoQ style: no CDATA, entity-escaped HTML in <description>, utm_* links, GMT dates. */
export const infoqFeed = (items: readonly { title: string; path: string; pubDate: string; summary: string }[]): string => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>InfoQ</title>
    <link>https://www.infoq.com</link>
    <description>InfoQ feed</description>
${items
  .map(
    (i) => `    <item>
      <title>${i.title}</title>
      <link>https://www.infoq.com${i.path}?utm_campaign=infoq_content&amp;utm_source=infoq&amp;utm_medium=feed&amp;utm_term=global</link>
      <description>&lt;img src="https://res.infoq.com${i.path}en/headerimage/x.jpg"/&gt;&lt;p&gt;${i.summary}&lt;/p&gt;</description>
      <category>DevOps</category>
      <category>news</category>
      <pubDate>${i.pubDate}</pubDate>
      <guid>https://www.infoq.com${i.path}?utm_campaign=infoq_content&amp;utm_source=infoq&amp;utm_medium=feed&amp;utm_term=global</guid>
      <dc:creator>Sample Author</dc:creator>
    </item>`,
  )
  .join('\n')}
  </channel>
</rss>
`;

const NOW = 'Tue, 24 Nov 2026 12:00:00 +0000';
const EARLIER = 'Tue, 24 Nov 2026 08:00:00 +0000';
const OLD = 'Fri, 20 Nov 2026 08:00:00 +0000';
export const FIXTURE_NOW = new Date('2026-11-24T13:00:00Z');

/** The 9 feeds of ARCHITECTURE §11.1 (same URLs as the seed migration). */
export const FEEDS = {
  tnsAi: {
    url: 'https://thenewstack.io/ai/feed/',
    xml: wpFeed([
      {
        title: 'Sponsored post about a product',
        link: 'https://thenewstack.io/sponsored-sample/',
        pubDate: NOW,
        categories: ['AI', 'sponsor-sample'],
        description: 'Short lede.',
        encoded: [paras(6, 60), 'Short lede.'],
      },
      {
        title: 'Agents learn to share a test lab&#8217;s tools',
        link: 'https://thenewstack.io/agents-share-tools/',
        pubDate: EARLIER,
        categories: ['AI', 'AI Agents'],
        description: 'Short lede.',
        encoded: [`<img width="1024" height="538" src="https://cdn.thenewstack.io/x.png" />${paras(5, 60)}`, 'Short lede.'],
      },
    ]),
  },
  siliconAngle: {
    url: 'https://siliconangle.com/category/ai/feed/',
    xml: wpFeed([
      {
        title: 'Startup ships a sample chip compiler',
        link: 'https://siliconangle.com/2026/11/24/sample-chip-compiler/',
        pubDate: EARLIER,
        categories: ['AI', 'NEWS'],
        description: `<p>${prose(75)}</p>`,
        encoded: [],
      },
    ]),
  },
  marktechpost: {
    url: 'https://www.marktechpost.com/feed/',
    xml: wpFeed([
      {
        title: 'A sample model release',
        link: 'https://www.marktechpost.com/2026/11/24/sample-model-release/',
        pubDate: EARLIER,
        categories: ['AI Agents', 'Tech News'],
        description: prose(40),
        encoded: [`\n<p class="wp-block-paragraph">${prose(300)}</p>`],
      },
    ]),
  },
  sdTimes: {
    url: 'https://sdtimes.com/feed/',
    xml: wpFeed([
      {
        title: 'Sample build tool news',
        link: 'https://sdtimes.com/devops/sample-build-tool/',
        pubDate: EARLIER,
        categories: ['DevOps'],
        description: `<p>${prose(30)}</p>`,
        encoded: [`<h5><b>Key takeaways</b></h5>\n<ul>\n<li style="font-weight: 400">${prose(20)}</li>\n</ul>\n${paras(4, 70)}`],
      },
    ]),
  },
  infoq: {
    url: 'https://feed.infoq.com/',
    xml: infoqFeed([
      { title: 'Sample service mesh news', path: '/news/2026/11/sample-mesh/', pubDate: 'Tue, 24 Nov 2026 10:00:00 GMT', summary: prose(45) },
    ]),
  },
  tnsAll: {
    url: 'https://thenewstack.io/feed/',
    xml: wpFeed([
      {
        title: 'Sample platform team story',
        link: 'https://thenewstack.io/sample-platform-team/',
        pubDate: EARLIER,
        categories: ['Platform Engineering', 'AI Engineering'],
        description: 'Short lede.',
        encoded: [paras(5, 60), 'Short lede.'],
      },
    ]),
  },
  semiEngineering: {
    url: 'https://semiengineering.com/feed/',
    xml: wpFeed([
      {
        title: 'Sample chiplet test story',
        link: 'https://semiengineering.com/sample-chiplet-test/',
        pubDate: EARLIER,
        categories: ['Top Stories', 'EDA'],
        description: prose(30),
        encoded: [`<p><strong>Key Takeaways:</strong></p>\n<ul>\n<li>${prose(10)}</li>\n</ul>\n${paras(5, 60)}`],
      },
    ]),
  },
  eeNews: {
    url: 'https://www.eenewseurope.com/en/feed/',
    xml: wpFeed([
      {
        title: 'Sample edge module',
        link: 'https://www.eenewseurope.com/en/sample-edge-module/',
        pubDate: OLD,
        categories: ['AI', 'Edge AI'],
        description: `<p>${prose(30)}</p>`,
        encoded: [paras(5, 60)],
      },
    ]),
  },
  semiDigest: {
    url: 'https://www.semiconductor-digest.com/feed/',
    xml: wpFeed([
      {
        title: 'Sample fab expansion',
        link: 'https://www.semiconductor-digest.com/sample-fab-expansion/?utm_source=rss&#038;utm_medium=rss&#038;utm_campaign=sample-fab-expansion',
        pubDate: EARLIER,
        categories: ['Semiconductors'],
        description: prose(30),
        encoded: [paras(4, 70)],
      },
    ]),
  },
} as const;

/** SiliconANGLE page: an empty container first, the body container later; login／cookie／copyright <p> outside. */
export const SILICONANGLE_PAGE = `<!doctype html>
<html class="no-js" lang="en-US">
<head>
  <meta charset="UTF-8">
<script> var gform; </script>
<style>p { color: red; }</style>
</head>
<body>
<form class="login"><p>Log in to your account</p></form>
<div class="single-post-content">
    </div>
<div class="col-md-12 col-xs-12 sa-post-content">
        <div class="single-post-content"><p><span style="font-weight: 400">${prose(50)} </span><a href="https://example.invalid/"><span style="font-weight: 400">linked</span></a></p>
${paras(5, 45)}
<div class="ad"><noscript><p>Enable JavaScript</p></noscript></div>
</div>
</div>
<div class="cookie"><p>We use cookies on this site</p></div>
<footer><p>&copy; 2026 Sample copyright line</p></footer>
</body>
</html>
`;

/** InfoQ page: breadcrumbs and a newsletter box inside <article> but outside div.article__content. */
export const INFOQ_PAGE = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head><title>Sample</title></head>
<body>
<article>
<div class="breadcrumbs"><p>InfoQ Homepage News</p></div>
<div class="article__content">
      <div class="actions__left actions__sidebar article__actions">
<script type="application/javascript">
var playing = false; function ttsPlaying(p) { return "<p>not text</p>"; }
</script>
       <div id="audio-overlay" role="button"><span class="audio-overlay-main-text">Listen to this article -&nbsp; <span id="total-length">0:00</span></span></div>
      </div>
${paras(4, 70)}
<p>Caf&#233; and café &mdash; &unknown; done</p>
</div>
<div class="newsletter"><p>Subscribe to our newsletter</p></div>
</article>
</body>
</html>
`;

export const ROBOTS = {
  allowAll: 'User-agent: *\nDisallow:\n',
  tns: 'User-agent: *\nDisallow: /wp-admin/\nDisallow: /sponsors/\nAllow: /wp-admin/admin-ajax.php\n\nUser-agent: GPTBot\nDisallow: /\n',
} as const;

export type Route = { readonly status?: number; readonly type?: string; readonly body?: string | ReadableStream<Uint8Array>; readonly location?: string };

/** Injected fetch over a fixed route table; unknown URLs get 404. Records every call. */
export function fakeFetch(routes: Readonly<Record<string, Route>>): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const r = routes[url];
    const headers = new Headers();
    if (r?.type !== undefined) headers.set('content-type', r.type);
    if (r?.location !== undefined) headers.set('location', r.location);
    return Promise.resolve(new Response(r?.body ?? '', { status: r?.status ?? 404, headers }));
  };
  return { fetch, calls };
}

const RSS = 'application/rss+xml; charset=UTF-8';
const HTML = 'text/html; charset=UTF-8';

/** Every feed of FEEDS plus the 2 article pages; robots.txt falls back to 404 (= allow all). */
export const recordedWeb = (): Record<string, Route> => ({
  ...Object.fromEntries(Object.values(FEEDS).map((f) => [f.url, { status: 200, type: RSS, body: f.xml }])),
  'https://siliconangle.com/2026/11/24/sample-chip-compiler/': { status: 200, type: HTML, body: SILICONANGLE_PAGE },
  'https://www.infoq.com/news/2026/11/sample-mesh/': { status: 200, type: 'text/html;charset=utf-8', body: INFOQ_PAGE },
  'https://thenewstack.io/robots.txt': { status: 200, type: 'text/plain', body: ROBOTS.tns },
});
