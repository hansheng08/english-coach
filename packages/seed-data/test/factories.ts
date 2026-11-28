import { SEED_BATCH_SIZE } from '@english-coach/contracts';
import type { SeedBatch, SeedChunk } from '@english-coach/contracts';

/** 把索引變成只含小寫字母、不會是佔位詞的字（`q` 開頭）。 */
function wordOf(index: number): string {
  let rest = index;
  let out = '';
  for (let k = 0; k < 4; k++) {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return `q${out}`;
}

/** 通過 R1～R5 的一筆；`index` 決定內容，不同索引的 chunk 互不相同（R6）。 */
export function makeSeedChunk(overrides: Partial<SeedChunk> = {}, index = 0): SeedChunk {
  const chunk = `go ${wordOf(index)}`;
  return {
    chunk,
    meaning_zh: `意思${String(index)}`,
    example_en: `We will ${chunk} together very soon.`,
    tags: ['meeting'],
    ...overrides,
  };
}

/** 通過 R1～R8 的一批；不同 `batch` 的內容互不重複，可以互當 `others`。 */
export function makeSeedBatch(overrides: Partial<SeedBatch> = {}): SeedBatch {
  const batch = overrides.batch ?? 1;
  const base = Math.max(0, batch - 1) * SEED_BATCH_SIZE;
  const items = Array.from({ length: SEED_BATCH_SIZE }, (_, i) => makeSeedChunk({}, base + i));
  return { batch, items, ...overrides };
}
