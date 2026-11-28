import { DailyPlanSchema, httpStatusOf, map, NtdSchema, toApiErrorBody, type AppError } from '@english-coach/contracts';
import { toTaipeiPlanDate } from '@english-coach/domain';
import type { AuthContext } from '../_shared/db/auth.ts';
import type { PlanStore } from '../_shared/db/plan-store.ts';
import type { FetchLike } from '../_shared/news/http.ts';
import { preparePlan } from '../_shared/plan/prepare.ts';
import { DEFAULT_SETTINGS, type Registry } from '../_shared/providers/registry.ts';

/** router.ts 的 `RouteDeps`／`Route` 的結構子集；不從 router 匯入，避免循環相依（adr008-10-no-circular）。 */
type PlanRouteDeps = {
  readonly now: () => Date;
  readonly planStore: (ctx: AuthContext) => PlanStore;
  readonly providers: Registry;
  readonly fetch: FetchLike;
};
type PlanRoute = (req: Request, ctx: AuthContext, deps: PlanRouteDeps) => Promise<Response>;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function failure(e: AppError): Response {
  return new Response(JSON.stringify(toApiErrorBody(e)), { status: httpStatusOf(e), headers: JSON_HEADERS });
}

/**
 * POST /plan/today：冪等補做或直接回傳今天的計畫（ARCHITECTURE §4.13.2、§5.1）。不收 body。
 * pending、ready、failed 三種都是 200；只有還沒拿到計畫列之前的錯誤才回錯誤狀態碼（§11.2 v1.12）。
 */
export const postPlanToday: PlanRoute = async (_req, ctx, deps) => {
  const today = toTaipeiPlanDate(deps.now());
  if (!today.ok) return failure({ kind: 'internal', message: 'cannot compute today' });

  // 免費供應商不看用量。T-020 的 sumPaidUsageThisMonthNtd 還不在 main：暫傳 0（ARCHITECTURE §4.19 對 T-021 的同一做法），
  // 由 T-020 的用量接線換成函式（ADR-019 決定 4）；這是本檔唯一的呼叫點。
  const llm = map(deps.providers.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0)), (provider) => ({
    llm: provider,
    model: DEFAULT_SETTINGS.llm.model,
  }));

  const plan = await preparePlan(
    { store: deps.planStore(ctx), llm, fetch: deps.fetch, now: deps.now, log: () => undefined },
    ctx.userId,
    today.value,
  );
  if (!plan.ok) return failure(plan.error);

  const body = DailyPlanSchema.safeParse(plan.value);
  if (!body.success) return failure({ kind: 'internal', message: 'plan failed its own schema' });
  return new Response(JSON.stringify(body.data), { status: 200, headers: JSON_HEADERS });
};
