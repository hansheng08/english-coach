import { UserIdSchema } from '@english-coach/contracts';
import type { AuthSession } from '../../client.ts';

/** 固定的示範身分（假資料，不是真使用者）。 */
export const DEMO_USER_ID_TEXT = '00000000-0000-4000-8000-000000000001';

export const DEMO_SESSION: AuthSession = { userId: UserIdSchema.parse(DEMO_USER_ID_TEXT), email: 'demo@example.com' };
