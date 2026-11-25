import { describe, expect, it } from 'vitest';
import GEN_35 from '../docs/poc/A-003/samples/02-gen-gemini-3.5-flash-lite.body?raw';
import GEN_31 from '../docs/poc/A-003/samples/02-gen-gemini-3.1-flash-lite.body?raw';
import MAXTOKENS from '../docs/poc/A-003/samples/08-maxtokens-gemini-3.5-flash-lite.body?raw';
import STREAM_35 from '../docs/poc/A-003/samples/03-stream-gemini-3.5-flash-lite.body?raw';
import STREAM_MAXTOKENS from '../docs/poc/A-003/samples/09-stream-maxtokens-gemini-3.5-flash-lite.body?raw';
import ERR_FAKE_KEY from '../docs/poc/A-003/samples/05-err-fake-key.body?raw';
import ERR_NO_KEY from '../docs/poc/A-003/samples/05b-err-no-key.body?raw';
import ERR_404 from '../docs/poc/A-003/samples/06-err-model-not-found.body?raw';
import ERR_404_STREAM from '../docs/poc/A-003/samples/06b-err-model-not-found-stream.body?raw';
import ERR_MALFORMED from '../docs/poc/A-003/samples/07-err-malformed-json.body?raw';
import ERR_BAD_FIELD from '../docs/poc/A-003/samples/07b-err-bad-field.body?raw';
import ERR_503_GEN from '../docs/poc/A-003/samples/02-gen-gemini-3.8-flash.body?raw';
import ERR_503_STREAM from '../docs/poc/A-003/samples/11-stream-gemini-3.8-flash.body?raw';
import adapterSamples from '../supabase/functions/_shared/providers/gemini/test/a003-samples.ts?raw';

// T-015：a003-samples.ts 的常數字面寫法必須等於「對原始檔內容做 JSON.stringify」。原始檔改了，這裡會失敗。
const SAMPLES: readonly (readonly [string, string])[] = [
  ['02-gen-gemini-3.5-flash-lite.body', GEN_35],
  ['02-gen-gemini-3.1-flash-lite.body', GEN_31],
  ['08-maxtokens-gemini-3.5-flash-lite.body', MAXTOKENS],
  ['03-stream-gemini-3.5-flash-lite.body', STREAM_35],
  ['09-stream-maxtokens-gemini-3.5-flash-lite.body', STREAM_MAXTOKENS],
  ['05-err-fake-key.body', ERR_FAKE_KEY],
  ['05b-err-no-key.body', ERR_NO_KEY],
  ['06-err-model-not-found.body', ERR_404],
  ['06b-err-model-not-found-stream.body', ERR_404_STREAM],
  ['07-err-malformed-json.body', ERR_MALFORMED],
  ['07b-err-bad-field.body', ERR_BAD_FIELD],
  ['02-gen-gemini-3.8-flash.body', ERR_503_GEN],
  ['11-stream-gemini-3.8-flash.body', ERR_503_STREAM],
];

describe('A-003 樣本防漂移（AC-T15-12）', () => {
  for (const [name, raw] of SAMPLES) {
    it(`(AC-T15-12) (TC-25) ${name} 與 a003-samples.ts 的常數一致`, () => {
      expect(raw.length).toBeGreaterThan(0);
      expect(adapterSamples).toContain(`= ${JSON.stringify(raw)};`);
    });
  }

  it('(AC-T15-12) (TC-25) SSE 樣本保留 CRLF 空行', () => {
    expect(STREAM_35).toContain('\r\n\r\n');
    expect(STREAM_MAXTOKENS).toContain('\r\n\r\n');
  });

  it('(AC-T15-12) (TC-25) a003-samples.ts 沒有多餘的常數（每個常數都對應一個原始檔）', () => {
    const constants = adapterSamples.match(/^export const [A-Z0-9_]+ = /gm) ?? [];
    expect(constants).toHaveLength(SAMPLES.length);
  });
});
