import { CardIdSchema, PlanDateSchema, UserIdSchema, type CardSchedule, type SrsSettings } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { applyReview } from '@english-coach/domain';
import { describe, expect, it } from 'vitest';
import type { DbResponse } from './client.ts';
import { readCardForReview, readSrsSettings, recordCardReview, type ReviewDbClient } from './reviews.ts';

const CARD = CardIdSchema.parse('123e4567-e89b-42d3-a456-426614174000');
const USER = UserIdSchema.parse('3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c');
const TODAY = PlanDateSchema.parse('2026-11-27');
const SRS: SrsSettings = { step_days: [3, 7, 14], after_last_days: 14, forgot_days: 1 };
const SECRET_CHUNK = 'move the needle';

type RpcCall = { readonly fn: string; readonly args: Readonly<Record<string, unknown>> };

function rpcClient(respond: () => PromiseLike<DbResponse<unknown>>): { client: ReviewDbClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client: ReviewDbClient = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return respond();
    },
  };
  return { client, calls };
}

function rowClient(data: Readonly<Record<string, unknown>> | null): ReviewDbClient {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

const reviewing2: CardSchedule = { state: 'reviewing', correctCount: 3, intervalStep: 2, dueDate: TODAY };

function input(rating: 'hesitant' | 'forgot') {
  const outcome = expectOk(applyReview(reviewing2, rating, TODAY, SRS));
  return { cardId: CARD, reviewDate: TODAY, mode: 'A' as const, rating, before: reviewing2, outcome };
}

describe('recordCardReview (_shared/db)', () => {
  it('(AC-T32-6) (TC-9) calls record_card_review once with the 13 parameters mapped from the old and new schedule', async () => {
    for (const rating of ['hesitant', 'forgot'] as const) {
      const { client, calls } = rpcClient(() => Promise.resolve({ data: null, error: null }));
      const i = input(rating);
      expectOk(await recordCardReview(client, i));
      expect(calls).toHaveLength(1);
      expect(calls[0]?.fn).toBe('record_card_review');
      const s = i.outcome.schedule;
      expect(calls[0]?.args).toEqual({
        p_card_id: CARD,
        p_review_date: TODAY,
        p_mode: 'A',
        p_rating: rating,
        p_expected_state: 'reviewing',
        p_expected_correct_count: 3,
        p_expected_interval_step: 2,
        p_expected_due_date: TODAY,
        p_new_state: s.state,
        p_new_correct_count: s.correctCount,
        p_new_interval_step: s.intervalStep,
        p_new_due_date: s.dueDate,
        p_interval_days_applied: i.outcome.intervalDaysApplied,
      });
      expect(Object.keys(calls[0]?.args ?? {})).toHaveLength(13);
    }
  });

  it('(AC-T32-8) (TC-12) 23505 and 40001 are a conflict on card', async () => {
    for (const code of ['23505', '40001']) {
      const { client } = rpcClient(() => Promise.resolve({ data: null, error: { code, message: `dup ${SECRET_CHUNK}` } }));
      const e = expectErr(await recordCardReview(client, input('hesitant')));
      expect(e).toMatchObject({ kind: 'conflict', entity: 'card' });
    }
  });

  it('(AC-T32-8) (TC-13) P0002 is not_found; other codes and thrown errors are db_failed without values', async () => {
    const notFound = rpcClient(() => Promise.resolve({ data: null, error: { code: 'P0002', message: SECRET_CHUNK } }));
    expect(expectErr(await recordCardReview(notFound.client, input('hesitant')))).toMatchObject({ kind: 'not_found', entity: 'card' });

    const other = rpcClient(() => Promise.resolve({ data: null, error: { code: '42501', message: `${SECRET_CHUNK} ${TODAY}` } }));
    const e1 = expectErr(await recordCardReview(other.client, input('hesitant')));
    expect(e1.kind).toBe('db_failed');

    const thrown = rpcClient(() => Promise.reject(new Error(`boom ${SECRET_CHUNK} ${TODAY}`)));
    const e2 = expectErr(await recordCardReview(thrown.client, input('hesitant')));
    expect(e2.kind).toBe('db_failed');
    for (const e of [e1, e2]) {
      expect(e.message).not.toContain(SECRET_CHUNK);
      expect(e.message).not.toContain(TODAY);
    }
  });
});

describe('readCardForReview and readSrsSettings (_shared/db)', () => {
  const row = {
    id: CARD,
    chunk: SECRET_CHUNK,
    meaning_zh: null,
    example_en: null,
    synonyms: [],
    source_sentence: null,
    source_type: 'manual',
    state: 'learning',
    correct_count: 1,
    interval_step: 0,
    due_date: '2026-11-28',
    priority_new: false,
    tts_path: null,
    generated_by: null,
    created_at: '2026-11-27T00:00:00+00:00',
    mastered_at: null,
  };

  it('(AC-T32-3) maps a row to a Card and returns null when there is no row', async () => {
    const card = expectOk(await readCardForReview(rowClient(row), CARD));
    expect(card?.schedule).toEqual({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-28' });
    expect(card?.chunk).toBe(SECRET_CHUNK);
    expect(expectOk(await readCardForReview(rowClient(null), CARD))).toBeNull();
  });

  it('(AC-T32-4) (TC-4) (TC-6) a missing profile row or missing srs gives the defaults; an invalid srs is internal', async () => {
    const defaults = { step_days: [3, 7, 14], after_last_days: 14, forgot_days: 1 };
    expect(expectOk(await readSrsSettings(rowClient(null), USER))).toEqual(defaults);
    expect(expectOk(await readSrsSettings(rowClient({ settings: {} }), USER))).toEqual(defaults);
    const bad = rowClient({ settings: { srs: { step_days: [7, 3, 14] } } });
    expect(expectErr(await readSrsSettings(bad, USER)).kind).toBe('internal');
  });
});
