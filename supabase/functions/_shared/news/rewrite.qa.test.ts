// QA probes for T-023 rewrite.ts (request boundaries, error pass-through). Written by QA.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { ARTICLE_END, ARTICLE_START, createCategoryJudge, rewriteArticle } from './rewrite.ts';
import { createFakeLlm, providerError } from './test/fake-llm.ts';
import { candidate, goodRaw, numberedBody } from './test/rewrite-samples.ts';

const fetchCalls = vi.fn(() => {
  throw new Error('network is not allowed in tests');
});
beforeEach(() => {
  fetchCalls.mockClear();
  vi.stubGlobal('fetch', fetchCalls);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const inside = (prompt: string): string => {
  const a = prompt.indexOf(ARTICLE_START);
  const b = prompt.indexOf(ARTICLE_END);
  return a >= 0 && b > a ? prompt.slice(a + ARTICLE_START.length, b) : '';
};

describe('QA probes: request excerpts (AC-T23-7, AC-T23-8)', () => {
  it('(QA-14) (AC-T23-7) judge: a body of exactly 300 words is sent whole; "/" tokens and extra whitespace are not counted', async () => {
    const fake = createFakeLlm({ raw: { category_match: true } });
    const judge = createCategoryJudge({ llm: fake.llm, model: 'gemini-3.1-flash-lite' });
    await judge(candidate(numberedBody(300)));
    expect(inside(fake.requests[0]?.prompt ?? '').trim().split(' ')).toHaveLength(300);
    const body = numberedBody(310).split(' ').join(' / \n\n ');
    await judge(candidate(body));
    const sent = inside(fake.requests[1]?.prompt ?? '');
    expect(sent).toContain('w300x');
    expect(sent).not.toContain('w301x');
    expect(sent).not.toContain('/');
    expect(fetchCalls).toHaveBeenCalledTimes(0);
  });

  it('(QA-15) (AC-T23-8) rewrite: 2,000 words exactly are kept; the title sits before the block, the body only inside it', async () => {
    const fake = createFakeLlm({ raw: goodRaw() });
    expectOk(await rewriteArticle({ llm: fake.llm, model: 'gemini-3.5-flash-lite' }, candidate(numberedBody(2_000), { title: 'Unique Title QA' })));
    const req = fake.requests[0];
    expect(req?.model).toBe('gemini-3.5-flash-lite');
    const prompt = req?.prompt ?? '';
    expect(inside(prompt).trim().split(' ')).toHaveLength(2_000);
    expect(prompt.indexOf('Unique Title QA')).toBeLessThan(prompt.indexOf(ARTICLE_START));
    expect(prompt.slice(prompt.indexOf(ARTICLE_END) + ARTICLE_END.length).trim()).toBe('');
  });
});

describe('QA probes: errors pass through untouched (AC-T23-7, AC-T23-8)', () => {
  it('(QA-16) (AC-T23-7) (AC-T23-8) the very same error object is returned for every ProviderError kind', async () => {
    for (const kind of ['timeout', 'invalid_response', 'unavailable', 'auth', 'region_blocked', 'not_configured'] as const) {
      const e = providerError(kind);
      const j = createFakeLlm({ error: e });
      expect(expectErr(await createCategoryJudge({ llm: j.llm, model: 'gemini-3.1-flash-lite' })(candidate('body')))).toBe(e);
      const w = createFakeLlm({ error: e });
      expect(expectErr(await rewriteArticle({ llm: w.llm, model: 'gemini-3.1-flash-lite' }, candidate('body')))).toBe(e);
      expect(j.calls() + w.calls()).toBe(2);
    }
  });
});
