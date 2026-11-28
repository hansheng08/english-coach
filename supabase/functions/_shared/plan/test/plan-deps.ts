import { err } from '@english-coach/contracts';
import { makeTestPlanStore } from '../../db/test/fakes.ts';
import type { PlanDeps } from '../prepare.ts';

/**
 * 測試用 PlanDeps（ARCHITECTURE §5.1.1）：`store` 是全部回 not stubbed 的 `makeTestPlanStore()`；`llm` 是 `not_configured`；
 * `fetch` reject `not stubbed: fetch`；`now` 固定 2026-11-28T00:00:00Z；`log` 不輸出。
 */
export function makeTestPlanDeps(overrides?: Partial<PlanDeps>): PlanDeps {
  return {
    store: makeTestPlanStore(),
    llm: err({ kind: 'not_configured', provider: 'gemini', capability: 'llm', message: 'not stubbed: llm' }),
    fetch: () => Promise.reject(new Error('not stubbed: fetch')),
    now: () => new Date('2026-11-28T00:00:00Z'),
    log: () => undefined,
    ...overrides,
  };
}
