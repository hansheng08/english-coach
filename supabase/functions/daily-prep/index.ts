import { map, NtdSchema } from '@english-coach/contracts';
import { denoEnv } from '../_shared/config/deno-env.ts';
import { loadSupabaseSecretEnv } from '../_shared/config/env.ts';
import { planStoreFrom } from '../_shared/db/plan-store.ts';
import { createServiceClient, listProfileUserIds } from '../_shared/db/service-db.ts';
import { runPrepare } from '../_shared/plan/prepare.ts';
import { DEFAULT_SETTINGS } from '../_shared/providers/registry.ts';
import { createProviders, realFetch } from '../_shared/providers/wiring.ts';
import { createDailyPrepHandler } from './handler.ts';

// 只做組裝（ARCHITECTURE §4.12.1）：secret client 只在這裡建立；使用者資料的查詢都經 planStoreFrom(client.plan, userId)。
const now = (): Date => new Date();

Deno.serve(
  createDailyPrepHandler({
    env: loadSupabaseSecretEnv(denoEnv),
    open: (env) => {
      const client = createServiceClient(env);
      const providers = createProviders({ env: denoEnv, fetch: realFetch });
      return {
        listUserIds: () => listProfileUserIds(client.plan),
        prepare: (userId, planDate) => {
          // 免費供應商不看用量；T-020 的 sumPaidUsageThisMonthNtd 還不在 main，暫傳 0（同 api/plan.ts，由 T-020 的用量接線換成函式）。
          const llm = map(providers.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0)), (provider) => ({
            llm: provider,
            model: DEFAULT_SETTINGS.llm.model,
          }));
          return runPrepare({ store: planStoreFrom(client.plan, userId), llm, fetch: realFetch, now, log: () => undefined }, userId, planDate);
        },
      };
    },
    now,
    log: (line) => {
      console.log(line);
    },
  }),
);
