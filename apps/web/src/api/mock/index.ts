import { err, ok } from '@english-coach/contracts';
import type { AppError, Result } from '@english-coach/contracts';
import type { ApiClient, AuthSession, LoadedApi } from '../client.ts';
import { DEMO_SESSION } from './fixtures/identity.ts';

/** 建置掃描用的標記（ARCHITECTURE §9.1.1）：supabase 建置的 dist/ 不得出現；只由這個檔案定義。 */
export const MOCK_MARKER = '__EC_MOCK__';

export const MOCK_SCENARIOS = ['default', 'empty', 'error', 'fallback-article', 'prep-pending', 'offline'] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

const isScenario = (s: string): s is MockScenario => MOCK_SCENARIOS.some((x) => x === s);

/** `?scenario=<名稱>`：沒有參數 → default；名稱不在清單內 → default，unknown 帶原字串（區分大小寫）。 */
export function parseScenario(search: string): { readonly scenario: MockScenario; readonly unknown: string | null } {
  const name = new URLSearchParams(search).get('scenario');
  if (name === null || name === '') return { scenario: 'default', unknown: null };
  if (isScenario(name)) return { scenario: name, unknown: null };
  return { scenario: 'default', unknown: name };
}

/** 資料在記憶體，不發任何網路請求。本單只有 default／error 有不同行為，其他已知名稱暫同 default。 */
export function createMockClient(scenario: MockScenario): ApiClient {
  const session: AuthSession = DEMO_SESSION;
  return {
    getSession: (): Promise<Result<AuthSession | null, AppError>> => Promise.resolve(ok(session)),
    signInWithPassword: (): Promise<Result<AuthSession, AppError>> =>
      Promise.resolve(
        scenario === 'error' ? err({ kind: 'unauthenticated', message: 'mock: invalid credentials' }) : ok(session),
      ),
    signOut: (): Promise<Result<void, AppError>> => Promise.resolve(ok(undefined)),
  };
}

export function createMockApi(search: string): LoadedApi {
  const { scenario, unknown } = parseScenario(search);
  return { client: createMockClient(scenario), preview: { unknownScenario: unknown } };
}
