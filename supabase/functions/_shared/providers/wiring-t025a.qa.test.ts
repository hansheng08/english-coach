// QA probe for createProviders (QA-9): the Gemini adapter is built with the GEMINI_API_KEY value and the injected fetch.
import { NtdSchema } from '@english-coach/contracts';
import { expectOk } from '@english-coach/contracts/testing';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './registry.ts';
import { createProviders } from './wiring.ts';

const KEY = 'k-qa-gemini-qa-gemini-qa-gemini';

describe('createProviders key wiring (QA-9)', () => {
  it('(QA-9) a generate call sends the env key through the injected fetch', async () => {
    const sent: (string | null)[] = [];
    const fetchSpy: typeof fetch = (_input, init) => {
      sent.push(new Headers(init?.headers).get('x-goog-api-key'));
      return Promise.resolve(new Response('{}', { status: 500 }));
    };
    const reg = createProviders({ env: (name) => (name === 'GEMINI_API_KEY' ? KEY : undefined), fetch: fetchSpy });
    const llm = expectOk(reg.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0)));
    await llm.generate({
      model: DEFAULT_SETTINGS.llm.model,
      system: 's',
      prompt: 'p',
      schema: z.object({ ok: z.boolean() }),
      maxOutputTokens: 16,
      timeoutMs: 1000,
    });
    expect(sent.length).toBeGreaterThan(0);
    for (const k of sent) expect(k).toBe(KEY);
  });
});
