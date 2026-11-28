import { CardIdSchema, CardSchema, PlanDateSchema, UserIdSchema, type CardSchedule, type SrsSettings } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { applyReview } from '@english-coach/domain';
import { describe, expect, it } from 'vitest';
import type { DbResponse } from './client.ts';
import { readCardForReview, readSrsSettings, recordCardReview, type ReviewDbClient } from './reviews.ts';

// QA probes for T-032 (repository layer). Fake values only.
const CARD = CardIdSchema.parse('123e4567-e89b-42d3-a456-426614174000');
const USER = UserIdSchema.parse('3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c');
const TODAY = PlanDateSchema.parse('2026-11-27');
const SRS: SrsSettings = { step_days: [3, 7, 14], after_last_days: 14, forgot_days: 1 };
const SECRET = 'qa-secret-chunk-text';

type Query = { table: string; columns: string; column: string; value: string };

function recordingClient(data: Readonly<Record<string, unknown>> | null, error: DbResponse<null>['error'] = null) {
  const queries: Query[] = [];
  const rpcCalls: { fn: string; args: Readonly<Record<string, unknown>> }[] = [];
  const client: ReviewDbClient = {
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => {
          queries.push({ table, columns, column, value });
          return { maybeSingle: () => Promise.resolve({ data, error }) };
        },
      }),
    }),
    rpc: (fn, args) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client, queries, rpcCalls };
}

const ROW = {
  id: CARD,
  chunk: SECRET,
  meaning_zh: 'qa-meaning',
  example_en: 'qa example',
  synonyms: ['qa-a', 'qa-b'],
  source_sentence: 'qa sentence',
  source_type: 'news',
  state: 'reviewing',
  correct_count: 3,
  interval_step: 2,
  due_date: '2026-11-28',
  priority_new: true,
  tts_path: '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c/a.mp3',
  generated_by: 'qa-model',
  created_at: '2026-11-20T01:02:03+00:00',
  mastered_at: null,
};

describe('T-032 QA: readCardForReview', () => {
  it('(QA-1) reads table card by id and maps every column to its Card field', async () => {
    const { client, queries } = recordingClient(ROW);
    const card = expectOk(await readCardForReview(client, CARD));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ table: 'card', column: 'id', value: CARD });
    expect(queries[0]?.columns).not.toContain('user_id');
    expect(queries[0]?.columns).not.toContain('seed_chunk_id');
    expect(card).toEqual(
      CardSchema.parse({
        id: CARD,
        chunk: SECRET,
        meaningZh: 'qa-meaning',
        exampleEn: 'qa example',
        synonyms: ['qa-a', 'qa-b'],
        sourceSentence: 'qa sentence',
        sourceType: 'news',
        schedule: { state: 'reviewing', correctCount: 3, intervalStep: 2, dueDate: '2026-11-28' },
        priorityNew: true,
        ttsPath: '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c/a.mp3',
        generatedBy: 'qa-model',
        createdAt: '2026-11-20T01:02:03+00:00',
        masteredAt: null,
      }),
    );
  });

  it('(QA-2) maps a mastered row (null due_date, mastered_at set)', async () => {
    const row = { ...ROW, state: 'mastered', correct_count: 5, interval_step: 3, due_date: null, mastered_at: '2026-11-25T00:00:00+00:00' };
    const card = expectOk(await readCardForReview(recordingClient(row).client, CARD));
    expect(card?.schedule).toEqual({ state: 'mastered', correctCount: 5, intervalStep: 3, dueDate: null });
    expect(card?.masteredAt).toBe('2026-11-25T00:00:00+00:00');
  });

  it('(QA-3) a row with an unexpected shape is db_failed and the message holds no values', async () => {
    const e = expectErr(await readCardForReview(recordingClient({ ...ROW, state: 'bogus' }).client, CARD));
    expect(e.kind).toBe('db_failed');
    expect(e.message).not.toContain(SECRET);
    expect(e.message).toBe('select card returned an unexpected shape');
  });

  it('(QA-4) a database error is db_failed with the code and no values', async () => {
    const e = expectErr(await readCardForReview(recordingClient(null, { code: '42501', message: SECRET }).client, CARD));
    expect(e.kind).toBe('db_failed');
    expect(e.message).toBe('select card failed (42501)');
  });
});

describe('T-032 QA: readSrsSettings', () => {
  it('(QA-5) reads profile.settings for this user only', async () => {
    const { client, queries } = recordingClient({ settings: {} });
    expectOk(await readSrsSettings(client, USER));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ table: 'profile', columns: 'settings', column: 'user_id', value: USER });
  });

  it('(QA-6) a valid custom srs is returned as written', async () => {
    const srs = { step_days: [2, 5, 9], after_last_days: 9, forgot_days: 1 };
    expect(expectOk(await readSrsSettings(recordingClient({ settings: { srs } }).client, USER))).toEqual(srs);
  });

  it('(QA-7) srs null is invalid (internal), not silently the defaults', async () => {
    expect(expectErr(await readSrsSettings(recordingClient({ settings: { srs: null } }).client, USER)).kind).toBe('internal');
  });

  it('(QA-8) a database error is db_failed with the code', async () => {
    const e = expectErr(await readSrsSettings(recordingClient(null, { code: '42P01', message: 'x' }).client, USER));
    expect(e).toMatchObject({ kind: 'db_failed', message: 'select profile failed (42P01)' });
  });
});

describe('T-032 QA: recordCardReview', () => {
  const learning: CardSchedule = { state: 'collected', correctCount: 0, intervalStep: 0, dueDate: null };

  it('(QA-9) success returns the card id and the new schedule from the outcome', async () => {
    const outcome = expectOk(applyReview(learning, 'fast', TODAY, SRS));
    const { client } = recordingClient(null);
    const res = expectOk(await recordCardReview(client, { cardId: CARD, reviewDate: TODAY, mode: 'A', rating: 'fast', before: learning, outcome }));
    expect(res).toEqual({ id: CARD, schedule: outcome.schedule });
  });

  it('(QA-10) a collected card passes its null old due_date through as null', async () => {
    const outcome = expectOk(applyReview(learning, 'fast', TODAY, SRS));
    const { client, rpcCalls } = recordingClient(null);
    expectOk(await recordCardReview(client, { cardId: CARD, reviewDate: TODAY, mode: 'B', rating: 'fast', before: learning, outcome }));
    expect(rpcCalls[0]?.args['p_expected_due_date']).toBeNull();
    expect(rpcCalls[0]?.args['p_expected_state']).toBe('collected');
    expect(rpcCalls[0]?.args['p_mode']).toBe('B');
  });

  it('(QA-11) an error without a code is db_failed "record_card_review failed"; a coded one keeps only the code', async () => {
    const outcome = expectOk(applyReview(learning, 'fast', TODAY, SRS));
    const make = (error: DbResponse<null>['error']): ReviewDbClient => ({
      ...recordingClient(null).client,
      rpc: () => Promise.resolve({ data: null, error }),
    });
    const input = { cardId: CARD, reviewDate: TODAY, mode: 'A' as const, rating: 'fast' as const, before: learning, outcome };
    expect(expectErr(await recordCardReview(make({ message: SECRET }), input))).toEqual({ kind: 'db_failed', message: 'record_card_review failed' });
    expect(expectErr(await recordCardReview(make({ code: 'XX000', message: SECRET }), input))).toEqual({
      kind: 'db_failed',
      message: 'record_card_review failed (XX000)',
    });
  });

  it('(QA-12) conflict and not_found carry entity card and fixed messages without values', async () => {
    const outcome = expectOk(applyReview(learning, 'fast', TODAY, SRS));
    const input = { cardId: CARD, reviewDate: TODAY, mode: 'A' as const, rating: 'fast' as const, before: learning, outcome };
    const make = (code: string): ReviewDbClient => ({
      ...recordingClient(null).client,
      rpc: () => Promise.resolve({ data: null, error: { code, message: SECRET } }),
    });
    for (const code of ['23505', '40001']) {
      const e = expectErr(await recordCardReview(make(code), input));
      expect(e).toEqual({ kind: 'conflict', entity: 'card', message: 'record_card_review conflict' });
    }
    expect(expectErr(await recordCardReview(make('P0002'), input))).toEqual({ kind: 'not_found', entity: 'card', message: 'card not found' });
  });
});
