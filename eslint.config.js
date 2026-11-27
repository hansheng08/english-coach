import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// ADR-008（含修訂 1、2）。no-restricted-syntax 在重疊路徑會互相覆蓋（後面的設定取代前面的整個選項），
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
const denoServe = {
  selector: "MemberExpression[object.name='Deno'][property.name='serve']",
  message: 'ADR-008 #15: Deno.serve may only appear in supabase/functions/<function>/index.ts',
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

// ADR-008 修訂 2 決定 5：品牌型別的 as／<T> 只能出現在建立函式所在檔案與測試程式
const BRAND_NAMES = 'UserId|CardId|AnswerId|QuestionId|ArticleId|PlanDate|StoragePath|Ntd|Wav16kMono|PaidConsent|AuthContext';
const brandSelectors = ['TSAsExpression', 'TSTypeAssertion'].map((node) => ({
  selector: `${node}[typeAnnotation.typeName.name=/^(${BRAND_NAMES})$/]`,
  message: 'ADR-008 #14: create branded values with a zod schema or the type\'s creator function, not "as"',
}));

// 測試程式（與 .dependency-cruiser.cjs 的 TEST 同一個定義：(^|/)test/|\.test\.tsx?$|\.test-d\.ts$）
const TEST_GLOBS = ['**/*.test.{ts,tsx}', '**/*.test-d.ts', `**/test/**/*.${TS}`];
const testGlobsUnder = (dir) => [`${dir}/**/*.test.${TS}`, `${dir}/**/*.test-d.ts`, `${dir}/**/test/**/*.${TS}`];

const DOMAIN = 'packages/domain';
const TAIPEI_DATE = `${DOMAIN}/src/taipei-date.ts`; // 唯一可以 as PlanDate 的正式程式檔
const REGISTRY = 'supabase/functions/_shared/providers/registry.ts'; // 唯一可以 as PaidConsent 的檔案
const BRAND_CREATORS = ['packages/contracts/src/ids.ts', 'packages/contracts/src/audio.ts']; // as Ntd、as Wav16kMono
const AUTH = 'supabase/functions/_shared/db/auth.ts'; // 唯一可以 as AuthContext 的檔案
const FN_ENTRY = 'supabase/functions/*/index.ts'; // 唯一可以 Deno.serve 的檔案
const CONFIG = 'supabase/functions/_shared/config';
const SHARED_THROW_DIRS = [
  'supabase/functions/_shared/providers',
  'supabase/functions/_shared/db',
  'supabase/functions/_shared/news',
];

// no-restricted-imports 的 patterns
const urlPatterns = [
  {
    // ADR-008 #4（修訂 1）：不得用網址或 npm:／jsr: 前綴 import（Deno 端用 deno.json 的 imports 對應成裸名稱）
    regex: '^(https?|npm|jsr):',
    message:
      'ADR-008 #4: do not import with http(s):, npm: or jsr: specifiers; map the package to a bare name in deno.json "imports"',
  },
];
const crossPackagePatterns = [
  // ADR-008 #12（修訂 2 決定 4 / ADR-009）：只能用套件名稱引用 packages/*
  { regex: '^\\.{1,2}/(.*/)?packages/', message: 'ADR-009: import packages by name, e.g. @english-coach/contracts' },
  {
    regex: '^@english-coach/(contracts|domain)/(?!testing$)',
    message: 'ADR-009: only @english-coach/contracts, @english-coach/contracts/testing and @english-coach/domain are entry points',
  },
  { regex: '^@english-coach/domain/testing$', message: 'ADR-009: @english-coach/domain has no testing entry point' },
];
// ADR-008 #13：packages/**、supabase/functions/** 的相對 import 要寫副檔名
const extensionPattern = {
  regex: '^\\.{1,2}/(?!.*\\.(ts|tsx|json)$)',
  message: 'ADR-009: Deno needs the .ts extension in relative imports',
};

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
      'playwright.config.ts',
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
    // no-restricted-imports：一個檔案只套用最後一個符合的區塊，所以每個區塊都要寫齊該路徑適用的全部 patterns。
    // 1. packages/**、supabase/functions/**：網址前綴（#4）＋跨套件（#12）＋副檔名（#13）
    files: [under('packages'), under('supabase/functions')],
    rules: { 'no-restricted-imports': ['error', { patterns: [...urlPatterns, ...crossPackagePatterns, extensionPattern] }] },
  },
  {
    // 2. 其他檔案：網址前綴（#4）＋跨套件（#12）
    files: [`**/*.${TS}`],
    ignores: [under('packages'), under('supabase/functions')],
    rules: { 'no-restricted-imports': ['error', { patterns: [...urlPatterns, ...crossPackagePatterns] }] },
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

  // ── no-restricted-syntax：互不重疊的區塊（每個檔案只落在其中一個）─────────
  {
    // A. domain 正式程式：#7、#9（時鐘、亂數、throw）、#14（品牌 as）
    files: [under(DOMAIN)],
    ignores: [...TEST_GLOBS, TAIPEI_DATE],
    rules: {
      'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe, ...clockSelectors, throwSelector, ...brandSelectors],
    },
  },
  {
    // A'. taipei-date.ts：可以 as PlanDate，其他同 A
    files: [TAIPEI_DATE],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe, ...clockSelectors, throwSelector] },
  },
  {
    // B. domain 測試程式：時鐘與亂數仍禁止，throw 與品牌 as 放行
    files: testGlobsUnder(DOMAIN),
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe, ...clockSelectors] },
  },
  {
    // C. _shared/{providers,db,news} 正式程式：#9b（throw）、#14
    files: SHARED_THROW_DIRS.map(under),
    ignores: [...TEST_GLOBS, REGISTRY, AUTH],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe, throwSelector, ...brandSelectors] },
  },
  {
    // C'. registry.ts（可以 as PaidConsent）、auth.ts（可以 as AuthContext）：其他同 C
    files: [REGISTRY, AUTH],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe, throwSelector] },
  },
  {
    // D. _shared/config 正式程式：唯一可以讀 Deno.env 的地方；#14
    files: [under(CONFIG)],
    ignores: TEST_GLOBS,
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoServe, ...brandSelectors] },
  },
  {
    // D'. _shared/config 測試程式
    files: testGlobsUnder(CONFIG),
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoServe] },
  },
  {
    // E. 其餘正式程式：#7、#14、#15
    files: [`**/*.${TS}`],
    ignores: [
      under(DOMAIN),
      under(CONFIG),
      ...SHARED_THROW_DIRS.map(under),
      ...TEST_GLOBS,
      ...BRAND_CREATORS,
      FN_ENTRY,
    ],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe, ...brandSelectors] },
  },
  {
    // E-entry. supabase/functions/<函式>/index.ts：唯一可以 Deno.serve 的檔案（沒有 denoServe），其他同 E
    files: [FN_ENTRY],
    ignores: TEST_GLOBS,
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, ...brandSelectors] },
  },
  {
    // E-sub. ids.ts（as Ntd）、audio.ts（as Wav16kMono）：其他同 E
    files: BRAND_CREATORS,
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe] },
  },
  {
    // E'. 其餘測試程式（含 _shared/{providers,db,news} 的測試程式：可以 throw）
    files: TEST_GLOBS,
    ignores: [under(DOMAIN), under(CONFIG)],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, denoServe] },
  },
);
