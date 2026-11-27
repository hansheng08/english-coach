import { beforeAll, describe, expect, it } from 'vitest';
// The ?raw imports put both tools in this file's import graph (so `vitest related` and the mutant runner pick it up);
// the .mjs files have no type declarations, so the functions are loaded through a computed specifier.
import cssSource from './css-literals.mjs?raw';
import tokensSource from './tokens-css.mjs?raw';

// QA probes for T-018-fix3 AC-T18-31～34 (ARCHITECTURE §9.1.5).
type Token = { name: string; light: string; dark: string; split: boolean };
type CssLiterals = { findViolations: (css: string) => number[] };
type TokensCss = { parseTokens: (text: string) => { ok: true; tokens: Token[] } | { ok: false; reason: string } };

let css: CssLiterals;
let tokens: TokensCss;
beforeAll(async () => {
  expect(cssSource).toContain('export function findViolations');
  expect(tokensSource).toContain('export function parseTokens');
  const load = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);
  css = (await load('./css-literals.mjs')) as CssLiterals;
  tokens = (await load('./tokens-css.mjs')) as TokensCss;
});

describe('T-018-fix3 QA css-literals', () => {
  it('(QA-16) ; inside parentheses or quotes does not end the declaration', () => {
    expect(css.findViolations('.a { background: url(data:image/png;base64,AAA) #fff; }')).toEqual([1]);
    expect(css.findViolations('.a {\n  --x: "a;" #fff;\n}')).toEqual([2]);
    expect(css.findViolations('.a { content: "\\"" ; color: #123; }')).toEqual([1]);
    expect(css.findViolations('.a { content: "\\"" }\n.b:not(#abc) { color: var(--a) }')).toEqual([]);
  });

  it('(QA-17) line numbers are sorted, follow the literal, and comments inside a value are ignored', () => {
    expect(css.findViolations('.a {\n  background: linear-gradient(rgb(0 0 0),\n    #fff);\n}')).toEqual([2, 3]);
    expect(css.findViolations('.a {\n  color: var(--a);\n  background:\n    rgba(0, 0, 0, 0.1)\n}')).toEqual([4]);
    expect(css.findViolations('.a {\n  color:\n    /* #fff */ var(--a);\n}')).toEqual([]);
    expect(css.findViolations('.a,\n#b:hover {\n  color: var(--a);\n}')).toEqual([]);
    expect(css.findViolations('.x {}\nbutton:hover #abc {\n  color: var(--a);\n}')).toEqual([]);
  });
});

describe('T-018-fix3 QA tokens-css', () => {
  it('(QA-18) source key order is kept at every depth; escaped quotes inside keys do not break reading', () => {
    const r = tokens.parseTokens('{"font":{"size":{"10":"a","body":"b","2":"c"}},"space":{"gutter":"8px","10":"40px"}}');
    expect(r.ok && r.tokens.map((t) => t.name)).toEqual(['font-size-10', 'font-size-body', 'font-size-2', 'space-gutter', 'space-10']);
    const bad = tokens.parseTokens('{"space":{"x\\"y":"1"}}');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toContain('名稱只能是');
  });

  it('(QA-19) duplicate keys fail at the top level, inside light/dark and inside arrays', () => {
    for (const text of [
      '{"space":{"a":"1"},"space":{"b":"2"}}',
      '{"color":{"x":{"light":"#fff","dark":"#000","light":"#111"}}}',
      '{"space":{"arr":[{"a":"1","a":"2"}]}}',
    ]) {
      const r = tokens.parseTokens(text);
      expect(!r.ok && r.reason).toContain('重複');
    }
  });

  it('(QA-20) an empty subcategory deep in the tree fails with its full path', () => {
    const r = tokens.parseTokens('{"color":{"x":{"y":{"$description":"d"}}}}');
    expect(!r.ok && r.reason).toContain('color.x.y');
  });
});
