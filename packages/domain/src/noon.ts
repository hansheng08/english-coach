import type { CardId, CardState, NoonItem, PlanDate } from '@english-coach/contracts';
import { detectChunkHits } from './chunk-hit.ts';
import { normalizeWords } from './words.ts';

// ARCHITECTURE §4.14.4、§4.14.2 (T-025a). Pure functions; the LLM part of NoonItem (T-025b) is not built here.

export type NoonCardFields = {
  readonly state: CardState;
  readonly exampleEn: string | null;
  readonly meaningZh: string | null;
};
export type NoonCardInput = NoonCardFields & { readonly cardId: CardId; readonly chunk: string };
export type NoonMode = 'B' | 'A_choice' | 'A_recall' | 'postpone';

const BLANK = '____';

const hasText = (s: string | null | undefined): s is string => s !== null && s !== undefined && s.trim().length > 0;

/**
 * Both example and meaning missing → postpone; Reviewing with complete mode-B material → B; complete choice material → A_choice;
 * otherwise A_recall. Mastered never appears at noon (§4.3), so it is postponed.
 */
export function selectNoonMode(card: NoonCardFields, item: NoonItem | undefined): NoonMode {
  if (card.state === 'mastered') return 'postpone';
  if (!hasText(card.exampleEn) && !hasText(card.meaningZh)) return 'postpone';
  if (
    card.state === 'reviewing' &&
    item !== undefined &&
    item.context_zh !== null &&
    item.blocks !== null &&
    item.shuffled_order !== null
  ) {
    return 'B';
  }
  if (item !== undefined && item.plain_en !== null && item.cloze_en !== null && item.distractors !== null) return 'A_choice';
  return 'A_recall';
}

/** Prompt of an A_recall question (AC-08 order): plain_en → cloze_en → meaning. Never an empty string; null when nothing is left. */
export function recallPrompt(
  card: NoonCardFields,
  item: NoonItem | undefined,
): { readonly kind: 'plain' | 'cloze' | 'meaning'; readonly text: string } | null {
  if (hasText(item?.plain_en)) return { kind: 'plain', text: item.plain_en };
  if (hasText(item?.cloze_en)) return { kind: 'cloze', text: item.cloze_en };
  if (hasText(card.meaningZh)) return { kind: 'meaning', text: card.meaningZh };
  return null;
}

type RawToken = { readonly rawIndex: number; readonly token: string };

/** Same tokenization as detectChunkHits (curly quotes → "'", hyphen → space), remembering which whitespace-separated word each token came from. */
function tokensWithOrigin(rawWords: readonly string[]): readonly RawToken[] {
  return rawWords.flatMap((raw, rawIndex) =>
    normalizeWords(raw.replace(/[‘’]/g, "'").replace(/-/g, ' ')).map((token): RawToken => ({ rawIndex, token })),
  );
}

/** Replaces the first occurrence of the full hit's matched words with "____" (surrounding punctuation of the span is kept). */
function clozeOf(example: string, chunk: string): string | null {
  const hit = detectChunkHits(example, [chunk])[0];
  if (hit === undefined || hit.level !== 'full' || hit.matchedText === null) return null;
  const rawWords = example.split(/\s+/).filter((w) => w.length > 0);
  const tokens = tokensWithOrigin(rawWords);
  const wanted = hit.matchedText.split(' ');
  for (let start = 0; start + wanted.length <= tokens.length; start += 1) {
    if (!wanted.every((w, i) => tokens[start + i]?.token === w)) continue;
    const first = tokens[start]?.rawIndex;
    const last = tokens[start + wanted.length - 1]?.rawIndex;
    if (first === undefined || last === undefined) return null;
    const head = /^[^A-Za-z0-9']*/.exec(rawWords[first] ?? '')?.[0] ?? '';
    const tail = /[^A-Za-z0-9']*$/.exec(rawWords[last] ?? '')?.[0] ?? '';
    return [...rawWords.slice(0, first), `${head}${BLANK}${tail}`, ...rawWords.slice(last + 1)].join(' ');
  }
  return null;
}

/** T-025a accepts only `undefined` for the LLM part (T-025b widens it): rule-based `cloze_en` only, everything else null. */
export const buildNoonItem: (card: NoonCardInput, llmItem: undefined, planDate: PlanDate) => NoonItem = (card) => ({
  card_id: card.cardId,
  plain_en: null,
  cloze_en: hasText(card.exampleEn) ? clozeOf(card.exampleEn, card.chunk) : null,
  distractors: null,
  context_zh: null,
  blocks: null,
  shuffled_order: null,
});
