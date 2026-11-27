// 依官方文件範例（ARCHITECTURE §5.6.2、ADR-015 參考網址）自己寫的樣本；沒有真實回應，格式未驗證（A-004）。

/** 發音評估成功：Offset／Duration 是數字（單位 100 奈秒）。 */
export const successNumeric = JSON.stringify({
  RecognitionStatus: 'Success',
  Offset: 500000,
  Duration: 22000000,
  DisplayText: 'Good morning.',
  NBest: [
    {
      Confidence: 0.97,
      Lexical: 'good morning',
      Display: 'Good morning.',
      PronScore: 87.5,
      AccuracyScore: 90,
      FluencyScore: 85,
      CompletenessScore: 100,
      thoughtSignature: 'extra-field-is-ignored',
      Words: [
        { Word: 'good', Offset: 500000, Duration: 3500000, Confidence: 0 },
        { Word: 'morning', Offset: 4100000, Duration: 6000000, Confidence: 0 },
      ],
    },
  ],
});

/** Offset／Duration 是純數字字串；分數超出範圍；有一個空字。 */
export const successEdge = (pronScore: number): string =>
  JSON.stringify({
    RecognitionStatus: 'Success',
    NBest: [
      {
        PronScore: pronScore,
        Display: 'Hello there.',
        Words: [
          { Word: 'hello', Offset: '12300000', Duration: '5000000' },
          { Word: '', Offset: '17400000', Duration: '100000' },
          { Word: 'there', Offset: '17500000', Duration: '4999' },
        ],
      },
    ],
  });

export const status = (RecognitionStatus: string): string => JSON.stringify({ RecognitionStatus });

export const emptyNBest = JSON.stringify({ RecognitionStatus: 'Success', NBest: [] });
export const noNBest = JSON.stringify({ RecognitionStatus: 'Success' });
export const noPronScore = JSON.stringify({
  RecognitionStatus: 'Success',
  NBest: [{ Display: 'Hi.', Words: [] }],
});
