// QA probes for T-050 (renderSeedSample). Fake, low-entropy data only.
import { describe, expect, it } from 'vitest';
import type { SeedBatch } from '@english-coach/contracts';
import { sampleWithSeed } from '@english-coach/domain';
import { makeSeedBatch, makeSeedChunk } from '../test/factories.ts';
import { SEED_SAMPLE_SEED, SEED_SAMPLE_SIZE, renderSeedSample } from './seed-chunks.ts';

/** Splits a table row on pipes that are not escaped; a well-formed 5-column row gives 7 parts. */
function cells(row: string): string[] {
  return row.split(/(?<!\\)\|/);
}

function withItems(count: number, batch = 1): SeedBatch {
  const base = makeSeedBatch({ batch });
  return { batch, items: base.items.slice(0, count) };
}

describe('QA T-050 renderSeedSample', () => {
  it('(QA-12) every pipe in chunk, meaning_zh and example_en is escaped, not only the first one', () => {
    const b = makeSeedBatch();
    const items = b.items.map((item) => ({ ...item, chunk: 'go a|b|c', meaning_zh: '意|思|二', example_en: 'We go a|b|c here today friend.' }));
    const rows = renderSeedSample({ ...b, items }).split('\n').slice(4, 24);
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(cells(row), row).toHaveLength(7);
      expect(row).toContain('| go a\\|b\\|c | 意\\|思\\|二 | We go a\\|b\\|c here today friend. | meeting |');
    }
  });

  it('(QA-13) the title reports the real row count and item count for batches smaller than the sample size', () => {
    const small = renderSeedSample(withItems(7, 2)).split('\n');
    expect(small[0]).toBe('# T-050 seed_chunk batch 2 sample (SEED_SAMPLE_SEED 20261127, 7 of 7; source supabase/seed-chunks/batch-2.json)');
    expect(small).toHaveLength(4 + 7 + 1);
    const mid = renderSeedSample(withItems(35, 4)).split('\n');
    expect(mid[0]).toBe('# T-050 seed_chunk batch 4 sample (SEED_SAMPLE_SEED 20261127, 20 of 35; source supabase/seed-chunks/batch-4.json)');
    expect(mid).toHaveLength(4 + 20 + 1);
    const big = renderSeedSample(withItems(100, 6)).split('\n')[0];
    expect(big).toBe('# T-050 seed_chunk batch 6 sample (SEED_SAMPLE_SEED 20261127, 20 of 100; source supabase/seed-chunks/batch-6.json)');
  });

  it('(QA-14) an empty batch gives only the title, header and separator, then one newline', () => {
    const out = renderSeedSample({ batch: 1, items: [] });
    expect(out).toBe('# T-050 seed_chunk batch 1 sample (SEED_SAMPLE_SEED 20261127, 0 of 0; source supabase/seed-chunks/batch-1.json)\n\n| # | chunk | meaning_zh | example_en | tags |\n|---|---|---|---|---|\n');
  });

  it('(QA-15) rows are the sampleWithSeed picks with the exported constants, with exact cell text', () => {
    const b = makeSeedBatch({ batch: 5 });
    const items = b.items.map((item, i) => ({ ...item, tags: i % 3 === 0 ? [] : i % 3 === 1 ? ['email' as const] : ['email' as const, 'project' as const, 'technical' as const] }));
    const batch = { ...b, items };
    expect(SEED_SAMPLE_SEED).toBe(20261127);
    expect(SEED_SAMPLE_SIZE).toBe(20);
    const picked = sampleWithSeed(items, SEED_SAMPLE_SIZE, SEED_SAMPLE_SEED);
    const rows = renderSeedSample(batch).split('\n').slice(4, 24);
    picked.forEach((item, i) => {
      const tags = item.tags.length === 0 ? '-' : item.tags.join(', ');
      expect(rows[i]).toBe(`| ${String(i + 1)} | ${item.chunk} | ${item.meaning_zh} | ${item.example_en} | ${tags} |`);
    });
    expect(new Set(rows.map((r) => cells(r)[2])).size).toBe(20);
  });

  it('(QA-16) the output depends on the items and the batch number only, and does not change the input', () => {
    const one = makeSeedBatch({ batch: 1 });
    const copy = JSON.parse(JSON.stringify(one)) as SeedBatch;
    const first = renderSeedSample(one);
    expect(one).toEqual(copy);
    expect(renderSeedSample({ ...one, batch: 2 })).toBe(first.replace('batch 1 sample', 'batch 2 sample').replace('batch-1.json', 'batch-2.json'));
    const changed = { ...one, items: one.items.map((_, i) => makeSeedChunk({ chunk: `go zz${String(i)}` }, i)) };
    expect(renderSeedSample(changed)).not.toBe(first);
  });
});
