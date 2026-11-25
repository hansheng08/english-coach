// Our own samples for T-023 (no real news text). A good rewrite: 18 sentences x 14 words = 252 words, one " / " each.
import type { Candidate } from '../types.ts';

export type RawRewrite = {
  sentences: string[];
  chunks: { chunk: string; meaning_zh: string }[];
};

const sentence = (n: number): string => `Team ${String(n)} tested the new tool / and shared clear results with every partner today`;

const CHUNKS: RawRewrite['chunks'] = [
  { chunk: 'tested the new tool', meaning_zh: '測試新工具' },
  { chunk: 'shared clear results', meaning_zh: '分享清楚的結果' },
  { chunk: 'every partner today', meaning_zh: '今天的每位夥伴' },
  { chunk: 'new tool', meaning_zh: '新工具' },
  { chunk: 'with every partner', meaning_zh: '與每位夥伴' },
];

/** Passes every rule of NewsArticleContentSchema after the transform. */
export const goodRaw = (): RawRewrite => ({
  sentences: Array.from({ length: 18 }, (_, i) => sentence(i + 1)),
  chunks: CHUNKS.map((c) => ({ ...c })),
});

/** 10 sentences = 140 words: the word count rule (T2) fails. */
export const shortRaw = (): RawRewrite => ({
  sentences: Array.from({ length: 10 }, (_, i) => sentence(i + 1)),
  chunks: CHUNKS.map((c) => ({ ...c })),
});

/** Only 4 chunks. */
export const fourChunksRaw = (): RawRewrite => ({ ...goodRaw(), chunks: CHUNKS.slice(0, 4).map((c) => ({ ...c })) });

export const candidate = (body: string, over: Partial<Candidate> = {}): Candidate => ({
  sourceId: 'src-1',
  category: 'ai',
  url: 'https://example.invalid/a',
  title: 'Sample title',
  publishedAt: new Date('2026-11-25T00:00:00Z'),
  body,
  sha256: 'abc',
  wordCount: body.split(/\s+/).length,
  ...over,
});

/** `n` words `w1 w2 ...`, so the n-th word is recognisable. */
export const numberedBody = (n: number): string => Array.from({ length: n }, (_, i) => `w${String(i + 1)}x`).join(' ');

/** A software article about our own made-up topic, used for the category mismatch sample. */
export const mismatchCandidate = (): Candidate =>
  candidate('Our lab trained a new language model and compared it with older models on many tasks.', { category: 'software' });
