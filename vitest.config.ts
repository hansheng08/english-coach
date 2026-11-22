import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tooling/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts', 'supabase/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tooling/fixtures/**'],
  },
});
