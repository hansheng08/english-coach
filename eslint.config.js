import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// ADR-008（含修訂 1）。no-restricted-syntax 在重疊路徑會互相覆蓋（後面的設定取代前面的整個選項），
// 所以下面把檔案分成「互不重疊」的區塊，每個檔案只會落在其中一個區塊。
const TS = '{ts,tsx}';
const under = (dir) => `${dir}/**/*.${TS}`;

const asUnknownAs = {
  selector: "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
  message: 'CLAUDE.md §6: "as unknown as" is not allowed; parse the value with a zod schema instead',
};
const denoEnv = {
  selector: "MemberExpression[object.name='Deno'][property.name='env']",
  message: 'ADR-008 #7: Deno.env may only be read in supabase/functions/_shared/config/**',
};
const clockSelectors = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: 'ADR-008 #9: domain must not read the clock; pass now as a parameter',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'ADR-008 #9: domain must not read the clock; pass now as a parameter (new Date() without arguments)',
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: 'ADR-008 #9: domain must not read the clock; pass now as a parameter (Date() returns the current time)',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'ADR-008 #9: domain must be deterministic; do not use Math.random (tests: use a seeded generator in test/)',
  },
];
const throwSelector = {
  selector: 'ThrowStatement',
  message: 'ADR-008 #9: production code must not throw; return err(AppError) (only test code may throw)',
};

// 測試程式（與 .dependency-cruiser.cjs 的 TEST 同一個定義：(^|/)test/|\.test(-d)?\.ts$）
const TEST_GLOBS = ['**/*.test.ts', '**/*.test-d.ts', '**/test/**'];
const testGlobsUnder = (dir) => [`${dir}/**/*.test.ts`, `${dir}/**/*.test-d.ts`, `${dir}/**/test/**/*.${TS}`];

const DOMAIN = 'packages/domain';
const CONFIG = 'supabase/functions/_shared/config';
const SHARED_THROW_DIRS = [
  'supabase/functions/_shared/providers',
  'supabase/functions/_shared/db',
  'supabase/functions/_shared/news',
];

const FETCH_ALLOWED = [
  'supabase/functions/_shared/providers/**',
  'supabase/functions/_shared/news/**',
  'apps/web/src/api/**',
];
const FETCH_MSG = 'ADR-008 #8: fetch is only allowed in _shared/providers/**, _shared/news/** and apps/web/src/api/**';

export default defineConfig(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.claude/**',
      '.github/**',
      'tooling/fixtures/**',
      // 設定檔本身（JS／CJS／根目錄 TS）不在任何 tsconfig 專案內，不做型別檢查規則
      'eslint.config.js',
      '.dependency-cruiser.cjs',
      'vitest.config.ts',
    ],
  },
  {
    files: [`**/*.${TS}`],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true },
      ],
    },
  },
  {
    // CLAUDE.md §6：@ts-expect-error 只能出現在型別測試
    files: ['**/*.test-d.ts'],
    rules: { '@typescript-eslint/ban-ts-comment': 'off' },
  },
  {
    // ADR-008 #4（修訂 1）：不得用網址或 npm:／jsr: 前綴 import（Deno 端用 deno.json 的 imports 對應成裸名稱）
    files: [`**/*.${TS}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(https?|npm|jsr):',
              message:
                'ADR-008 #4: do not import with http(s):, npm: or jsr: specifiers; map the package to a bare name in deno.json "imports"',
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-008 #8：fetch（含 globalThis／window／self 的寫法）只能在 providers／news／web api
    files: [`**/*.${TS}`],
    ignores: FETCH_ALLOWED,
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: FETCH_MSG }],
      'no-restricted-properties': [
        'error',
        ...['globalThis', 'window', 'self'].map((object) => ({ object, property: 'fetch', message: FETCH_MSG })),
      ],
    },
  },

  // ── no-restricted-syntax：互不重疊的區塊 ──────────────────────────────
  {
    // A. domain 正式程式：#7、#9（時鐘、亂數、throw）
    files: [under(DOMAIN)],
    ignores: TEST_GLOBS,
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, ...clockSelectors, throwSelector] },
  },
  {
    // B. domain 測試程式：時鐘與亂數仍禁止，throw 放行
    files: testGlobsUnder(DOMAIN),
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, ...clockSelectors] },
  },
  {
    // C. _shared/{providers,db,news} 正式程式：#9b（throw）
    files: SHARED_THROW_DIRS.map(under),
    ignores: TEST_GLOBS,
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, throwSelector] },
  },
  {
    // D. _shared/config：唯一可以讀 Deno.env 的地方
    files: [under(CONFIG)],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs] },
  },
  {
    // E. 其餘所有檔案（含 _shared/{providers,db,news} 的測試程式）
    files: [`**/*.${TS}`],
    ignores: [under(DOMAIN), under(CONFIG), ...SHARED_THROW_DIRS.map(under)],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv] },
  },
  {
    // E'. _shared/{providers,db,news} 的測試程式：可以 throw，其他同 E
    files: SHARED_THROW_DIRS.flatMap(testGlobsUnder),
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv] },
  },
);
