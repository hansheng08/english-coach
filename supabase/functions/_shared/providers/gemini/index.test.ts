import { describe, expect, it } from 'vitest';
import { createGeminiProvider } from './index.ts';
import { fakeFetch, installNoNetwork } from './test/fake-fetch.ts';

installNoNetwork();

describe('createGeminiProvider（AC-24；ARCHITECTURE §5.4.2）', () => {
  it('(AC-T15-2) (TC-3) id: gemini → tier free、displayName Gemini、capability llm，建立時不呼叫 fetch', () => {
    const f = fakeFetch();
    const p = createGeminiProvider({ id: 'gemini', apiKey: 'k-1', fetch: f.fetch });
    expect(p).toMatchObject({ id: 'gemini', tier: 'free', displayName: 'Gemini', capability: 'llm' });
    expect(f.calls).toHaveLength(0);
  });

  it('(AC-T15-2) (TC-3) id: gemini-paid → tier paid、displayName Gemini（付費），建立時不呼叫 fetch', () => {
    const f = fakeFetch();
    const p = createGeminiProvider({ id: 'gemini-paid', apiKey: 'k-2', fetch: f.fetch });
    expect(p).toMatchObject({ id: 'gemini-paid', tier: 'paid', displayName: 'Gemini（付費）', capability: 'llm' });
    expect(f.calls).toHaveLength(0);
  });

  it('(AC-T15-12) (TC-25) 全域 fetch 被換成一呼叫就失敗的函式，且測試過程呼叫次數為 0', () => {
    const f = fakeFetch();
    createGeminiProvider({ id: 'gemini', apiKey: 'k-1', fetch: f.fetch });
    // installNoNetwork 的 afterEach 會確認全域 fetch 呼叫次數是 0
    expect(f.calls).toHaveLength(0);
  });
});
