// QA probes for T-050: content hygiene of every supabase/seed-chunks/batch-<n>.json that exists, and t004 fixtures vs real chunks.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const SEED_DIR = join(ROOT, 'supabase', 'seed-chunks');

interface Row {
  file: string;
  chunk: string;
  meaning: string;
  example: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadRows(): Row[] {
  const rows: Row[] = [];
  for (const file of readdirSync(SEED_DIR).sort()) {
    if (!/^batch-[1-6]\.json$/.test(file)) continue;
    const data: unknown = JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8'));
    const items: unknown[] = isRecord(data) && Array.isArray(data.items) ? (data.items as unknown[]) : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      rows.push({ file, chunk: String(item.chunk), meaning: String(item.meaning_zh), example: String(item.example_en) });
    }
  }
  return rows;
}

const rows = loadRows();

// Characters that exist only in Simplified Chinese (none of them is a Traditional form).
const SIMPLIFIED_ONLY = '这们说时会为对从动发应现开关与当让给还样边头问题经过请该进种实错档类设计务队议认识讨论转换备选择师学项产车组执调览责虑见确觉负压测试资读写点够将处决况统维线络总结续节简单导';
// Words that are Mainland usage even when written in Traditional characters (Taiwan uses other terms).
const MAINLAND_WORDS = ['軟件', '硬件', '代碼', '內存', '默認', '信息', '網絡', '數據', '質量', '視頻', '服務器', '激活', '接口', '文檔', '打印', '屏幕', '鼠標'];
const FILLER = new Set(['sb', 'sth', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'your', 'my', 'one', 's']);

function nearKey(chunk: string): string {
  return chunk
    .toLowerCase()
    .replace(/[-']/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !FILLER.has(w))
    .join(' ');
}

describe('QA T-050 t004 fixtures and content hygiene of existing batches', () => {
  it('(QA-26) the seed_chunk rows t004 inserts match no real seed chunk (unique key on seed_chunk.chunk)', () => {
    const t004 = readFileSync(join(ROOT, 'supabase', 'tests', 't004_rls_test.sql'), 'utf8');
    const seedInserts = [...t004.matchAll(/insert into public\.seed_chunk[^;]*;/g)].map((m) => m[0]);
    expect(seedInserts.length).toBeGreaterThanOrEqual(3);
    const strings = new Set(seedInserts.flatMap((stmt) => [...stmt.matchAll(/'([^']*)'/g)].map((m) => (m[1] ?? '').trim().toLowerCase())));
    const realChunks = new Set(rows.map((r) => r.chunk.trim().toLowerCase()));
    expect(rows.length).toBeGreaterThan(0);
    for (const s of strings) expect(realChunks.has(s), s).toBe(false);
  });

  it('(QA-22) meaning_zh has no Simplified-only characters and no Mainland-only vocabulary', () => {
    for (const r of rows) {
      const bad: string[] = [];
      for (const c of r.meaning) if (SIMPLIFIED_ONLY.includes(c)) bad.push(c);
      expect(bad, `${r.file} ${r.chunk}`).toEqual([]);
      for (const w of MAINLAND_WORDS) expect(r.meaning.includes(w), `${r.file} ${r.chunk} ${w}`).toBe(false);
    }
  });

  it('(QA-23) no two chunks are the same once articles, prepositions and placeholders are ignored', () => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const key = nearKey(r.chunk);
      expect(key.length, r.chunk).toBeGreaterThan(0);
      const prior = seen.get(key);
      expect(prior === undefined ? '' : `${r.chunk} ~ ${prior}`).toBe('');
      seen.set(key, r.chunk);
    }
  });

  it('(QA-24) examples are sentences: start with a capital letter, end with . ? or !, and hold no digits, e-mail or links', () => {
    for (const r of rows) {
      expect(r.example, r.chunk).toMatch(/^[A-Z].*[.?!]$/);
      expect(r.example, r.chunk).not.toMatch(/\d|@|https?:|www\./);
      expect(r.chunk, r.chunk).not.toMatch(/[A-Z]{2,}|\d/);
    }
  });
});
