import { beforeAll, describe, expect, it } from 'vitest';
import { cruise } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';

// ADR-009 (3)：supabase/functions 在 Node 端（dependency-cruiser）也要能解析 @english-coach/*
const EXPECTED: Readonly<Record<string, string>> = {
  '@english-coach/contracts': 'packages/contracts/src/index.ts',
  '@english-coach/domain': 'packages/domain/src/index.ts',
  '@english-coach/contracts/testing': 'packages/contracts/test/index.ts',
};

interface Dep {
  readonly from: string;
  readonly module: string;
  readonly resolved: string;
  readonly couldNotResolve: boolean;
}

let sources: string[] = [];
let deps: Dep[] = [];

beforeAll(async () => {
  const options = await extractDepcruiseOptions('./.dependency-cruiser.cjs');
  const result = await cruise(['supabase/functions'], { ...options, validate: false });
  const output = result.output;
  if (typeof output === 'string') throw new Error('expected object output');
  const modules = output.modules.filter((m) => m.source.startsWith('supabase/functions/'));
  sources = modules.map((m) => m.source);
  deps = modules.flatMap((m) =>
    m.dependencies.map((d) => ({ from: m.source, module: d.module, resolved: d.resolved, couldNotResolve: d.couldNotResolve })),
  );
});

describe('supabase/functions resolution in Node (ADR-009 (3))', () => {
  it('(AC-T3-2) cruises supabase/functions', () => {
    for (const expected of [
      'supabase/functions/api/router.ts',
      'supabase/functions/api/index.ts',
      'supabase/functions/_shared/db/auth.ts',
      'supabase/functions/_shared/config/env.ts',
    ]) {
      expect(sources).toContain(expected);
    }
  });

  it('(AC-T3-2) no couldNotResolve', () => {
    const unresolved = deps.filter((d) => d.couldNotResolve).map((d) => `${d.from} -> ${d.module}`);
    expect(unresolved).toEqual([]);
  });

  it('(AC-T3-2) @english-coach/* resolves to the expected entry', () => {
    const own = deps.filter((d) => d.module.startsWith('@english-coach/'));
    expect(own.length).toBeGreaterThan(0);
    const wrong = own
      .filter((d) => EXPECTED[d.module] !== d.resolved)
      .map((d) => `${d.from} -> ${d.module} -> ${d.resolved}`);
    expect(wrong).toEqual([]);
  });
});
