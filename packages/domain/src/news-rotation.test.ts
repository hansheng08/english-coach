import { NewsSettingsSchema, PlanDateSchema, type NewsCategory } from '@english-coach/contracts';
import { expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { categoryTryOrder, decideNewsCategory, plannedCategory } from './news-rotation.ts';
import { addDays } from './taipei-date.ts';

const defaults = NewsSettingsSchema.parse({});
const custom = NewsSettingsSchema.parse({ rotation_order: ['semiconductor', 'ai', 'software'] });
const days = (settings: typeof defaults, from: number, count: number): NewsCategory[] =>
  Array.from({ length: count }, (_, k) => plannedCategory(expectOk(addDays(settings.anchor_date, from + k)), settings));

describe('plannedCategory (ARCHITECTURE §11.2)', () => {
  it('(AC-T49-2) 9 days from anchor_date repeat rotation_order 3 times (default and custom order)', () => {
    expect(plannedCategory(PlanDateSchema.parse('2026-11-24'), defaults)).toBe('semiconductor');
    expect(days(defaults, 0, 9)).toEqual([...defaults.rotation_order, ...defaults.rotation_order, ...defaults.rotation_order]);
    expect(days(custom, 0, 9)).toEqual([...custom.rotation_order, ...custom.rotation_order, ...custom.rotation_order]);
  });

  it('(AC-T49-2) dates before anchor_date use a non-negative modulo', () => {
    const [a, b, c] = defaults.rotation_order;
    expect(days(defaults, -4, 4)).toEqual([c, a, b, c]);
  });
});

describe('categoryTryOrder / decideNewsCategory (ARCHITECTURE §11.2 fallback)', () => {
  it('(AC-T49-3) try order starts at planned and wraps along rotation_order', () => {
    expect(categoryTryOrder('ai', defaults.rotation_order)).toEqual(['ai', 'software', 'semiconductor']);
    expect(categoryTryOrder('software', defaults.rotation_order)).toEqual(['software', 'semiconductor', 'ai']);
    expect(categoryTryOrder('semiconductor', defaults.rotation_order)).toEqual(['semiconductor', 'ai', 'software']);
    expect(categoryTryOrder('ai', custom.rotation_order)).toEqual(['ai', 'software', 'semiconductor']);
    expect(categoryTryOrder('software', custom.rotation_order)).toEqual(['software', 'semiconductor', 'ai']);
  });

  it('(AC-T49-3) no skip, skip one, skip two, and all empty -> fallback article', () => {
    const order = defaults.rotation_order;
    expect(decideNewsCategory('ai', order, new Set<NewsCategory>(['ai']))).toEqual({
      planned: 'ai',
      actual: 'ai',
      skipped: [],
      useFallbackArticle: false,
    });
    expect(decideNewsCategory('ai', order, new Set<NewsCategory>(['software', 'semiconductor']))).toEqual({
      planned: 'ai',
      actual: 'software',
      skipped: ['ai'],
      useFallbackArticle: false,
    });
    expect(decideNewsCategory('semiconductor', order, new Set<NewsCategory>(['software']))).toEqual({
      planned: 'semiconductor',
      actual: 'software',
      skipped: ['semiconductor', 'ai'],
      useFallbackArticle: false,
    });
    expect(decideNewsCategory('software', order, new Set<NewsCategory>())).toEqual({
      planned: 'software',
      actual: null,
      skipped: ['software', 'semiconductor', 'ai'],
      useFallbackArticle: true,
    });
  });
});
