import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// 假檔名不在任何 tsconfig 專案內，所以測試時關掉「需要型別資訊」的規則（disableTypeChecked）；
// 本檔檢查的規則（ADR-008 #7～#9、CLAUDE.md §6）都不需要型別資訊。
const eslint = new ESLint({
  overrideConfigFile: 'eslint.config.js',
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => ({ ruleId: m.ruleId, message: m.message }));
}
const has = (msgs: { message: string }[], needle: string) => msgs.some((m) => m.message.includes(needle));

const DOMAIN = 'packages/domain/src/x.ts';
const FETCH = "export const p = fetch('https://example.com');";

describe('ESLint rules (ADR-008 #7-#9, CLAUDE.md §6)', () => {
  it('row 1 ADR-008 #9: Date.now() in domain is an error', async () => {
    expect(has(await lint(DOMAIN, 'export const t = Date.now();'), 'ADR-008 #9')).toBe(true);
  });
  it('row 2 ADR-008 #9: new Date() in domain is an error', async () => {
    expect(has(await lint(DOMAIN, 'export const d = new Date();'), 'ADR-008 #9')).toBe(true);
  });
  it('row 3 ADR-008 #9: new Date(n) in domain is allowed', async () => {
    expect(has(await lint(DOMAIN, 'export const d = (n: number) => new Date(n);'), 'ADR-008 #9')).toBe(false);
  });
  it('row 4 ADR-008 #9: Math.random() in domain is an error', async () => {
    expect(has(await lint(DOMAIN, 'export const r = Math.random();'), 'ADR-008 #9')).toBe(true);
  });
  it('row 5 ADR-008 #9: throw in domain is an error', async () => {
    expect(has(await lint(DOMAIN, "export function f(): never { throw new Error('x'); }"), 'ADR-008 #9')).toBe(true);
  });
  it('row 6 ADR-008 #8: fetch in domain is an error', async () => {
    expect(has(await lint(DOMAIN, FETCH), 'ADR-008 #8')).toBe(true);
  });
  it('row 7 ADR-008 #8: fetch in apps/web/src/api is allowed', async () => {
    expect(has(await lint('apps/web/src/api/x.ts', FETCH), 'ADR-008 #8')).toBe(false);
  });
  it('row 8 ADR-008 #8: fetch in _shared/providers is allowed', async () => {
    expect(has(await lint('supabase/functions/_shared/providers/gemini/x.ts', FETCH), 'ADR-008 #8')).toBe(false);
  });
  it('row 9 ADR-008 #8: fetch in a web feature is an error', async () => {
    expect(has(await lint('apps/web/src/features/noon/x.ts', FETCH), 'ADR-008 #8')).toBe(true);
  });
  it('row 10 ADR-008 #7: Deno.env outside _shared/config is an error', async () => {
    expect(has(await lint('supabase/functions/api/x.ts', "export const k = Deno.env.get('X');"), 'ADR-008 #7')).toBe(true);
  });
  it('row 11 ADR-008 #7: Deno.env in _shared/config is allowed', async () => {
    expect(has(await lint('supabase/functions/_shared/config/x.ts', "export const k = Deno.env.get('X');"), 'ADR-008 #7')).toBe(false);
  });
  it('row 12 CLAUDE.md §6: explicit any is an error', async () => {
    const msgs = await lint('apps/web/src/x.ts', 'export const a: any = 1;');
    expect(msgs.some((m) => m.ruleId === '@typescript-eslint/no-explicit-any')).toBe(true);
  });
  it('row 13 CLAUDE.md §6: @ts-ignore is an error', async () => {
    const msgs = await lint('apps/web/src/x.ts', "// @ts-ignore\nexport const a: number = 'x';");
    expect(msgs.some((m) => m.ruleId === '@typescript-eslint/ban-ts-comment')).toBe(true);
  });
  it('CLAUDE.md §6: "as unknown as" is an error everywhere', async () => {
    expect(has(await lint('apps/web/src/x.ts', 'export const a = 1 as unknown as string;'), 'as unknown as')).toBe(true);
    expect(has(await lint(DOMAIN, 'export const a = 1 as unknown as string;'), 'as unknown as')).toBe(true);
  });
  it('CLAUDE.md §6: strict-type-checked is enabled (type-aware rules are configured)', async () => {
    const strict = new ESLint({ overrideConfigFile: 'eslint.config.js' });
    const cfg = (await strict.calculateConfigForFile('apps/web/src/x.ts')) as { rules?: Record<string, unknown> };
    expect(cfg.rules?.['@typescript-eslint/no-unsafe-assignment']).toBeDefined();
    expect(cfg.rules?.['@typescript-eslint/no-floating-promises']).toBeDefined();
  });
});

// ── T-002：ADR-008 修訂 1 ────────────────────────────────────────────────
const THROW = "export function f(): never { throw new Error('x'); }";
const FETCH_CALL = "export const p = fetch('https://example.com');";
const DENO_ENV = "export const k = Deno.env.get('X');";
const AS_UNKNOWN_AS = 'export const a = 1 as unknown as string;';

describe('ESLint rules (ADR-008 revision 1)', () => {
  it('T-002 row 1 ADR-008 #9: throw in domain production code is an error', async () => {
    expect(has(await lint('packages/domain/src/x.ts', THROW), 'ADR-008 #9')).toBe(true);
  });
  it('T-002 row 2 ADR-008 #9 (rev 1): throw in domain *.test.ts is allowed', async () => {
    expect(has(await lint('packages/domain/src/x.test.ts', THROW), 'ADR-008 #9')).toBe(false);
  });
  it('T-002 row 3 ADR-008 #9 (rev 1): throw in domain test/ helper is allowed', async () => {
    expect(has(await lint('packages/domain/test/result.ts', THROW), 'ADR-008 #9')).toBe(false);
  });
  it('T-002 row 4 ADR-008 #9 (rev 1): Date.now() in domain tests is still an error', async () => {
    expect(has(await lint('packages/domain/src/x.test.ts', 'export const t = Date.now();'), 'ADR-008 #9')).toBe(true);
  });
  it('T-002 row 5 ADR-008 #9 (rev 1): Math.random() in domain tests is still an error', async () => {
    expect(has(await lint('packages/domain/src/x.test.ts', 'export const r = Math.random();'), 'ADR-008 #9')).toBe(true);
  });
  it('T-002 row 6 ADR-008 #9b: throw in _shared/db is an error', async () => {
    expect(has(await lint('supabase/functions/_shared/db/x.ts', THROW), 'ADR-008 #9')).toBe(true);
  });
  it('T-002 row 7 ADR-008 #9b: throw in _shared/providers is an error', async () => {
    expect(has(await lint('supabase/functions/_shared/providers/gemini/x.ts', THROW), 'ADR-008 #9')).toBe(true);
  });
  it('T-002 row 8 ADR-008 #9b: throw in _shared/news is an error', async () => {
    expect(has(await lint('supabase/functions/_shared/news/x.ts', THROW), 'ADR-008 #9')).toBe(true);
  });
  it('T-002 row 9 ADR-008 #9b: throw in _shared/db *.test.ts is allowed', async () => {
    expect(has(await lint('supabase/functions/_shared/db/x.test.ts', THROW), 'ADR-008 #9')).toBe(false);
  });
  it('T-002 row 10 ADR-008 #9b: throw in an endpoint (HTTP handler) is allowed', async () => {
    expect(has(await lint('supabase/functions/api/x.ts', THROW), 'ADR-008 #9')).toBe(false);
  });
  it('T-002 row 11 ADR-008 #8 + #9: providers may fetch while throw / Deno.env / as unknown as stay errors (blocks do not override each other)', async () => {
    const file = 'supabase/functions/_shared/providers/gemini/x.ts';
    expect(has(await lint(file, FETCH_CALL), 'ADR-008 #8')).toBe(false);
    expect(has(await lint(file, THROW), 'ADR-008 #9')).toBe(true);
    expect(has(await lint(file, AS_UNKNOWN_AS), 'as unknown as')).toBe(true);
    expect(has(await lint(file, DENO_ENV), 'ADR-008 #7')).toBe(true);
  });
  it('T-002 row 12 ADR-008 #8: fetch in _shared/db is an error', async () => {
    expect(has(await lint('supabase/functions/_shared/db/x.ts', FETCH_CALL), 'ADR-008 #8')).toBe(true);
  });
  it('T-002 row 13 ADR-008 #4 (rev 1): https:// import is an error', async () => {
    const code = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';\nexport const c = createClient;";
    expect(has(await lint('supabase/functions/api/x.ts', code), 'ADR-008 #4')).toBe(true);
  });
  it('T-002 row 14 ADR-008 #4 (rev 1): npm: import is an error', async () => {
    const code = "import { createClient } from 'npm:@supabase/supabase-js@2';\nexport const c = createClient;";
    expect(has(await lint('supabase/functions/api/x.ts', code), 'ADR-008 #4')).toBe(true);
  });
  it('T-002 row 15 ADR-008 #4 (rev 1): jsr: import is an error', async () => {
    const code = "import { x } from 'jsr:@std/assert';\nexport const y = x;";
    expect(has(await lint('supabase/functions/_shared/db/x.ts', code), 'ADR-008 #4')).toBe(true);
  });
  it('T-002 row 16 ADR-008 #4 (rev 1): bare @supabase/supabase-js import is not reported by ESLint', async () => {
    const code = "import { createClient } from '@supabase/supabase-js';\nexport const c = createClient;";
    expect(has(await lint('supabase/functions/_shared/db/x.ts', code), 'ADR-008 #4')).toBe(false);
  });
  it('T-002 row 17 ADR-008 #8: fetch in a .tsx feature is an error', async () => {
    expect(has(await lint('apps/web/src/features/noon/x.tsx', FETCH_CALL), 'ADR-008 #8')).toBe(true);
  });
  it('T-002 row 18 CLAUDE.md §6: explicit any in a .tsx file is an error', async () => {
    const msgs = await lint('apps/web/src/features/noon/x.tsx', 'export const a: any = 1;');
    expect(msgs.some((m) => m.ruleId === '@typescript-eslint/no-explicit-any')).toBe(true);
  });
  it('T-002 row 19 ADR-008 #8: globalThis.fetch in a feature is an error', async () => {
    const code = "export const p = globalThis.fetch('https://example.com');";
    expect(has(await lint('apps/web/src/features/noon/x.ts', code), 'ADR-008 #8')).toBe(true);
  });
  it('T-002 row 20 ADR-008 #8: window.fetch in a feature is an error', async () => {
    const code = "export const p = window.fetch('https://example.com');";
    expect(has(await lint('apps/web/src/features/noon/x.ts', code), 'ADR-008 #8')).toBe(true);
  });
  it('T-002 row 21 ADR-008 #8: globalThis.fetch in apps/web/src/api is allowed', async () => {
    const code = "export const p = globalThis.fetch('https://example.com');";
    expect(has(await lint('apps/web/src/api/x.ts', code), 'ADR-008 #8')).toBe(false);
  });
  it('T-002 row 22 ADR-008 #7: Deno.env in domain tests is an error', async () => {
    expect(has(await lint('packages/domain/src/x.test.ts', DENO_ENV), 'ADR-008 #7')).toBe(true);
  });
  it('T-002 row 23 CLAUDE.md §6: as unknown as in domain tests is an error', async () => {
    expect(has(await lint('packages/domain/src/x.test.ts', AS_UNKNOWN_AS), 'as unknown as')).toBe(true);
  });
  it('T-002 extra ADR-008 #8: self.fetch in a feature is an error', async () => {
    const code = "export const p = self.fetch('https://example.com');";
    expect(has(await lint('apps/web/src/features/noon/x.ts', code), 'ADR-008 #8')).toBe(true);
  });
  it('T-002 extra ADR-008 #9: Date() call in domain production code is an error', async () => {
    expect(has(await lint('packages/domain/src/x.ts', 'export const s = Date();'), 'ADR-008 #9')).toBe(true);
  });
  it('T-002 extra ADR-008 #9: throw in a .tsx under domain is an error', async () => {
    expect(has(await lint('packages/domain/src/x.tsx', THROW), 'ADR-008 #9')).toBe(true);
  });
});

// ── T-051：ADR-008 修訂 2（第 12、13、14 條；.test.tsx 是測試）──────────────
type Msg = { ruleId: string | null; message: string };
const DETECT: Record<string, (m: Msg) => boolean> = {
  '#4': (m) => m.message.includes('ADR-008 #4'),
  '#7': (m) => m.message.includes('ADR-008 #7'),
  '#8': (m) => m.message.includes('ADR-008 #8'),
  '#9': (m) => m.message.includes('ADR-008 #9'),
  '#12': (m) =>
    m.ruleId === 'no-restricted-imports' &&
    (m.message.includes('ADR-009: import packages by name') ||
      m.message.includes('ADR-009: only @english-coach') ||
      m.message.includes('ADR-009: @english-coach/domain has no testing')),
  '#13': (m) => m.message.includes('Deno needs the .ts extension'),
  '#14': (m) => m.message.includes('ADR-008 #14'),
};

const CARD_AS = "type CardId = string; export const id = 'a' as CardId;";
const THROW_FN = "export function f(): never { throw new Error('x'); }";

// 第 4 節規則表：[列, 假檔名, 程式片段, 預期（規則 → 是否報告）]
const REV2_ROWS: [number, string, string, Record<string, boolean>][] = [
  [1, 'apps/web/src/api/x.ts', "import { ok } from '../../../../packages/contracts/src/index.ts';", { '#12': true }],
  [2, 'apps/web/src/api/x.ts', "import { CardIdSchema } from '@english-coach/contracts/src/ids.ts';", { '#12': true }],
  [3, 'apps/web/src/api/x.ts', "import { ok } from '@english-coach/contracts';", { '#12': false }],
  [4, 'packages/domain/src/x.test.ts', "import { expectOk } from '@english-coach/contracts/testing';", { '#12': false }],
  [5, 'apps/web/src/api/x.ts', "import { x } from '@english-coach/domain/testing';", { '#12': true }],
  [6, 'packages/domain/src/x.ts', "import { y } from './y';", { '#13': true }],
  [7, 'packages/domain/src/x.ts', "import { y } from './y.ts';", { '#13': false }],
  [8, 'supabase/functions/api/x.ts', "import { y } from '../_shared/db/y';", { '#13': true }],
  [9, 'apps/web/src/features/noon/x.ts', "import { y } from './y';", { '#13': false }],
  [10, 'packages/domain/src/x.ts', "import { z } from 'npm:zod';", { '#4': true }],
  [11, 'apps/web/src/api/x.ts', CARD_AS, { '#14': true }],
  [12, 'apps/web/src/api/x.ts', "type CardId = string; export const id = <CardId>'a';", { '#14': true }],
  [13, 'packages/contracts/src/ids.ts', 'type Ntd = number; export const n = 1 as Ntd;', { '#14': false }],
  [14, 'packages/contracts/src/audio.ts', 'type Wav16kMono = string; declare const x: string; export const w = x as Wav16kMono;', { '#14': false }],
  [15, 'packages/domain/src/taipei-date.ts', "type PlanDate = string; export const d = '2026-01-01' as PlanDate;", { '#14': false }],
  [16, 'packages/domain/src/other.ts', "type PlanDate = string; export const d = '2026-01-01' as PlanDate;", { '#14': true }],
  [17, 'supabase/functions/_shared/providers/registry.ts', 'type PaidConsent = string; declare const x: string; export const c = x as PaidConsent;', { '#14': false }],
  [18, 'packages/domain/src/x.test.ts', CARD_AS, { '#14': false }],
  [19, 'packages/domain/src/x.test.tsx', THROW_FN, { '#9': false }],
  [20, 'apps/web/test/render.tsx', "export const p = fetch('https://example.com');", { '#8': true }],
  [21, 'packages/domain/src/x.ts', `export const a = 1 as unknown as string; export const t = Date.now(); ${CARD_AS}`, { '#9': true, '#14': true }],
  [22, 'packages/domain/src/taipei-date.ts', "type PlanDate = string; export const d = '2026-01-01' as PlanDate; export const t = Date.now();", { '#14': false, '#9': true }],
  [23, 'supabase/functions/_shared/providers/registry.ts', `type PaidConsent = string; declare const x: string; export const c = x as PaidConsent; ${THROW_FN}`, { '#14': false, '#9': true }],
  [24, 'supabase/functions/_shared/db/x.ts', `${CARD_AS} ${THROW_FN}`, { '#14': true, '#9': true }],
  [25, 'supabase/functions/_shared/db/x.test.ts', CARD_AS, { '#14': false }],
  [26, 'supabase/functions/_shared/config/x.ts', `${CARD_AS} export const k = Deno.env.get('X');`, { '#14': true, '#7': false }],
  [27, 'packages/contracts/src/ids.ts', "export const a = 1 as unknown as string; export const k = Deno.env.get('X');", { '#7': true }],
  [28, 'packages/contracts/src/x.test.ts', CARD_AS, { '#14': false }],
  [29, 'apps/web/src/features/noon/x.test.tsx', CARD_AS, { '#14': false }],
  [
    30,
    'supabase/functions/_shared/db/x.ts',
    "import { a } from 'npm:zod'; import { b } from '../../../../packages/contracts/src/index.ts'; import { c } from './c';",
    { '#4': true, '#12': true, '#13': true },
  ],
  [31, 'apps/web/src/api/x.ts', "import { a } from 'jsr:@std/assert'; import { b } from '@english-coach/contracts/src/ids.ts';", { '#4': true, '#12': true }],
];

describe('ESLint rules (ADR-008 revision 2)', () => {
  for (const [row, file, code, expected] of REV2_ROWS) {
    const label = Object.entries(expected)
      .map(([k, v]) => `${k} ${v ? 'reported' : 'not reported'}`)
      .join(', ');
    it(`T-051 row ${String(row)} ${file}: ${label}`, async () => {
      const msgs = await lint(file, code);
      for (const [rule, shouldReport] of Object.entries(expected)) {
        const detect = DETECT[rule];
        expect(detect, `unknown rule ${rule}`).toBeDefined();
        expect(msgs.some((m) => detect?.(m)), `${rule} in ${JSON.stringify(msgs)}`).toBe(shouldReport);
      }
    });
  }

  it('T-051 row 27 (extra): ids.ts still reports "as unknown as" next to Deno.env', async () => {
    const msgs = await lint('packages/contracts/src/ids.ts', "export const a = 1 as unknown as string; export const k = Deno.env.get('X');");
    expect(has(msgs, 'as unknown as')).toBe(true);
  });

  it('T-051 extra: audio.ts still reports "as unknown as"', async () => {
    expect(has(await lint('packages/contracts/src/audio.ts', 'export const a = 1 as unknown as string;'), 'as unknown as')).toBe(true);
  });

  it('T-051 extra: a legal contracts test (.test.ts) can throw and use brand "as"', async () => {
    const msgs = await lint('packages/contracts/src/x.test.ts', `${CARD_AS} ${THROW_FN}`);
    expect(msgs.filter((m) => m.message.startsWith('ADR-008'))).toEqual([]);
  });

  it('T-051 extra #12: a relative path into packages/ from the repo root is an error', async () => {
    expect(DETECT['#12']?.((await lint('apps/web/src/api/x.ts', "import { a } from '../../../../packages/domain/src/index.ts';"))[0] ?? { ruleId: null, message: '' })).toBe(true);
  });
});

const SERVE = 'Deno.serve(() => new Response(null));';
const AS_AUTH = 'type AuthContext = string; declare const x: string; export const c = x as AuthContext;';
const DENO_ENV_GET = "export const k = Deno.env.get('X');";

// [列, 假檔名, 程式片段, 規則標記, 是否應該回報]
const REV3_ROWS: readonly (readonly [number, string, string, string, boolean])[] = [
  [1, 'supabase/functions/api/router.ts', SERVE, 'ADR-008 #15', true],
  [2, 'supabase/functions/api/index.ts', SERVE, 'ADR-008 #15', false],
  [3, 'supabase/functions/api/router.ts', AS_AUTH, 'ADR-008 #14', true],
  [4, 'supabase/functions/_shared/db/auth.ts', AS_AUTH, 'ADR-008 #14', false],
  [5, 'supabase/functions/_shared/db/auth.ts', "export function f(): never { throw new Error('x'); }", 'ADR-008 #9', true],
  [6, 'supabase/functions/_shared/db/auth.ts', DENO_ENV_GET, 'ADR-008 #7', true],
  [7, 'supabase/functions/_shared/db/x.ts', AS_AUTH, 'ADR-008 #14', true],
  [8, 'supabase/functions/api/index.ts', DENO_ENV_GET, 'ADR-008 #7', true],
  [9, 'supabase/functions/api/index.ts', "type CardId = string; export const id = 'a' as CardId;", 'ADR-008 #14', true],
  [10, 'supabase/functions/_shared/config/x.ts', SERVE, 'ADR-008 #15', true],
  [11, 'supabase/functions/_shared/db/index.ts', SERVE, 'ADR-008 #15', true],
  [12, 'supabase/functions/api/router.test.ts', SERVE, 'ADR-008 #15', true],
  [13, 'packages/domain/src/x.ts', SERVE, 'ADR-008 #15', true],
  [14, 'supabase/functions/_shared/db/auth.test.ts', AS_AUTH, 'ADR-008 #14', false],
];

describe('ESLint rules (ADR-008 revision 3)', () => {
  for (const [row, file, code, marker, shouldReport] of REV3_ROWS) {
    it(`(AC-T3-7) row ${String(row)} ${file}: ${marker} ${shouldReport ? 'reported' : 'not reported'}`, async () => {
      const msgs = await lint(file, code);
      expect(has(msgs, marker), JSON.stringify(msgs)).toBe(shouldReport);
    });
  }
});

describe('ESLint rules (ARCHITECTURE §4.10.1, T-024)', () => {
  const SEED = 'packages/seed-data/src/x.ts';
  const rows: [string, string, string][] = [
    ['Date.now', 'export const t = Date.now();', 'ADR-008 #9'],
    ['Math.random', 'export const r = Math.random();', 'ADR-008 #9'],
    ['throw', "export function f(): never { throw new Error('x'); }", 'ADR-008 #9'],
  ];
  for (const [label, code, marker] of rows) {
    it(`(AC-T24-15) (TC-24) ${label} in seed-data production code is an error from exactly one block`, async () => {
      const msgs = await lint(SEED, code);
      expect(msgs.filter((m) => m.message.includes(marker)), JSON.stringify(msgs)).toHaveLength(1);
    });
  }

  it('(AC-T24-15) (TC-24) throw in a seed-data test file is allowed', async () => {
    const msgs = await lint('packages/seed-data/src/x.test.ts', "export function f(): never { throw new Error('x'); }");
    expect(has(msgs, 'ADR-008 #9'), JSON.stringify(msgs)).toBe(false);
  });

  for (const file of ['apps/web/src/features/a/x.ts', 'supabase/functions/api/x.ts']) {
    it(`(AC-T24-15) (TC-25) ${file}: importing @english-coach/seed-data is an error`, async () => {
      const msgs = await lint(file, "import { checkSeedBatch } from '@english-coach/seed-data';\nexport const c = checkSeedBatch;");
      expect(has(msgs, '@english-coach/seed-data must not be imported'), JSON.stringify(msgs)).toBe(true);
    });
  }
});
