import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('playwright.config.ts', () => {
  it('(AC-T18-29) (TC-50) webServer sets VITE_DATA_MODE through env, not through the command', () => {
    const src = read('playwright.config.ts');
    const env = /env:\s*\{([^}]*)\}/.exec(src);
    expect(env).not.toBeNull();
    const body = env?.[1] ?? '';
    expect(body).toMatch(/VITE_DATA_MODE:\s*'mock'/);
    expect(body).not.toContain('VITE_SUPABASE_');
    const command = /command:\s*`([^`]*)`/.exec(src);
    expect(command).not.toBeNull();
    expect(command?.[1] ?? '').not.toContain('VITE_DATA_MODE=');
  });

  it('(AC-T18-30) (TC-53) no fixed waits or retries in the E2E spec and the Playwright config', () => {
    for (const file of ['test/e2e/t018.spec.ts', 'playwright.config.ts']) {
      const src = read(file);
      for (const word of ['waitForTimeout', 'retries', 'test.slow', 'test.fixme']) {
        expect(src, `${file} contains ${word}`).not.toContain(word);
      }
    }
  });
});
