import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEED_BATCH_SIZE, SeedBatchSchema } from '@english-coach/contracts';
import type { SeedBatch, SeedChunk } from '@english-coach/contracts';
import { makeSeedBatch, makeSeedChunk } from '../test/factories.ts';
import { checkSeedBatch, renderSeedMigration } from './seed-chunks.ts';
import * as seedData from './index.ts';

// ---------- helpers ----------

/** 通過檢查的資料，item 0 換成 `patch` 之後的檢查結果（只回規則與 path）。 */
function issuesOf(data: unknown, others: readonly SeedBatch[] = [], fileName = 'batch-1.json'): string[] {
  const r = checkSeedBatch({ fileName, data }, others);
  return r.ok ? [] : r.error.issues.map((i) => `${i.message.split(' ')[0] ?? ''}@${i.path}`);
}

function withItem0(patch: Partial<SeedChunk>): SeedBatch {
  const b = makeSeedBatch();
  return { ...b, items: b.items.map((item, i) => (i === 0 ? { ...item, ...patch } : item)) };
}

function ruleAt(rule: string, path: string): string {
  return `${rule}@${path}`;
}

function hasRule(issues: readonly string[], rule: string): boolean {
  return issues.some((s) => s.startsWith(`${rule}@`));
}

// ---------- drift：比對函式與讀檔層 ----------

const MIGRATION_SUFFIX = /_seed_chunk_batch_(\d+)\.sql$/;
const JSON_NAME = /^batch-.*\.json$/;

/** 「檔名 → 內容」兩張表；回傳失敗訊息（空陣列表示通過）。 */
function compareSeedFiles(jsons: ReadonlyMap<string, string>, migrations: ReadonlyMap<string, string>): string[] {
  const failures: string[] = [];
  const parsed = new Map<number, { fileName: string; data: unknown }>();
  for (const [fileName, text] of jsons) {
    const m = /^batch-([1-6])\.json$/.exec(fileName);
    if (m === null) {
      failures.push(`${fileName}: file name must be batch-1.json to batch-6.json`);
      continue;
    }
    try {
      parsed.set(Number(m[1]), { fileName, data: JSON.parse(text) as unknown });
    } catch {
      failures.push(`batch ${String(m[1])}: ${fileName} is not valid JSON`);
    }
  }
  const valid = new Map<number, SeedBatch>();
  for (const [n, { data }] of parsed) {
    const r = SeedBatchSchema.safeParse(data);
    if (r.success) valid.set(n, r.data);
  }
  const byNumber = new Map<number, string[]>();
  for (const name of migrations.keys()) {
    const m = MIGRATION_SUFFIX.exec(name);
    if (m !== null) byNumber.set(Number(m[1]), [...(byNumber.get(Number(m[1])) ?? []), name]);
  }
  for (const [n, { fileName, data }] of parsed) {
    const others = [...valid].filter(([k]) => k !== n).map(([, v]) => v);
    const checked = checkSeedBatch({ fileName, data }, others);
    if (!checked.ok) {
      failures.push(`batch ${String(n)}: ${checked.error.message}`);
      continue;
    }
    const names = byNumber.get(n) ?? [];
    const [only, ...extra] = names;
    if (only === undefined) failures.push(`batch ${String(n)}: no migration ending _seed_chunk_batch_${String(n)}.sql`);
    else if (extra.length > 0) failures.push(`batch ${String(n)}: more than one migration (${names.join(', ')})`);
    else if (migrations.get(only) !== renderSeedMigration(checked.value)) failures.push(`batch ${String(n)}: ${only} differs from renderSeedMigration`);
  }
  for (const [n, names] of byNumber) {
    if (!parsed.has(n) && !jsons.has(`batch-${String(n)}.json`)) failures.push(`batch ${String(n)}: migration ${names.join(', ')} has no batch-${String(n)}.json`);
  }
  return failures;
}

/** 讀檔層：只收 `batch-*.json` 與以 `_seed_chunk_batch_<n>.sql` 結尾的 migration；目錄不存在回空。 */
function readSeedFiles(seedDir: string, migrationDir: string): { jsons: Map<string, string>; migrations: Map<string, string> } {
  const read = (dir: string, accept: (name: string) => boolean): Map<string, string> => {
    const out = new Map<string, string>();
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir).sort()) if (accept(name)) out.set(name, readFileSync(join(dir, name), 'utf8'));
    return out;
  };
  return { jsons: read(seedDir, (n) => JSON_NAME.test(n)), migrations: read(migrationDir, (n) => MIGRATION_SUFFIX.test(n)) };
}

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const FIXTURES = join(ROOT, 'packages', 'seed-data', 'test', 'fixtures', 'seed-chunks');

function filesOf(batch: SeedBatch, n = batch.batch): { jsons: Map<string, string>; migrations: Map<string, string> } {
  return {
    jsons: new Map([[`batch-${String(n)}.json`, JSON.stringify(batch)]]),
    migrations: new Map([[`20261128000000_t050_seed_chunk_batch_${String(n)}.sql`, renderSeedMigration(batch)]]),
  };
}

// ---------- 規則 ----------

describe('checkSeedBatch rules R1–R8', () => {
  it('(AC-T24-2) (TC-3) R1: bad chunks each give one R1, good chunks give none', () => {
    const path = 'items.0.chunk';
    for (const chunk of ['go (now)', 'a/b test', 'wait…', ' take over', 'take  over', 'deadline', 'one two three four five six seven']) {
      const issues = issuesOf(withItem0({ chunk }));
      expect(issues.filter((s) => s === ruleAt('R1', path)), chunk).toHaveLength(1);
    }
    for (const chunk of ['take over', 'get buy-in from sb', 'circle back on this one later']) {
      expect(hasRule(issuesOf(withItem0({ chunk, example_en: `Please ${chunk} with the team today.` })), 'R1'), chunk).toBe(false);
    }
  });

  it('(AC-T24-3) (TC-4) R2: empty, blank, 31 chars, no Han fail; 30 Han chars pass (code points)', () => {
    const path = 'items.0.meaning_zh';
    for (const meaning_zh of ['', '   ', '開'.repeat(31), 'meeting']) {
      expect(issuesOf(withItem0({ meaning_zh })).filter((s) => s === ruleAt('R2', path)), meaning_zh).toHaveLength(1);
    }
    expect(hasRule(issuesOf(withItem0({ meaning_zh: '開'.repeat(30) })), 'R2')).toBe(false);
    expect(hasRule(issuesOf(withItem0({ meaning_zh: '𠀀'.repeat(30) })), 'R2')).toBe(false);
    expect(hasRule(issuesOf(withItem0({ meaning_zh: '𠀀'.repeat(31) })), 'R2')).toBe(true);
  });

  it('(AC-T24-3) (TC-28) R2: outer whitespace and control characters fail', () => {
    const path = 'items.0.meaning_zh';
    for (const meaning_zh of [' 開會', '開會 ', '開\n會', '開\t會', '開\u0000會', '開\u007F會']) {
      expect(issuesOf(withItem0({ meaning_zh })).filter((s) => s === ruleAt('R2', path)), JSON.stringify(meaning_zh)).toHaveLength(1);
    }
    expect(hasRule(issuesOf(withItem0({ meaning_zh: '開會' })), 'R2')).toBe(false);
  });

  it('(AC-T24-4) (TC-5) R3: spaces, 4 or 26 words, "/" anywhere, line breaks fail; 5 and 25 words pass', () => {
    const path = 'items.0.example_en';
    const words = (n: number): string => `go ${'qaaaa '.repeat(n - 1)}`.trim();
    const bad = [' We will go qaaaa together.', 'We will go qaaaa together. ', words(4), words(26), 'We will go qaaaa and/or soon.', 'We will go qaaaa\ntogether soon.'];
    for (const example_en of bad) {
      expect(issuesOf(withItem0({ example_en })).filter((s) => s === ruleAt('R3', path)), JSON.stringify(example_en)).toHaveLength(1);
    }
    for (const example_en of [words(5), words(25)]) expect(hasRule(issuesOf(withItem0({ example_en })), 'R3'), example_en).toBe(false);
  });

  it('(AC-T24-5) (TC-6) R4: example must contain the chunk (placeholders and inflections count)', () => {
    const path = ruleAt('R4', 'items.0.example_en');
    const run = (chunk: string, example_en: string): string[] => issuesOf(withItem0({ chunk, example_en }));
    expect(run('go qaaaa', 'Nothing relevant appears in this sentence.')).toContain(path);
    expect(run('get buy-in from sb', '…get buy-in from the whole product team…')).not.toContain(path);
    expect(run('take over', 'They took over the old office yesterday.')).not.toContain(path);
    expect(run('ship it', 'The shipment arrived on Monday morning.')).toContain(path);
  });

  it('(AC-T24-6) (TC-7) R5: unknown, wrong case, more than 3, duplicates fail; 0 and 3 valid tags pass', () => {
    const path = ruleAt('R5', 'items.0.tags');
    for (const tags of [['sports'], ['Meeting'], ['email', 'project', 'meeting', 'technical'], ['email', 'email']]) {
      expect(issuesOf({ ...makeSeedBatch(), items: [{ ...makeSeedChunk(), tags }, ...makeSeedBatch().items.slice(1)] }).filter((s) => s === path), tags.join()).toHaveLength(1);
    }
    for (const tags of [[], ['email', 'project', 'meeting']]) {
      expect(hasRule(issuesOf(withItem0({ tags: tags as SeedChunk['tags'] })), 'R5')).toBe(false);
    }
  });

  it('(AC-T24-7) (TC-8) R6 within a batch: normalized duplicates point at the later item; "lets go" is not "let\'s go"', () => {
    const b = makeSeedBatch();
    const dup = (a: string, c: string): string[] =>
      issuesOf({
        ...b,
        items: b.items.map((item, i) => (i === 0 ? makeSeedChunk({ chunk: a, example_en: `Please ${a} with us today friend.` }, 0) : i === 1 ? makeSeedChunk({ chunk: c, example_en: `Please ${c} with us today friend.` }, 1) : item)),
      });
    expect(dup('get buy-in', 'Get Buy In')).toContain(ruleAt('R6', 'items.1.chunk'));
    expect(dup("let's go", 'lets go')).not.toContain(ruleAt('R6', 'items.1.chunk'));
    expect(hasRule(dup("let's go", 'lets go'), 'R6')).toBe(false);
  });

  it('(AC-T24-7) (TC-9) R6 across batches: duplicate of an item in `others` is reported with the batch', () => {
    const other = makeSeedBatch({ batch: 2 });
    const others: SeedBatch[] = [{ ...other, items: other.items.map((item, i) => (i === 0 ? makeSeedChunk({ chunk: 'take over', example_en: 'They take over the office soon.' }) : item)) }];
    const mine = makeSeedBatch();
    const data = { ...mine, items: mine.items.map((item, i) => (i === 5 ? makeSeedChunk({ chunk: 'Take Over', example_en: 'They take over the office soon.' }, 5) : item)) };
    const r = checkSeedBatch({ fileName: 'batch-1.json', data }, others);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.error.issues.find((i) => i.message.startsWith('R6'));
      expect(issue?.path).toBe('items.5.chunk');
      expect(issue?.message).toContain('batch 2');
    }
  });

  it('(AC-T24-8) (TC-10) R7: 99, 101 and 0 items fail at `items`; 100 pass', () => {
    const b = makeSeedBatch();
    for (const items of [b.items.slice(0, 99), [...b.items, makeSeedChunk({}, 900)], []]) {
      expect(issuesOf({ ...b, items })).toContain(ruleAt('R7', 'items'));
    }
    expect(issuesOf(b)).toEqual([]);
  });

  it('(AC-T24-8) (TC-11) R8: bad batch values and a repeated batch fail at `batch`; 1 to 6 pass', () => {
    const b = makeSeedBatch();
    for (const batch of [0, 7, 1.5, '1']) expect(issuesOf({ ...b, batch })).toContain(ruleAt('R8', 'batch'));
    const three = makeSeedBatch({ batch: 3 });
    expect(issuesOf(three, [three], 'batch-3.json')).toContain(ruleAt('R8', 'batch'));
    for (const n of [1, 2, 3, 4, 5, 6]) expect(issuesOf(makeSeedBatch({ batch: n }), [], `batch-${String(n)}.json`)).toEqual([]);
  });

  it('(AC-T24-8) (TC-27) R8 file name: only basename batch-<n>.json with <n> equal to batch passes', () => {
    const two = makeSeedBatch({ batch: 2 });
    expect(issuesOf(two, [], 'batch-2.json')).toEqual([]);
    expect(issuesOf(two, [], 'seed/batch-2.json')).toEqual([]);
    for (const name of ['batch-3.json', 'batch-02.json', 'batch-2.JSON', 'b.json']) {
      expect(issuesOf(two, [], name), name).toContain(ruleAt('R8', 'fileName'));
    }
  });

  it('(AC-T24-9) (TC-12) every issue comes back at once; wrong shapes give `shape`', () => {
    const data = {
      batch: 1,
      items: [
        makeSeedChunk({ chunk: 'go (now)' }),
        makeSeedChunk({ chunk: 'take over', example_en: 'Nothing relevant appears in this sentence.' }),
        makeSeedChunk({ chunk: 'Take Over', example_en: 'They take over the office soon.' }),
      ],
    };
    const issues = issuesOf(data);
    for (const rule of ['R1', 'R4', 'R6', 'R7']) expect(hasRule(issues, rule), rule).toBe(true);
    for (const bad of [null, { batch: 1, items: 'x' }, { batch: 1, items: [5] }]) {
      const r = checkSeedBatch({ fileName: 'batch-1.json', data: bad }, []);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('validation');
        expect(r.error.issues.some((i) => i.message.startsWith('shape'))).toBe(true);
        expect(r.error.message).toBe(r.error.issues[0]?.message);
      }
    }
  });

  it('(AC-T24-9) (TC-13) a valid batch is ok and the value equals the input', () => {
    const b = makeSeedBatch();
    const alone = checkSeedBatch({ fileName: 'batch-1.json', data: b }, []);
    expect(alone.ok && alone.value).toEqual(b);
    const withOther = checkSeedBatch({ fileName: 'batch-1.json', data: b }, [makeSeedBatch({ batch: 2 })]);
    expect(withOther.ok && withOther.value).toEqual(b);
  });
});

// ---------- migration 產生器 ----------

describe('renderSeedMigration', () => {
  const small: SeedBatch = {
    batch: 3,
    items: [
      { chunk: 'take over', meaning_zh: '接手', example_en: "It's time to take over.", tags: [] },
      { chunk: 'go home', meaning_zh: '回家', example_en: 'Let us go home now please.', tags: ['meeting', 'email'] },
    ],
  };

  it('(AC-T24-10) (TC-14) renders the ARCHITECTURE §4.10 format verbatim', () => {
    const expected = [
      '-- T-050 seed_chunk batch 3 (generated format: packages/seed-data/src/seed-chunks.ts renderSeedMigration; source supabase/seed-chunks/batch-3.json).',
      'insert into public.seed_chunk (chunk, meaning_zh, example_en, tags, batch) values',
      "  ('take over', '接手', 'It''s time to take over.', '{}'::text[], 3),",
      "  ('go home', '回家', 'Let us go home now please.', array['meeting', 'email']::text[], 3);",
      '',
    ].join('\n');
    expect(renderSeedMigration(small)).toBe(expected);
  });

  it('(AC-T24-10) (TC-15) is deterministic and does not touch a frozen input', () => {
    const frozen: SeedBatch = { batch: small.batch, items: small.items.map((i) => ({ ...i, tags: [...i.tags] })) };
    for (const item of frozen.items) {
      Object.freeze(item.tags);
      Object.freeze(item);
    }
    Object.freeze(frozen.items);
    Object.freeze(frozen);
    const first = renderSeedMigration(frozen);
    expect(renderSeedMigration(frozen)).toBe(first);
    expect(frozen).toEqual(small);
    expect(first.endsWith(';\n')).toBe(true);
    expect(first).not.toContain('on conflict');
  });
});

// ---------- drift ----------

describe('seed file drift', () => {
  it('(AC-T24-11) (TC-16) one-character diff, missing migration, two migrations, missing JSON each fail with the batch number', () => {
    const b = makeSeedBatch({ batch: 2 });
    const good = filesOf(b);
    expect(compareSeedFiles(good.jsons, good.migrations)).toEqual([]);

    const [name, text] = [...good.migrations][0] ?? ['', ''];
    const diff = new Map([[name, `${text.slice(0, -2)}:\n`]]);
    expect(compareSeedFiles(good.jsons, diff).join()).toMatch(/batch 2.*differs/);

    expect(compareSeedFiles(good.jsons, new Map()).join()).toMatch(/batch 2.*no migration/);

    const twice = new Map([...good.migrations, ['20261128000001_t050_seed_chunk_batch_2.sql', text]]);
    expect(compareSeedFiles(good.jsons, twice).join()).toMatch(/batch 2.*more than one/);

    expect(compareSeedFiles(new Map(), good.migrations).join()).toMatch(/batch 2.*no batch-2\.json/);
  });

  it('(AC-T24-11) (TC-17) mismatched file names fail; empty tables pass', () => {
    const one = makeSeedBatch({ batch: 1 });
    const text = JSON.stringify(one);
    expect(compareSeedFiles(new Map([['batch-2.json', text]]), new Map()).join()).toMatch(/batch 2.*R8/);
    expect(compareSeedFiles(new Map([['batch-7.json', text]]), new Map()).join()).toContain('batch-7.json');
    expect(compareSeedFiles(new Map([['batch-01.json', text]]), new Map()).join()).toContain('batch-01.json');
    expect(compareSeedFiles(new Map(), new Map())).toEqual([]);
  });

  it('(AC-T24-12) (TC-18) the real supabase/seed-chunks and supabase/migrations match', () => {
    const { jsons, migrations } = readSeedFiles(join(ROOT, 'supabase', 'seed-chunks'), join(ROOT, 'supabase', 'migrations'));
    expect(compareSeedFiles(jsons, migrations)).toEqual([]);
  });

  it('(AC-T24-12) (TC-19) the reader keeps batch JSON and seed-chunk migrations only; missing or empty dirs give nothing', () => {
    const got = readSeedFiles(join(FIXTURES, 'reader', 'seed'), join(FIXTURES, 'reader', 'migrations'));
    expect([...got.jsons.keys()]).toEqual(['batch-1.json']);
    expect([...got.migrations.keys()]).toEqual(['20260101000000_t050_seed_chunk_batch_1.sql']);
    const empty = readSeedFiles(join(FIXTURES, 'empty'), join(FIXTURES, 'empty'));
    expect(empty.jsons.size + empty.migrations.size).toBe(0);
    const missing = readSeedFiles(join(FIXTURES, 'nope'), join(FIXTURES, 'nope'));
    expect(missing.jsons.size + missing.migrations.size).toBe(0);
  });
});

// ---------- 套件形狀 ----------

function readJson(...parts: string[]): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('expected an object');
  return Object.fromEntries(Object.entries(parsed));
}

describe('package shape', () => {
  it('(AC-T24-13) (TC-20) package.json, tsconfig.json and the root references match ARCHITECTURE §4.10.1', () => {
    const pkg = readJson('packages', 'seed-data', 'package.json');
    expect(pkg).toEqual({
      name: '@english-coach/seed-data',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts' },
      dependencies: { '@english-coach/contracts': 'workspace:*', '@english-coach/domain': 'workspace:*' },
    });
    expect(pkg['scripts']).toBeUndefined();
    const ts = readJson('packages', 'seed-data', 'tsconfig.json');
    expect(ts['references']).toEqual([{ path: '../contracts' }, { path: '../domain' }]);
    expect(ts['compilerOptions']).toMatchObject({ composite: true, allowImportingTsExtensions: true, types: [] });
    expect(readJson('tsconfig.json')['references']).toContainEqual({ path: './packages/seed-data' });
    const root = readJson('package.json');
    expect(JSON.stringify([root['scripts'], root['dependencies'], root['devDependencies']])).not.toContain('seed-data');
  });

  it('(AC-T24-13) (TC-21) the package index exports checkSeedBatch and renderSeedMigration', () => {
    expect(Object.keys(seedData)).toEqual(expect.arrayContaining(['checkSeedBatch', 'renderSeedMigration']));
  });

  it('(AC-T24-16) (TC-26) pnpm-lock.yaml has the seed-data importer with two workspace links; both packages resolve', async () => {
    const lines = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8').split('\n');
    const start = lines.indexOf('  packages/seed-data:');
    expect(start).toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^ {0,2}\S/.test(line)) break;
      if (line.trim() !== '') block.push(line);
    }
    expect(block).toEqual([
      '    dependencies:',
      "      '@english-coach/contracts':",
      '        specifier: workspace:*',
      '        version: link:../contracts',
      "      '@english-coach/domain':",
      '        specifier: workspace:*',
      '        version: link:../domain',
    ]);
    const contracts = await import('@english-coach/contracts');
    const domain = await import('@english-coach/domain');
    expect(contracts.SEED_BATCH_SIZE).toBe(SEED_BATCH_SIZE);
    expect(typeof domain.normalizeWords).toBe('function');
  });
});
