// QA probes for T-024 (checkSeedBatch, renderSeedMigration, seed contracts). Fake values only.
import { describe, expect, it } from 'vitest';
import { SEED_BATCH_SIZE, SEED_TAGS, SeedBatchSchema, SeedChunkSchema, SeedTagSchema } from '@english-coach/contracts';
import type { SeedBatch, SeedChunk } from '@english-coach/contracts';
import { makeSeedBatch, makeSeedChunk } from '../test/factories.ts';
import { checkSeedBatch, renderSeedMigration } from './seed-chunks.ts';

function issuesOf(data: unknown, others: readonly SeedBatch[] = [], fileName = 'batch-1.json'): string[] {
  const r = checkSeedBatch({ fileName, data }, others);
  return r.ok ? [] : r.error.issues.map((i) => `${i.message.split(' ')[0] ?? ''}@${i.path}`);
}

function withItem(index: number, patch: Record<string, unknown>, batch: SeedBatch = makeSeedBatch()): unknown {
  return { ...batch, items: batch.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) };
}

function tinyBatch(items: readonly SeedChunk[], batch = 3): SeedBatch {
  return { batch, items: [...items] };
}

const HAN_ASTRAL = '\u{20000}'; // one code point, two UTF-16 units

describe('QA probes: contracts', () => {
  it('(QA-1) SEED_TAGS order, batch size, and schema strictness', () => {
    expect([...SEED_TAGS]).toEqual(['meeting', 'presentation', 'negotiation', 'interview', 'email', 'project', 'technical', 'small-talk']);
    expect(SEED_BATCH_SIZE).toBe(100);
    for (const t of SEED_TAGS) expect(SeedTagSchema.safeParse(t).success).toBe(true);
    for (const bad of ['Meeting', 'MEETING', 'small_talk', 'small talk', ' meeting', '', 'sports', 1, null]) {
      expect(SeedTagSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('(QA-2) SeedBatchSchema: batch 1..6 integers only, items exactly 100', () => {
    for (const b of [1, 2, 3, 4, 5, 6]) expect(SeedBatchSchema.safeParse(makeSeedBatch({ batch: b })).success).toBe(true);
    for (const b of [0, 7, -1, 1.5, 6.0001, '1', null, undefined]) {
      expect(SeedBatchSchema.safeParse({ ...makeSeedBatch(), batch: b }).success).toBe(false);
    }
    const full = makeSeedBatch();
    expect(SeedBatchSchema.safeParse({ ...full, items: full.items.slice(0, 99) }).success).toBe(false);
    expect(SeedBatchSchema.safeParse({ ...full, items: [...full.items, makeSeedChunk({}, 999)] }).success).toBe(false);
  });

  it('(QA-3) SeedChunkSchema: three unique tags pass, a fourth or a repeat fails', () => {
    expect(SeedChunkSchema.safeParse(makeSeedChunk({ tags: ['meeting', 'email', 'project'] })).success).toBe(true);
    expect(SeedChunkSchema.safeParse(makeSeedChunk({ tags: ['meeting', 'email', 'project', 'technical'] })).success).toBe(false);
    expect(SeedChunkSchema.safeParse(makeSeedChunk({ tags: ['meeting', 'email', 'meeting'] })).success).toBe(false);
  });
});

describe('QA probes: R1 chunk', () => {
  it('(QA-4) exact word-count boundaries: 1 and 7 fail, 2 and 6 pass', () => {
    const run = (chunk: string): string[] => issuesOf(withItem(0, { chunk, example_en: `We say ${chunk} to all of them.` }));
    expect(run('deadline')).toContain('R1@items.0.chunk');
    expect(run('a b c d e f g')).toContain('R1@items.0.chunk');
    expect(run('go now')).not.toContain('R1@items.0.chunk');
    expect(run("a-b c's d e f g")).not.toContain('R1@items.0.chunk');
  });

  it('(QA-5) other bad characters in chunk fail R1: digits, tab, period, comma, non-ASCII letter', () => {
    for (const chunk of ['go 2 now', 'go\tnow', 'go now.', 'go, now', 'caf\u00e9 now', '- -', "' '"]) {
      expect(issuesOf(withItem(0, { chunk })), JSON.stringify(chunk)).toContain('R1@items.0.chunk');
    }
  });

  it('(QA-6) non-string chunk is R1 at its path and does not crash R4 or R6', () => {
    for (const chunk of [null, 5, undefined, ['go now']]) {
      const issues = issuesOf(withItem(0, { chunk }));
      expect(issues, String(chunk)).toContain('R1@items.0.chunk');
      expect(issues.some((s) => s.startsWith('R4@') || s.startsWith('R6@'))).toBe(false);
    }
  });

  it('(QA-7) R4 and R6 are skipped for an item whose chunk fails R1', () => {
    const b = makeSeedBatch();
    const data = {
      ...b,
      items: b.items.map((item, i) => (i === 0 || i === 1 ? { ...item, chunk: 'a/b', example_en: 'nothing relevant appears in this sentence at all' } : item)),
    };
    const issues = issuesOf(data);
    expect(issues).toContain('R1@items.0.chunk');
    expect(issues).toContain('R1@items.1.chunk');
    expect(issues.filter((s) => s.startsWith('R4@') || s.startsWith('R6@'))).toEqual([]);
  });
});

describe('QA probes: R2 meaning_zh', () => {
  const r2 = (meaning_zh: unknown): boolean => issuesOf(withItem(0, { meaning_zh })).includes('R2@items.0.meaning_zh');

  it('(QA-8) length is counted in code points: 30 astral Han pass, 31 fail', () => {
    expect(r2(HAN_ASTRAL.repeat(30))).toBe(false);
    expect(r2(HAN_ASTRAL.repeat(31))).toBe(true);
    expect(r2('\u958b'.repeat(30))).toBe(false);
    expect(r2('\u958b'.repeat(31))).toBe(true);
  });

  it('(QA-9) control character boundaries: U+0000, U+001F, U+007F fail; U+0020, U+007E, U+0080 pass', () => {
    expect(r2('\u958b\u0000\u6703')).toBe(true);
    expect(r2('\u958b\u001f\u6703')).toBe(true);
    expect(r2('\u958b\u007f\u6703')).toBe(true);
    expect(r2('\u958b\r\u6703')).toBe(true);
    expect(r2('\u958b \u6703')).toBe(false);
    expect(r2('\u958b\u007e\u6703')).toBe(false);
    expect(r2('\u958b\u0080\u6703')).toBe(false);
  });

  it('(QA-10) outer whitespace of any kind fails, including a full-width space and NBSP', () => {
    for (const s of ['\u3000\u958b\u6703', '\u958b\u6703\u3000', '\u00a0\u958b\u6703', '\u958b\u6703\u00a0', '\u958b\u6703 ']) {
      expect(r2(s), JSON.stringify(s)).toBe(true);
    }
  });

  it('(QA-11) a Han character must exist: Latin, digits, kana and punctuation alone fail', () => {
    for (const s of ['meeting', '12345', '\u3042\u3044\u3046', '\uff01\uff1f', 'abc \u958b'.slice(0, 3)]) {
      expect(r2(s), JSON.stringify(s)).toBe(true);
    }
    expect(r2('a\u958b')).toBe(false);
  });

  it('(QA-12) non-string meaning_zh is R2 at its path', () => {
    for (const v of [null, 5, undefined, ['\u958b\u6703'], { a: 1 }]) expect(r2(v), typeof v).toBe(true);
  });
});

describe('QA probes: R3 example_en', () => {
  const r3 = (example_en: unknown): boolean => issuesOf(withItem(0, { example_en })).includes('R3@items.0.example_en');

  it('(QA-13) outer whitespace (tab, CR, LF) and inner CR or LF fail; inner single spaces pass', () => {
    const base = 'go qaaaa now we will do it';
    for (const s of [`\t${base}`, `${base}\t`, `${base}\n`, `\r${base}`, 'go qaaaa now\rwe will do it', 'go qaaaa now\nwe will do it']) {
      expect(r3(s), JSON.stringify(s)).toBe(true);
    }
  });

  it('(QA-14) "/" fails at the start, in the middle of a word, and at the end', () => {
    for (const s of ['/go qaaaa now we will', 'go qaaaa now we wi/ll', 'go qaaaa now we will/', 'go qaaaa now / we will']) {
      expect(r3(s), JSON.stringify(s)).toBe(true);
    }
  });

  it('(QA-15) 5 and 25 words pass; 4 and 26 fail; runs of spaces do not add words', () => {
    const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${'a'.repeat(i + 1)}`).join(' ');
    expect(r3(words(5))).toBe(false);
    expect(r3(words(25))).toBe(false);
    expect(r3(words(4))).toBe(true);
    expect(r3(words(26))).toBe(true);
    expect(r3(words(4).replace(' ', '   '))).toBe(true);
  });

  it('(QA-16) non-string example_en is R3 at its path and does not crash R4', () => {
    for (const v of [null, 5, undefined, ['x']]) {
      const issues = issuesOf(withItem(0, { example_en: v }));
      expect(issues, String(v)).toContain('R3@items.0.example_en');
      expect(issues).not.toContain('R4@items.0.example_en');
    }
  });
});

describe('QA probes: R4 example contains chunk', () => {
  const r4 = (chunk: string, example_en: string): boolean => issuesOf(withItem(0, { chunk, example_en })).includes('R4@items.0.example_en');

  it('(QA-17) whole-word matching, case-insensitive, with hyphenated chunks', () => {
    expect(r4('go now', 'Please GO NOW before the meeting starts.')).toBe(false);
    expect(r4('get buy-in', 'We must get buy-in from every leader here.')).toBe(false);
    expect(r4('go now', 'Please go slowly before the meeting starts.')).toBe(true);
    expect(r4('ship it', 'The shipment arrived on Monday morning.')).toBe(true);
    expect(r4('go now', 'Please go before the meeting starts now.')).toBe(true);
  });

  it('(QA-18) a chunk of 6 words with a placeholder matches a longer example', () => {
    expect(r4('get buy-in from sb', 'We need to get buy-in from the whole product team soon.')).toBe(false);
  });
});

describe('QA probes: R5 tags', () => {
  const r5 = (tags: unknown): string[] => issuesOf(withItem(0, { tags })).filter((s) => s.startsWith('R5@'));

  it('(QA-19) non-array and non-string tags fail with a single R5 at the tags path', () => {
    for (const v of ['meeting', null, undefined, [1], [null], { 0: 'meeting' }]) {
      expect(r5(v), JSON.stringify(v)).toEqual(['R5@items.0.tags']);
    }
  });

  it('(QA-20) a list that is both too long and duplicated gives exactly one R5', () => {
    expect(r5(['email', 'email', 'email', 'email', 'bogus'])).toEqual(['R5@items.0.tags']);
  });

  it('(QA-21) all 8 tags are accepted individually; 3 unique pass', () => {
    for (const t of SEED_TAGS) expect(r5([t])).toEqual([]);
    expect(r5(['small-talk', 'technical', 'interview'])).toEqual([]);
  });
});

describe('QA probes: R6 duplicates', () => {
  const dupBatch = (a: string, b: string): unknown => {
    const base = makeSeedBatch();
    return {
      ...base,
      items: base.items.map((item, i) => (i === 3 ? { ...item, chunk: a, example_en: `We say ${a} to all of them.` } : i === 7 ? { ...item, chunk: b, example_en: `We say ${b} to all of them.` } : item)),
    };
  };

  it('(QA-22) hyphen vs space, case, and the three-way duplicate each point at the later items only', () => {
    expect(issuesOf(dupBatch('buy-in now', 'Buy In Now'))).toEqual(['R6@items.7.chunk']);
    expect(issuesOf(dupBatch('buy in now', 'buy-in now'))).toEqual(['R6@items.7.chunk']);
    expect(issuesOf(dupBatch('go now', 'go nowhere'))).toEqual([]);
    const base = makeSeedBatch();
    const three = { ...base, items: base.items.map((item, i) => (i === 1 || i === 2 || i === 3 ? { ...item, chunk: 'run it', example_en: 'We will run it together very soon.' } : item)) };
    expect(issuesOf(three)).toEqual(['R6@items.2.chunk', 'R6@items.3.chunk']);
  });

  it('(QA-23) a duplicate of an `others` item names the batch and the item; items inside `others` are not rechecked', () => {
    const other = makeSeedBatch({ batch: 2 });
    const mine = withItem(5, { chunk: other.items[9]?.chunk ?? '', example_en: `We say ${other.items[9]?.chunk ?? ''} to all of them.` });
    const r = checkSeedBatch({ fileName: 'batch-1.json', data: mine }, [other]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]?.path).toBe('items.5.chunk');
      expect(r.error.issues[0]?.message).toContain('batch 2');
    }
    expect(checkSeedBatch({ fileName: 'batch-1.json', data: makeSeedBatch() }, [other, makeSeedBatch({ batch: 3 })]).ok).toBe(true);
  });

  it('(QA-24) apostrophes are kept: let\'s go and lets go differ; Let\'s Go equals let\'s go', () => {
    expect(issuesOf(dupBatch("let's go", 'lets go'))).toEqual([]);
    expect(issuesOf(dupBatch("let's go", "Let's Go"))).toEqual(['R6@items.7.chunk']);
  });
});

describe('QA probes: R6 key joins words with a space', () => {
  it('(QA-42) chunks that differ only in where the space is are not duplicates', () => {
    const base = makeSeedBatch();
    const data = {
      ...base,
      items: base.items.map((item, i) =>
        i === 3 ? { ...item, chunk: 'ice cream', example_en: 'We say ice cream to all of them.' } : i === 7 ? { ...item, chunk: 'icec ream', example_en: 'We say icec ream to all of them.' } : item,
      ),
    };
    expect(issuesOf(data)).toEqual([]);
  });
});

describe('QA probes: R7 and R8', () => {
  it('(QA-25) batch 1 to 6 with a matching file name pass; boundary values 0, 7, -1 fail at batch', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) expect(issuesOf(makeSeedBatch({ batch: n }), [], `batch-${String(n)}.json`)).toEqual([]);
    for (const n of [0, 7, -1]) expect(issuesOf(makeSeedBatch({ batch: n }), [], `batch-${String(n)}.json`)).toContain('R8@batch');
  });

  it('(QA-26) missing batch and null batch are R8 at batch', () => {
    const { items } = makeSeedBatch();
    expect(issuesOf({ items })).toContain('R8@batch');
    expect(issuesOf({ batch: null, items })).toContain('R8@batch');
  });

  it('(QA-27) file name variants: dir prefixes and backslashes are stripped; look-alikes fail at fileName', () => {
    const b = makeSeedBatch({ batch: 2 });
    for (const f of ['batch-2.json', 'a/b/batch-2.json', '/abs/batch-2.json', 'dir\\batch-2.json']) expect(issuesOf(b, [], f), f).toEqual([]);
    for (const f of ['', 'batch-2.json/', 'batch-2.json.bak', 'xbatch-2.json', 'Batch-2.json', 'batch-2.json ', 'batch_2.json', 'batch-12.json', 'batch-2.jsonx', 'batch-.json']) {
      expect(issuesOf(b, [], f), JSON.stringify(f)).toContain('R8@fileName');
    }
  });

  it('(QA-28) a wrong item count and a wrong batch are reported together', () => {
    const b = makeSeedBatch({ batch: 9 });
    expect(issuesOf({ ...b, items: b.items.slice(1) }, [], 'batch-9.json').sort()).toEqual(['R7@items', 'R8@batch']);
  });

  it('(QA-29) a repeated batch number and a mismatched file name give two R8 with their own paths', () => {
    const issues = issuesOf(makeSeedBatch({ batch: 2 }), [makeSeedBatch({ batch: 2 })], 'batch-3.json');
    expect(issues.sort()).toContain('R8@batch');
    expect(issues).toContain('R8@fileName');
    expect(issues.filter((s) => s.startsWith('R8@'))).toHaveLength(2);
  });

  it('(QA-30) a non-numeric batch still checks the file name format only', () => {
    const { items } = makeSeedBatch();
    expect(issuesOf({ batch: '1', items }, [], 'batch-1.json')).toEqual(['R8@batch']);
    expect(issuesOf({ batch: '1', items }, [], 'nope.json').sort()).toEqual(['R8@batch', 'R8@fileName']);
  });
});

describe('QA probes: issue shape and ok value', () => {
  it('(QA-31) the top-level message equals the first issue message and the error kind is validation', () => {
    const r = checkSeedBatch({ fileName: 'batch-1.json', data: withItem(2, { chunk: 'deadline', meaning_zh: '' }) }, []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.message).toBe(r.error.issues[0]?.message);
      for (const i of r.error.issues) expect(i.message).toMatch(/^(R[1-8]|shape) /);
    }
  });

  it('(QA-32) wrong shapes: top-level values give one `shape` with an empty path', () => {
    for (const data of [null, undefined, 5, 'x', true, [], [makeSeedBatch()]]) {
      const r = checkSeedBatch({ fileName: 'batch-1.json', data }, []);
      expect(r.ok, JSON.stringify(data)).toBe(false);
      if (!r.ok) {
        expect(r.error.issues).toHaveLength(1);
        expect(r.error.issues[0]?.path).toBe('');
        expect(r.error.issues[0]?.message.startsWith('shape ')).toBe(true);
      }
    }
  });

  it('(QA-33) `items` that is not an array gives shape at items; a non-object item gives shape at items.<i>', () => {
    for (const items of [null, 'x', 5, {}, undefined, true]) expect(issuesOf({ batch: 1, items }), typeof items).toContain('shape@items');
    for (const items of [null, 5, {}, undefined, true]) expect(issuesOf({ batch: 1, items }), typeof items).toEqual(['shape@items']);
    for (const bad of [null, 'x', 5, [], undefined]) {
      expect(issuesOf({ batch: 1, items: makeSeedBatch().items.map((it, i) => (i === 4 ? bad : it)) }), String(bad)).toEqual(['shape@items.4']);
    }
  });

  it('(QA-34) a valid batch returns ok with a value that parses as SeedBatch and equals the input', () => {
    const input = makeSeedBatch({ batch: 4 });
    const r = checkSeedBatch({ fileName: 'x/batch-4.json', data: input }, [makeSeedBatch({ batch: 1 })]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(input);
      expect(r.value.items).toHaveLength(SEED_BATCH_SIZE);
    }
  });

  it('(QA-35) checkSeedBatch does not modify its inputs', () => {
    const data = makeSeedBatch({ batch: 2 });
    const others = [makeSeedBatch({ batch: 1 })];
    const before = JSON.stringify([data, others]);
    checkSeedBatch({ fileName: 'batch-2.json', data }, others);
    checkSeedBatch({ fileName: 'batch-2.json', data: withItem(0, { chunk: 'x' }, data) }, others);
    expect(JSON.stringify([data, others])).toBe(before);
  });

  it('(QA-36) every rule at once: R1, R2, R3, R4, R5, R6, R7, R8 and the paths are all present', () => {
    const base = makeSeedBatch({ batch: 2 });
    const first = base.items[0];
    const data = {
      batch: 8,
      items: [
        { ...first, chunk: 'deadline' },
        { ...first, meaning_zh: '' },
        { ...first, example_en: 'too short' },
        { ...first, tags: ['bogus'] },
        { ...first, chunk: 'go now', example_en: 'This sentence has no match at all for it.' },
        { ...first, chunk: 'Go Now', example_en: 'Please go now before the meeting starts.' },
      ],
    };
    const issues = issuesOf(data, [], 'batch-2.json');
    for (const want of ['R1@items.0.chunk', 'R2@items.1.meaning_zh', 'R3@items.2.example_en', 'R5@items.3.tags', 'R4@items.4.example_en', 'R6@items.5.chunk', 'R7@items', 'R8@batch', 'R8@fileName']) {
      expect(issues, want).toContain(want);
    }
  });
});

describe('QA probes: renderSeedMigration', () => {
  const one = (over: Partial<SeedChunk> = {}): SeedBatch => tinyBatch([makeSeedChunk({ chunk: 'go now', meaning_zh: '\u73fe\u5728\u8d70', example_en: 'We go now together.', tags: ['email'], ...over })], 5);

  it('(QA-37) exact text for a single row: header, insert line, row ending with ";" and one final newline', () => {
    expect(renderSeedMigration(one())).toBe(
      [
        '-- T-050 seed_chunk batch 5 (generated format: packages/seed-data/src/seed-chunks.ts renderSeedMigration; source supabase/seed-chunks/batch-5.json).',
        'insert into public.seed_chunk (chunk, meaning_zh, example_en, tags, batch) values',
        "  ('go now', '\u73fe\u5728\u8d70', 'We go now together.', array['email']::text[], 5);",
        '',
      ].join('\n'),
    );
  });

  it('(QA-38) tags keep their JSON order (not sorted) and hyphenated tags are quoted whole', () => {
    expect(renderSeedMigration(one({ tags: ['small-talk', 'email', 'meeting'] }))).toContain("array['small-talk', 'email', 'meeting']::text[]");
    expect(renderSeedMigration(one({ tags: [] }))).toContain("'{}'::text[], 5);");
  });

  it('(QA-39) every single quote is doubled in chunk, meaning_zh and example_en; backslash and double quote are untouched', () => {
    const out = renderSeedMigration(one({ chunk: "let's go", meaning_zh: "\u958b'\u6703'", example_en: 'It\'s a "test" with \\ and \'quotes\' here.' }));
    expect(out).toContain("('let''s go', '\u958b''\u6703''', 'It''s a \"test\" with \\ and ''quotes'' here.',");
    expect(out).not.toContain('E\'');
    expect(out).not.toContain('$$');
  });

  it('(QA-40) two rows: the first ends with ",", the last with ";", order follows items, no on conflict, one trailing newline', () => {
    const a = makeSeedChunk({}, 1);
    const b = makeSeedChunk({}, 2);
    const out = renderSeedMigration(tinyBatch([b, a], 6));
    const lines = out.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[2]?.startsWith(`  ('${b.chunk}'`)).toBe(true);
    expect(lines[2]?.endsWith('6),')).toBe(true);
    expect(lines[3]?.startsWith(`  ('${a.chunk}'`)).toBe(true);
    expect(lines[3]?.endsWith('6);')).toBe(true);
    expect(lines[4]).toBe('');
    expect(out.endsWith('\n\n')).toBe(false);
    expect(out.toLowerCase()).not.toContain('on conflict');
  });

  it('(QA-41) it only formats: a full 100-row batch gives 100 rows and 1 row ending in a semicolon; bad data does not throw', () => {
    const full = makeSeedBatch({ batch: 3 });
    const out = renderSeedMigration(full);
    expect(out.split('\n')).toHaveLength(100 + 3);
    expect(out.split('\n').filter((l) => l.endsWith(';'))).toHaveLength(1);
    expect(() => renderSeedMigration(tinyBatch([], 9))).not.toThrow();
    expect(renderSeedMigration(tinyBatch([], 9)).startsWith('-- T-050 seed_chunk batch 9 ')).toBe(true);
  });
});
