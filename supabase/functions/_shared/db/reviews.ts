import {
  CardSchema,
  err,
  ok,
  SrsSettingsSchema,
  tryCatchAsync,
  type AppError,
  type Card,
  type CardId,
  type CardSchedule,
  type PlanDate,
  type Result,
  type ReviewMode,
  type ReviewRating,
  type SrsSettings,
  type UserId,
} from '@english-coach/contracts';
import type { ReviewOutcome } from '@english-coach/domain';
import type { SupabaseEnv } from '../config/env.ts';
import type { AuthContext } from './auth.ts';
import { createUserClient, runDb, type ReviewDbClient } from './client.ts';

export type { ReviewDbClient };

export type RecordReviewInput = {
  readonly cardId: CardId;
  readonly reviewDate: PlanDate;
  readonly mode: ReviewMode;
  readonly rating: ReviewRating;
  readonly before: CardSchedule;
  readonly outcome: ReviewOutcome;
};

const CARD_COLUMNS =
  'id, chunk, meaning_zh, example_en, synonyms, source_sentence, source_type, state, correct_count, interval_step, due_date, priority_new, tts_path, generated_by, created_at, mastered_at';

/** 資料庫列（snake_case）轉成 Card 的候選值；之後一律經 CardSchema 驗證。 */
function cardCandidate(row: Readonly<Record<string, unknown>>): unknown {
  return {
    id: row['id'],
    chunk: row['chunk'],
    meaningZh: row['meaning_zh'],
    exampleEn: row['example_en'],
    synonyms: row['synonyms'],
    sourceSentence: row['source_sentence'],
    sourceType: row['source_type'],
    schedule: {
      state: row['state'],
      correctCount: row['correct_count'],
      intervalStep: row['interval_step'],
      dueDate: row['due_date'],
    },
    priorityNew: row['priority_new'],
    ttsPath: row['tts_path'],
    generatedBy: row['generated_by'],
    createdAt: row['created_at'],
    masteredAt: row['mastered_at'],
  };
}

/** 讀一張卡（RLS：只讀得到自己的）；不存在或不是本人的 → ok(null)。訊息不含欄位值。 */
export async function readCardForReview(client: ReviewDbClient, cardId: CardId): Promise<Result<Card | null, AppError>> {
  const res = await runDb('select card', () => client.from('card').select(CARD_COLUMNS).eq('id', cardId).maybeSingle());
  if (!res.ok) return err(res.error);
  if (res.value === null) return ok(null);
  const parsed = CardSchema.safeParse(cardCandidate(res.value));
  if (!parsed.success) return err({ kind: 'db_failed', message: 'select card returned an unexpected shape' });
  return ok(parsed.data);
}

/** 讀 `profile.settings.srs`；沒有 profile 列或沒有 `srs` → 預設值；有 `srs` 但不合法 → internal（不默默改用預設）。 */
export async function readSrsSettings(client: ReviewDbClient, userId: UserId): Promise<Result<SrsSettings, AppError>> {
  const res = await runDb('select profile', () => client.from('profile').select('settings').eq('user_id', userId).maybeSingle());
  if (!res.ok) return err(res.error);
  const settings = res.value?.['settings'];
  const srs = typeof settings === 'object' && settings !== null && 'srs' in settings ? settings.srs : {};
  const parsed = SrsSettingsSchema.safeParse(srs);
  if (!parsed.success) return err({ kind: 'internal', message: 'profile.settings.srs is invalid' });
  return ok(parsed.data);
}

/** 錯誤碼對應（ARCHITECTURE §4.11）：23505、40001 → conflict；P0002 → not_found；其他 → db_failed。訊息不含任何值。 */
function mapRecordError(code: string | undefined): AppError {
  switch (code) {
    case '23505':
    case '40001':
      return { kind: 'conflict', entity: 'card', message: 'record_card_review conflict' };
    case 'P0002':
      return { kind: 'not_found', entity: 'card', message: 'card not found' };
    default:
      return { kind: 'db_failed', message: code === undefined ? 'record_card_review failed' : `record_card_review failed (${code})` };
  }
}

/** 呼叫 SQL 函式 record_card_review：比對舊值、更新 card、寫 card_review，同一個交易（一天一次由唯一約束保證）。 */
export async function recordCardReview(
  client: ReviewDbClient,
  input: RecordReviewInput,
): Promise<Result<{ readonly id: CardId; readonly schedule: CardSchedule }, AppError>> {
  const { before, outcome } = input;
  const res = await tryCatchAsync(
    async () =>
      await client.rpc('record_card_review', {
        p_card_id: input.cardId,
        p_review_date: input.reviewDate,
        p_mode: input.mode,
        p_rating: input.rating,
        p_expected_state: before.state,
        p_expected_correct_count: before.correctCount,
        p_expected_interval_step: before.intervalStep,
        p_expected_due_date: before.dueDate,
        p_new_state: outcome.schedule.state,
        p_new_correct_count: outcome.schedule.correctCount,
        p_new_interval_step: outcome.schedule.intervalStep,
        p_new_due_date: outcome.schedule.dueDate,
        p_interval_days_applied: outcome.intervalDaysApplied,
      }),
    (): AppError => ({ kind: 'db_failed', message: 'record_card_review failed' }),
  );
  if (!res.ok) return err(res.error);
  if (res.value.error !== null) return err(mapRecordError(res.value.error.code));
  return ok({ id: input.cardId, schedule: outcome.schedule });
}

/** endpoint 拿到的入口：沒有 client、沒有 `{ data, error }`（ADR-008 修訂 1）。 */
export type ReviewDb = {
  readonly readCardForReview: (id: CardId) => Promise<Result<Card | null, AppError>>;
  readonly readSrsSettings: () => Promise<Result<SrsSettings, AppError>>;
  readonly recordCardReview: (
    input: RecordReviewInput,
  ) => Promise<Result<{ readonly id: CardId; readonly schedule: CardSchedule }, AppError>>;
};

export function reviewDbFrom(client: ReviewDbClient, userId: UserId): ReviewDb {
  return {
    readCardForReview: (id) => readCardForReview(client, id),
    readSrsSettings: () => readSrsSettings(client, userId),
    recordCardReview: (input) => recordCardReview(client, input),
  };
}

export function createReviewDb(ctx: AuthContext, env: SupabaseEnv): ReviewDb {
  return reviewDbFrom(createUserClient(ctx, env), ctx.userId);
}
