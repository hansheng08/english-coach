import { CardIdSchema, NewsSettingsSchema, NtdSchema, ok, PlanDateSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { makeTestRouteDeps } from '../../api/test/route-deps.ts';
import { requireUser } from '../db/auth.ts';
import { makeTestPlanStore } from '../db/test/fakes.ts';
import { DEFAULT_SETTINGS } from '../providers/registry.ts';
import { makeTestPlanDeps } from './test/plan-deps.ts';

const PLAN_DATE = PlanDateSchema.parse('2026-11-28');
const USER = '00000000-0000-4000-8000-0000000000aa';
const CARD = CardIdSchema.parse('123e4567-e89b-42d3-a456-426614174000');

async function authContext() {
  const r = await requireUser(new Request('http://localhost/api/x', { headers: { Authorization: 'Bearer a.b.c' } }), {
    verifyToken: () => Promise.resolve(ok({ role: 'authenticated', sub: USER, is_anonymous: false })),
  });
  return expectOk(r);
}

describe('T-025a test factories (defaults fail loudly)', () => {
  it('(AC-T25-19) (TC-28) makeTestPlanStore and makeTestPlanDeps().store return not stubbed errors', async () => {
    const e1 = expectErr(await makeTestPlanStore().readPlan(PLAN_DATE));
    expect(e1.kind).toBe('internal');
    expect(e1.message).toContain('not stubbed: readPlan');
    const e2 = expectErr(await makeTestPlanDeps().store.readPlan(PLAN_DATE));
    expect(e2.message).toContain('not stubbed: readPlan');
  });

  it('(AC-T25-19) (TC-28) an override replaces one method and the rest stay unstubbed', async () => {
    const store = makeTestPlanStore({ readNewsSettings: () => Promise.resolve(ok(NewsSettingsSchema.parse({}))) });
    expect(expectOk(await store.readNewsSettings()).lookback_hours).toBe(48);
    expect(expectErr(await store.listCardCandidates()).message).toContain('not stubbed: listCardCandidates');
    const deps = makeTestPlanDeps({ now: () => new Date('2026-01-01T00:00:00Z') });
    expect(deps.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(expectErr(await deps.store.listCardCandidates()).message).toContain('not stubbed: listCardCandidates');
  });

  it('(AC-T25-19) (TC-28) makeTestRouteDeps().fetch rejects with not stubbed: fetch', async () => {
    await expect(makeTestRouteDeps().fetch('https://example.invalid/', {})).rejects.toThrow('not stubbed: fetch');
    await expect(makeTestPlanDeps().fetch('https://example.invalid/', {})).rejects.toThrow('not stubbed: fetch');
  });

  it('(AC-T25-19) (TC-28) makeTestRouteDeps().reviewDb(ctx) and planStore(ctx) return not stubbed errors; providers is empty', async () => {
    const deps = makeTestRouteDeps();
    const ctx = await authContext();
    const card = expectErr(await deps.reviewDb(ctx).readCardForReview(CARD));
    expect(card.message).toContain('not stubbed: readCardForReview');
    expect(expectErr(await deps.planStore(ctx).readPlan(PLAN_DATE)).message).toContain('not stubbed: readPlan');
    expect(expectErr(deps.providers.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0))).kind).toBe('not_configured');
  });
});
