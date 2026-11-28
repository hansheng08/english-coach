import { describe, expect, it } from 'vitest';
import reviewsSrc from '../supabase/functions/api/reviews.ts?raw';
import routerSrc from '../supabase/functions/api/router.ts?raw';
import configToml from '../supabase/config.toml?raw';
import testDepsSrc from '../supabase/functions/api/test-deps.test.ts?raw';
import planTestSrc from '../supabase/functions/api/plan.test.ts?raw';
import memStoreSrc from '../supabase/functions/_shared/plan/test/mem-store.ts?raw';
import prepareTestSrc from '../supabase/functions/_shared/plan/prepare.test.ts?raw';
import t005Sql from '../supabase/tests/t005_rls_test.sql?raw';
import migration from '../supabase/migrations/20261129000101_t025a_daily_plan_claim_noon.sql?raw';

/** Same 18 kinds, same order, as APP_ERROR_KINDS (ARCHITECTURE §5.0.4). */
export const APP_ERROR_KINDS_LITERAL = [
  'quota_exhausted',
  'rate_limited',
  'unavailable',
  'timeout',
  'auth',
  'region_blocked',
  'invalid_response',
  'not_configured',
  'paid_not_allowed',
  'validation',
  'unauthenticated',
  'not_found',
  'conflict',
  'storage_failed',
  'db_failed',
  'news_unavailable',
  'plan_not_ready',
  'internal',
] as const;

describe('T-025a migration and config (static text)', () => {
  it('(AC-T25-15) (TC-24) the migration adds the columns and the checks', () => {
    expect(migration).toMatch(/add column claimed_at timestamptz not null default now\(\)/);
    expect(migration).toMatch(/add column noon_items jsonb not null default '\[\]'::jsonb/);
    expect(migration).toMatch(/add column failure jsonb\b/);
    expect(migration).toMatch(/add column seed_remaining int\b/);
    expect(migration).toMatch(/jsonb_array_length\(noon_items\) <= 25/);
    expect(migration).toContain("check ((status = 'failed') = (failure is not null))");
    expect(migration).toMatch(/check \(seed_remaining >= 0\)/);
  });

  it('(AC-T25-15) (TC-24) the error check lists exactly APP_ERROR_KINDS', () => {
    const block = /daily_plan_error_kind_check\s+check \(error is null or error in \(([\s\S]*?)\)\)/.exec(migration)?.[1] ?? '';
    const listed = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // The tooling project cannot import @english-coach/contracts, so the list is written out here;
    // packages/contracts/src/plan.test.ts (TC-24) pins APP_ERROR_KINDS to the same literal, in the same order.
    expect(listed).toEqual([...APP_ERROR_KINDS_LITERAL]);
  });

  it('(AC-T25-15) (TC-24) the cron job: name, UTC schedule, function path, timeout, extensions; no secret is created here', () => {
    expect(migration).toContain("cron.schedule('daily-prep-daily', '0 21 * * *'");
    expect(migration).toContain('/functions/v1/daily-prep');
    expect(migration).toContain('timeout_milliseconds := 150000');
    expect(migration).toContain('create extension if not exists pg_cron');
    expect(migration).toContain('create extension if not exists pg_net with schema extensions');
    expect(migration).not.toContain('vault.create_secret');
  });

  it('(AC-T25-15) (TC-24) config.toml has [functions.daily-prep] with verify_jwt = false and the import map', () => {
    const block = /\[functions\.daily-prep\]\n([^[]*)/.exec(configToml)?.[1] ?? '';
    expect(block).toContain('verify_jwt = false');
    expect(block).toContain('import_map = "./functions/deno.json"');
  });
});

describe('T-025a RouteDeps (static text)', () => {
  it('(AC-T25-19) (TC-29) planStore, providers, fetch and reviewDb are required on RouteDeps', () => {
    const routeDeps = /export type RouteDeps = \{([\s\S]*?)\n\};/.exec(routerSrc)?.[1] ?? '';
    for (const name of ['planStore', 'providers', 'fetch', 'reviewDb']) {
      expect(routeDeps, name).toMatch(new RegExp(`readonly ${name}:`));
      expect(routeDeps, name).not.toMatch(new RegExp(`readonly ${name}\\?:`));
    }
  });

  it('(AC-T25-19) (TC-29) reviews.ts no longer checks whether reviewDb is wired', () => {
    expect(reviewsSrc).not.toContain('reviewDb not wired');
    expect(reviewsSrc).not.toMatch(/reviewDb\?:/);
    expect(reviewsSrc).not.toMatch(/reviewDb === undefined/);
  });
});

describe('T-025a-fix1 (static text)', () => {
  it('(AC-T25-30) (TC-44) test-deps asserts reviewDb is a function, not undefined', () => {
    expect(testDepsSrc).not.toMatch(/reviewDb\)\.toBeUndefined\(\)/);
    expect(testDepsSrc).toMatch(/typeof makeTestRouteDeps\(\)\.reviewDb/);
    expect(testDepsSrc).toContain("'function'");
    expect(testDepsSrc).toContain('(AC-T32-12) (TC-19)');
    expect(testDepsSrc).toContain('(AC-T32-12) (TC-20)');
  });

  it('(AC-T25-31) (TC-45) t005 daily_plan columns_are lists 17 columns', () => {
    const line = t005Sql.split('\n').find((l) => l.startsWith("select columns_are('public', 'daily_plan'")) ?? '';
    const list = /array\[([^\]]*)\]/.exec(line)?.[1] ?? '';
    const names = list.split(',').map((s) => s.trim().replaceAll("'", ''));
    expect(names).toHaveLength(17);
    for (const c of ['created_at', 'claimed_at', 'noon_items', 'failure', 'seed_remaining']) {
      expect(names).toContain(c);
    }
    expect(t005Sql.split('\n').length - 1).toBe(128);
    expect(t005Sql.match(/select plan\(69\);/g)).toHaveLength(1);
    expect(t005Sql).toContain('(AC-T5-1) daily_plan columns');
  });

  it('(AC-T25-32) (TC-46) mem-store and the migration are still in place', () => {
    expect(memStoreSrc.length).toBeGreaterThan(0);
    expect(prepareTestSrc).toMatch(/from '\.\/test\/mem-store\.ts'/);
    expect(planTestSrc).toMatch(/from '\.\.\/_shared\/plan\/test\/mem-store\.ts'/);
    expect(migration).toContain('claimed_at');
  });
});
