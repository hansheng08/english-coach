import { map } from '@english-coach/contracts';
import { denoEnv } from '../_shared/config/deno-env.ts';
import { keyPresence, loadAllowedOrigins, loadSupabaseEnv } from '../_shared/config/env.ts';
import { createGetClaimsVerifier } from '../_shared/db/auth.ts';
import { createRouter } from './router.ts';

const router = createRouter({
  auth: map(loadSupabaseEnv(denoEnv), (env) => ({ verifyToken: createGetClaimsVerifier(env) })),
  allowedOrigins: loadAllowedOrigins(denoEnv),
  keyPresence: keyPresence(denoEnv),
  log: (line) => {
    console.log(line);
  },
});

Deno.serve(router);
