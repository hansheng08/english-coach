// QA probes for T-024 (ESLint scope of packages/seed-data). Fake code strings only.
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({
  overrideConfigFile: 'eslint.config.js',
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => ({ ruleId: m.ruleId, message: m.message }));
}
const count = (msgs: { message: string }[], needle: string) => msgs.filter((m) => m.message.includes(needle)).length;

const SRC = 'packages/seed-data/src/x.ts';

describe('QA: seed-data ESLint scope (T-024)', () => {
  it('(QA-50) production code gets the domain-style bans: new Date(), fetch, Deno.env, as unknown as, branded as', async () => {
    expect(count(await lint(SRC, 'export const d = new Date();'), 'ADR-008 #9')).toBe(1);
    expect(count(await lint(SRC, "export const p = fetch('https://example.com');"), 'ADR-008 #8')).toBe(1);
    expect(count(await lint(SRC, "export const k = Deno.env.get('X');"), 'ADR-008 #7')).toBe(1);
    const asUnknown = await lint(SRC, 'export const v = (1 as unknown as string);');
    expect(asUnknown.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(1);
    const brand = await lint(SRC, "export const v = ('2026-11-27' as PlanDate);");
    expect(brand.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(1);
  });

  it('(QA-51) the same rules also hit src/seed-chunks.ts-style file names, not only x.ts', async () => {
    expect(count(await lint('packages/seed-data/src/seed-chunks.ts', 'export const t = Date.now();'), 'ADR-008 #9')).toBe(1);
    expect(count(await lint('packages/seed-data/src/question-bank.ts', 'export const r = Math.random();'), 'ADR-008 #9')).toBe(1);
  });

  it('(QA-52) a seed-data test file and test/factories.ts can throw and cast without a restricted-syntax error', async () => {
    const code = "export function f(): never { throw new Error('x'); }\nexport const v = ('a' as string);";
    for (const file of ['packages/seed-data/src/x.test.ts', 'packages/seed-data/test/factories.ts']) {
      const msgs = await lint(file, code);
      expect(msgs.filter((m) => m.ruleId === 'no-restricted-syntax'), file).toEqual([]);
    }
  });

  it('(QA-53) importing a sub-path of @english-coach/seed-data is blocked in apps/web and supabase/functions', async () => {
    const code = "import { checkSeedBatch } from '@english-coach/seed-data/src/seed-chunks.ts';\nexport const c = checkSeedBatch;";
    for (const file of ['apps/web/src/features/a/x.ts', 'supabase/functions/api/x.ts']) {
      expect(count(await lint(file, code), '@english-coach/seed-data must not be imported'), file).toBe(1);
    }
  });

  it('(QA-54) the import ban is not a prefix match: a package with a longer name is not blocked by it', async () => {
    const code = "import { a } from '@english-coach/seed-data-other';\nexport const c = a;";
    expect(count(await lint('apps/web/src/features/a/x.ts', code), '@english-coach/seed-data must not be imported')).toBe(0);
  });
});
