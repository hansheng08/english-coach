import { httpStatusOf, toApiErrorBody, type AppError, type HealthResponse, type Result } from '@english-coach/contracts';
import { formatAdr010EnvLine, type KeyPresence } from '../_shared/config/env.ts';
import { requireUser, type AuthContext, type RequireUserDeps } from '../_shared/db/auth.ts';
import type { ReviewDb } from '../_shared/db/reviews.ts';
import type { UserDb } from '../_shared/db/user-db.ts';
import { postCheckins } from './checkins.ts';
import { postReviews } from './reviews.ts';

export type RouteDeps = {
  readonly userDb: (ctx: AuthContext) => UserDb;
  readonly now: () => Date;
  /** 暫時選填（ARCHITECTURE §5.1.1 過渡），待 T-025a 改回必填；沒接時 POST /reviews 回 500 internal。 */
  readonly reviewDb?: (ctx: AuthContext) => ReviewDb;
};
export type Route = (req: Request, ctx: AuthContext, deps: RouteDeps) => Promise<Response>;
export type RouteKey = 'GET /health' | 'POST /checkins' | 'POST /reviews';

export type RouterDeps = {
  readonly auth: Result<RequireUserDeps, AppError>;
  readonly routeDeps: Result<RouteDeps, AppError>;
  readonly allowedOrigins: readonly string[];
  readonly keyPresence: KeyPresence;
  readonly log: (line: string) => void;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

const health = (): Promise<Response> => {
  const body: HealthResponse = { ok: true };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS }));
};

/** 沒有公開路由：每一條都只會在 requireUser 成功後被呼叫。 */
export const ROUTES: Readonly<Record<RouteKey, Route>> = {
  'GET /health': health,
  'POST /checkins': postCheckins,
  'POST /reviews': postReviews,
};

const PATH_PREFIX = /^(?:\/functions\/v1)?(?:\/api)?(\/.*)$/;

/** 去掉可有可無的 /functions/v1 與 /api 前綴（不得用 endsWith）。 */
export function routePath(pathname: string): string {
  return PATH_PREFIX.exec(pathname)?.[1] ?? pathname;
}

function isRouteKey(key: string): key is RouteKey {
  return Object.keys(ROUTES).includes(key);
}

function corsHeaders(req: Request, allowedOrigins: readonly string[]): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  const origin = req.headers.get('Origin');
  if (origin !== null && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }
  return headers;
}

function errorResponse(e: AppError, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(toApiErrorBody(e)), { status: httpStatusOf(e), headers });
}

function withCors(res: Response, cors: Headers): Response {
  const headers = new Headers(res.headers);
  cors.forEach((value, name) => {
    headers.set(name, value);
  });
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function createRouter(deps: RouterDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    deps.log(formatAdr010EnvLine(deps.keyPresence));
    const cors = corsHeaders(req, deps.allowedOrigins);
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (!deps.auth.ok) return errorResponse(deps.auth.error, cors);

      const user = await requireUser(req, deps.auth.value);
      if (!user.ok) return errorResponse(user.error, cors);

      const key = `${req.method} ${routePath(new URL(req.url).pathname)}`;
      if (!isRouteKey(key)) {
        return errorResponse(
          {
            kind: 'validation',
            message: 'unknown route',
            issues: [{ path: 'route', message: 'unknown route' }],
          },
          cors,
        );
      }
      // health 不使用 deps：routeDeps 載入失敗時仍要回 200。
      if (key === 'GET /health') return withCors(await health(), cors);
      if (!deps.routeDeps.ok) return errorResponse(deps.routeDeps.error, cors);
      return withCors(await ROUTES[key](req, user.value, deps.routeDeps.value), cors);
    } catch (e) {
      deps.log(`api-handler-error name=${e instanceof Error ? e.name : 'unknown'}`);
      return errorResponse({ kind: 'internal', message: 'unhandled error' }, cors);
    }
  };
}
