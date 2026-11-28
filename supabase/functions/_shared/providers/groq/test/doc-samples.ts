// 依官方文件（ADR-015 參考網址）的範例自己寫的樣本；沒有真實回應（A-002 未做）。內容不含任何金鑰樣子的字串。

/** 成功＋逐字（`start` 帶 3 位小數；含 `duration`）。 */
export const VERBOSE_WITH_WORDS = JSON.stringify({
  task: 'transcribe',
  language: 'English',
  duration: 3.52,
  text: ' Um, so I think we should ship it.',
  words: [
    { word: 'Um,', start: 0.12, end: 0.4 },
    { word: 'so', start: 0.4, end: 0.62 },
    { word: 'I', start: 0.8, end: 0.9 },
    { word: 'think', start: 0.9, end: 1.2345 },
    { word: 'we', start: 1.3004, end: 1.4 },
    { word: 'should', start: 1.4, end: 1.7 },
    { word: 'ship', start: 1.7, end: 2.1 },
    { word: 'it.', start: 2.1, end: 2.5 },
  ],
  segments: [{ id: 0, start: 0.12, end: 2.5, text: ' Um, so I think we should ship it.' }],
  x_groq: { id: 'req_sample' },
});

export const WORDS_ONLY = JSON.stringify({
  text: 'hello there',
  words: [
    { word: 'hello', start: 0.1, end: 0.5 },
    { word: 'there', start: 0.6, end: 1.25 },
  ],
});

export const SEGMENTS_ONLY = JSON.stringify({
  text: 'hello there',
  segments: [
    { start: 0, end: 0.8 },
    { start: 0.9, end: 1.75 },
  ],
});

export const NO_TIMING = JSON.stringify({ text: 'hello' });

export const REVERSED_AND_BLANK = JSON.stringify({
  text: 'a b c',
  words: [
    { word: 'a', start: 1.0004, end: 1.0001 },
    { word: '  ', start: 1.1, end: 1.2 },
    { word: 'c', start: 1.3, end: 1.5 },
  ],
});

export const TEXT_NO_WORDS = JSON.stringify({ text: 'hello' });
export const TEXT_EMPTY_WORDS = JSON.stringify({ text: 'hello', words: [] });
export const SILENCE = JSON.stringify({ text: '', words: [], duration: 2 });
export const BAD_STRUCTURE = JSON.stringify({ text: 1 });

export const rateLimitBody = (message: string, type = 'tokens'): string =>
  JSON.stringify({ error: { message, type, code: 'rate_limit_exceeded' } });
