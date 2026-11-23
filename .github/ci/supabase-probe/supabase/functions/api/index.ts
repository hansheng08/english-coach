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

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyHs256(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  if (!payload || typeof payload !== 'object') return null;
  return payload as Record<string, unknown>;
}

function isUserPayload(payload: Record<string, unknown>): boolean {
  return payload.role === 'authenticated' && payload.is_anonymous !== true && typeof payload.sub === 'string' &&
    payload.sub.length > 0;
}

async function isAuthenticatedUser(token: string): Promise<boolean> {
  try {
    // Probe-only secret from supabase status -o env (not a product env name).
    // Avoids calling Auth via 127.0.0.1 from inside the Edge Runtime container.
    const probeSecret = Deno.env.get('O003_PROBE_JWT_SECRET');
    if (probeSecret) {
      const payload = await verifyHs256(token, probeSecret);
      return payload !== null && isUserPayload(payload);
    }

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
    if (!apikey) apikey = Deno.env.get('SUPABASE_ANON_KEY');
    const urls = [supabaseUrl, 'http://kong:8000'].filter((u): u is string => typeof u === 'string' && u.length > 0);
    for (const url of urls) {
      try {
        const response = await fetch(`${url}/auth/v1/user`, {
          headers: { Authorization: `Bearer ${token}`, apikey: apikey ?? '' },
        });
        if (!response.ok) continue;
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') continue;
        return isUserPayload(body as Record<string, unknown>);
      } catch {
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const status = injectedKeyStatus();
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
  } catch (err) {
    const message = err instanceof Error ? err.name : 'unknown';
    console.log(`o003-handler-error name=${message}`);
    return jsonError({ kind: 'unauthenticated', message: 'missing or invalid jwt' });
  }
});
