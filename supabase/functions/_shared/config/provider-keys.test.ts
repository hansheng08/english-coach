import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { loadAzureSpeechConfig, loadGeminiKey } from './provider-keys.ts';

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

const azure = (env: Record<string, string | undefined>) => loadAzureSpeechConfig((name) => env[name]);

describe('loadAzureSpeechConfig（ARCHITECTURE §5.5）', () => {
  it('(AC-T17-1) (TC-1) 缺變數 → not_configured，訊息只有名稱', () => {
    const base = { kind: 'not_configured', provider: 'azure-speech', capability: 'pronunciation' } as const;
    expect(expectErr(azure({}))).toEqual({ ...base, message: 'missing env AZURE_SPEECH_KEY, AZURE_SPEECH_REGION' });
    expect(expectErr(azure({ AZURE_SPEECH_KEY: 'k-1' }))).toEqual({ ...base, message: 'missing env AZURE_SPEECH_REGION' });
    expect(expectErr(azure({ AZURE_SPEECH_KEY: '   ', AZURE_SPEECH_REGION: 'japaneast' }))).toEqual({
      ...base,
      message: 'missing env AZURE_SPEECH_KEY',
    });
  });

  it('(AC-T17-1) (TC-2) region 先 trim、轉小寫，格式不符 → invalid env', () => {
    expect(expectOk(azure({ AZURE_SPEECH_KEY: 'k-1', AZURE_SPEECH_REGION: ' JapanEast ' }))).toEqual({
      key: 'k-1',
      region: 'japaneast',
    });
    for (const region of ['japan-east', 'east.evil.com']) {
      const e = expectErr(azure({ AZURE_SPEECH_KEY: 'k-1', AZURE_SPEECH_REGION: region }));
      expect(e.kind).toBe('not_configured');
      expect(e.message).toBe('invalid env AZURE_SPEECH_REGION');
    }
  });
});
