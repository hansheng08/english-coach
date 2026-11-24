import { describe, expect, it } from 'vitest';
import { cruise } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';

const PAID = 'supabase/functions/_shared/config/paid.ts';
const REGISTRY = 'supabase/functions/_shared/providers/registry.ts';

describe('config/paid.ts 的 import（ADR-008 #6、AC-25）', () => {
  it('(AC-T14-8) (TC-16) 真實樹中只有 registry.ts 依賴 paid.ts，且依賴存在', async () => {
    const options = await extractDepcruiseOptions('./.dependency-cruiser.cjs');
    const result = await cruise(['supabase/functions'], { ...options, validate: true });
    const output = result.output;
    if (typeof output === 'string') throw new Error('expected object output');
    const importers = output.modules
      .filter((m) => m.dependencies.some((d) => d.resolved === PAID))
      .map((m) => m.source);
    expect(importers).toEqual([REGISTRY]);
    const violations = output.summary.violations.filter((v) => v.rule.name === 'adr008-06-paid-config-only-registry');
    expect(violations).toEqual([]);
  });
});
