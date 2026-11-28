import { describe, expect, it } from 'vitest';
import product from '../supabase/config.toml?raw';
import envExample from '../supabase/functions/.env.example?raw';
import denoJsonRaw from '../supabase/functions/deno.json?raw';

// vite 的 import.meta.glob（不安裝 vite 型別；只宣告用到的簽名）。
declare global {
  interface ImportMeta {
    glob(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
  }
}

// 每個有 index.ts 的資料夾就是一個函式（`_shared`、`_types` 沒有 index.ts，不算）。
const functionFolders = Object.keys(import.meta.glob('../supabase/functions/*/index.ts')).map(
  (p) => p.split('/').slice(-2)[0] ?? '',
);

/** 回傳每個違規的說明（含區塊名稱）；空陣列表示通過（ARCHITECTURE §4.12.4）。 */
function checkFunctionBlocks(toml: string, folders: readonly string[]): string[] {
  const lines = toml.split('\n');
  const problems: string[] = [];
  lines.forEach((line, i) => {
    const m = /^\[functions\.([^\]]+)\]$/.exec(line);
    const slug = m?.[1];
    if (slug === undefined) return;
    if (lines[i + 1] !== 'verify_jwt = false') problems.push(`[functions.${slug}] needs verify_jwt = false right below the header`);
    if (lines[i + 2] !== 'import_map = "./functions/deno.json"') {
      problems.push(`[functions.${slug}] needs import_map = "./functions/deno.json" as the second line`);
    }
    if (!folders.includes(slug)) problems.push(`[functions.${slug}] has no folder under supabase/functions/`);
  });
  return problems;
}

describe('supabase config (T-003)', () => {
  it('(AC-T3-1) (AC-T46-11) (TC-22) product config blocks are valid; v1.12 no longer compares with the CI probe (ARCHITECTURE §4.12.4)', () => {
    expect(checkFunctionBlocks(product, functionFolders)).toEqual([]);
    expect(functionFolders).toEqual(expect.arrayContaining(['api', 'purge-audio']));
    expect(product).toMatch(/^\[functions\.api\]$/m);
    expect(product).toMatch(/^\[functions\.purge-audio\]$/m);
    expect(product.split('\n')).toContain('project_id = "english-coach"');
  });

  it('(AC-T3-1) (AC-T46-11) (TC-23) the block check reports each bad block by name', () => {
    const folders = ['api', 'purge-audio'];
    const ok = '[functions.api]\nverify_jwt = false\nimport_map = "./functions/deno.json"\n';
    expect(checkFunctionBlocks(ok, folders)).toEqual([]);
    expect(checkFunctionBlocks('[functions.api]\nimport_map = "./functions/deno.json"\n', folders)).toEqual([
      expect.stringContaining('[functions.api]'),
      expect.stringContaining('[functions.api]'),
    ]);
    expect(
      checkFunctionBlocks('[functions.purge-audio]\nverify_jwt = false\nimport_map = "./elsewhere.json"\n', folders),
    ).toEqual([expect.stringContaining('[functions.purge-audio]')]);
    expect(
      checkFunctionBlocks('[functions.nope]\nverify_jwt = false\nimport_map = "./functions/deno.json"\n', folders),
    ).toEqual([expect.stringContaining('[functions.nope]')]);
  });

  it('(AC-T3-1) signup is closed and api uses verify_jwt = false with the deno.json import map', () => {
    expect({
      signupOff: /^enable_signup = false$/m.test(product),
      confirmationsOff: /^enable_confirmations = false$/m.test(product),
      apiFunction: /\[functions\.api\]\nverify_jwt = false\nimport_map = "\.\/functions\/deno\.json"/.test(product),
    }).toEqual({ signupOff: true, confirmationsOff: true, apiFunction: true });
  });

  it('(AC-T3-1) deno.json imports match ADR-009', () => {
    const parsed: unknown = JSON.parse(denoJsonRaw);
    expect(parsed).toEqual({
      imports: {
        '@english-coach/contracts': '../../packages/contracts/src/index.ts',
        '@english-coach/domain': '../../packages/domain/src/index.ts',
        zod: 'npm:zod@^4.6.7',
        '@supabase/supabase-js': 'npm:@supabase/supabase-js@^2.119.2',
      },
    });
  });

  it('(AC-T3-1) .env.example lists exactly the six names', () => {
    const entries = envExample
      .split('\n')
      .filter((l) => /^[A-Z]/.test(l))
      .map((l) => {
        const i = l.indexOf('=');
        return { name: l.slice(0, i), value: l.slice(i + 1) };
      });
    expect(entries.map((e) => e.name)).toEqual([
      'GEMINI_API_KEY',
      'GEMINI_PAID_API_KEY',
      'GROQ_API_KEY',
      'AZURE_SPEECH_KEY',
      'AZURE_SPEECH_REGION',
      'APP_ALLOWED_ORIGINS',
    ]);
    expect(entries.slice(0, 5).map((e) => e.value)).toEqual(['', '', '', '', '']);
    expect(entries[5]?.value).toBe('http://localhost:5173');
    expect(envExample.split('\n').filter((l) => l.startsWith('SUPABASE_'))).toEqual([]);
  });
});
