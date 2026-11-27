import { err, ok, UserIdSchema } from '@english-coach/contracts';
import type { AppError, Result } from '@english-coach/contracts';
import type { AuthSession } from '../../client';

/** 示範身分（自己寫的假資料；UUID 要通過 UserIdSchema）。 */
export const DEMO_USER_ID = '5b0d6a3e-7c1f-4c8a-9d52-1f3e8a7b4c10';
export const DEMO_EMAIL = 'demo@example.com';

export function demoSession(): Result<AuthSession, AppError> {
  const userId = UserIdSchema.safeParse(DEMO_USER_ID);
  if (!userId.success) return err({ kind: 'internal', message: 'demo user id is not a valid UserId' });
  return ok({ userId: userId.data, email: DEMO_EMAIL });
}
