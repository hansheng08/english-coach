// CI probe (O-003, log prefixes productized in O-005). Not product code (product api lands in T-003).
// ADR-009 (1): import @english-coach/contracts and actually use it.
// ADR-010: verify_jwt = false; GET /health requires a user JWT (role=authenticated).
import { httpStatusOf, toApiErrorBody, type AppError } from '@english-coach/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJsonPart(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function publishableApiKey(): string {
  const publishable = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (!publishable) return '';
  try {
    const parsed: unknown = JSON.parse(publishable);
    if (parsed && typeof parsed === 'object' && 'default' in parsed) {
      const def = (parsed as { default?: unknown }).default;
      if (typeof def === 'string') return def;
    }
  } catch { /* not JSON */ }
  return '';
}

let authClient: SupabaseClient | undefined;
function getAuthClient(): SupabaseClient {
  authClient ??= createClient(Deno.env.get('SUPABASE_URL') ?? '', publishableApiKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return authClient;
}

async function isAuthenticatedUser(token: string): Promise<boolean> {
  try {
    const header = decodeJsonPart(token.split('.')[0] ?? '');
    const { data, error } = await getAuthClient().auth.getClaims(token);
    const claims = data?.claims;
    const accepted = !error && claims?.role === 'authenticated' && claims?.is_anonymous !== true &&
      typeof claims?.sub === 'string' && claims.sub.length > 0;
    const alg = typeof header?.alg === 'string' ? header.alg : 'none';
    const hasKid = typeof header?.kid === 'string';
    const path = !alg.startsWith('HS') && hasKid ? 'jwks' : 'auth_user_fallback';
    console.log(`adr010-auth via=getClaims alg=${alg} has_kid=${hasKid} path=${path} error=${error ? error.name : 'none'} role=${String(claims?.role ?? 'none')} accepted=${accepted}`);
    return accepted;
  } catch (err) {
    console.log(`adr010-auth-error name=${err instanceof Error ? err.name : 'unknown'}`);
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const status = injectedKeyStatus();
    console.log(
      `adr010-env has_supabase_url=${status.hasUrl} has_publishable=${status.hasPublishable} has_secret=${status.hasSecret} only_legacy_keys=${status.onlyLegacyKeys}`,
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
  } catch (err) {
    const message = err instanceof Error ? err.name : 'unknown';
    console.log(`adr010-handler-error name=${message}`);
    return jsonError({ kind: 'unauthenticated', message: 'missing or invalid jwt' });
  }
});
