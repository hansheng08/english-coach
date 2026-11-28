// 備料核心：daily-prep 與 POST /plan/today 共用（ARCHITECTURE §4.13.2、§4.13.3 第一階段、§4.14.5、§11.2、§11.3.5）。
// 只 import contracts、domain、_shared/news 與 _shared/db 的型別；LLM 由參數注入。不記文章或使用者內容（CLAUDE.md §5 第 7、9 條）。
import {
  chunkAppearsIn,
  err,
  ok,
  SeniorSentenceSchema,
  toApiErrorBody,
  UpgradeChunkSchema,
  type AppError,
  type ArticleId,
  type CardId,
  type DailyPlan,
  type NewsCategory,
  type NewsChunk,
  type NewsSettings,
  type NoonItem,
  type PlanDate,
  type PlanFailure,
  type ProviderError,
  type Result,
  type ShadowItem,
  type UserId,
} from '@english-coach/contracts';
import {
  buildNoonItem,
  categoryTryOrder,
  plannedCategory,
  selectDailyCards,
  selectNoonMode,
  selectShadowSentences,
  selectTonightQuestion,
  type DailyCardSelection,
  type ShadowSentenceCandidate,
} from '@english-coach/domain';
import type { CompleteInput, PlanCard, PlanStore } from '../db/plan-store.ts';
import type { FetchLike } from '../news/http.ts';
import { findArticle, type IngestDeps, type NewsEvent } from '../news/ingest.ts';
import { createCategoryJudge, JUDGE_TIMEOUT_MS, REWRITE_TIMEOUT_MS, rewriteArticle, type RewriteDeps } from '../news/rewrite.ts';

export type PlanDeps = {
  readonly store: PlanStore;
  readonly llm: Result<RewriteDeps, ProviderError>;
  readonly fetch: FetchLike;
  readonly now: () => Date;
  readonly log: (e: NewsEvent) => void;
};

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly claimedAt: string }
  | { readonly kind: 'existing'; readonly plan: DailyPlan };

/** 租約：上一個備料者超過這麼久還沒完成就視為已結束（Edge Function 牆鐘上限 150 秒；§4.13.2）。 */
export const CLAIM_LEASE_SECONDS = 180;

/** `existing`＝這次沒有自己備料（別人已完成或正在做）。daily-prep 用它分「ready／existing／failed」三種筆數。 */
export type PrepareOutcome = { readonly plan: DailyPlan; readonly existing: boolean };

function isProviderError(e: AppError): e is ProviderError {
  switch (e.kind) {
    case 'quota_exhausted':
    case 'rate_limited':
    case 'unavailable':
    case 'timeout':
    case 'auth':
    case 'region_blocked':
    case 'invalid_response':
    case 'not_configured':
    case 'paid_not_allowed':
      return true;
    case 'validation':
    case 'unauthenticated':
    case 'not_found':
    case 'conflict':
    case 'storage_failed':
    case 'db_failed':
    case 'news_unavailable':
    case 'plan_not_ready':
    case 'internal':
      return false;
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

async function claimWith(deps: PlanDeps, planDate: PlanDate, planned: NewsCategory): Promise<Result<ClaimResult, AppError>> {
  const nowMs = deps.now().getTime();
  const claimedAt = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - CLAIM_LEASE_SECONDS * 1000).toISOString();

  const inserted = await deps.store.insertPending({ planDate, plannedCategory: planned, claimedAt });
  if (!inserted.ok) return err(inserted.error);
  if (inserted.value) return ok({ kind: 'claimed', claimedAt });

  const stored = await deps.store.readPlan(planDate);
  if (!stored.ok) return err(stored.error);
  if (stored.value === null) return err({ kind: 'internal', message: 'daily_plan row vanished after a conflict' });
  const { plan, claimedAt: heldAt } = stored.value;
  if (plan.status === 'ready') return ok({ kind: 'existing', plan });

  const expired = plan.status === 'pending' && Date.parse(heldAt) < Date.parse(staleBefore);
  if (plan.status === 'failed' || expired) {
    const taken = await deps.store.reclaim({ planDate, claimedAt, staleBefore });
    if (!taken.ok) return err(taken.error);
    if (taken.value) return ok({ kind: 'claimed', claimedAt });
    return ok({ kind: 'existing', plan: { status: 'pending', planDate } });
  }
  return ok({ kind: 'existing', plan });
}

/**
 * §4.13.2 的認領：插入成功＝搶到；ready → existing；failed 或租約過期的 pending → 重新認領（沒搶到就是 existing pending）；
 * 其他 pending → existing。每一步都是單一 SQL 敘述。使用者由 `deps.store` 綁定。
 */
export async function claimPlan(deps: PlanDeps, _userId: UserId, planDate: PlanDate): Promise<Result<ClaimResult, AppError>> {
  const settings = await deps.store.readNewsSettings();
  if (!settings.ok) return err(settings.error);
  return claimWith(deps, planDate, plannedCategory(planDate, settings.value));
}

/** 備料中某一步的失敗：寫進 `failure` 的資料（§5.9.2）。 */
type Failing = { readonly step: PlanFailure['step']; readonly error: AppError; readonly timeoutSec: number | null };

const failing = (step: PlanFailure['step'], error: AppError, timeoutMs: number | null = null): Failing => ({
  step,
  error,
  timeoutSec: error.kind === 'timeout' && timeoutMs !== null ? timeoutMs / 1000 : null,
});

type NewsPlanSettings = Pick<NewsSettings, 'rotation_order' | 'lookback_hours'>;

type ArticleChoice = {
  readonly articleId: ArticleId;
  readonly category: NewsCategory;
  readonly isFallback: boolean;
  readonly skipped: readonly NewsCategory[];
  readonly sentences: readonly string[];
  readonly chunks: readonly NewsChunk[];
};

/** §11.2 第 1～3 步＋§11.3.5：找新文章、改寫、寫入；判定或改寫失敗直接退回舊文章（不換類別）。 */
async function chooseArticle(
  deps: PlanDeps,
  planned: NewsCategory,
  settings: NewsPlanSettings,
): Promise<Result<ArticleChoice, Failing>> {
  const { store, llm } = deps;
  const order = categoryTryOrder(planned, settings.rotation_order);
  const sources = await store.listNewsSources();
  if (!sources.ok) return err(failing('news', sources.error));

  const ingest: IngestDeps = {
    fetch: deps.fetch,
    now: deps.now(),
    lookbackHours: settings.lookback_hours,
    isUsed: (key) => store.isArticleUsed(key),
    judge: llm.ok ? createCategoryJudge(llm.value) : () => Promise.resolve(err(llm.error)),
    log: deps.log,
    robots: new Map(),
  };

  const skipped: NewsCategory[] = [];
  let llmFailure: Failing | null = null;
  for (const category of order) {
    const found = await findArticle(category, sources.value, ingest);
    if (!found.ok) {
      if (found.error.kind === 'news_unavailable') {
        skipped.push(category);
        continue;
      }
      if (!isProviderError(found.error)) return err(failing('news', found.error));
      llmFailure = failing('rewrite', found.error, JUDGE_TIMEOUT_MS);
      break;
    }
    if (!llm.ok) {
      llmFailure = failing('rewrite', llm.error);
      break;
    }
    const content = await rewriteArticle(llm.value, found.value);
    if (!content.ok) {
      llmFailure = failing('rewrite', content.error, REWRITE_TIMEOUT_MS);
      break;
    }
    const c = found.value;
    const inserted = await store.insertArticle({
      sourceId: c.sourceId,
      category: c.category,
      url: c.url,
      sha256: c.sha256,
      title: c.title,
      publishedAt: c.publishedAt.toISOString(),
      content: content.value,
    });
    if (!inserted.ok) return err(failing('news', inserted.error));
    return ok({
      articleId: inserted.value,
      category: c.category,
      isFallback: false,
      skipped,
      sentences: content.value.sentences,
      chunks: content.value.chunks,
    });
  }

  const older = await store.readFallbackArticle(planned);
  if (!older.ok) return err(failing('news', older.error));
  if (older.value === null) {
    return err(
      llmFailure ??
        failing('news', {
          kind: 'news_unavailable',
          category: planned,
          message: 'no category had a usable article and no unread older article exists',
        }),
    );
  }
  return ok({
    articleId: older.value.id,
    category: older.value.category,
    isFallback: true,
    skipped: order,
    sentences: older.value.sentences,
    chunks: older.value.chunks,
  });
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** §4.6 v1.12：前一晚首答的 `diagnosis.senior[].text`；沒有或解析失敗就是 null（不讓備料失敗）。 */
async function rewriteCandidates(deps: PlanDeps, planDate: PlanDate): Promise<readonly ShadowSentenceCandidate[] | null> {
  const source = await deps.store.readRewriteSource(planDate);
  if (!source.ok || source.value === null) return null;
  const { diagnosis, upgradeChunks } = source.value;
  const senior = SeniorSentenceSchema.array().safeParse(isRecord(diagnosis) ? diagnosis['senior'] : undefined);
  const upgrade = UpgradeChunkSchema.array().safeParse(upgradeChunks);
  if (!senior.success || !upgrade.success) return null;
  return senior.data.map((s) => ({
    text: s.text,
    containsTargetChunk: upgrade.data.some((u) => chunkAppearsIn(u.chunk, s.text)),
  }));
}

async function shadowItemsFor(deps: PlanDeps, planDate: PlanDate, choice: ArticleChoice): Promise<readonly ShadowItem[]> {
  const news = choice.sentences.map((text): ShadowSentenceCandidate => ({
    text,
    containsTargetChunk: choice.chunks.some((c) => chunkAppearsIn(c.chunk, text)),
  }));
  const picked = selectShadowSentences(news, await rewriteCandidates(deps, planDate));
  return picked.map((s): ShadowItem => ({ source: s.source, text: s.text, tts_path: null }));
}

const hasText = (s: string | null): boolean => s !== null && s.trim().length > 0;

type CardPlan = { readonly cardIds: readonly CardId[]; readonly noonItems: readonly NoonItem[] };

/** §4.14.5 第 1～6 步（T-025a：沒有種子、沒有 LLM；不改任何卡片）。 */
function selectCards(cards: readonly PlanCard[], planDate: PlanDate): CardPlan {
  const byId = new Map<CardId, PlanCard>(cards.map((c) => [c.candidate.cardId, c]));
  const idsOf = (sel: DailyCardSelection): readonly CardId[] => [...sel.oldCardIds, ...sel.newCardIds, ...sel.extraOldCardIds];
  const noonOf = (card: PlanCard): NoonItem =>
    buildNoonItem(
      {
        cardId: card.candidate.cardId,
        chunk: card.chunk,
        state: card.candidate.schedule.state,
        exampleEn: card.exampleEn,
        meaningZh: card.meaningZh,
      },
      undefined,
      planDate,
    );
  const select = (pool: readonly PlanCard[]): readonly CardId[] =>
    idsOf(selectDailyCards({ cards: pool.map((c) => c.candidate), seeds: [], usedSeedChunkIds: new Set<string>() }, planDate));
  const postpones = (card: PlanCard): boolean =>
    selectNoonMode({ state: card.candidate.schedule.state, exampleEn: card.exampleEn, meaningZh: card.meaningZh }, noonOf(card)) ===
    'postpone';

  const first = select(cards);
  const postponed = new Set<CardId>(first.filter((id) => {
    const card = byId.get(id);
    return card !== undefined && postpones(card);
  }));
  const chosen =
    postponed.size === 0
      ? first
      : select(
          cards.filter((c) => {
            const id = c.candidate.cardId;
            return !postponed.has(id) && (first.includes(id) || hasText(c.exampleEn) || hasText(c.meaningZh));
          }),
        );
  const items: NoonItem[] = [];
  const ids: CardId[] = [];
  for (const id of chosen) {
    const card = byId.get(id);
    if (card === undefined) continue;
    ids.push(id);
    items.push(noonOf(card));
  }
  return { cardIds: ids, noonItems: items };
}

/** 搶到認領後的第 1～6 步，回要寫入的欄位；任何一步失敗回 Failing。 */
async function build(
  deps: PlanDeps,
  planDate: PlanDate,
  planned: NewsCategory,
  settings: NewsPlanSettings,
  claimedAt: string,
): Promise<Result<CompleteInput, Failing>> {
  const choice = await chooseArticle(deps, planned, settings);
  if (!choice.ok) return err(choice.error);

  const shadowItems = await shadowItemsFor(deps, planDate, choice.value);

  const cards = await deps.store.listCardCandidates();
  if (!cards.ok) return err(failing('cards', cards.error));
  const plan = selectCards(cards.value, planDate);

  const questions = await deps.store.listQuestionCandidates();
  if (!questions.ok) return err(failing('internal', questions.error));

  return ok({
    planDate,
    claimedAt,
    actualCategory: choice.value.category,
    categorySkipped: choice.value.skipped,
    articleId: choice.value.articleId,
    isFallbackArticle: choice.value.isFallback,
    shadowItems,
    noonItems: plan.noonItems,
    cardIds: plan.cardIds,
    tonightQuestionId: selectTonightQuestion(questions.value),
    seedRemaining: null,
  });
}

/** 被別人接手（complete／fail 回 false）時，丟掉自己的結果，回資料庫現在的內容。 */
async function currentPlan(deps: PlanDeps, planDate: PlanDate): Promise<Result<DailyPlan, AppError>> {
  const stored = await deps.store.readPlan(planDate);
  if (!stored.ok) return err(stored.error);
  if (stored.value === null) return err({ kind: 'internal', message: 'daily_plan row is missing' });
  return ok(stored.value.plan);
}

async function writeFailure(deps: PlanDeps, planDate: PlanDate, claimedAt: string, f: Failing): Promise<Result<DailyPlan, AppError>> {
  const failure: PlanFailure = {
    step: f.step,
    error: toApiErrorBody(f.error).error,
    timeout_sec: f.timeoutSec,
    failed_at: deps.now().toISOString(),
  };
  const written = await deps.store.fail({ planDate, claimedAt, failure });
  if (!written.ok) return err(f.error);
  if (!written.value) return currentPlan(deps, planDate);
  return ok({ status: 'failed', planDate, failure });
}

/** 先 claimPlan；existing 就直接回；搶到就備料並用一次 update 完成（§4.13.2）。 */
export async function runPrepare(deps: PlanDeps, _userId: UserId, planDate: PlanDate): Promise<Result<PrepareOutcome, AppError>> {
  const settings = await deps.store.readNewsSettings();
  if (!settings.ok) return err(settings.error);
  const planned = plannedCategory(planDate, settings.value);

  const claim = await claimWith(deps, planDate, planned);
  if (!claim.ok) return err(claim.error);
  if (claim.value.kind === 'existing') return ok({ plan: claim.value.plan, existing: true });
  const { claimedAt } = claim.value;

  const built = await build(deps, planDate, planned, settings.value, claimedAt);
  if (!built.ok) {
    const failed = await writeFailure(deps, planDate, claimedAt, built.error);
    return failed.ok ? ok({ plan: failed.value, existing: false }) : err(failed.error);
  }

  const done = await deps.store.complete(built.value);
  if (!done.ok) {
    const failed = await writeFailure(deps, planDate, claimedAt, failing('save', done.error));
    return failed.ok ? ok({ plan: failed.value, existing: false }) : err(failed.error);
  }
  const plan = await currentPlan(deps, planDate);
  return plan.ok ? ok({ plan: plan.value, existing: !done.value }) : err(plan.error);
}

export async function preparePlan(deps: PlanDeps, userId: UserId, planDate: PlanDate): Promise<Result<DailyPlan, AppError>> {
  const r = await runPrepare(deps, userId, planDate);
  return r.ok ? ok(r.value.plan) : err(r.error);
}
