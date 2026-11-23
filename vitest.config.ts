import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tooling/**/*.test.ts',
      'packages/**/*.test.{ts,tsx}',
      'apps/**/*.test.{ts,tsx}',
      'supabase/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tooling/fixtures/**'],
  },
});
