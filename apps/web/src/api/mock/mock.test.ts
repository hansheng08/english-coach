import { describe, expect, it } from 'vitest';
import { NewsArticleContentSchema, UserIdSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { FIXTURE_ARTICLE } from './fixtures/article.ts';
import { DEMO_SESSION } from './fixtures/identity.ts';
import { MOCK_MARKER, MOCK_SCENARIOS, createMockApi, createMockClient, parseScenario } from './index.ts';

describe('mock fixtures', () => {
  it('(AC-T18-4) (TC-7) every fixture passes its contracts schema; the demo identity passes UserIdSchema', () => {
    const files = import.meta.glob('./fixtures/*.ts');
    expect(Object.keys(files).sort()).toEqual(['./fixtures/article.ts', './fixtures/identity.ts']);
    const article = NewsArticleContentSchema.safeParse(FIXTURE_ARTICLE);
    expect(article.success).toBe(true);
    expect(UserIdSchema.safeParse(DEMO_SESSION.userId).success).toBe(true);
    expect(MOCK_MARKER).toBe('__EC_MOCK__');
  });
});

describe('mock client', () => {
  it('(AC-T18-5) (TC-9) default: sign-in succeeds, getSession returns the demo identity', async () => {
    const client = createMockClient('default');
    const signedIn = expectOk(await client.signInWithPassword('a@example.com', 'x'));
    expect(signedIn).toEqual(DEMO_SESSION);
    expect(expectOk(await client.getSession())).toEqual(DEMO_SESSION);
  });

  it('(AC-T18-5) (TC-9) error scenario: sign-in is unauthenticated, getSession still returns the demo identity', async () => {
    const client = createMockClient('error');
    const e = expectErr(await client.signInWithPassword('a@example.com', 'x'));
    expect(e.kind).toBe('unauthenticated');
    expect(expectOk(await client.getSession())).toEqual(DEMO_SESSION);
  });

  it('(AC-T18-5) (TC-9) the ApiClient has exactly three methods', () => {
    expect(Object.keys(createMockClient('default')).sort()).toEqual(['getSession', 'signInWithPassword', 'signOut']);
    expect(createMockApi('?scenario=nope').preview).toEqual({ unknownScenario: 'nope' });
  });
});

describe('parseScenario', () => {
  it('(AC-T18-7) (TC-11) default, known, wrongly cased and markup-like names', () => {
    expect(parseScenario('')).toEqual({ scenario: 'default', unknown: null });
    expect(parseScenario('?scenario=error')).toEqual({ scenario: 'error', unknown: null });
    expect(parseScenario('?scenario=Error')).toEqual({ scenario: 'default', unknown: 'Error' });
    expect(parseScenario('?scenario=<b>x</b>')).toEqual({ scenario: 'default', unknown: '<b>x</b>' });
    for (const s of MOCK_SCENARIOS) expect(parseScenario(`?scenario=${s}`)).toEqual({ scenario: s, unknown: null });
  });
});
