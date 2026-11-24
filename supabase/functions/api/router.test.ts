import { ApiErrorBodySchema, err, ok, HealthResponseSchema, type AppError, type Result } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { KeyPresence } from '../_shared/config/env.ts';
import type { TokenClaims, VerifyToken } from '../_shared/db/auth.ts';
import { createRouter, ROUTES, routePath, type RouterDeps } from './router.ts';

const UUID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';
const PRESENCE: KeyPresence = { hasSupabaseUrl: true, hasPublishable: true, hasSecret: true, onlyLegacyKeys: false };
const ENV_LINE = 'adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false';
const GOOD: TokenClaims = { role: 'authenticated', sub: UUID, is_anonymous: false };

type Harness = { readonly handle: (req: Request) => Promise<Response>; readonly logs: string[]; readonly verifyCalls: () => number };

function harness(opts: {
  readonly verify?: VerifyToken;
  readonly auth?: Result<{ readonly verifyToken: VerifyToken }, AppError>;
  readonly origins?: readonly string[];
}): Harness {
  let calls = 0;
  const inner: VerifyToken = opts.verify ?? (() => Promise.resolve(ok(GOOD)));
  const counted: VerifyToken = (token) => {
    calls += 1;
    return inner(token);
  };
  const logs: string[] = [];
  const deps: RouterDeps = {
    auth: opts.auth ?? ok({ verifyToken: counted }),
    allowedOrigins: opts.origins ?? ['http://localhost:5173'],
    keyPresence: PRESENCE,
    log: (line) => {
      logs.push(line);
    },
  };
  return { handle: createRouter(deps), logs, verifyCalls: () => calls };
}

const req = (method: string, path: string, headers: Record<string, string> = {}): Request =>
  new Request(`http://localhost${path}`, { method, headers });
const bearer = { Authorization: 'Bearer a.b.c' };

async function errorKind(res: Response): Promise<string> {
  const parsed = ApiErrorBodySchema.parse(await res.json());
  return parsed.error.kind;
}

describe('ROUTES authentication', () => {
  const entries = Object.keys(ROUTES).map((key) => {
    const [method = '', path = ''] = key.split(' ');
    return { key, method, path };
  });
  it('(AC-T3-5) has at least one route', () => {
    expect(entries.length).toBeGreaterThan(0);
  });
  for (const { key, method, path } of entries) {
    it(`(AC-T3-5) ${key}: no token → 401 unauthenticated`, async () => {
      const h = harness({});
      const res = await h.handle(req(method, `/api${path}`));
      expect(res.status).toBe(401);
      expect(await errorKind(res)).toBe('unauthenticated');
      expect(h.verifyCalls()).toBe(0);
    });
    it(`(AC-T3-5) ${key}: verifyToken err → 401 unauthenticated`, async () => {
      const h = harness({ verify: () => Promise.resolve(err({ kind: 'unauthenticated', message: 'x' })) });
      const res = await h.handle(req(method, `/api${path}`, bearer));
      expect(res.status).toBe(401);
      expect(await errorKind(res)).toBe('unauthenticated');
    });
    it(`(AC-T3-5) ${key}: role is not authenticated → 401 unauthenticated`, async () => {
      const h = harness({ verify: () => Promise.resolve(ok({ role: 'anon', sub: UUID, is_anonymous: false })) });
      const res = await h.handle(req(method, `/api${path}`, bearer));
      expect(res.status).toBe(401);
      expect(await errorKind(res)).toBe('unauthenticated');
    });
  }
});

describe('GET health', () => {
  for (const path of ['/api/health', '/health', '/functions/v1/api/health']) {
    it(`(AC-T3-5) GET ${path} with a valid token → 200 { ok: true }`, async () => {
      const h = harness({});
      const res = await h.handle(req('GET', path, bearer));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      const body = HealthResponseSchema.parse(await res.json());
      expect(body).toEqual({ ok: true });
    });
  }

  it('(AC-T3-5) an allowed origin also gets Access-Control-Allow-Origin on the 200', async () => {
    const h = harness({});
    const res = await h.handle(req('GET', '/api/health', { ...bearer, Origin: 'http://localhost:5173' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Vary')).toBe('Origin');
  });
});

describe('OPTIONS', () => {
  it('(AC-T3-5) OPTIONS → 204 and verifyToken is not called', async () => {
    const h = harness({});
    const res = await h.handle(req('OPTIONS', '/api/health'));
    expect(res.status).toBe(204);
    expect(h.verifyCalls()).toBe(0);
  });
  it('(AC-T3-5) OPTIONS from an allowed origin gets CORS headers', async () => {
    const h = harness({});
    const res = await h.handle(req('OPTIONS', '/api/health', { Origin: 'http://localhost:5173' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS');
  });
  it('(AC-T3-5) OPTIONS from an unknown origin gets no Access-Control-Allow-Origin', async () => {
    const h = harness({});
    const res = await h.handle(req('OPTIONS', '/api/health', { Origin: 'http://evil.example' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('(AC-T3-5) OPTIONS is still 204 when deps.auth is err', async () => {
    const h = harness({ auth: err({ kind: 'internal', message: 'missing env SUPABASE_URL' }) });
    const res = await h.handle(req('OPTIONS', '/api/health'));
    expect(res.status).toBe(204);
  });
});

describe('errors', () => {
  it('(AC-T3-5) deps.auth err → 500 internal and verifyToken is not called', async () => {
    const h = harness({ auth: err({ kind: 'internal', message: 'missing env SUPABASE_URL' }) });
    const res = await h.handle(req('GET', '/api/health', bearer));
    expect(res.status).toBe(500);
    expect(await errorKind(res)).toBe('internal');
    expect(h.verifyCalls()).toBe(0);
  });

  const unknownRoutes: readonly (readonly [string, string])[] = [
    ['GET', '/api/healthx'],
    ['GET', '/foo/health'],
    ['POST', '/api/health'],
  ];
  for (const [method, path] of unknownRoutes) {
    it(`(AC-T3-5) ${method} ${path} with a valid token → 400 validation`, async () => {
      const h = harness({});
      const res = await h.handle(req(method, path, bearer));
      expect(res.status).toBe(400);
      expect(await errorKind(res)).toBe('validation');
    });
  }

  it('(AC-T3-5) GET /api/healthx without a token → 401', async () => {
    const h = harness({});
    const res = await h.handle(req('GET', '/api/healthx'));
    expect(res.status).toBe(401);
  });

  it('(AC-T3-5) a throwing verifyToken → 500 internal and logs only the error name', async () => {
    const h = harness({
      verify: () => {
        throw new Error('secret-detail');
      },
    });
    const res = await h.handle(req('GET', '/api/health', bearer));
    expect(res.status).toBe(500);
    expect(await errorKind(res)).toBe('internal');
    expect(h.logs[1]).toBe('api-handler-error name=Error');
    expect(h.logs.join('\n').includes('secret-detail')).toBe(false);
  });
});

describe('logging', () => {
  const cases: readonly (readonly [string, () => Harness, Request])[] = [
    ['OPTIONS', () => harness({}), req('OPTIONS', '/api/health')],
    ['401', () => harness({}), req('GET', '/api/health')],
    ['500', () => harness({ auth: err({ kind: 'internal', message: 'x' }) }), req('GET', '/api/health', bearer)],
    ['200', () => harness({}), req('GET', '/api/health', bearer)],
  ];
  for (const [label, make, request] of cases) {
    it(`(AC-T3-5) ${label}: deps.log is called exactly once with the adr010-env line`, async () => {
      const h = make();
      await h.handle(request);
      expect(h.logs).toEqual([ENV_LINE]);
    });
  }
});

describe('routePath', () => {
  it('(AC-T3-5) strips the optional /functions/v1 and /api prefixes', () => {
    expect(routePath('/health')).toBe('/health');
    expect(routePath('/api/health')).toBe('/health');
    expect(routePath('/functions/v1/api/health')).toBe('/health');
  });
  it('(AC-T3-5) does not treat other paths as /health', () => {
    expect(routePath('/api/healthx')).toBe('/healthx');
    expect(routePath('/foo/health')).toBe('/foo/health');
  });
});
