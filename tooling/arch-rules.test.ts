import { beforeAll, describe, expect, it } from 'vitest';
import { cruise } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';

const BASE = 'tooling/fixtures/arch';

interface Violation {
  rule: string;
  from: string;
  to: string;
}

let violations: Violation[] = [];
let ruleNames: string[] = [];

beforeAll(async () => {
  const options = await extractDepcruiseOptions('./.dependency-cruiser.cjs');
  ruleNames = (options.ruleSet?.forbidden ?? []).map((r) => r.name ?? '');
  const result = await cruise(['.'], { ...options, baseDir: BASE, validate: true });
  const output = result.output;
  if (typeof output === 'string') throw new Error('expected object output');
  violations = output.summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
});

const hits = (rule: string, from: string) => violations.filter((v) => v.rule === rule && v.from === from);

// 每條規則：[規則名稱, ADR-008 條號, 違規範例, 合法範例]
const CASES: [string, string, string, string][] = [
  ['adr008-01-domain-imports-contracts-only', '#1', 'packages/domain/src/bad.ts', 'packages/domain/src/good.ts'],
  ['adr008-02-contracts-imports-zod-only', '#2', 'packages/contracts/src/bad.ts', 'packages/contracts/src/index.ts'],
  ['adr008-03-features-isolated', '#3', 'apps/web/src/features/a/bad-feature.ts', 'apps/web/src/features/a/good.ts'],
  ['adr008-04-supabase-js-only-in-api', '#4', 'apps/web/src/features/a/bad-supabase.ts', 'apps/web/src/api/client.ts'],
  ['adr008-05-endpoints-via-registry', '#5', 'supabase/functions/api/bad.ts', 'supabase/functions/api/good.ts'],
  ['adr008-06-paid-config-only-registry', '#6', 'supabase/functions/_shared/providers/gemini/bad-paid.ts', 'supabase/functions/_shared/providers/registry.ts'],
  ['adr008-10-no-circular', '#10', 'packages/domain/src/cycle-a.ts', 'packages/domain/src/good.ts'],
];

describe('dependency-cruiser rules (ADR-008)', () => {
  it('ADR-008: the config defines exactly the 7 named rules', () => {
    expect(ruleNames).toEqual(CASES.map((c) => c[0]));
  });

  for (const [rule, adr, bad, good] of CASES) {
    it(`ADR-008 ${adr} ${rule}: violating fixture is reported`, () => {
      expect(hits(rule, bad).length).toBeGreaterThan(0);
    });
    it(`ADR-008 ${adr} ${rule}: legal fixture is not reported`, () => {
      expect(hits(rule, good)).toEqual([]);
    });
  }

  it('ADR-008: legal fixtures trigger no rule at all', () => {
    const legal = CASES.map((c) => c[3]);
    expect(violations.filter((v) => legal.includes(v.from))).toEqual([]);
  });
});
