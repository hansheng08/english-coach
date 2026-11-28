import { httpStatusOf, ReviewRequestSchema, toApiErrorBody, type AppError, type Card } from '@english-coach/contracts';
import { applyReview, toTaipeiPlanDate } from '@english-coach/domain';
import type { AuthContext } from '../_shared/db/auth.ts';
import type { ReviewDb } from '../_shared/db/reviews.ts';

/** router.ts 的 `RouteDeps`／`Route` 的結構子集；不從 router 匯入，避免循環相依（adr008-10-no-circular）。 */
type ReviewsDeps = { readonly now: () => Date; readonly reviewDb?: (ctx: AuthContext) => ReviewDb };
type ReviewsRoute = (req: Request, ctx: AuthContext, deps: ReviewsDeps) => Promise<Response>;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function failure(e: AppError): Response {
  return new Response(JSON.stringify(toApiErrorBody(e)), { status: httpStatusOf(e), headers: JSON_HEADERS });
}

function invalid(issues: readonly { readonly path: string; readonly message: string }[]): Response {
  return failure({ kind: 'validation', message: 'invalid request', issues: [...issues] });
}

async function readJson(req: Request): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, value: (await req.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

/** POST /reviews：中午評分（SRS 在 TypeScript 算，一次交易寫入，一天一次；ARCHITECTURE §4.11）。 */
export const postReviews: ReviewsRoute = async (req, ctx, deps) => {
  if (deps.reviewDb === undefined) return failure({ kind: 'internal', message: 'reviewDb not wired' });
  const reviewDb = deps.reviewDb(ctx);

  const body = await readJson(req);
  if (!body.ok) return invalid([{ path: 'body', message: 'body must be JSON' }]);
  const parsed = ReviewRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
  const { cardId, mode, rating } = parsed.data;

  const card = await reviewDb.readCardForReview(cardId);
  if (!card.ok) return failure(card.error);
  if (card.value === null) return failure({ kind: 'not_found', entity: 'card', message: 'card not found' });

  const srs = await reviewDb.readSrsSettings();
  if (!srs.ok) return failure(srs.error);

  const today = toTaipeiPlanDate(deps.now());
  if (!today.ok) return failure({ kind: 'internal', message: 'cannot compute today' });

  const outcome = applyReview(card.value.schedule, rating, today.value, srs.value);
  if (!outcome.ok) return failure(outcome.error);

  const written = await reviewDb.recordCardReview({
    cardId,
    reviewDate: today.value,
    mode,
    rating,
    before: card.value.schedule,
    outcome: outcome.value,
  });
  if (!written.ok) return failure(written.error);

  const updated: Card = { ...card.value, schedule: written.value.schedule };
  return new Response(JSON.stringify(updated), { status: 200, headers: JSON_HEADERS });
};
