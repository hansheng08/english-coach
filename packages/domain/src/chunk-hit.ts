import { IRREGULAR_VERB_FORMS } from './irregular-verbs.ts';
import { normalizeWords } from './words.ts';

export type ChunkHitLevel = 'full' | 'partial' | 'none';
export type ChunkHit = { readonly target: string; readonly level: ChunkHitLevel; readonly matchedText: string | null };

type Item = { readonly kind: 'word'; readonly word: string } | { readonly kind: 'gap' } | { readonly kind: 'possessive' };

const GAP_WORDS: ReadonlySet<string> = new Set(['sb', 'someone', 'somebody', 'sth', 'something']);
const POSSESSIVE_PLACEHOLDERS: ReadonlySet<string> = new Set(["one's", "sb's", "someone's"]);
const POSSESSIVES: ReadonlySet<string> = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their']);
const MAX_GAP = 4;
const VOWELS = 'aeiou';

/** ARCHITECTURE §4.7 normalization: curly quotes → "'", hyphen → space, then normalizeWords. */
function normalize(text: string): readonly string[] {
  return normalizeWords(text.replace(/[‘’]/g, "'").replace(/-/g, ' '));
}

function isConsonant(ch: string): boolean {
  return ch !== '' && /[a-z]/.test(ch) && !VOWELS.includes(ch);
}

function isPossessiveWord(t: string): boolean {
  return POSSESSIVES.has(t) || (t.length > 2 && t.endsWith("'s"));
}

/** Does transcript word `t` count as chunk word `w` (exact, regular inflection, or irregular form)? */
function sameWord(w: string, t: string): boolean {
  if (t === w) return true;
  const forms = [`${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`];
  const last = w.slice(-1);
  const beforeLast = w.slice(-2, -1);
  if (last === 'y' && isConsonant(beforeLast)) {
    const stem = w.slice(0, -1);
    forms.push(`${stem}ies`, `${stem}ied`);
  }
  if (last === 'e') forms.push(`${w.slice(0, -1)}ing`);
  if (isConsonant(last)) forms.push(`${w}${last}ed`, `${w}${last}ing`);
  if (forms.includes(t)) return true;
  return (IRREGULAR_VERB_FORMS.get(w) ?? []).includes(t);
}

function toItems(words: readonly string[]): readonly Item[] {
  return words.map((w): Item => {
    if (GAP_WORDS.has(w)) return { kind: 'gap' };
    if (POSSESSIVE_PLACEHOLDERS.has(w)) return { kind: 'possessive' };
    return { kind: 'word', word: w };
  });
}

/** Match items[idx..] against tokens starting at pos; returns the exclusive end index, or null. Gaps take the fewest words that work. */
function matchFrom(tokens: readonly string[], items: readonly Item[], pos: number, idx: number): number | null {
  const item = items[idx];
  if (item === undefined) return pos;
  const token = tokens[pos];
  switch (item.kind) {
    case 'word':
      return token !== undefined && sameWord(item.word, token) ? matchFrom(tokens, items, pos + 1, idx + 1) : null;
    case 'possessive':
      return token !== undefined && isPossessiveWord(token) ? matchFrom(tokens, items, pos + 1, idx + 1) : null;
    case 'gap': {
      for (let count = 1; count <= MAX_GAP && pos + count <= tokens.length; count++) {
        const end = matchFrom(tokens, items, pos + count, idx + 1);
        if (end !== null) return end;
      }
      return null;
    }
    default: {
      const unreachable: never = item;
      return unreachable;
    }
  }
}

function findFull(tokens: readonly string[], items: readonly Item[]): string | null {
  for (let start = 0; start < tokens.length; start++) {
    const end = matchFrom(tokens, items, start, 0);
    if (end !== null) return tokens.slice(start, end).join(' ');
  }
  return null;
}

/** Longest in-order match between chunk words and a transcript range; returns first/last matched range offsets and the count. */
function bestOrdered(words: readonly string[], seg: readonly string[]): { count: number; first: number; last: number } {
  const rows = words.length + 1;
  const cols = seg.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const at = (i: number, j: number): number => dp[i]?.[j] ?? 0;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const w = words[i - 1];
      const t = seg[j - 1];
      const hit = w !== undefined && t !== undefined && sameWord(w, t);
      const row = dp[i];
      if (row !== undefined) row[j] = hit ? at(i - 1, j - 1) + 1 : Math.max(at(i - 1, j), at(i, j - 1));
    }
  }
  const count = at(rows - 1, cols - 1);
  let first = -1;
  let last = -1;
  let i = rows - 1;
  let j = cols - 1;
  while (i > 0 && j > 0) {
    const w = words[i - 1];
    const t = seg[j - 1];
    if (w !== undefined && t !== undefined && sameWord(w, t) && at(i, j) === at(i - 1, j - 1) + 1) {
      if (last < 0) last = j - 1;
      first = j - 1;
      i--;
      j--;
    } else if (at(i - 1, j) >= at(i, j - 1)) {
      i--;
    } else {
      j--;
    }
  }
  return { count, first, last };
}

function findPartial(tokens: readonly string[], words: readonly string[]): string | null {
  const n = words.length;
  const need = Math.ceil(n / 2);
  const maxLen = n + 2;
  for (let start = 0; start < tokens.length; start++) {
    const head = tokens[start];
    if (head === undefined || !words.some((w) => sameWord(w, head))) continue;
    for (let len = 1; len <= maxLen && start + len <= tokens.length; len++) {
      const seg = tokens.slice(start, start + len);
      const best = bestOrdered(words, seg);
      if (best.count >= need) return seg.slice(best.first, best.last + 1).join(' ');
    }
  }
  return null;
}

function detectOne(tokens: readonly string[], target: string): ChunkHit {
  const items = toItems(normalize(target));
  const words: string[] = [];
  for (const item of items) if (item.kind === 'word') words.push(item.word);
  if (words.length === 0) return { target, level: 'none', matchedText: null };
  const full = findFull(tokens, items);
  if (full !== null) return { target, level: 'full', matchedText: full };
  if (words.length >= 2) {
    const partial = findPartial(tokens, words);
    if (partial !== null) return { target, level: 'partial', matchedText: partial };
  }
  return { target, level: 'none', matchedText: null };
}

/** ARCHITECTURE §4.7: which target chunks were said in the transcript. Output order matches `targets`. */
export function detectChunkHits(transcriptText: string, targets: readonly string[]): readonly ChunkHit[] {
  const tokens = normalize(transcriptText);
  return targets.map((target) => detectOne(tokens, target));
}

/** ADR-011 decision 5: one point per `full` hit; `partial` scores 0. */
export function scoreChunkHits(hits: readonly ChunkHit[]): number {
  return hits.filter((h) => h.level === 'full').length;
}
