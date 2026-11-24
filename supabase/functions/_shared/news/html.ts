// HTML → plain text for news bodies (ARCHITECTURE §11.1.1 point 4). Pure functions; no DOM or Deno API.

/** The fixed list of named entities we decode (§11.1.1); any other named entity is kept as written. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};
/** XML only predefines these five (plus numeric references). */
const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

const codePoint = (raw: string, cp: number): string =>
  Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : raw;

function decode(s: string, allowed: (name: string) => boolean): string {
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (raw, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return codePoint(raw, Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return codePoint(raw, Number.parseInt(body.slice(1), 10));
    const value = NAMED_ENTITIES[body];
    return value !== undefined && allowed(body) ? value : raw;
  });
}

/** Decodes XML's 5 predefined entities and numeric references (text outside CDATA). */
export const decodeXmlEntities = (s: string): string => decode(s, (name) => XML_ENTITIES.has(name));
/** Decodes numeric references and the fixed named list; unknown entities stay as written. */
export const decodeHtmlEntities = (s: string): string => decode(s, () => true);

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const SKIP = new Set(['script', 'style', 'noscript']);
/** Block-level tags that implicitly end an open <p>. */
const BLOCK = new Set(['p', 'div', 'ul', 'ol', 'li', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article', 'figure', 'header', 'footer', 'pre', 'form', 'aside', 'nav']);

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

const hasClass = (attrs: string, cls: string): boolean => {
  const m = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const value = m?.[1] ?? m?.[2] ?? '';
  return value.split(/\s+/).includes(cls);
};

/** Normalises one paragraph: decode entities, collapse whitespace (incl. NBSP), trim, NFC. */
const cleanParagraph = (raw: string): string => decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim().normalize('NFC');

/**
 * Returns the text of every <p> (in document order). With `containerClass`, only <p> inside an element whose class list
 * contains that token count; nested containers are not counted twice. <script>/<style>/<noscript> content is dropped.
 */
export function htmlParagraphs(html: string, containerClass: string | null): string[] {
  const stack: { name: string; container: boolean }[] = [];
  const out: string[] = [];
  let containerDepth = 0;
  let para: string | null = null;
  let last = 0;
  const flush = (): void => {
    if (para !== null) {
      const text = cleanParagraph(para);
      if (text !== '') out.push(text);
      para = null;
    }
  };
  const inScope = (): boolean => containerClass === null || containerDepth > 0;
  const lower = html.toLowerCase();
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(html); m !== null; m = TOKEN.exec(html)) {
    if (para !== null) para += html.slice(last, m.index);
    last = TOKEN.lastIndex;
    const name = m[2]?.toLowerCase();
    if (name === undefined) continue; // comment, CDATA, doctype, processing instruction
    const closing = m[1] === '/';
    const attrs = m[3] ?? '';
    if (!closing && SKIP.has(name)) {
      const end = lower.indexOf(`</${name}`, TOKEN.lastIndex);
      const close = end < 0 ? -1 : html.indexOf('>', end);
      TOKEN.lastIndex = close < 0 ? html.length : close + 1;
      last = TOKEN.lastIndex;
      continue;
    }
    if (name === 'br') {
      if (para !== null) para += ' ';
    } else if (BLOCK.has(name)) {
      flush();
    }
    if (closing) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) {
        for (const e of stack.splice(at)) if (e.container) containerDepth -= 1;
        if (!inScope()) flush();
      }
      continue;
    }
    if (VOID.has(name) || attrs.trimEnd().endsWith('/')) continue;
    const container = containerClass !== null && hasClass(attrs, containerClass);
    if (container) containerDepth += 1;
    stack.push({ name, container });
    if (name === 'p' && inScope()) para = '';
  }
  if (para !== null) para += html.slice(last);
  flush();
  return out;
}

/** Body text = paragraphs joined by a blank line (§11.1.1). */
export const joinParagraphs = (paragraphs: readonly string[]): string => paragraphs.join('\n\n');

/** Word count = number of whitespace-separated tokens (threshold ≥ 250, §11.1.1). */
export const wordCount = (body: string): number => body.split(/\s+/).filter((w) => w !== '').length;
