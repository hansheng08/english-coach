import { map } from '@english-coach/contracts';
import { denoEnv } from '../_shared/config/deno-env.ts';
import { keyPresence, loadAllowedOrigins, loadSupabaseEnv } from '../_shared/config/env.ts';
import { createGetClaimsVerifier } from '../_shared/db/auth.ts';
import { createReviewDb } from '../_shared/db/reviews.ts';
import { createUserDb } from '../_shared/db/user-db.ts';
import { createRouter } from './router.ts';

const supabaseEnv = loadSupabaseEnv(denoEnv);

const router = createRouter({
  auth: map(supabaseEnv, (env) => ({ verifyToken: createGetClaimsVerifier(env) })),
  routeDeps: map(supabaseEnv, (env) => ({
    userDb: (ctx) => createUserDb(ctx, env),
    now: () => new Date(),
    reviewDb: (ctx) => createReviewDb(ctx, env),
  })),
  allowedOrigins: loadAllowedOrigins(denoEnv),
  keyPresence: keyPresence(denoEnv),
  log: (line) => {
    console.log(line);
  },
});

Deno.serve(router);
