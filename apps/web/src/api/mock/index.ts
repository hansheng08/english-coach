import { err, ok } from '@english-coach/contracts';
import type { ApiClient, ApiRuntime } from '../client';
import { demoSession } from './fixtures/demo-session';

export const MOCK_MARKER = '__EC_MOCK__';
export const MOCK_SCENARIOS = ['default', 'empty', 'error', 'fallback-article', 'prep-pending', 'offline'] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

const isScenario = (name: string): name is MockScenario => (MOCK_SCENARIOS as readonly string[]).includes(name);

/** `?scenario=<名稱>`：沒有參數 → default；不認得 → default，並把原字串放在 unknown。 */
export function parseScenario(search: string): { readonly scenario: MockScenario; readonly unknown: string | null } {
  const raw = new URLSearchParams(search).get('scenario');
  if (raw === null || raw === '') return { scenario: 'default', unknown: null };
  if (isScenario(raw)) return { scenario: raw, unknown: null };
  return { scenario: 'default', unknown: raw };
}

/** 資料在記憶體、不發任何網路請求。本單只有 default 與 error 有不同行為，其他已知名稱暫同 default。 */
export function createMockApi(search: string): ApiRuntime {
  const { scenario, unknown } = parseScenario(search);
  const client: ApiClient = {
    getSession: () => Promise.resolve(demoSession()),
    signInWithPassword: () =>
      Promise.resolve(
        scenario === 'error' ? err({ kind: 'unauthenticated', message: 'mock scenario "error": invalid credentials' }) : demoSession(),
      ),
    signOut: () => Promise.resolve(ok(undefined)),
  };
  return { client, preview: { marker: MOCK_MARKER, unknownScenario: unknown } };
}
