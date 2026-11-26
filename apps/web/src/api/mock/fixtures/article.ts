import { stripBreaks } from '@english-coach/contracts';
import type { NewsArticleContent } from '@english-coach/contracts';

// 假資料：自己寫的虛構短文，不是任何真實新聞的原文或改寫（CLAUDE.md §5 第 7 條的精神）。
// 「/」是斷句標記（NewsArticleContentSchema 的 S2、S3）。
export const FIXTURE_SENTENCES: readonly string[] = [
  'A small software team / spent most of last year building a tool that shows families how much electricity they use.',
  'The idea started / when one engineer noticed that her monthly bill kept growing even though nobody had changed any habits.',
  'She wanted to know / which devices were responsible, but the numbers from the power company arrived only once a month.',
  'So the team connected simple sensors / to the main panel and sent the readings to a mobile application every minute.',
  'Early users said the charts were helpful, / yet many of them still struggled to decide what to change first.',
  'To solve that problem, / the team added a short daily summary that points out one habit worth adjusting.',
  'For example, / the summary might suggest running the dishwasher at night, when electricity is cheaper and the grid is less busy.',
  'After three months, / the average household in the trial reduced its usage by almost eight percent without buying new equipment.',
  'Some people were surprised / to learn that old refrigerators and forgotten chargers accounted for a large share of their bills.',
  'The company now plans to open its tool / to more customers while keeping the data private and stored only on the device.',
  'Experts say that tools like this / can raise awareness, but they warn that real savings depend on long term changes in behavior.',
  'Critics also point out / that sensors cost money, so lower income families may need support from local governments to join.',
  'The team agrees with that concern / and is talking with several city offices about shared programs that could reduce the price.',
  'If those talks succeed, / the tool could reach thousands of homes by the end of next year and help many families save.',
];

export const FIXTURE_ARTICLE: NewsArticleContent = {
  rewritten_text: FIXTURE_SENTENCES.map(stripBreaks).join(' '),
  sentences: [...FIXTURE_SENTENCES],
  chunks: [
    { chunk: 'how much electricity', meaning_zh: '用了多少電', sentence_index: 0 },
    { chunk: 'kept growing', meaning_zh: '不斷增加', sentence_index: 1 },
    { chunk: 'from the power company', meaning_zh: '來自電力公司', sentence_index: 2 },
    { chunk: 'worth adjusting', meaning_zh: '值得調整', sentence_index: 5 },
    { chunk: 'real savings depend on', meaning_zh: '真正的節省取決於', sentence_index: 10 },
  ],
};
