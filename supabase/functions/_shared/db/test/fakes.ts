import { err, type AppError, type Result } from '@english-coach/contracts';
import type { DbClient, DbResponse } from '../client.ts';
import type { PlanStore } from '../plan-store.ts';
import type { UserDb } from '../user-db.ts';

type FromResult = ReturnType<DbClient['from']>;

/** 測試用 DbClient：沒覆寫的方法回 `{ data: null, error: { code: 'TEST', message: 'not stubbed: <表>.<方法>' } }`（ARCHITECTURE §5.1.1）。 */
export function makeTestDbClient(overrides?: { readonly from?: (table: string) => Partial<FromResult> }): DbClient {
  return {
    from: (table) => {
      const given = overrides?.from?.(table) ?? {};
      return {
        insert:
          given.insert ??
          (() =>
            Promise.resolve<DbResponse<unknown>>({
              data: null,
              error: { code: 'TEST', message: `not stubbed: ${table}.insert` },
            })),
      };
    },
  };
}

const notStubbed = (name: string): Promise<Result<never, AppError>> =>
  Promise.resolve(err({ kind: 'internal', message: `not stubbed: ${name}` }));

/** 測試用 PlanStore：沒覆寫的方法回 `err({ kind: 'internal', message: 'not stubbed: <名稱>' })`（ARCHITECTURE §5.1.1）。 */
export function makeTestPlanStore(overrides?: Partial<PlanStore>): PlanStore {
  return {
    insertPending: () => notStubbed('insertPending'),
    readPlan: () => notStubbed('readPlan'),
    reclaim: () => notStubbed('reclaim'),
    complete: () => notStubbed('complete'),
    fail: () => notStubbed('fail'),
    readNewsSettings: () => notStubbed('readNewsSettings'),
    listNewsSources: () => notStubbed('listNewsSources'),
    isArticleUsed: () => notStubbed('isArticleUsed'),
    insertArticle: () => notStubbed('insertArticle'),
    readFallbackArticle: () => notStubbed('readFallbackArticle'),
    listCardCandidates: () => notStubbed('listCardCandidates'),
    listQuestionCandidates: () => notStubbed('listQuestionCandidates'),
    readRewriteSource: () => notStubbed('readRewriteSource'),
    ...overrides,
  };
}

/** 測試用 UserDb：沒覆寫的方法回 `err({ kind: 'internal', message: 'not stubbed: <名稱>' })`；覆寫的值取代預設值。 */
export function makeTestUserDb(overrides?: Partial<UserDb>): UserDb {
  return {
    insertProviderCall: () => notStubbed('insertProviderCall'),
    insertCheckin: () => notStubbed('insertCheckin'),
    ...overrides,
  };
}
