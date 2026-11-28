import { describe, expect, it } from 'vitest';
import checkinDbTest from '../supabase/functions/_shared/db/checkin.test.ts?raw';
import clientSrc from '../supabase/functions/_shared/db/client.ts?raw';
import providerCallTest from '../supabase/functions/_shared/db/provider-call.test.ts?raw';
import userDbSrc from '../supabase/functions/_shared/db/user-db.ts?raw';
import checkinsTest from '../supabase/functions/api/checkins.test.ts?raw';
import routerSrc from '../supabase/functions/api/router.ts?raw';
import routerTest from '../supabase/functions/api/router.test.ts?raw';
import t004 from '../supabase/tests/t004_rls_test.sql?raw';

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;
const titles = (text: string): string[] =>
  [...text.matchAll(/^\s*it\((['`])(.*?)\1, (?:async )?\(/gm)].map((m) => m[2] ?? '');

const ROUTER_TITLES: readonly string[] = [
  '(AC-T3-5) has at least one route',
  '(AC-T3-5) ${key}: no token → 401 unauthenticated',
  '(AC-T3-5) ${key}: verifyToken err → 401 unauthenticated',
  '(AC-T3-5) ${key}: role is not authenticated → 401 unauthenticated',
  '(AC-T3-5) GET ${path} with a valid token → 200 { ok: true }',
  '(AC-T3-5) an allowed origin also gets Access-Control-Allow-Origin on the 200',
  '(AC-T53-7) (TC-13) GET /health is 200 { ok: true } whether routeDeps is ok or err',
  '(AC-T3-5) OPTIONS → 204 and verifyToken is not called',
  '(AC-T3-5) OPTIONS from an allowed origin gets CORS headers',
  '(AC-T3-5) OPTIONS from an unknown origin gets no Access-Control-Allow-Origin',
  '(AC-T3-5) OPTIONS is still 204 when deps.auth is err',
  '(AC-T3-5) deps.auth err → 500 internal and verifyToken is not called',
  '(AC-T3-5) ${method} ${path} with a valid token → 400 validation',
  '(AC-T3-5) GET /api/healthx without a token → 401',
  '(AC-T3-5) a throwing verifyToken → 500 internal and logs only the error name',
  '(AC-T3-5) ${label}: deps.log is called exactly once with the adr010-env line',
  '(AC-T3-5) strips the optional /functions/v1 and /api prefixes',
  '(AC-T3-5) does not treat other paths as /health',
];

const CHECKINS_TITLES: readonly string[] = [
  '(AC-T53-1) (TC-1) no token, bad token, and role anon are all 401 and never touch userDb',
  '(AC-T53-2) (TC-2) a non-JSON body is 400 validation with path body',
  '(AC-T53-2) (TC-3) a step that does not belong to the slot is rejected on path step',
  '(AC-T53-2) (TC-4) opened only pairs with step slot, and slot only with opened',
  '(AC-T53-2) (TC-5) bad slot, status, date format, or a missing step is 400 on the right field',
  '(AC-T53-3) (TC-6) now=${now}: accepts Taipei today and yesterday only',
  '(AC-T53-3) (TC-7) the day before yesterday and tomorrow are 400 on planDate',
  '(AC-T53-4) (TC-8) writes exactly five columns for the ctx user and answers 204 with CORS',
  '(AC-T53-4) (TC-9) every slot step with completed/skipped, and every slot opened, is written as sent',
  '(AC-T53-5) (TC-10) a 23505 duplicate is a successful 204',
  '(AC-T53-5) (TC-11) other database errors and thrown errors are 500 db_failed without event values',
  '(AC-T53-7) (TC-13) routeDeps err is returned as that error',
];

const CHECKIN_DB_TITLES: readonly string[] = [
  '(AC-T53-4) writes one slot_checkin row with exactly SLOT_CHECKIN_COLUMNS',
  '(AC-T53-5) (TC-10) a 23505 unique violation is ok(null)',
  '(AC-T53-5) (TC-11) another code becomes db_failed with only the operation and code',
  '(AC-T53-5) (TC-11) a thrown error becomes db_failed instead of escaping',
];

const PROVIDER_CALL_TITLES: readonly string[] = [
  '(AC-T7-1) writes exactly the provider_call metadata columns for the AuthContext user; extra fields are dropped',
  '(AC-T7-1) a successful call is stored as status ok with no error_kind',
  '(AC-T7-2) a PostgREST error becomes db_failed with only the operation and code, never the DB message',
  '(AC-T7-2) a thrown network error becomes db_failed instead of escaping',
];

const EXISTING_TESTS = [
  { name: 'router.test.ts', src: routerTest, its: 18, describes: 7, titles: ROUTER_TITLES },
  { name: 'checkins.test.ts', src: checkinsTest, its: 12, describes: 6, titles: CHECKINS_TITLES },
  { name: 'checkin.test.ts', src: checkinDbTest, its: 4, describes: 1, titles: CHECKIN_DB_TITLES },
  { name: 'provider-call.test.ts', src: providerCallTest, its: 4, describes: 1, titles: PROVIDER_CALL_TITLES },
] as const;

const usesFactory = (src: string, name: string): boolean =>
  new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(src) && new RegExp(`\\b${name}\\(`).test(src);

describe('T-032 regression (static text)', () => {
  it('(AC-T32-13) (AC-T32-14) (TC-22) (AC-T32-18) (TC-27) the four existing test files build their dependencies with the make-test factories', () => {
    expect(usesFactory(routerTest, 'makeTestRouteDeps')).toBe(true);
    expect(usesFactory(routerTest, 'makeTestRouterDeps')).toBe(true);
    expect(usesFactory(routerTest, 'makeTestUserDb')).toBe(true);
    expect(usesFactory(checkinsTest, 'makeTestDbClient')).toBe(true);
    expect(usesFactory(checkinsTest, 'makeTestRouteDeps')).toBe(true);
    expect(usesFactory(checkinsTest, 'makeTestRouterDeps')).toBe(true);
    expect(usesFactory(checkinDbTest, 'makeTestDbClient')).toBe(true);
    expect(usesFactory(providerCallTest, 'makeTestDbClient')).toBe(true);
    for (const t of EXISTING_TESTS) expect(t.src, t.name).not.toContain('keyPresence');
  });

  it('(AC-T32-13) (AC-T32-14) (TC-22) (AC-T32-18) (TC-28) the four existing test files keep the same it/describe counts and titles as main', () => {
    for (const t of EXISTING_TESTS) {
      expect(count(t.src, /^\s*it\(/gm), `${t.name} it`).toBe(t.its);
      expect(count(t.src, /^\s*describe\(/gm), `${t.name} describe`).toBe(t.describes);
      expect(titles(t.src), `${t.name} titles`).toEqual(t.titles);
      expect(t.src, t.name).not.toMatch(/\b(?:it|test|describe)\.(?:skip|only|todo)\b/);
    }
  });

  it('(AC-T32-13) (AC-T32-14) (TC-22) (AC-T32-18) (TC-29) reviewDb is optional on RouteDeps and no type gained a field', () => {
    expect(routerSrc).toMatch(/export type RouteDeps = \{[\s\S]*?readonly reviewDb:[\s\S]*?\};/);
    const routerDeps = /export type RouterDeps = \{([\s\S]*?)\n\};/.exec(routerSrc)?.[1] ?? '';
    expect(routerDeps).not.toContain('reviewDb');
    expect(count(routerDeps, /^\s+readonly \w+:/gm)).toBe(5);
    expect(userDbSrc).not.toContain('reviewDb');
    expect(clientSrc).not.toContain('reviewDb');
  });

  it('(AC-T32-15) (TC-23) (AC-T32-19) (TC-30) t004_rls_test.sql keeps its structure and gains only review_date in the card_review inserts', () => {
    expect(count(t004, /\n/g)).toBe(99);
    expect(t004.endsWith('\n')).toBe(true);
    expect(count(t004, /^select plan\(47\);$/gm)).toBe(1);
    const perAc = ['1', '2', '3', '4', '5', '6', '7'].map((n) => count(t004, new RegExp(`\\(AC-T4-${n}\\)`, 'g')));
    expect(perAc).toEqual([5, 12, 9, 7, 7, 6, 1]);
    expect(count(t004, /insert into public\.card_review/g)).toBe(5);
    expect(count(t004, /insert into public\.card_review \(user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied\)/g)).toBe(5);
  });

  it('(AC-T32-15) (TC-23) (AC-T32-19) (TC-31) t004_rls_test.sql uses five distinct review_date values and keeps its error codes', () => {
    const dates = [...t004.matchAll(/insert into public\.card_review \([^)]*\) values[^$;]*/g)].map(
      (m) => /'(\d{4}-\d{2}-\d{2})'/.exec(m[0])?.[1],
    );
    expect(dates).toEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']);
    expect(count(t004, /'23503'/g)).toBe(1);
    expect(count(t004, /'23505'/g)).toBe(1);
    expect(count(t004, /'23514'/g)).toBe(9);
    expect(count(t004, /'42501'/g)).toBe(11);
  });
});
