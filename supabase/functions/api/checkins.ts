import { CheckinEventSchema, httpStatusOf, toApiErrorBody, type AppError } from '@english-coach/contracts';
import { addDays, toTaipeiPlanDate } from '@english-coach/domain';
import type { AuthContext } from '../_shared/db/auth.ts';
import type { UserDb } from '../_shared/db/user-db.ts';

/** router.ts 的 `RouteDeps`／`Route` 的結構相同；不從 router 匯入，避免循環相依（adr008-10-no-circular）。 */
type CheckinsDeps = { readonly userDb: (ctx: AuthContext) => UserDb; readonly now: () => Date };
type CheckinsRoute = (req: Request, ctx: AuthContext, deps: CheckinsDeps) => Promise<Response>;

type Issue = { readonly path: string; readonly message: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function failure(e: AppError): Response {
  return new Response(JSON.stringify(toApiErrorBody(e)), { status: httpStatusOf(e), headers: JSON_HEADERS });
}

function invalid(issues: readonly Issue[]): Response {
  return failure({ kind: 'validation', message: 'invalid request', issues: [...issues] });
}

async function readJson(req: Request): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, value: (await req.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

/** POST /checkins：寫入一筆時段打卡事件（冪等；ARCHITECTURE §4.8.3、§5.1）。 */
export const postCheckins: CheckinsRoute = async (req, ctx, deps) => {
  const body = await readJson(req);
  if (!body.ok) return invalid([{ path: 'body', message: 'body must be JSON' }]);

  const parsed = CheckinEventSchema.safeParse(body.value);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
  const event = parsed.data;

  const today = toTaipeiPlanDate(deps.now());
  if (!today.ok) return failure({ kind: 'internal', message: 'cannot compute today' });
  const yesterday = addDays(today.value, -1);
  if (!yesterday.ok) return failure({ kind: 'internal', message: 'cannot compute yesterday' });
  if (event.planDate !== today.value && event.planDate !== yesterday.value) {
    return invalid([{ path: 'planDate', message: 'planDate must be today or yesterday (Asia/Taipei)' }]);
  }

  const written = await deps.userDb(ctx).insertCheckin(event);
  if (!written.ok) return failure(written.error);
  return new Response(null, { status: 204 });
};
