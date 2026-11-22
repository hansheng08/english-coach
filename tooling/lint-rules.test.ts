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
