import { denoEnv } from '../_shared/config/deno-env.ts';
import { loadSupabaseSecretEnv } from '../_shared/config/env.ts';
import { purgeDepsFrom, purgeExpiredAudio } from '../_shared/db/audio-purge.ts';
import { createServiceClient } from '../_shared/db/service-db.ts';
import { createPurgeHandler } from './handler.ts';

// 只做組裝（ARCHITECTURE §4.12.2）：secret client 只在這裡建立。
const now = (): Date => new Date();

Deno.serve(
  createPurgeHandler({
    env: loadSupabaseSecretEnv(denoEnv),
    purge: (env) => purgeExpiredAudio(purgeDepsFrom(createServiceClient(env)), now()),
    now,
    log: (line) => {
      console.log(line);
    },
  }),
);
