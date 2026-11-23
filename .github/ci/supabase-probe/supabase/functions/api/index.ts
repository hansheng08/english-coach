// CI probe for O-003 only. Not product code (product api lands in T-003).
// ADR-009 (1): import @english-coach/contracts and actually use it.
// ADR-010: verify_jwt = false; GET /health requires a user JWT (role=authenticated).
import { httpStatusOf, toApiErrorBody, type AppError } from '@english-coach/contracts';

function jsonError(error: AppError, status = httpStatusOf(error)): Response {
  return Response.json(toApiErrorBody(error), { status });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

function envPresent(name: string): boolean {
  const value = Deno.env.get(name);
  return typeof value === 'string' && value.length > 0;
}

function injectedKeyStatus(): { hasUrl: boolean; hasPublishable: boolean; hasSecret: boolean; onlyLegacyKeys: boolean } {
  const hasUrl = envPresent('SUPABASE_URL');
  const hasPublishable = envPresent('SUPABASE_PUBLISHABLE_KEYS') || envPresent('SUPABASE_PUBLISHABLE_KEY');
  const hasSecret = envPresent('SUPABASE_SECRET_KEYS') || envPresent('SUPABASE_SECRET_KEY');
  const onlyLegacyKeys = !hasPublishable && !hasSecret &&
    (envPresent('SUPABASE_ANON_KEY') || envPresent('SUPABASE_SERVICE_ROLE_KEY'));
  return { hasUrl, hasPublishable, hasSecret, onlyLegacyKeys };
}

async function isAuthenticatedUser(token: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishable = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  let apikey: string | undefined;
  if (publishable) {
    try {
      const parsed: unknown = JSON.parse(publishable);
      if (parsed && typeof parsed === 'object' && parsed !== null && 'default' in parsed) {
        const def = (parsed as { default?: unknown }).default;
        if (typeof def === 'string') apikey = def;
      }
    } catch {
      apikey = undefined;
    }
  }
  if (!apikey) apikey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  // Product code must not fall back to SUPABASE_ANON_KEY (ADR-010). This probe
  // may use it only to call local Auth /user when checking a token, so that
  // 401 vs 200 can still be observed; a later CI step flags only-legacy-keys.
  if (!apikey) apikey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !apikey) return false;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey,
    },
  });
  if (!response.ok) return false;
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') return false;
  const role = (body as { role?: unknown }).role;
  const isAnonymous = (body as { is_anonymous?: unknown }).is_anonymous;
  return role === 'authenticated' && isAnonymous !== true;
}

Deno.serve(async (req) => {
  const status = injectedKeyStatus();
  // Presence only — never values — for the CI job to grep.
  console.log(
    `o003-env has_supabase_url=${status.hasUrl} has_publishable=${status.hasPublishable} has_secret=${status.hasSecret} only_legacy_keys=${status.onlyLegacyKeys}`,
  );

  const url = new URL(req.url);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const isHealth = req.method === 'GET' &&
    (url.pathname === '/health' || url.pathname.endsWith('/health'));
  if (!isHealth) {
    return jsonError({ kind: 'not_found', entity: 'plan', message: 'not found' });
  }

  const token = bearerToken(req);
  if (!token || !(await isAuthenticatedUser(token))) {
    return jsonError({ kind: 'unauthenticated', message: 'missing or invalid jwt' });
  }

  if (!status.hasUrl || !status.hasPublishable || status.onlyLegacyKeys) {
    return jsonError({
      kind: 'internal',
      message: 'SUPABASE_URL or publishable key missing, or only legacy key names injected; report to Architect (ADR-010)',
    });
  }
  return Response.json({ ok: true }, { status: 200 });
});
