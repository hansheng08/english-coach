import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { loadGeminiKey } from './provider-keys.ts';

const run = (value: string | undefined) => {
  const read: string[] = [];
  const result = loadGeminiKey((name) => {
    read.push(name);
    return value;
  });
  return { result, read };
};

describe('loadGeminiKey（NFR-05；ARCHITECTURE §5.4.2）', () => {
  it('(AC-T15-1) (TC-1) undefined、空字串、只有空白 → not_configured，訊息只有變數名稱', () => {
    for (const value of [undefined, '', '   ']) {
      const { result, read } = run(value);
      const e = expectErr(result);
      expect(e).toEqual({
        kind: 'not_configured',
        provider: 'gemini',
        capability: 'llm',
        message: 'missing env GEMINI_API_KEY',
      });
      expect(read).toEqual(['GEMINI_API_KEY']);
    }
  });

  it('(AC-T15-1) (TC-1) 有值 → 原樣回傳，且只讀過 GEMINI_API_KEY', () => {
    const { result, read } = run('k-1');
    expect(expectOk(result)).toBe('k-1');
    expect(read).toEqual(['GEMINI_API_KEY']);
  });
});
