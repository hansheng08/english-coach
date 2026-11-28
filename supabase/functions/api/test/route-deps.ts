import { err, ok, type AppError, type Result } from '@english-coach/contracts';
import { makeTestPlanStore, makeTestTtsStore, makeTestUserDb } from '../../_shared/db/test/fakes.ts';
import type { ReviewDb } from '../../_shared/db/reviews.ts';
import { createRegistry } from '../../_shared/providers/registry.ts';
import type { RouteDeps, RouterDeps } from '../router.ts';

const TEST_USER = '00000000-0000-4000-8000-0000000000aa';
const TEST_ORIGIN = 'http://localhost:5173';

const notStubbed = (name: string): Promise<Result<never, AppError>> =>
  Promise.resolve(err({ kind: 'internal', message: `not stubbed: ${name}` }));

/** 測試用 ReviewDb：每個方法回 `err({ kind: 'internal', message: 'not stubbed: <名稱>' })`。 */
function makeTestReviewDb(): ReviewDb {
  return {
    readCardForReview: () => notStubbed('readCardForReview'),
    readSrsSettings: () => notStubbed('readSrsSettings'),
    recordCardReview: () => notStubbed('recordCardReview'),
  };
}

/**
 * 測試用 RouteDeps：`userDb`、`reviewDb`、`planStore` 都是全部回 not stubbed 的版本；`providers` 是空的 registry；
 * `fetch` reject `not stubbed: fetch`；`now` 固定 2026-11-27T00:00:00Z。
 */
export function makeTestRouteDeps(overrides?: Partial<RouteDeps>): RouteDeps {
  return {
    userDb: () => makeTestUserDb(),
    now: () => new Date('2026-11-27T00:00:00Z'),
    reviewDb: () => makeTestReviewDb(),
    planStore: () => makeTestPlanStore(),
    providers: createRegistry({ providers: [], env: () => undefined }),
    fetch: () => Promise.reject(new Error('not stubbed: fetch')),
    ttsStore: () => makeTestTtsStore(),
    log: () => undefined,
    ...overrides,
  };
}

/** 測試用 RouterDeps：驗證一律通過（固定測試使用者）、一個測試 origin、四把金鑰都在、不輸出 log。 */
export function makeTestRouterDeps(overrides?: Partial<RouterDeps>): RouterDeps {
  return {
    auth: ok({ verifyToken: () => Promise.resolve(ok({ role: 'authenticated', sub: TEST_USER, is_anonymous: false })) }),
    routeDeps: ok(makeTestRouteDeps()),
    allowedOrigins: [TEST_ORIGIN],
    keyPresence: { hasSupabaseUrl: true, hasPublishable: true, hasSecret: true, onlyLegacyKeys: false },
    log: () => undefined,
    ...overrides,
  };
}
