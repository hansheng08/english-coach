import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json?raw';

const sources = import.meta.glob<string>('../../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

const isProduction = (path: string) => !/(^|\/)test\/|\.test\.tsx?$|\.test-d\.ts$/u.test(path);
const LIBS = ['pdfjs-dist', 'mammoth'];

// main 上 apps/web/package.json 的 dependencies（T-035 之前）。
const BASELINE = [
  '@english-coach/contracts',
  '@english-coach/domain',
  '@supabase/supabase-js',
  'react',
  'react-dom',
  'react-router',
  'vite-plugin-pwa',
];

describe('resume dependencies', () => {
  it('(AC-T35-9) (TC-17) only extract.ts mentions pdfjs-dist and mammoth, and only inside import()', () => {
    const mentioning = Object.entries(sources).filter(
      ([path, src]) => isProduction(path) && LIBS.some((lib) => src.includes(lib)),
    );
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(mentioning.map(([path]) => path)).toEqual(['./extract.ts']);
    const [[, src] = ['', '']] = mentioning;
    const specifierLines = src.split('\n').filter((line) => LIBS.some((lib) => line.includes(`'${lib}`)));
    expect(specifierLines.length).toBeGreaterThan(0);
    for (const line of specifierLines) {
      expect(line).toMatch(/import\(\s*'/u);
    }
  });

  it('(AC-T35-9) (TC-17) adds exactly pdfjs-dist and mammoth to dependencies', () => {
    const parsed: unknown = JSON.parse(packageJson);
    const deps =
      typeof parsed === 'object' && parsed !== null && 'dependencies' in parsed ? parsed.dependencies : {};
    const keys = typeof deps === 'object' && deps !== null ? Object.keys(deps) : [];
    expect(keys.filter((k) => !BASELINE.includes(k)).sort()).toEqual(['mammoth', 'pdfjs-dist']);
    expect(BASELINE.every((k) => keys.includes(k))).toBe(true);
  });
});
