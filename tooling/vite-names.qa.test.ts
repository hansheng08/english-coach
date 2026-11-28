// QA probes for T-054: the real viteNamesOutsideAllowList (taken from project-rules.test.ts, which does not export it),
// the allow-list shared with bundle-name-scan.mjs, and a wider scan than the ticket's.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import bundleScan from './bundle-name-scan.mjs?raw';
import rules from '../apps/web/src/project-rules.test.ts?raw';
import ci from '../.github/workflows/ci.yml?raw';
import runTask from '../.github/workflows/claude-run-task.yml?raw';
import rootPackage from '../package.json?raw';
import webPackage from '../apps/web/package.json?raw';
import t018 from '../test/e2e/t018.spec.ts?raw';
import t019 from '../test/e2e/t019.spec.ts?raw';
import t052 from '../test/e2e/t052.spec.ts?raw';

type Scan = (text: string) => string[];

const START = 'const ALLOWED_VITE_NAMES';
const END = "describe('apps/web project rules'";

async function loadScan(source: string): Promise<Scan> {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start) throw new Error('project-rules.test.ts no longer has the expected layout');
  const code = `${source.slice(start, end)}\nexport { viteNamesOutsideAllowList };`;
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const mod: unknown = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(js)}`);
  const fn = typeof mod === 'object' && mod !== null && 'viteNamesOutsideAllowList' in mod ? mod.viteNamesOutsideAllowList : undefined;
  if (typeof fn !== 'function') throw new Error('viteNamesOutsideAllowList was not found');
  return (text) => {
    const r: unknown = Reflect.apply(fn, undefined, [text]);
    if (!Array.isArray(r) || !r.every((x): x is string => typeof x === 'string')) throw new Error('unexpected result');
    return r;
  };
}

const scan = await loadScan(rules);

describe('viteNamesOutsideAllowList, adversarial (QA-1)', () => {
  it('(QA-1) allow-listed names pass in every syntax and are never reported', () => {
    for (const text of [
      'VITE_DATA_MODE',
      'import.meta.env.VITE_SUPABASE_URL',
      "import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY']",
      '%VITE_DATA_MODE%',
      '"VITE_DATA_MODE"',
      'VITE_DATA_MODE\r\nVITE_SUPABASE_URL\r\n',
      'process.env.VITE_DATA_MODE;VITE_SUPABASE_URL',
    ]) {
      expect(scan(text), text).toEqual([]);
    }
  });

  it('(QA-1) a name next to an allow-listed one is reported on its own', () => {
    expect(scan('VITE_DATA_MODE.VITE_X')).toEqual(['VITE_X']);
    expect(scan('VITE_SUPABASE_URL,VITE_SUPABASE_URL_B')).toEqual(['VITE_SUPABASE_URL_B']);
    expect(scan('VITE_SUPABASE_PUBLISHABLE_KEY_2')).toEqual(['VITE_SUPABASE_PUBLISHABLE_KEY_2']);
    expect(scan('VITE_SUPABASE_PUBLISHABLE_KEYS')).toEqual(['VITE_SUPABASE_PUBLISHABLE_KEYS']);
    expect(scan('VITE_DATA_MODE_X')).toEqual(['VITE_DATA_MODE_X']);
  });

  it('(QA-1) quoting, punctuation and line breaks around a name do not hide it', () => {
    expect(scan('"VITE_A"')).toEqual(['VITE_A']);
    expect(scan('$VITE_A')).toEqual(['VITE_A']);
    expect(scan("env['VITE_B']")).toEqual(['VITE_B']);
    expect(scan('x\nVITE_C=1\r\nVITE_D=2')).toEqual(['VITE_C', 'VITE_D']);
    expect(scan('VITE_1')).toEqual(['VITE_1']);
    expect(scan('VITE_A2_B3')).toEqual(['VITE_A2_B3']);
  });

  it('(QA-1) a letter, digit or underscore in front is not a boundary', () => {
    for (const text of ['_VITE_X', 'aVITE_X', '1VITE_X', 'XVITE_X']) expect(scan(text), text).toEqual([]);
  });

  it('(QA-1) a trailing underscore or star is a prefix note, not a name', () => {
    for (const text of ['VITE_', 'VITE_SUPABASE_', 'VITE_SUPABASE_*', 'VITE_FOO_*', 'VITE_X_ and VITE_Y_']) expect(scan(text), text).toEqual([]);
  });

  it('(QA-1) repeated calls give the same answer (no regex state is kept)', () => {
    const text = 'VITE_X VITE_Y';
    expect(scan(text)).toEqual(['VITE_X', 'VITE_Y']);
    expect(scan(text)).toEqual(['VITE_X', 'VITE_Y']);
    expect(scan('')).toEqual([]);
  });
});

describe('allow-list copies agree (QA-2)', () => {
  it('(QA-2) project-rules.test.ts and bundle-name-scan.mjs list the same three names', () => {
    const literal = /const ALLOWED_VITE_NAMES = \[([^\]]*)\] as const;/.exec(rules)?.[1] ?? '';
    const names = [...literal.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    expect(names).toHaveLength(3);
    const bundleLiteral = /export const ALLOWED_VITE_NAMES = Object\.freeze\(\[([^\]]*)\]\)/.exec(bundleScan)?.[1] ?? '';
    const bundleNames = [...bundleLiteral.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    expect([...names].sort()).toEqual([...bundleNames].sort());
  });
});

const wider: Record<string, string> = { ci, runTask, rootPackage, webPackage, t018, t019, t052 };

describe('files outside the ticket scan (QA-3)', () => {
  it('(QA-3) e2e specs, workflows and package files use only allow-listed VITE_ names', () => {
    const entries = Object.entries(wider);
    expect(entries).toHaveLength(7);
    for (const [path, text] of entries) expect(scan(text), path).toEqual([]);
  });
});

describe('scope of T-054 (AC-T54-4)', () => {
  it('(AC-T54-4) (TC-7) the other tests of project-rules.test.ts are still there with their original titles', () => {
    const titles = [...rules.matchAll(/^\s+it\('([^']+)'/gm)].map((m) => m[1] ?? '');
    for (const title of [
      '(AC-T18-3) (TC-6) @supabase/* is imported only under api/supabase/',
      '(AC-T18-3) (TC-6) MOCK_MARKER is defined once, in api/mock/index.ts',
      '(AC-T18-3) (TC-6) screens never import api/mock or read the data mode',
      '(AC-T18-3) (TC-6) dependency-cruiser forbids jsdom and @testing-library in production code',
      '(AC-T18-20) (TC-37) both workspace packages resolve by name, without an alias',
      '(AC-T18-20) (TC-37) root engines.node matches jsdom',
    ]) {
      expect(titles.filter((t) => t === title), title).toHaveLength(1);
    }
  });

  it('(AC-T54-4) (TC-7) the rewritten VITE_ test keeps the old tag next to the new one', () => {
    expect(rules).toContain('(AC-T18-2) (TC-5) (AC-T54-2) (TC-5)');
  });
});
