import { CheckinEventSchema, UserIdSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { SLOT_CHECKIN_COLUMNS } from './checkin.ts';
import type { DbClient, DbResponse } from './client.ts';
import { userDbFrom } from './user-db.ts';

const USER = UserIdSchema.parse('3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c');
const EVENT = CheckinEventSchema.parse({ planDate: '2026-11-27', slot: 'evening', step: 'no_script', status: 'skipped' });

function fakeClient(respond: () => PromiseLike<DbResponse<unknown>>): {
  client: DbClient;
  calls: { table: string; row: Readonly<Record<string, unknown>> }[];
} {
  const calls: { table: string; row: Readonly<Record<string, unknown>> }[] = [];
  const client: DbClient = {
    from: (table) => ({
      insert: (row) => {
        calls.push({ table, row });
        return respond();
      },
    }),
  };
  return { client, calls };
}

describe('insertCheckin (_shared/db)', () => {
  it('(AC-T53-4) writes one slot_checkin row with exactly SLOT_CHECKIN_COLUMNS', async () => {
    const { client, calls } = fakeClient(() => Promise.resolve({ data: null, error: null }));
    expect(expectOk(await userDbFrom(client, USER).insertCheckin(EVENT))).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('slot_checkin');
    expect(Object.keys(calls[0]?.row ?? {})).toEqual([...SLOT_CHECKIN_COLUMNS]);
    expect(calls[0]?.row).toEqual({ user_id: USER, plan_date: '2026-11-27', slot: 'evening', step: 'no_script', status: 'skipped' });
  });

  it('(AC-T53-5) (TC-10) a 23505 unique violation is ok(null)', async () => {
    const { client } = fakeClient(() => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }));
    expect(expectOk(await userDbFrom(client, USER).insertCheckin(EVENT))).toBeNull();
  });

  it('(AC-T53-5) (TC-11) another code becomes db_failed with only the operation and code', async () => {
    const { client } = fakeClient(() =>
      Promise.resolve({ data: null, error: { code: '42501', message: 'row has no_script 2026-11-27' } }),
    );
    expect(expectErr(await userDbFrom(client, USER).insertCheckin(EVENT))).toEqual({
      kind: 'db_failed',
      message: 'insert slot_checkin failed (42501)',
    });
  });

  it('(AC-T53-5) (TC-11) a thrown error becomes db_failed instead of escaping', async () => {
    const { client } = fakeClient(() => Promise.reject(new Error('fetch failed no_script')));
    expect(expectErr(await userDbFrom(client, USER).insertCheckin(EVENT))).toEqual({
      kind: 'db_failed',
      message: 'insert slot_checkin failed',
    });
  });
});
