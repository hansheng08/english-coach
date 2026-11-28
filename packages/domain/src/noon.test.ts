import { describe, expect, it } from 'vitest';
import { CardIdSchema, PlanDateSchema, type CardState, type NoonItem } from '@english-coach/contracts';
import { buildNoonItem, recallPrompt, selectNoonMode, type NoonCardFields } from './noon.ts';

const CARD_ID = CardIdSchema.parse('11111111-1111-4111-8111-111111111111');
const PLAN_DATE = PlanDateSchema.parse('2026-11-28');

const item = (over: Partial<NoonItem> = {}): NoonItem => ({
  card_id: CARD_ID,
  plain_en: null,
  cloze_en: null,
  distractors: null,
  context_zh: null,
  blocks: null,
  shuffled_order: null,
  ...over,
});
const full = item({
  plain_en: 'plain',
  cloze_en: 'a ____ b',
  distractors: ['x', 'y', 'z'],
  context_zh: '情境',
  blocks: ['a', 'b', 'c'],
  shuffled_order: [2, 0, 1],
});
const noB = item({ plain_en: 'plain', cloze_en: 'a ____ b', distractors: ['x', 'y', 'z'] });
const noChoice = item({ context_zh: '情境', blocks: ['a', 'b', 'c'], shuffled_order: [2, 0, 1] });

const card = (state: CardState, over: Partial<NoonCardFields> = {}): NoonCardFields => ({
  state,
  exampleEn: 'We drive adoption.',
  meaningZh: '推動採用',
  ...over,
});

describe('selectNoonMode (ARCHITECTURE §4.14.4)', () => {
  it('(AC-T25-2) (TC-2) Reviewing with complete mode-B material gives B', () => {
    expect(selectNoonMode(card('reviewing'), full)).toBe('B');
  });

  it('(AC-T25-2) (TC-2) Reviewing without mode-B material falls back to A_choice, then A_recall', () => {
    expect(selectNoonMode(card('reviewing'), noB)).toBe('A_choice');
    expect(selectNoonMode(card('reviewing'), item({ plain_en: 'plain' }))).toBe('A_recall');
    expect(selectNoonMode(card('reviewing'), undefined)).toBe('A_recall');
  });

  it('(AC-T25-2) (TC-2) Collected and Learning never get B', () => {
    expect(selectNoonMode(card('collected'), full)).toBe('A_choice');
    expect(selectNoonMode(card('learning'), noChoice)).toBe('A_recall');
    expect(selectNoonMode(card('reviewing'), noChoice)).toBe('B');
  });

  it('(AC-T25-2) (TC-2) no example and no meaning postpones; so does Mastered', () => {
    expect(selectNoonMode(card('collected', { exampleEn: null, meaningZh: null }), full)).toBe('postpone');
    expect(selectNoonMode(card('reviewing', { exampleEn: null, meaningZh: null }), undefined)).toBe('postpone');
    expect(selectNoonMode(card('mastered'), full)).toBe('postpone');
  });

  it('(AC-T25-2) (TC-2) one of example or meaning is enough', () => {
    expect(selectNoonMode(card('learning', { exampleEn: null }), undefined)).toBe('A_recall');
    expect(selectNoonMode(card('learning', { meaningZh: null }), undefined)).toBe('A_recall');
  });
});

describe('recallPrompt', () => {
  it('(AC-T25-2) (TC-3) follows plain → cloze → meaning', () => {
    expect(recallPrompt(card('learning'), item({ plain_en: 'p', cloze_en: 'c ____' }))).toEqual({ kind: 'plain', text: 'p' });
    expect(recallPrompt(card('learning'), item({ cloze_en: 'c ____' }))).toEqual({ kind: 'cloze', text: 'c ____' });
    expect(recallPrompt(card('learning'), item())).toEqual({ kind: 'meaning', text: '推動採用' });
    expect(recallPrompt(card('learning'), undefined)).toEqual({ kind: 'meaning', text: '推動採用' });
  });

  it('(AC-T25-2) (TC-3) returns null when nothing is available and never an empty string', () => {
    expect(recallPrompt(card('learning', { meaningZh: null }), undefined)).toBeNull();
    expect(recallPrompt(card('learning', { meaningZh: '' }), item({ plain_en: '', cloze_en: '  ' }))).toBeNull();
  });
});

describe('buildNoonItem (T-025a: no LLM material)', () => {
  const input = (exampleEn: string | null, chunk = 'drive adoption') => ({
    cardId: CARD_ID,
    chunk,
    state: 'learning' as const,
    exampleEn,
    meaningZh: null,
  });

  it('(AC-T25-2) (TC-4) replaces the first occurrence of an inflected chunk with ____', () => {
    const r = buildNoonItem(input('Rising costs drove adoption of chiplets.'), undefined, PLAN_DATE);
    expect(r.cloze_en).toBe('Rising costs ____ of chiplets.');
    expect(r.card_id).toBe(CARD_ID);
  });

  it('(AC-T25-2) (TC-4) keeps punctuation around the blank', () => {
    const r = buildNoonItem(input('We hope to get buy-in, soon.', 'get buy-in'), undefined, PLAN_DATE);
    expect(r.cloze_en).toBe('We hope to ____, soon.');
  });

  it('(AC-T25-2) (TC-4) is null when the example lacks the chunk or there is no example; other fields are null', () => {
    const none = buildNoonItem(input('Nothing relevant here.'), undefined, PLAN_DATE);
    expect(none.cloze_en).toBeNull();
    const missing = buildNoonItem(input(null), undefined, PLAN_DATE);
    expect(missing).toEqual({
      card_id: CARD_ID,
      plain_en: null,
      cloze_en: null,
      distractors: null,
      context_zh: null,
      blocks: null,
      shuffled_order: null,
    });
  });
});
