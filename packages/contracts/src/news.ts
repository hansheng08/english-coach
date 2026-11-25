import { z } from 'zod';

// ARCHITECTURE §11.3 (T-023): the stored content of a rewritten news article, the two LLM response schemas and the pure helpers.
// Issue messages only carry a rule name and an index, never article text (CLAUDE.md §5 #7).

export const NEWS_REWRITE_MIN_WORDS = 250;
export const NEWS_REWRITE_MAX_WORDS = 300;
export const NEWS_CHUNK_COUNT = 5;

export type NewsChunk = { chunk: string; meaning_zh: string; sentence_index: number };
export type NewsArticleContent = { rewritten_text: string; sentences: string[]; chunks: NewsChunk[] };

const MAX_SENTENCES = 40;
const MAX_SENTENCE_WORDS = 40;
const FOLLOW_MIN_WORDS = 6;
const FOLLOW_MAX_WORDS = 25;
const FOLLOW_MIN_SENTENCES = 5;
const CHUNK_MIN_WORDS = 2;
const CHUNK_MAX_WORDS = 6;
const MEANING_MAX_CHARS = 30;
const CHUNK_FORMAT = /^[A-Za-z]+(?:['-][A-Za-z]+)*(?: [A-Za-z]+(?:['-][A-Za-z]+)*)*$/;

/** Split on whitespace; drops empty strings and a lone "/" (same as html.ts `wordCount` otherwise). */
export function newsWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== '' && w !== '/');
}

/** Remove the "/" tokens and join the words with one space. */
export function stripBreaks(sentence: string): string {
  return newsWords(sentence).join(' ');
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `chunk` appear in `sentence` (ignoring "/" breaks, any whitespace between words, case-insensitive, whole words)? */
export function chunkAppearsIn(chunk: string, sentence: string): boolean {
  const words = chunk.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return false;
  const body = words.map(escapeRegex).join('\\s+');
  const re = new RegExp(`(?<![\\p{L}\\p{N}'-])${body}(?![\\p{L}\\p{N}'-])`, 'iu');
  return re.test(stripBreaks(sentence));
}

export const NewsChunkSchema: z.ZodType<NewsChunk> = z
  .object({ chunk: z.string(), meaning_zh: z.string(), sentence_index: z.number() })
  .superRefine((c, ctx) => {
    const n = c.chunk.split(' ').length;
    if (!CHUNK_FORMAT.test(c.chunk) || n < CHUNK_MIN_WORDS || n > CHUNK_MAX_WORDS) {
      ctx.addIssue({ code: 'custom', message: 'C2 chunk format', path: ['chunk'] });
    }
    const meaning = c.meaning_zh.trim();
    const len = Array.from(meaning).length;
    if (len < 1 || len > MEANING_MAX_CHARS || !/\p{Script=Han}/u.test(meaning)) {
      ctx.addIssue({ code: 'custom', message: 'C3 meaning_zh', path: ['meaning_zh'] });
    }
  });

type Issue = (message: string, path: (string | number)[]) => void;

function checkSentence(s: string, i: number, issue: Issue): number {
  const w = newsWords(s).length;
  if (s.trim() === '' || /[\r\n]/.test(s) || w < 1 || w > MAX_SENTENCE_WORDS) {
    issue(`S1 sentence ${String(i)}`, ['sentences', i]);
  }
  const tokens = s.split(/\s+/).filter((t) => t !== '');
  const slashes = tokens.filter((t) => t === '/').length;
  const bad =
    tokens.some((t) => t !== '/' && t.includes('/')) ||
    tokens[0] === '/' ||
    tokens[tokens.length - 1] === '/' ||
    tokens.some((t, k) => t === '/' && tokens[k + 1] === '/');
  if (bad) issue(`S2 sentence ${String(i)}`, ['sentences', i]);
  if (slashes > Math.floor(w / 3) || (w >= FOLLOW_MIN_WORDS && slashes < 1)) {
    issue(`S3 sentence ${String(i)}`, ['sentences', i]);
  }
  return w;
}

export const NewsArticleContentSchema: z.ZodType<NewsArticleContent> = z
  .object({
    rewritten_text: z.string(),
    sentences: z.array(z.string()),
    chunks: z.array(NewsChunkSchema),
  })
  .superRefine((a, ctx) => {
    const issue: Issue = (message, path) => {
      ctx.addIssue({ code: 'custom', message, path });
    };
    if (a.sentences.length < 1 || a.sentences.length > MAX_SENTENCES) issue('S1 sentence count', ['sentences']);
    const widths = a.sentences.map((s, i) => checkSentence(s, i, issue));
    if (widths.filter((w) => w >= FOLLOW_MIN_WORDS && w <= FOLLOW_MAX_WORDS).length < FOLLOW_MIN_SENTENCES) {
      issue('S4 follow-up sentences', ['sentences']);
    }
    if (a.rewritten_text !== a.sentences.map(stripBreaks).join(' ')) issue('T1 rewritten_text', ['rewritten_text']);
    const total = newsWords(a.rewritten_text).length;
    if (total < NEWS_REWRITE_MIN_WORDS || total > NEWS_REWRITE_MAX_WORDS) issue('T2 word count', ['rewritten_text']);
    if (a.chunks.length !== NEWS_CHUNK_COUNT) issue('C1 chunk count', ['chunks']);
    const seen = new Set<string>();
    a.chunks.forEach((c, i) => {
      const key = c.chunk.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) issue(`C1 duplicate chunk ${String(i)}`, ['chunks', i, 'chunk']);
      seen.add(key);
      const sentence = Number.isInteger(c.sentence_index) ? a.sentences[c.sentence_index] : undefined;
      if (sentence === undefined || c.sentence_index < 0 || !chunkAppearsIn(c.chunk, sentence)) {
        issue(`C4 chunk ${String(i)}`,['chunks', i, 'sentence_index']);
      }
    });
  });

export const NewsJudgeResponseSchema: z.ZodType<{ category_match: boolean }> = z.object({ category_match: z.boolean() });

const normalizeText = (s: string): string => s.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** The raw LLM shape → `NewsArticleContent` (design decision: a `.transform`, so the adapter's single retry covers every rule). */
export const NewsRewriteResponseSchema: z.ZodType<NewsArticleContent> = z
  .object({
    sentences: z.array(z.string()).min(1).max(MAX_SENTENCES),
    chunks: z.array(z.object({ chunk: z.string(), meaning_zh: z.string() })).length(NEWS_CHUNK_COUNT),
  })
  .transform((raw, ctx): NewsArticleContent => {
    const sentences = raw.sentences.map(normalizeText);
    const chunks: NewsChunk[] = [];
    raw.chunks.forEach((c, i) => {
      const chunk = normalizeText(c.chunk);
      const index = sentences.findIndex((s) => chunkAppearsIn(chunk, s));
      if (index < 0) ctx.addIssue({ code: 'custom', message: `C4 chunk ${String(i)}`, path: ['chunks', i, 'chunk'] });
      chunks.push({ chunk, meaning_zh: c.meaning_zh.trim(), sentence_index: index });
    });
    const content = { rewritten_text: sentences.map(stripBreaks).join(' '), sentences, chunks };
    const checked = NewsArticleContentSchema.safeParse(content);
    if (!checked.success) {
      for (const i of checked.error.issues) ctx.addIssue({ code: 'custom', message: i.message, path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)) });
      return z.NEVER;
    }
    return checked.data;
  });
