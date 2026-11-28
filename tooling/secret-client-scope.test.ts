import { describe, expect, it } from 'vitest';

// vite 的 import.meta.glob（不安裝 vite 型別；只宣告用到的簽名）。
declare global {
  interface ImportMeta {
    glob(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
  }
}

// ARCHITECTURE §4.12.5 第 1 點、CLAUDE.md §5 第 14、15 條：用 secret 金鑰的檔案只有固定幾個。
const FUNCTIONS = 'supabase/functions/';
const MAY_APPEAR_IN = [
  '_shared/db/service-db.ts',
  'purge-audio/index.ts',
  'daily-prep/index.ts',
  '_shared/db/paid-consent.ts',
] as const;
const MAY_IMPORT_SERVICE_DB = ['purge-audio/index.ts', 'daily-prep/index.ts', '_shared/db/paid-consent.ts'] as const;
const NEVER_IMPORT_SERVICE_DB = ['purge-audio/handler.ts', '_shared/db/audio-purge.ts'] as const;

const isProduction = (rel: string): boolean => !/(^|\/)test\/|\.test\.tsx?$|\.test-d\.ts$/.test(rel);

/** files：相對 supabase/functions/ 的路徑 → 檔案內容。回傳每個違規的說明（含檔名）。 */
function checkScope(files: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const [rel, src] of Object.entries(files)) {
    if (!isProduction(rel)) continue;
    const appears = /\bcreateServiceClient\b/.test(src);
    const importsServiceDb = /from\s+['"][^'"]*service-db\.ts['"]/.test(src);
    if (appears && !(MAY_APPEAR_IN as readonly string[]).includes(rel)) {
      problems.push(`${rel}: createServiceClient is not allowed here`);
    }
    if (importsServiceDb && !(MAY_IMPORT_SERVICE_DB as readonly string[]).includes(rel)) {
      problems.push(`${rel}: must not import service-db.ts`);
    }
    if ((NEVER_IMPORT_SERVICE_DB as readonly string[]).includes(rel) && (appears || importsServiceDb)) {
      problems.push(`${rel}: purge-audio creates the secret client only in index.ts`);
    }
  }
  return problems;
}

const raw = import.meta.glob('../supabase/functions/**/*.ts', { query: '?raw', import: 'default', eager: true });
const repoFiles: Record<string, string> = {};
for (const [path, content] of Object.entries(raw)) {
  const rel = path.slice(path.indexOf(FUNCTIONS) + FUNCTIONS.length);
  if (typeof content === 'string') repoFiles[rel] = content;
}

describe('secret client scope (T-046)', () => {
  it('(AC-T46-12) (TC-24) createServiceClient appears only in the allowed files; handler.ts and audio-purge.ts stay clear of service-db.ts', () => {
    expect(Object.keys(repoFiles)).toContain('purge-audio/index.ts');
    expect(checkScope(repoFiles)).toEqual([]);
    expect(repoFiles['purge-audio/index.ts']).toContain('createServiceClient');
    expect(repoFiles['purge-audio/handler.ts']).not.toMatch(/service-db/);
    expect(repoFiles['_shared/db/audio-purge.ts']).not.toMatch(/service-db/);
  });

  it('(AC-T46-12) (TC-25) the check names an extra file or a forbidden import', () => {
    expect(checkScope({ 'api/routes/x.ts': 'const c = createServiceClient(env);' })).toEqual([
      expect.stringContaining('api/routes/x.ts'),
    ]);
    expect(
      checkScope({ 'purge-audio/handler.ts': "import { createServiceClient } from '../_shared/db/service-db.ts';" }).join('\n'),
    ).toContain('purge-audio/handler.ts');
    expect(
      checkScope({ '_shared/db/audio-purge.ts': "import type { X } from './service-db.ts';" }).join('\n'),
    ).toContain('_shared/db/audio-purge.ts');
    expect(checkScope({ 'api/routes/x.test.ts': 'createServiceClient()' })).toEqual([]);
    expect(checkScope({ 'daily-prep/index.ts': 'createServiceClient()' })).toEqual([]);
  });
});
