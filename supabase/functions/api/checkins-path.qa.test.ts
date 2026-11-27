import { ApiErrorBodySchema, ok } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { UserDb } from '../_shared/db/user-db.ts';
import { createRouter } from './router.ts';

// QA probe for T-053 AC-T53-2（介面：issue.path 以 '.' 連接）。現行 schema 的 issue 只有一層 path，
// 所以這裡把 CheckinEventSchema 換成回多層 path 的假 schema，直接驗證對應規則。
vi.mock('@english-coach/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@english-coach/contracts')>();
  return {
    ...actual,
    CheckinEventSchema: {
      safeParse: () => ({
        success: false,
        error: {
          issues: [
            { path: ['a', 'b', 0], message: 'nested' },
            { path: [], message: 'root' },
          ],
        },
      }),
    },
  };
});

describe('T-053 QA validation issue paths', () => {
  it('(QA-10) zod issue paths are joined with dots, root issues get an empty path, and nothing is written', async () => {
    const insertCheckin = vi.fn<UserDb['insertCheckin']>(() => Promise.resolve(ok(null)));
    const userDb = vi.fn((): UserDb => ({ insertProviderCall: () => Promise.resolve(ok(null)), insertCheckin }));
    const handle = createRouter({
      auth: ok({ verifyToken: () => Promise.resolve(ok({ role: 'authenticated', sub: '00000000-0000-4000-8000-000000000053', is_anonymous: false })) }),
      routeDeps: ok({ userDb, now: () => new Date('2026-11-27T04:00:00Z') }),
      allowedOrigins: [],
      keyPresence: { hasSupabaseUrl: true, hasPublishable: true, hasSecret: true, onlyLegacyKeys: false },
      log: () => undefined,
    });
    const req = new Request('http://localhost/api/checkins', { method: 'POST', headers: { Authorization: 'Bearer a.b.c' }, body: '{}' });
    const res = await handle(req);
    expect(res.status).toBe(400);
    const body = ApiErrorBodySchema.parse(await res.json()).error;
    expect(body.kind).toBe('validation');
    expect(body.issues).toEqual([
      { path: 'a.b.0', message: 'nested' },
      { path: '', message: 'root' },
    ]);
    expect(userDb).not.toHaveBeenCalled();
    expect(insertCheckin).not.toHaveBeenCalled();
  });
});
