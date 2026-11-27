import { describe, expect, it } from 'vitest';
import { MOCK_MARKER, MOCK_SCENARIOS, createMockApi, parseScenario } from './index';

// QA probes for T-018 AC-T18-5、AC-T18-7.
describe('T-018 QA mock api', () => {
  it('(QA-5) parseScenario edge cases', () => {
    expect(parseScenario('?scenario=')).toEqual({ scenario: 'default', unknown: null });
    expect(parseScenario('?other=1')).toEqual({ scenario: 'default', unknown: null });
    expect(parseScenario('?scenario=error&scenario=empty')).toEqual({ scenario: 'error', unknown: null });
    expect(parseScenario('?scenario=%3Cb%3E')).toEqual({ scenario: 'default', unknown: '<b>' });
    expect(parseScenario('?scenario=%20error')).toEqual({ scenario: 'default', unknown: ' error' });
    expect(parseScenario('scenario=empty')).toEqual({ scenario: 'empty', unknown: null });
    expect([...MOCK_SCENARIOS]).toEqual(['default', 'empty', 'error', 'fallback-article', 'prep-pending', 'offline']);
  });

  it('(QA-6) only error rejects sign-in; other known scenarios behave like default; signOut is ok', async () => {
    for (const name of MOCK_SCENARIOS) {
      const { client, preview } = createMockApi(`?scenario=${name}`);
      const r = await client.signInWithPassword('a@example.com', 'x');
      expect(r.ok).toBe(name !== 'error');
      expect((await client.getSession()).ok).toBe(true);
      expect(await client.signOut()).toEqual({ ok: true, value: undefined });
      expect(preview).toEqual({ marker: MOCK_MARKER, unknownScenario: null });
    }
    const unknown = createMockApi('?scenario=ERROR');
    expect((await unknown.client.signInWithPassword('a@example.com', 'x')).ok).toBe(true);
    expect(unknown.preview?.unknownScenario).toBe('ERROR');
  });
});
