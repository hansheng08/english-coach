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

function decodeJsonPart(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadProbeSecret(): Promise<{ secret?: string; source: string }> {
  const fromEnv = Deno.env.get('O003_PROBE_JWT_SECRET');
  if (fromEnv && fromEnv.length > 0) return { secret: fromEnv, source: 'env' };
  try {
    const text = (await Deno.readTextFile(new URL('./.o003-jwt-secret', import.meta.url))).trim();
    if (text.length > 0) return { secret: text, source: 'file' };
  } catch {
    // file is written only at CI runtime in the staged workdir
  }
  return { source: 'none' };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyHs256(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToBytes(parts[2]);
  const signed = new Uint8Array(await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, data));
  if (!timingSafeEqual(signed, signature)) return null;
  return decodeJsonPart(parts[1]);
}

function subjectOf(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.sub === 'string' && payload.sub.length > 0) return payload.sub;
  // Auth GET /user returns the user row (id), not a JWT payload (sub).
  if (typeof payload.id === 'string' && payload.id.length > 0) return payload.id;
  return undefined;
}

function isUserPayload(payload: Record<string, unknown>): boolean {
  return payload.role === 'authenticated' && payload.is_anonymous !== true && subjectOf(payload) !== undefined;
}

function publishableApiKey(): string {
  const publishable = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (publishable) {
    try {
      const parsed: unknown = JSON.parse(publishable);
      if (parsed && typeof parsed === 'object' && parsed !== null && 'default' in parsed) {
        const def = (parsed as { default?: unknown }).default;
        if (typeof def === 'string' && def.length > 0) return def;
      }
    } catch {
      if (publishable.length > 0 && !publishable.startsWith('{')) return publishable;
    }
  }
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}

function authBaseUrls(): string[] {
  const raw = Deno.env.get('SUPABASE_URL');
  const urls: string[] = [];
  const add = (u?: string | null) => {
    if (u && u.length > 0 && !urls.includes(u)) urls.push(u);
  };
  add(raw);
  if (raw) {
    add(raw.replace(/127\.0\.0\.1|localhost/g, 'kong').replace(/:54321\b/, ':8000'));
    add(raw.replace(/127\.0\.0\.1|localhost/g, 'host.docker.internal'));
  }
  add('http://kong:8000');
  add('http://auth:9999');
  add('http://supabase_kong_english-coach-ci-probe:8000');
  add('http://supabase_auth_english-coach-ci-probe:9999');
  return urls;
}

async function authUserPayload(token: string): Promise<Record<string, unknown> | null> {
  const apikey = publishableApiKey();
  const pathsFor = (base: string): string[] => {
    if (base.includes(':9999')) return [`${base}/user`, `${base}/auth/v1/user`];
    return [`${base}/auth/v1/user`, `${base}/user`];
  };
  for (const base of authBaseUrls()) {
    for (const url of pathsFor(base)) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, apikey },
        });
        console.log(`o003-auth-fetch status=${response.status}`);
        if (!response.ok) continue;
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') continue;
        return body as Record<string, unknown>;
      } catch (err) {
        const name = err instanceof Error ? err.name : 'unknown';
        console.log(`o003-auth-fetch-error name=${name}`);
      }
    }
  }
  return null;
}

async function isAuthenticatedUser(token: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    const header = parts.length >= 1 ? decodeJsonPart(parts[0]) : null;
    const unverified = parts.length >= 2 ? decodeJsonPart(parts[1]) : null;
    const { secret, source } = await loadProbeSecret();
    const alg = typeof header?.alg === 'string' ? header.alg : 'none';
    let hs256 = 'skipped';
    let payload: Record<string, unknown> | null = null;
    // Local GoTrue (CLI 3.2.0) issues user access tokens as ES256; JWT_SECRET HS256
    // only verifies legacy/anon tokens. Use Auth /user for non-HS256.
    if (secret && alg === 'HS256') {
      payload = await verifyHs256(token, secret);
      hs256 = payload ? 'ok' : 'mismatch';
    } else if (secret && alg !== 'HS256') {
      hs256 = 'skipped_alg';
    }
    const sourcePayload = payload ?? await authUserPayload(token);
    const accepted = sourcePayload !== null && isUserPayload(sourcePayload);
    const claims = payload ?? unverified;
    console.log(
      `o003-auth has_probe_secret=${secret ? 'true' : 'false'} secret_source=${source} alg=${alg} jwt_parts=${parts.length} hs256=${hs256} role=${String(claims?.role ?? sourcePayload?.role ?? 'none')} has_sub=${typeof claims?.sub === 'string'} has_id=${typeof sourcePayload?.id === 'string'} is_anonymous=${String((sourcePayload ?? claims)?.is_anonymous)} accepted=${accepted}`,
    );
    return accepted;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    console.log(`o003-auth-error name=${name}`);
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
