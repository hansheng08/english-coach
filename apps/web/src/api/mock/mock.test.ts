import { UserIdSchema } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { DEMO_USER_ID, demoSession } from './fixtures/demo-session';
import { MOCK_SCENARIOS, createMockApi, parseScenario } from './index';

const fixtureModules = import.meta.glob('./fixtures/*.ts');

describe('mock api', () => {
  it('(AC-T18-4) (TC-7) every fixture file is covered here and passes its schema', () => {
    expect(Object.keys(fixtureModules)).toEqual(['./fixtures/demo-session.ts']);
    expect(UserIdSchema.safeParse(DEMO_USER_ID).success).toBe(true);
    const session = demoSession();
    expect(session.ok).toBe(true);
    expect(session.ok && UserIdSchema.safeParse(session.value.userId).success).toBe(true);
  });

  it('(AC-T18-5) (TC-9) default: sign-in succeeds and getSession returns the demo identity', async () => {
    const { client } = createMockApi('');
    const signedIn = await client.signInWithPassword('a@example.com', 'x');
    const session = await client.getSession();
    expect(signedIn.ok).toBe(true);
    expect(session.ok && session.value?.userId).toBe(DEMO_USER_ID);
  });

  it('(AC-T18-5) (TC-9) error scenario: sign-in returns unauthenticated, getSession still returns the identity', async () => {
    const { client } = createMockApi('?scenario=error');
    const signedIn = await client.signInWithPassword('a@example.com', 'x');
    expect(!signedIn.ok && signedIn.error.kind).toBe('unauthenticated');
    expect((await client.getSession()).ok).toBe(true);
  });

  it('(AC-T18-7) (TC-11) parseScenario', () => {
    expect(parseScenario('')).toEqual({ scenario: 'default', unknown: null });
    expect(parseScenario('?scenario=error')).toEqual({ scenario: 'error', unknown: null });
    expect(parseScenario('?scenario=Error')).toEqual({ scenario: 'default', unknown: 'Error' });
    expect(parseScenario('?scenario=<b>x</b>')).toEqual({ scenario: 'default', unknown: '<b>x</b>' });
    for (const name of MOCK_SCENARIOS) expect(parseScenario(`?scenario=${name}`)).toEqual({ scenario: name, unknown: null });
  });

  it('(AC-T18-8) (TC-13) the preview info carries the marker and any unknown scenario name', () => {
    expect(createMockApi('?scenario=nope').preview).toEqual({ marker: '__EC_MOCK__', unknownScenario: 'nope' });
    expect(createMockApi('').preview?.unknownScenario).toBeNull();
  });
});
