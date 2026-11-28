import {
  httpStatusOf,
  toApiErrorBody,
  type AppError,
  type Result,
} from '@english-coach/contracts';
import type { SupabaseSecretEnv } from '../_shared/config/env.ts';
import { requireServiceKey } from '../_shared/db/auth.ts';
import type { PurgeRun, PurgeStats, PurgeTableStats } from '../_shared/db/audio-purge.ts';

export type PurgeHandlerDeps = {
  readonly env: Result<SupabaseSecretEnv, AppError>;
  readonly purge: (env: SupabaseSecretEnv) => Promise<PurgeRun>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const triple = (s: PurgeTableStats): string => `${String(s.selected)}/${String(s.purged)}/${String(s.failed)}`;

/** 每次執行只寫這一行：只有數字、錯誤種類與階段，不含路徑、id、金鑰、錯誤 message（§4.12.2）。 */
function logLine(stats: PurgeStats, error: AppError | null, phase: string): string {
  const base = `purge-audio shadow=${triple(stats.shadow)} evening=${triple(stats.evening)} orphan=${triple(stats.orphan)}`;
  return error === null ? base : `${base} error=${error.kind} phase=${phase}`;
}

/** index.ts 只組裝；這裡不建立 secret client。 */
export function createPurgeHandler(deps: PurgeHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!deps.env.ok) return json(httpStatusOf(deps.env.error), toApiErrorBody(deps.env.error));
    const env = deps.env.value;
    const auth = requireServiceKey(req, env);
    if (!auth.ok) return json(httpStatusOf(auth.error), toApiErrorBody(auth.error));

    const run = await deps.purge(env);
    // phase 由 purgeExpiredAudio 帶出；沒帶時（只有孤兒階段會產生 storage_failed list）視為 orphan。
    deps.log(logLine(run.stats, run.error, run.phase ?? 'orphan'));
    if (run.error === null) return json(200, run.stats);
    return json(httpStatusOf(run.error), toApiErrorBody(run.error));
  };
}
