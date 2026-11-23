import { err, ok } from '@english-coach/contracts';
import type { Result, Transcript, ValidationError } from '@english-coach/contracts';

/** PRD AC-15：相鄰兩字間隔超過 2 秒算一次停頓。 */
export const PAUSE_THRESHOLD_MS = 2000;

export type SpeechMetrics = {
  readonly pauseCount: number;
  readonly fillerCount: number;
  readonly wordCount: number;
  readonly wpm: number;
};

function invalid(path: string, message: string): Result<SpeechMetrics, ValidationError> {
  return err({ kind: 'validation', issues: [{ path, message }], message });
}

// Lowercase, then strip leading/trailing characters that are not a-z or an apostrophe.
function normalize(word: string): string {
  return word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

// Filler phrases are chosen by the caller; domain ships no default list.
function toPhrases(fillerPhrases: readonly string[]): string[][] {
  return fillerPhrases
    .map((p) => p.split(/\s+/).map(normalize).filter((w) => w !== ''))
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
}

function countFillers(words: readonly string[], phrases: readonly string[][]): number {
  let count = 0;
  let i = 0;
  while (i < words.length) {
    const hit = phrases.find((p) => p.every((w, k) => words[i + k] === w));
    if (hit === undefined) {
      i += 1;
    } else {
      count += 1;
      i += hit.length;
    }
  }
  return count;
}

export function computeSpeechMetrics(
  transcript: Transcript,
  fillerPhrases: readonly string[],
): Result<SpeechMetrics, ValidationError> {
  if (transcript.timing === 'none') {
    return invalid('timing', 'transcript has no word timings');
  }
  if (transcript.durationMs <= 0) {
    return invalid('durationMs', 'durationMs must be greater than 0');
  }
  const { words } = transcript;
  for (let i = 0; i + 1 < words.length; i += 1) {
    const cur = words[i];
    const next = words[i + 1];
    if (cur !== undefined && next !== undefined && next.startMs < cur.startMs) {
      return invalid('words', 'words must be sorted by startMs');
    }
  }

  let pauseCount = 0;
  for (let i = 0; i + 1 < words.length; i += 1) {
    const cur = words[i];
    const next = words[i + 1];
    if (cur !== undefined && next !== undefined && next.startMs - cur.endMs > PAUSE_THRESHOLD_MS) {
      pauseCount += 1;
    }
  }

  const fillerCount = countFillers(
    words.map((w) => normalize(w.word)),
    toPhrases(fillerPhrases),
  );
  const wordCount = words.length;
  const wpm = Math.round((wordCount / (transcript.durationMs / 60000)) * 10) / 10;
  return ok({ pauseCount, fillerCount, wordCount, wpm });
}
