import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const asUnknownAs = {
  selector: "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
  message: 'CLAUDE.md §6: "as unknown as" is not allowed; parse the value with a zod schema instead',
};
const denoEnv = {
  selector: "MemberExpression[object.name='Deno'][property.name='env']",
  message: 'ADR-008 #7: Deno.env may only be read in supabase/functions/_shared/config/**',
};
const domainSelectors = [
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
    message: 'ADR-008 #9: domain must be deterministic; do not use Math.random',
  },
  {
    selector: 'ThrowStatement',
    message: 'ADR-008 #9: domain must not throw; return Result<T, AppError>',
  },
];

const FETCH_ALLOWED = [
  'supabase/functions/_shared/providers/**',
  'supabase/functions/_shared/news/**',
  'apps/web/src/api/**',
];
const CONFIG_DIR = 'supabase/functions/_shared/config/**';
const DOMAIN = 'packages/domain/**';

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
    files: ['**/*.ts'],
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
    // ADR-008 #7（Deno.env）＋ CLAUDE.md §6（as unknown as）；domain 與 config 資料夾另外處理，避免規則選項互相覆蓋
    files: ['**/*.ts'],
    ignores: [CONFIG_DIR, DOMAIN],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv] },
  },
  {
    files: [CONFIG_DIR],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs] },
  },
  {
    // ADR-008 #9（以及 #7）
    files: [DOMAIN],
    rules: { 'no-restricted-syntax': ['error', asUnknownAs, denoEnv, ...domainSelectors] },
  },
  {
    // ADR-008 #8：fetch 只能在 providers／news／web api
    files: ['**/*.ts'],
    ignores: FETCH_ALLOWED,
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'ADR-008 #8: fetch is only allowed in _shared/providers/**, _shared/news/** and apps/web/src/api/**' },
      ],
    },
  },
);
