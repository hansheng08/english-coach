import {
  httpStatusOf,
  toApiErrorBody,
  type AppError,
  type AppErrorKind,
  type PlanDate,
  type Result,
  type UserId,
} from '@english-coach/contracts';
import { toTaipeiPlanDate } from '@english-coach/domain';
import type { SupabaseSecretEnv } from '../_shared/config/env.ts';
import { requireServiceKey } from '../_shared/db/auth.ts';
import type { PrepareOutcome } from '../_shared/plan/prepare.ts';

/** 一次執行用的入口；secret client 只在 index.ts 建立，這裡不 import service-db.ts（ARCHITECTURE §4.12.5）。 */
export type DailyPrepSession = {
  readonly listUserIds: () => Promise<Result<readonly UserId[], AppError>>;
  readonly prepare: (userId: UserId, planDate: PlanDate) => Promise<Result<PrepareOutcome, AppError>>;
};

export type DailyPrepHandlerDeps = {
  readonly env: Result<SupabaseSecretEnv, AppError>;
  readonly open: (env: SupabaseSecretEnv) => DailyPrepSession;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

export type DailyPrepStats = { readonly ready: number; readonly existing: number; readonly failed: number };

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** 每次執行只寫這一行：筆數與錯誤種類，不含使用者 id、文章內容或金鑰。 */
function logLine(stats: DailyPrepStats, kinds: readonly AppErrorKind[]): string {
  const base = `daily-prep ready=${String(stats.ready)} existing=${String(stats.existing)} failed=${String(stats.failed)}`;
  return kinds.length === 0 ? base : `${base} errors=${[...new Set(kinds)].join(',')}`;
}

/** index.ts 只組裝（ARCHITECTURE §4.12.1、§4.13.2）。env 錯 → 500；金鑰不對 → 401；之後逐一備料。 */
export function createDailyPrepHandler(deps: DailyPrepHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!deps.env.ok) return json(httpStatusOf(deps.env.error), toApiErrorBody(deps.env.error));
    const env = deps.env.value;
    const auth = requireServiceKey(req, env);
    if (!auth.ok) return json(httpStatusOf(auth.error), toApiErrorBody(auth.error));

    const planDate = toTaipeiPlanDate(deps.now());
    if (!planDate.ok) {
      const e: AppError = { kind: 'internal', message: 'cannot compute today' };
      return json(httpStatusOf(e), toApiErrorBody(e));
    }

    const session = deps.open(env);
    const ids = await session.listUserIds();
    if (!ids.ok) {
      deps.log(logLine({ ready: 0, existing: 0, failed: 0 }, [ids.error.kind]));
      return json(httpStatusOf(ids.error), toApiErrorBody(ids.error));
    }

    let ready = 0;
    let existing = 0;
    let failed = 0;
    const kinds: AppErrorKind[] = [];
    for (const userId of ids.value) {
      const outcome = await session.prepare(userId, planDate.value);
      if (!outcome.ok) {
        failed += 1;
        kinds.push(outcome.error.kind);
      } else if (outcome.value.existing) {
        existing += 1;
      } else if (outcome.value.plan.status === 'ready') {
        ready += 1;
      } else {
        failed += 1;
        if (outcome.value.plan.status === 'failed') kinds.push(outcome.value.plan.failure.error.kind);
      }
    }
    const stats: DailyPrepStats = { ready, existing, failed };
    deps.log(logLine(stats, kinds));
    return json(200, stats);
  };
}
