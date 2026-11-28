import { ok } from '@english-coach/contracts';
import { makeTestUserDb } from '../../_shared/db/test/fakes.ts';
import type { RouteDeps, RouterDeps } from '../router.ts';

const TEST_USER = '00000000-0000-4000-8000-0000000000aa';
const TEST_ORIGIN = 'http://localhost:5173';

/** 測試用 RouteDeps：`userDb` 是全部回 not stubbed 的 `makeTestUserDb()`；`now` 固定 2026-11-27T00:00:00Z；`reviewDb` 預設不給（暫時選填）。 */
export function makeTestRouteDeps(overrides?: Partial<RouteDeps>): RouteDeps {
  return {
    userDb: () => makeTestUserDb(),
    now: () => new Date('2026-11-27T00:00:00Z'),
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
