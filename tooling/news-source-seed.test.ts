// T-022: the news_source seed migration ↔ ARCHITECTURE §11.1 table ↔ the t022 pgTAP expectation (CI db job checks the real DB).
import { describe, expect, it } from 'vitest';
import arch from '../docs/ARCHITECTURE.md?raw';
import seed from '../supabase/migrations/20261124170000_t022_news_source_seed.sql?raw';
import pgtap from '../supabase/tests/t022_news_source_seed_test.sql?raw';

const CATEGORY: Record<string, string> = { AI: 'ai', 軟體工程: 'software', 半導體產業: 'semiconductor' };
const PRIORITY: Record<string, string> = { 主: '1', '備 1': '2', '備 2': '3' };

/** category|priority|feed|fetch_mode for every row of the §11.1 table. */
const archRows = (): string[] =>
  arch
    .slice(arch.indexOf('### 11.1 '), arch.indexOf('#### 11.1.1'))
    .split('\n')
    .filter((l) => l.startsWith('| ') && l.includes('`https://'))
    .map((l) => {
      const c = l.split('|').map((x) => x.trim());
      const feed = /`(https:\/\/[^`]+)`/.exec(c[4] ?? '')?.[1] ?? '?';
      const mode = /`(rss_full|rss_then_page)`/.exec(c[5] ?? '')?.[1] ?? '?';
      return `${CATEGORY[c[1] ?? ''] ?? '?'}|${PRIORITY[c[2] ?? ''] ?? '?'}|${feed}|${mode}`;
    });

type Row = { category: string; priority: string; name: string; feed: string; mode: string; pattern: string; enabled: string; terms: string };
const SEED = /^ {2}\('([^']+)', '([^']+)', '([a-z]+)', ([1-3]), '(rss_full|rss_then_page)', (null|'[^']*'), (true|false), (null|'[0-9-]+')\)[,;]$/gm;
const PGTAP = /^ {4}\('([a-z]+)', ([1-3]), '([^']+)', '([^']+)', '(rss_full|rss_then_page)', (null(?:::text)?|'[^']*'), (true|false), (null|'[0-9-]+')\)(?:,|\$\$,)$/gm;
const seedRows = (): Row[] =>
  [...seed.matchAll(SEED)].map((m) => ({
    category: m[3] ?? '',
    priority: m[4] ?? '',
    name: m[1] ?? '',
    feed: m[2] ?? '',
    mode: m[5] ?? '',
    pattern: m[6] ?? '',
    enabled: m[7] ?? '',
    terms: m[8] ?? '',
  }));
const key = (r: Row): string => `${r.category}|${r.priority}|${r.feed}|${r.mode}`;

describe('news_source seed (ARCHITECTURE §11.1, §11.1.1 point 1)', () => {
  it('(AC-T22-8) the seed migration inserts exactly the 9 sources of the §11.1 table, all enabled, include_url_pattern null', () => {
    const rows = seedRows();
    expect(archRows()).toHaveLength(9);
    expect(rows.map(key).sort()).toEqual(archRows().sort());
    expect(rows.map((r) => `${r.pattern} ${r.enabled}`)).toEqual(Array.from({ length: 9 }, () => 'null true'));
  });

  it('(AC-T22-8) the t022 pgTAP file expects the same 9 rows; plan(N) equals its assertions', () => {
    const expected = [...pgtap.matchAll(PGTAP)].map((m) => [m[1], m[2], m[3], m[4], m[5], (m[6] ?? '').replace('::text', ''), m[7], m[8]].join('|'));
    const fromSeed = seedRows().map((r) => [r.category, r.priority, r.name, r.feed, r.mode, r.pattern, r.enabled, r.terms].join('|'));
    expect(expected.sort()).toEqual(fromSeed.sort());
    const assertions = pgtap.split('\n').filter((l) => /^select (results_eq|is)\(/.test(l)).length;
    expect(/^select plan\((\d+)\);$/m.exec(pgtap)?.[1]).toBe(String(assertions));
  });
});
