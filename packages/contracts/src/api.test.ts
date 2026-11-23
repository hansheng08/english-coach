import { describe, expect, it } from 'vitest';
import { CardStreamEventSchema } from './api.ts';

const UUID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';

describe('CardStreamEventSchema', () => {
  const valid = [
    { type: 'chunk', chunk: 'take off', meaningZh: '起飛' },
    { type: 'example', en: 'The plane took off.', zh: '飛機起飛了。' },
    { type: 'synonyms', items: ['depart', 'lift off'] },
    { type: 'done', cardId: UUID, meta: { llmModel: 'gemini-3.5-flash-lite' } },
    { type: 'error', error: { kind: 'timeout', message: 'm', retryable: true, provider: 'gemini', capability: 'llm' } },
  ];
  for (const event of valid) {
    it(`accepts a valid "${event.type}" event`, () => {
      expect(CardStreamEventSchema.safeParse(event).success).toBe(true);
    });
  }

  it('rejects an unknown type', () => {
    expect(CardStreamEventSchema.safeParse({ type: 'progress' }).success).toBe(false);
  });
  it('rejects an empty chunk and fewer than 2 synonyms', () => {
    expect(CardStreamEventSchema.safeParse({ type: 'chunk', chunk: '', meaningZh: 'x' }).success).toBe(false);
    expect(CardStreamEventSchema.safeParse({ type: 'synonyms', items: ['one'] }).success).toBe(false);
  });
  it('rejects a done event whose cardId is not a UUID', () => {
    const r = CardStreamEventSchema.safeParse({ type: 'done', cardId: 'x', meta: { llmModel: 'gemini-3.5-flash-lite' } });
    expect(r.success).toBe(false);
  });
});
