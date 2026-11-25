// QA probes for T-023 (boundaries, redaction, error states). Written by QA; not part of the ticket's TC list.
import { describe, expect, it } from 'vitest';
import {
  chunkAppearsIn,
  NewsArticleContentSchema,
  NewsChunkSchema,
  NewsRewriteResponseSchema,
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
const messages = (x: unknown): string[] => {
  const r = NewsArticleContentSchema.safeParse(x);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};
const has = (x: unknown, prefix: string): boolean => messages(x).some((m) => m.startsWith(prefix));
const words = (n: number): string => Array.from({ length: n }, () => 'word').join(' ');
const raw = () => {
  const c = content();
  return { sentences: [...c.sentences], chunks: c.chunks.map(({ chunk, meaning_zh }) => ({ chunk, meaning_zh })) };
};

describe('QA probes: chunkAppearsIn boundaries (AC-T23-2)', () => {
  it('(QA-1) (AC-T23-2) matches at sentence start/end and across a "/" break', () => {
    expect(chunkAppearsIn('drive adoption', 'drive adoption of chiplets')).toBe(true);
    expect(chunkAppearsIn('drive adoption', 'costs drive adoption')).toBe(true);
    expect(chunkAppearsIn('drive adoption', 'costs drive / adoption of chiplets')).toBe(true);
  });

  it('(QA-2) (AC-T23-2) rejects a neighbour that is a letter, digit, apostrophe or hyphen, including non-ASCII letters', () => {
    for (const s of ['x-drive adoption now', 'drive adoption-led growth', "o'drive adoption", 'drive adoption2 now', '3drive adoption', 'édrive adoption', 'drive adoptioné']) {
      expect(chunkAppearsIn('drive adoption', s), s).toBe(false);
    }
    expect(chunkAppearsIn('drive adoption', '(drive adoption).')).toBe(true);
    expect(chunkAppearsIn('DRIVE ADOPTION', 'Drive Adoption')).toBe(true);
  });

  it('(QA-3) (AC-T23-2) regex specials are literal (no wildcard, no alternation)', () => {
    expect(chunkAppearsIn('a|b', 'we saw a here')).toBe(false);
    expect(chunkAppearsIn('a*', 'we saw aaaa here')).toBe(false);
    expect(chunkAppearsIn('(x)', 'we saw x here')).toBe(false);
    expect(chunkAppearsIn('a|b', 'we saw a|b here')).toBe(true);
  });
});

describe('QA probes: sentence rules on exact boundaries (AC-T23-3)', () => {
  it('(QA-4) (AC-T23-3) S3 at small w: w=2 allows no "/", w=3 allows one, w=5 allows one but not two', () => {
    expect(has(content({ sentences: ['one / two'] }), 'S3')).toBe(true);
    expect(has(content({ sentences: ['one two / three'] }), 'S3')).toBe(false);
    expect(has(content({ sentences: ['one / two / three'] }), 'S3')).toBe(true);
    expect(has(content({ sentences: ['one two / three four five'] }), 'S3')).toBe(false);
    expect(has(content({ sentences: ['one / two three / four five'] }), 'S3')).toBe(true);
  });

  it('(QA-5) (AC-T23-3) S1 rejects a carriage return and a 41-word sentence; 40 words with breaks passes', () => {
    expect(has(content({ sentences: ['one two three\rfour five six'] }), 'S1 sentence 0')).toBe(true);
    expect(has(content({ sentences: [words(41)] }), 'S1 sentence 0')).toBe(true);
    expect(has(content({ sentences: [`${words(13)} / ${words(13)} / ${words(14)}`] }), 'S1')).toBe(false);
  });

  it('(QA-6) (AC-T23-3) S2 rejects a slash glued to a word on either side', () => {
    for (const s of ['one two /three four five six', 'one two three/ four five six', 'one two three // four five six']) {
      expect(has(content({ sentences: [s] }), 'S2 sentence 0'), s).toBe(true);
    }
  });

  it('(QA-7) (AC-T23-3) S4 counts w=6 and w=25 as follow-up sentences but not w=5 or w=26', () => {
    const w = (n: number): string => `${words(3)} / ${words(n - 3)}`;
    const four = [w(6), w(6), w(6), w(6)];
    expect(has(content({ sentences: [...four, w(25)] }), 'S4')).toBe(false);
    expect(has(content({ sentences: [...four, w(26)] }), 'S4')).toBe(true);
    expect(has(content({ sentences: [...four, 'one two three four five'] }), 'S4')).toBe(true);
  });
});

describe('QA probes: chunks (AC-T23-5)', () => {
  it('(QA-8) (AC-T23-5) C2 rejects leading/trailing/double spaces and stray punctuation; C3 counts code points', () => {
    const ok = (chunk: string, meaning_zh = '意思'): boolean => NewsChunkSchema.safeParse({ chunk, meaning_zh, sentence_index: 0 }).success;
    for (const bad of [' new tool', 'new tool ', 'new  tool', "new tool'", '-new tool', 'new tool.']) expect(ok(bad), bad).toBe(false);
    expect(ok('new tool', '𠮷'.repeat(30))).toBe(true);
    expect(ok('new tool', '𠮷'.repeat(31))).toBe(false);
    expect(ok('new tool', 'AI 工具')).toBe(true);
  });

  it('(QA-9) (AC-T23-5) C4 rejects NaN, Infinity and a numeric-string index', () => {
    for (const sentence_index of [Number.NaN, Number.POSITIVE_INFINITY, '0']) {
      const r = NewsArticleContentSchema.safeParse(content({ chunks: [{ ...CHUNKS[0], sentence_index: sentence_index as number }, ...CHUNKS.slice(1)] }));
      expect(r.success, String(sentence_index)).toBe(false);
    }
  });
});

describe('QA probes: NewsRewriteResponseSchema (AC-T23-6)', () => {
  it('(QA-10) (AC-T23-6) raw shape: 41 sentences or 6 chunks fail; extra keys are dropped', () => {
    const many = raw();
    many.sentences = Array.from({ length: 41 }, (_, i) => sent(i + 1));
    expect(NewsRewriteResponseSchema.safeParse(many).success).toBe(false);
    const six = raw();
    six.chunks.push({ chunk: 'clear results', meaning_zh: '清楚結果' });
    expect(NewsRewriteResponseSchema.safeParse(six).success).toBe(false);
    const extra = { ...raw(), note: 'x', chunks: raw().chunks.map((c) => ({ ...c, sentence_index: 9 })) };
    const out = NewsRewriteResponseSchema.safeParse(extra);
    expect(out.success).toBe(true);
    expect(out.data && Object.keys(out.data).sort()).toEqual(['chunks', 'rewritten_text', 'sentences']);
    expect(out.data?.chunks.every((c) => c.sentence_index === 0)).toBe(true);
  });

  it('(QA-11) (AC-T23-6) the LLM cannot pick sentence_index: the first matching sentence wins, case-insensitively', () => {
    const r = raw();
    r.sentences[5] = 'Our big launch / came after a long quiet winter season for the team today';
    r.sentences[9] = 'The BIG LAUNCH / came after a long quiet winter season for the team today';
    r.chunks[4] = { chunk: 'big launch', meaning_zh: '大型發表' };
    const out = NewsRewriteResponseSchema.safeParse(r);
    expect(out.success).toBe(true);
    expect(out.data?.chunks[4]?.sentence_index).toBe(5);
  });

  it('(QA-12) (AC-T23-6) left single quote and newlines inside a sentence are normalised before the rules run', () => {
    const r = raw();
    r.sentences[0] = '‘Team 1’ tested\nthe new tool / and shared clear results with every partner today';
    const out = NewsRewriteResponseSchema.safeParse(r);
    expect(out.success).toBe(true);
    expect(out.data?.sentences[0]).toBe("'Team 1' tested the new tool / and shared clear results with every partner today");
    expect(out.data?.rewritten_text).not.toMatch(/[\n‘’]/);
  });
});

describe('QA probes: no article text in issues (AC-T23-10)', () => {
  it('(QA-13) (AC-T23-10) every failing rule keeps the marker text out of messages and paths', () => {
    const m = 'qmarkq';
    const cases: unknown[] = [
      { ...content(), sentences: [`${m} TCP/IP`] },
      { ...content(), sentences: [`${m}\n${words(41)}`] },
      { ...content(), rewritten_text: `${m} ${words(10)}` },
      { ...content(), chunks: [{ chunk: `${m} 9`, meaning_zh: m, sentence_index: 99 }] },
      { ...content(), chunks: [...CHUNKS, { ...CHUNKS[0], chunk: 'TESTED the new tool' }].map((c) => ({ ...c, meaning_zh: m })) },
      { sentences: m, rewritten_text: 5, chunks: [m] },
    ];
    for (const x of cases) {
      const r = NewsArticleContentSchema.safeParse(x);
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues ?? [])).not.toContain(m);
      expect(r.error?.message ?? '').not.toContain(m);
    }
    const bad = raw();
    bad.sentences[0] = `${m} one two three four five six seven`;
    bad.chunks[0] = { chunk: `${m} zebra`, meaning_zh: m };
    for (const x of [bad, { sentences: [m, 7], chunks: [{ chunk: 1, meaning_zh: m }] }]) {
      const r = NewsRewriteResponseSchema.safeParse(x);
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues ?? [])).not.toContain(m);
      expect(r.error?.message ?? '').not.toContain(m);
    }
  });
});
