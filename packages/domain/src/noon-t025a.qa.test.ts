// QA probes for T-025a noon helpers (QA-2): every B / A_choice field is required, cloze only on a full hit, punctuation kept.
import { CardIdSchema, PlanDateSchema, type NoonItem } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { buildNoonItem, selectNoonMode, type NoonCardFields } from './noon.ts';

const CARD = CardIdSchema.parse('11111111-1111-4111-8111-111111111111');
const DAY = PlanDateSchema.parse('2026-11-28');
const reviewing: NoonCardFields = { state: 'reviewing', exampleEn: 'Rising costs drive adoption.', meaningZh: '推動採用' };

const full: NoonItem = {
  card_id: CARD,
  plain_en: 'Costs push companies to use chiplets.',
  cloze_en: 'Rising costs ____.',
  distractors: ['a', 'b', 'c'],
  context_zh: '成本上升',
  blocks: ['Rising', 'costs', 'drive adoption'],
  shuffled_order: [2, 0, 1],
};
const noChoice: NoonItem = { ...full, plain_en: null, cloze_en: null, distractors: null };

const cloze = (exampleEn: string, chunk = 'drive adoption'): string | null =>
  buildNoonItem({ cardId: CARD, chunk, state: 'learning', exampleEn, meaningZh: null }, undefined, DAY).cloze_en;

describe('selectNoonMode needs every field of a mode (QA-2)', () => {
  it('(QA-2) mode B needs context_zh, blocks and shuffled_order', () => {
    expect(selectNoonMode(reviewing, noChoice)).toBe('B');
    expect(selectNoonMode(reviewing, { ...noChoice, context_zh: null })).toBe('A_recall');
    expect(selectNoonMode(reviewing, { ...noChoice, blocks: null })).toBe('A_recall');
    expect(selectNoonMode(reviewing, { ...noChoice, shuffled_order: null })).toBe('A_recall');
  });

  it('(QA-2) A_choice needs plain_en, cloze_en and distractors', () => {
    const learning: NoonCardFields = { ...reviewing, state: 'learning' };
    expect(selectNoonMode(learning, full)).toBe('A_choice');
    expect(selectNoonMode(learning, { ...full, plain_en: null })).toBe('A_recall');
    expect(selectNoonMode(learning, { ...full, cloze_en: null })).toBe('A_recall');
    expect(selectNoonMode(learning, { ...full, distractors: null })).toBe('A_recall');
  });
});

describe('buildNoonItem cloze (QA-2)', () => {
  it('(QA-2) a partial hit gives no cloze', () => {
    expect(cloze('We drive it.')).toBeNull();
  });

  it('(QA-2) the punctuation before and after the chunk is kept', () => {
    expect(cloze('He said "drive adoption" twice.')).toBe('He said "____" twice.');
    expect(cloze('Costs (drive adoption).')).toBe('Costs (____).');
  });

  it('(QA-2) only the first occurrence is blanked, and a hyphenated chunk is found', () => {
    expect(cloze('We drive adoption and drive adoption again.')).toBe('We ____ and drive adoption again.');
    expect(cloze('A follow-up came.', 'follow up')).toBe('A ____ came.');
  });

  it('(QA-2) a blank example gives no cloze', () => {
    expect(cloze('   ')).toBeNull();
  });
});
