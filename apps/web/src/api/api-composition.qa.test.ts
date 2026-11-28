import { describe, expect, it } from 'vitest';
import appSource from '../App.tsx?raw';
import loadApiSource from './index.ts?raw';
import supabaseSource from './supabase/index.ts?raw';

// QA probes for T-021 ARCHITECTURE §9.1.7 (ADR-020 決定 1):
// loadApi / createApi inject fetch and getAccessToken; features must not fetch or call supabase-js.
// Paths are vs current main (T-025a did not move apps/web/src/api).

const featureSources: Record<string, string> = import.meta.glob('../features/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function isProductSource(path: string): boolean {
  return !/\.(qa\.)?test\.(ts|tsx)$/.test(path);
}

describe('T-021 QA ApiClient composition root (ARCH §9.1.7)', () => {
  it('(QA-4) createApi / createSupabaseApiClient mention fetch and getAccessToken (injected at the composition root)', () => {
    expect(supabaseSource).toMatch(/export function createApi\s*\(/);
    expect(supabaseSource).toMatch(/createSupabaseApiClient\s*\(/);
    expect(supabaseSource).toMatch(/getAccessToken/);
    expect(supabaseSource).toMatch(/\bfetch\b/);
    expect(loadApiSource).toMatch(/export async function loadApi\s*\(/);
    expect(loadApiSource).toMatch(/createApi\s*\(/);
  });

  it('(QA-5) features and App.tsx do not import a module-level product supabase client or call fetch', () => {
    // Expected to already hold on current main (LoginPage / App use useApi()). Re-checked so T-021 cannot regress.
    const files: Record<string, string> = { 'App.tsx': appSource };
    for (const [path, text] of Object.entries(featureSources)) {
      if (isProductSource(path)) files[path] = text;
    }
    expect(Object.keys(files).length).toBeGreaterThan(1);
    for (const [path, text] of Object.entries(files)) {
      expect(text, path).not.toMatch(/\bfetch\s*\(/);
      expect(text, path).not.toMatch(/@supabase\/supabase-js/);
      expect(text, path).not.toMatch(/\bcreateClient\s*\(/);
      expect(text, path).not.toMatch(/\bcreateSupabaseApiClient\b/);
    }
  });
});
