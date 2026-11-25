import { describe, expect, it } from 'vitest';
import {
  chunkAppearsIn,
  newsWords,
  NewsArticleContentSchema,
  NewsChunkSchema,
  NewsJudgeResponseSchema,
  NewsRewriteResponseSchema,
  NEWS_CHUNK_COUNT,
  NEWS_REWRITE_MAX_WORDS,
  NEWS_REWRITE_MIN_WORDS,
  stripBreaks,
  type NewsArticleContent,
  type NewsChunk,
} from './news.ts';

const sent = (n: number): string => `Team ${String(n)} tested the new tool / and shared clear results with every partner today`;
const CHUNKS: [NewsChunk, NewsChunk, NewsChunk, NewsChunk, NewsChunk] = [
  { chunk: 'tested the new tool', meaning_zh: '測試新工具', sentence_index: 0 },
  { chunk: 'shared clear results', meaning_zh: '分享清楚的結果', sentence_index: 0 },
  { chunk: 'every partner today', meaning_zh: '今天的每位夥伴', sentence_index: 0 },
  { chunk: 'new tool', meaning_zh: '新工具', sentence_index: 0 },
  { chunk: 'with every partner', meaning_zh: '與每位夥伴', sentence_index: 0 },
];
const content = (over: Partial<NewsArticleContent> = {}): NewsArticleContent => {
  const sentences = Array.from({ length: 18 }, (_, i) => sent(i + 1));
  return { rewritten_text: sentences.map(stripBreaks).join(' '), sentences, chunks: CHUNKS.map((c) => ({ ...c })), ...over };
};
/** Messages of every failed rule (rule name first), whatever else the content breaks. */
const messages = (x: unknown): string[] => {
  const r = NewsArticleContentSchema.safeParse(x);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};
const has = (x: unknown, prefix: string): boolean => messages(x).some((m) => m.startsWith(prefix));
const words = (n: number): string => Array.from({ length: n }, () => 'word').join(' ');

describe('news.ts helpers', () => {
  it('(AC-T23-1) (TC-1) newsWords drops empty strings and lone "/", keeps a lone dash; stripBreaks joins with one space', () => {
    expect(newsWords('  a  b\n/ c —  d /  ')).toEqual(['a', 'b', 'c', '—', 'd']);
    expect(stripBreaks('Rising costs / drive  adoption /\nof chiplets')).toBe('Rising costs drive adoption of chiplets');
    expect(NEWS_REWRITE_MIN_WORDS).toBe(250);
    expect(NEWS_REWRITE_MAX_WORDS).toBe(300);
    expect(NEWS_CHUNK_COUNT).toBe(5);
  });

  it('(AC-T23-2) (TC-3) chunkAppearsIn ignores "/", whitespace and case, and matches whole words only', () => {
    expect(chunkAppearsIn('drive adoption', 'Rising costs / drive adoption of chiplets')).toBe(true);
    expect(chunkAppearsIn('AI', 'said')).toBe(false);
    expect(chunkAppearsIn('Drive  Adoption', 'rising costs drive   adoption of chiplets')).toBe(true);
    expect(chunkAppearsIn('state-of-the-art', 'a state-of-the-artist works')).toBe(false);
    expect(chunkAppearsIn('state-of-the-art', 'a state-of-the-art chip')).toBe(true);
    expect(chunkAppearsIn('c++ code', 'we like c++ code a lot')).toBe(true);
    expect(chunkAppearsIn('a.b', 'we saw aXb here')).toBe(false);
    expect(chunkAppearsIn('a.b', 'we saw a.b here')).toBe(true);
    expect(chunkAppearsIn('tool', "the tool's end")).toBe(false);
    expect(chunkAppearsIn('', 'anything')).toBe(false);
  });
});

describe('NewsArticleContentSchema', () => {
  it('(AC-T23-3) (TC-4) a fully valid article passes', () => {
    expect(NewsArticleContentSchema.safeParse(content()).success).toBe(true);
  });

  it('(AC-T23-3) (TC-4) S1: sentence count, empty, newline and word limits', () => {
    expect(has(content({ sentences: [] }), 'S1 sentence count')).toBe(true);
    expect(has(content({ sentences: Array.from({ length: 41 }, () => sent(1)) }), 'S1 sentence count')).toBe(true);
    expect(has(content({ sentences: [sent(1), '   ', sent(2)] }), 'S1 sentence 1')).toBe(true);
    expect(has(content({ sentences: ['one two / three\nfour five six'] }), 'S1 sentence 0')).toBe(true);
    expect(has(content({ sentences: [`${words(20)} / ${words(21)}`] }), 'S1 sentence 0')).toBe(true);
    expect(has(content({ sentences: [sent(1)] }), 'S1')).toBe(false);
    expect(has(content({ sentences: Array.from({ length: 40 }, () => sent(1)) }), 'S1')).toBe(false);
    expect(has(content({ sentences: [`${words(20)} / ${words(20)}`] }), 'S1')).toBe(false);
  });

  it('(AC-T23-3) (TC-5) S2: "/" only as a lone token, not first, not last, not doubled', () => {
    for (const s of ['The TCP/IP stack / works well for us', 'We pick and/or / pass it on today', '/ Start here and go on / ok', 'End here and go on /', 'one two three / / four five six']) {
      expect(has(content({ sentences: [s] }), 'S2 sentence 0'), s).toBe(true);
    }
    expect(has(content({ sentences: [sent(1)] }), 'S2')).toBe(false);
  });

  it('(AC-T23-3) (TC-6) S3: slash count between 1 (when w >= 6) and floor(w / 3)', () => {
    expect(has(content({ sentences: ['one two three four five'] }), 'S3')).toBe(false);
    expect(has(content({ sentences: ['one two three four five six'] }), 'S3')).toBe(true);
    expect(has(content({ sentences: ['a b / c d / e f / g h i'] }), 'S3')).toBe(false);
    expect(has(content({ sentences: ['a / b / c d / e f / g h i'] }), 'S3')).toBe(true);
  });

  it('(AC-T23-3) (TC-7) S4: at least 5 sentences with 6 to 25 words', () => {
    const six = 'one two three / four five six';
    expect(has(content({ sentences: [six, six, six, six, 'one two'] }), 'S4')).toBe(true);
    expect(has(content({ sentences: [six, six, six, six, six] }), 'S4')).toBe(false);
  });

  it('(AC-T23-4) (TC-8) T1: rewritten_text must equal the joined sentences without "/"', () => {
    const c = content();
    expect(has({ ...c, rewritten_text: `${c.rewritten_text} ` }, 'T1')).toBe(true);
    expect(has({ ...c, rewritten_text: c.rewritten_text.replace('tool and', 'tool / and') }, 'T1')).toBe(true);
    expect(has(c, 'T1')).toBe(false);
  });

  it('(AC-T23-4) (TC-8) T2: 250 to 300 words, both ends included', () => {
    const t2 = (n: number): boolean => has(content({ rewritten_text: words(n) }), 'T2');
    expect([t2(249), t2(250), t2(300), t2(301)]).toEqual([true, false, false, true]);
  });

  it('(AC-T23-5) (TC-9) C1: exactly 5 chunks, unique after lower-casing and squeezing spaces', () => {
    const c = content();
    expect(has({ ...c, chunks: c.chunks.slice(0, 4) }, 'C1 chunk count')).toBe(true);
    expect(has({ ...c, chunks: [...c.chunks, ...c.chunks.slice(0, 1).map((x) => ({ ...x, chunk: 'other thing' }))] }, 'C1 chunk count')).toBe(true);
    expect(has({ ...c, chunks: [...c.chunks.slice(0, 4), { ...CHUNKS[3], chunk: 'New Tool' }] }, 'C1 duplicate')).toBe(true);
    expect(has({ ...c, chunks: [...c.chunks.slice(0, 4), { ...CHUNKS[3], chunk: 'new   tool' }] }, 'C1 duplicate')).toBe(true);
    expect(has(c, 'C1')).toBe(false);
  });

  it('(AC-T23-5) (TC-10) C2: 2 to 6 letter words in the allowed format', () => {
    const ok = (chunk: string): boolean => NewsChunkSchema.safeParse({ chunk, meaning_zh: '意思', sentence_index: 0 }).success;
    for (const bad of ['tool', 'a b c d e f g', 'web 3 tool', 'a/b tool', 'new (tool)']) expect(ok(bad), bad).toBe(false);
    for (const good of ['new tool', 'a b c d e f', "don't stop", 'well-known tool']) expect(ok(good), good).toBe(true);
  });

  it('(AC-T23-5) (TC-11) C3: meaning_zh is 1 to 30 characters with a Han character', () => {
    const ok = (meaning_zh: string): boolean => NewsChunkSchema.safeParse({ chunk: 'new tool', meaning_zh, sentence_index: 0 }).success;
    expect([ok('  '), ok('新'.repeat(31)), ok('only english'), ok('新'.repeat(30)), ok(' 新 ')]).toEqual([false, false, false, true, true]);
  });

  it('(AC-T23-5) (TC-11) C4: sentence_index is an in-range integer of a sentence that holds the chunk', () => {
    const at = (sentence_index: number): boolean => has(content({ chunks: [{ ...CHUNKS[0], sentence_index }, ...CHUNKS.slice(1)] }), 'C4');
    expect([at(-1), at(18), at(1.5), at(0), at(17)]).toEqual([true, true, true, false, false]);
    const other = content({ sentences: [sent(1), 'Nothing here / matches the chunk at all really', ...Array.from({ length: 16 }, (_, i) => sent(i + 3))] });
    expect(has({ ...other, chunks: [{ ...CHUNKS[0], sentence_index: 1 }, ...CHUNKS.slice(1)] }, 'C4')).toBe(true);
  });

  it('(AC-T23-5) (TC-11) extra keys are stripped (not strict)', () => {
    const c = content();
    const r = NewsArticleContentSchema.safeParse({ ...c, extra: 1, chunks: c.chunks.map((x) => ({ ...x, more: 2 })) });
    expect(r.success).toBe(true);
    expect(r.data).toEqual(c);
  });
});

describe('LLM response schemas', () => {
  const raw = () => {
    const c = content();
    return { sentences: c.sentences, chunks: c.chunks.map(({ chunk, meaning_zh }) => ({ chunk, meaning_zh })) };
  };

  it('(AC-T23-6) (TC-12) the transform trims, squeezes spaces, normalises apostrophes and takes the first matching sentence', () => {
    const r = raw();
    r.sentences[1] = '  Team’s   plan tested the new tool / and shared clear results with every partner today ';
    r.sentences[3] = 'Team’s plan tested the new tool / and shared clear results with every partner today';
    r.chunks[4] = { chunk: '  Team’s   plan ', meaning_zh: ' 隊伍的計畫 ' };
    const out = NewsRewriteResponseSchema.safeParse(r);
    expect(out.success).toBe(true);
    const d = out.data;
    expect(d?.chunks[4]).toEqual({ chunk: "Team's plan", meaning_zh: '隊伍的計畫', sentence_index: 1 });
    expect(d?.sentences[1]).toBe("Team's plan tested the new tool / and shared clear results with every partner today");
    expect(d?.rewritten_text).toBe(d?.sentences.map(stripBreaks).join(' '));
    expect(d?.rewritten_text).not.toContain('/');
  });

  it('(AC-T23-6) (TC-13) any broken rule fails the whole schema', () => {
    const noMatch = raw();
    noMatch.chunks[0] = { chunk: 'zebra crossing', meaning_zh: '斑馬線' };
    expect(NewsRewriteResponseSchema.safeParse(noMatch).success).toBe(false);
    const four = raw();
    four.chunks.pop();
    expect(NewsRewriteResponseSchema.safeParse(four).success).toBe(false);
    const short = raw();
    short.sentences.length = 10;
    expect(NewsRewriteResponseSchema.safeParse(short).success).toBe(false);
    expect(NewsRewriteResponseSchema.safeParse(raw()).success).toBe(true);
  });

  it('(AC-T23-6) (TC-14) the judge schema is { category_match: boolean }', () => {
    expect(NewsJudgeResponseSchema.safeParse({ category_match: true }).success).toBe(true);
    expect(NewsJudgeResponseSchema.safeParse({ category_match: 'yes' }).success).toBe(false);
    expect(NewsJudgeResponseSchema.safeParse({ category_match: false, extra: 1 }).data).toEqual({ category_match: false });
  });

  it('(AC-T23-10) (TC-23) issue messages never contain article, sentence or chunk text', () => {
    const r = raw();
    r.sentences[2] = 'zqxmarker one two TCP/IP three four five six';
    r.chunks[3] = { chunk: 'zqxmarker9 tool', meaning_zh: 'zqxmarker' };
    const out = NewsRewriteResponseSchema.safeParse(r);
    expect(out.success).toBe(false);
    expect(JSON.stringify(out.error?.issues ?? [])).not.toContain('zqxmarker');
    const direct = NewsArticleContentSchema.safeParse({ ...content(), sentences: ['zqxmarker TCP/IP'], chunks: [{ chunk: 'zqxmarker9', meaning_zh: 'zqxmarker', sentence_index: 0 }] });
    expect(direct.success).toBe(false);
    expect(JSON.stringify(direct.error?.issues ?? [])).not.toContain('zqxmarker');
  });
});
