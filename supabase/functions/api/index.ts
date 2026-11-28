import { map } from '@english-coach/contracts';
import { denoEnv } from '../_shared/config/deno-env.ts';
import { keyPresence, loadAllowedOrigins, loadSupabaseEnv } from '../_shared/config/env.ts';
import { createGetClaimsVerifier } from '../_shared/db/auth.ts';
import { createPlanStore } from '../_shared/db/plan-store.ts';
import { createReviewDb } from '../_shared/db/reviews.ts';
import { createTtsStore } from '../_shared/db/tts-store.ts';
import { createUserDb } from '../_shared/db/user-db.ts';
import { createProviders, realFetch } from '../_shared/providers/wiring.ts';
import { createRouter } from './router.ts';

const supabaseEnv = loadSupabaseEnv(denoEnv);

const router = createRouter({
  auth: map(supabaseEnv, (env) => ({ verifyToken: createGetClaimsVerifier(env) })),
  routeDeps: map(supabaseEnv, (env) => ({
    userDb: (ctx) => createUserDb(ctx, env),
    now: () => new Date(),
    reviewDb: (ctx) => createReviewDb(ctx, env),
    planStore: (ctx) => createPlanStore(ctx, env),
    providers: createProviders({ env: denoEnv, fetch: realFetch }),
    fetch: realFetch,
    ttsStore: (ctx) => createTtsStore(ctx, env),
    log: (line) => {
      console.log(line);
    },
  })),
  allowedOrigins: loadAllowedOrigins(denoEnv),
  keyPresence: keyPresence(denoEnv),
  log: (line) => {
    console.log(line);
  },
});

Deno.serve(router);
