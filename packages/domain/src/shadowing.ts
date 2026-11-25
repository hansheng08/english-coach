import { err, ok } from '@english-coach/contracts';
import type { PronunciationResult, Result, ValidationError } from '@english-coach/contracts';
import { normalizeWords } from './words.ts';

export const SHADOW_MIN_ACCURACY = 0.8;
export const SHADOW_MIN_SPEED_RATIO = 0.7;

export type ShadowScore = { readonly accuracy: number; readonly speedRatio: number; readonly unlocked: boolean };

function validationError(path: string, message: string): ValidationError {
  return { kind: 'validation', issues: [{ path, message }], message };
}

type Cell = { readonly cost: number; readonly matches: number };

function better(a: Cell, b: Cell): Cell {
  if (a.cost !== b.cost) return a.cost < b.cost ? a : b;
  return a.matches >= b.matches ? a : b;
}

/** Word-level Levenshtein alignment; returns the number of identical pairs in a minimum-cost alignment (ties: most matches). */
function alignedMatches(reference: readonly string[], recognized: readonly string[]): number {
  let prev: Cell[] = [];
  for (let j = 0; j <= recognized.length; j++) prev.push({ cost: j, matches: 0 });
  for (let i = 1; i <= reference.length; i++) {
    const row: Cell[] = [{ cost: i, matches: 0 }];
    for (let j = 1; j <= recognized.length; j++) {
      const diag = prev[j - 1] ?? { cost: 0, matches: 0 };
      const up = prev[j] ?? { cost: 0, matches: 0 };
      const left = row[j - 1] ?? { cost: 0, matches: 0 };
      const same = reference[i - 1] === recognized[j - 1];
      const viaDiag: Cell = same
        ? { cost: diag.cost, matches: diag.matches + 1 }
        : { cost: diag.cost + 1, matches: diag.matches };
      const viaUp: Cell = { cost: up.cost + 1, matches: up.matches };
      const viaLeft: Cell = { cost: left.cost + 1, matches: left.matches };
      row.push(better(viaDiag, better(viaUp, viaLeft)));
    }
    prev = row;
  }
  return prev[recognized.length]?.matches ?? 0;
}

export function canUnlock(accuracy: number, speedRatio: number): boolean {
  return accuracy >= SHADOW_MIN_ACCURACY && speedRatio >= SHADOW_MIN_SPEED_RATIO;
}

export function scoreShadowAttempt(
  referenceText: string,
  referenceDurationMs: number,
  result: Pick<PronunciationResult, 'recognizedText' | 'words'>,
): Result<ShadowScore, ValidationError> {
  const reference = normalizeWords(referenceText);
  if (reference.length === 0) return err(validationError('referenceText', 'referenceText has no words'));
  if (!(referenceDurationMs > 0)) {
    return err(validationError('referenceDurationMs', 'referenceDurationMs must be greater than 0'));
  }
  const accuracy = alignedMatches(reference, normalizeWords(result.recognizedText)) / reference.length;
  const first = result.words[0];
  const last = result.words[result.words.length - 1];
  let speedRatio = 0;
  if (first !== undefined && last !== undefined) {
    const spokenMs = last.endMs - first.startMs;
    if (spokenMs > 0) speedRatio = referenceDurationMs / spokenMs;
  }
  return ok({ accuracy, speedRatio, unlocked: canUnlock(accuracy, speedRatio) });
}

export function maskWords(sentence: string): readonly { readonly text: string; readonly masked: boolean }[] {
  const tokens: { readonly text: string; readonly masked: boolean }[] = [];
  let wordIndex = 0;
  for (const token of sentence.split(/\s+/)) {
    if (token === '') continue;
    if (normalizeWords(token).length === 0) {
      tokens.push({ text: token, masked: false });
      continue;
    }
    tokens.push({ text: token, masked: wordIndex % 2 === 1 });
    wordIndex += 1;
  }
  return tokens;
}
