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
  // fixtures 沒有 workspace 連結，用 fixtures 自己的 tsconfig paths 解析 @english-coach/*
  const result = await cruise(['.'], { ...options, baseDir: BASE, validate: true, tsConfig: { fileName: `${BASE}/tsconfig.json` } });
  const output = result.output;
  if (typeof output === 'string') throw new Error('expected object output');
  violations = output.summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
});

const hits = (rule: string, from: string) => violations.filter((v) => v.rule === rule && v.from === from);

interface Case {
  rule: string;
  adr: string;
  bad: string[]; // 違規範例（要被這條規則回報）
  good: string[]; // 合法範例（不得被任何規則回報）
}

// 每條規則：違規範例與合法範例（路徑相對 tooling/fixtures/arch/）
const CASES: Case[] = [
  {
    rule: 'adr008-01-domain-imports-contracts-only',
    adr: '#1',
    bad: ['packages/domain/src/bad.ts'],
    good: ['packages/domain/src/good.ts', 'packages/domain/src/uses-contracts.ts'],
  },
  {
    rule: 'adr008-01t-domain-tests-imports',
    adr: '#1t (rev 1)',
    bad: ['packages/domain/src/bad-zod.test.ts'],
    good: ['packages/domain/src/x.test.ts', 'packages/domain/test/result.ts'],
  },
  {
    rule: 'adr008-02-contracts-imports-zod-only',
    adr: '#2',
    bad: ['packages/contracts/src/bad.ts'],
    good: ['packages/contracts/src/index.ts'],
  },
  {
    rule: 'adr008-02t-contracts-tests-imports',
    adr: '#2t (rev 1)',
    bad: ['packages/contracts/src/bad-domain.test.ts'],
    good: ['packages/contracts/src/x.test.ts'],
  },
  {
    rule: 'adr008-03-features-isolated',
    adr: '#3',
    bad: ['apps/web/src/features/a/bad-feature.ts'],
    good: ['apps/web/src/features/a/good.ts'],
  },
  {
    rule: 'adr008-04-supabase-only-in-api-and-db',
    adr: '#4 (rev 1)',
    bad: [
      'apps/web/src/features/a/bad-supabase.ts',
      'supabase/functions/api/bad-supabase.ts',
      'supabase/functions/_shared/providers/gemini/bad-supabase.ts',
      'supabase/functions/api/bad-npm.ts',
    ],
    good: ['apps/web/src/api/client.ts', 'supabase/functions/_shared/db/client.ts'],
  },
  {
    rule: 'adr008-05-endpoints-via-registry',
    adr: '#5',
    bad: ['supabase/functions/api/bad.ts'],
    good: ['supabase/functions/api/good.ts'],
  },
  {
    rule: 'adr008-06-paid-config-only-registry',
    adr: '#6',
    bad: ['supabase/functions/_shared/providers/gemini/bad-paid.ts'],
    good: ['supabase/functions/_shared/providers/registry.ts'],
  },
  {
    rule: 'adr008-10-no-circular',
    adr: '#10',
    bad: ['packages/domain/src/cycle-a.ts'],
    good: ['packages/domain/src/good.ts'],
  },
  {
    rule: 'adr008-11-no-test-code-in-production',
    adr: '#11 (rev 1)',
    bad: [
      'packages/domain/src/bad-uses-test.ts',
      'apps/web/src/features/noon/bad-uses-test.tsx',
      'packages/domain/src/bad-uses-testing.ts',
    ],
    good: [
      'packages/domain/src/x.test.ts',
      'packages/domain/test/result.ts',
      'apps/web/src/features/noon/x.test.tsx',
      'packages/domain/src/x-testing.test.ts',
    ],
  },
  {
    rule: 'arch31-db-no-providers',
    adr: '(ARCHITECTURE §3.1)',
    bad: ['supabase/functions/_shared/db/bad-provider.ts'],
    good: ['supabase/functions/_shared/db/client.ts'],
  },
  {
    rule: 'adr008-18-adapter-imports-contracts-zod-only',
    adr: '#18 (rev 5)',
    bad: ['supabase/functions/_shared/providers/gemini/client.ts'],
    good: ['supabase/functions/_shared/providers/gemini/good-zod.ts'],
  },
  {
    rule: 'adr008-19-provider-keys-only-wiring',
    adr: '#19 (rev 5)',
    bad: ['supabase/functions/api/router.ts'],
    good: ['supabase/functions/_shared/providers/wiring.ts'],
  },
  {
    rule: 'adr008-20-news-no-providers-no-db',
    adr: '#20 (rev 6)',
    bad: ['supabase/functions/_shared/news/bad-registry.ts', 'supabase/functions/_shared/news/bad-db.ts'],
    good: ['supabase/functions/_shared/news/good-zod.ts', 'supabase/functions/_shared/news/ingest.test.ts'],
  },
];

describe('dependency-cruiser rules (ADR-008, revision 1)', () => {
  it('ADR-008: the config defines exactly the 14 named rules (TC-24: #18, #19 added by T-015; #20 added by T-023)', () => {
    expect(ruleNames).toEqual(CASES.map((c) => c.rule));
  });

  for (const c of CASES) {
    c.bad.forEach((path, i) => {
      const name =
        i === 0
          ? `ADR-008 ${c.adr} ${c.rule}: violating fixture is reported`
          : `ADR-008 ${c.adr} ${c.rule}: violating fixture ${path} is reported`;
      it(name, () => {
        expect(hits(c.rule, path).length).toBeGreaterThan(0);
      });
    });
    c.good.forEach((path, i) => {
      const name =
        i === 0
          ? `ADR-008 ${c.adr} ${c.rule}: legal fixture is not reported`
          : `ADR-008 ${c.adr} ${c.rule}: legal fixture ${path} is not reported`;
      it(name, () => {
        expect(hits(c.rule, path)).toEqual([]);
      });
    });
  }

  it('ADR-008: legal fixtures trigger no rule at all', () => {
    const legal = CASES.flatMap((c) => c.good);
    expect(violations.filter((v) => legal.includes(v.from))).toEqual([]);
  });

  it('(AC-T15-11) (TC-24) ADR-008 rev 5: the four examples (adapter→config, adapter→zod, api→provider-keys, wiring→provider-keys)', () => {
    const adapterDir = 'supabase/functions/_shared/providers/gemini';
    expect(hits('adr008-18-adapter-imports-contracts-zod-only', `${adapterDir}/client.ts`).map((v) => v.to)).toEqual([
      'supabase/functions/_shared/config/env.ts',
    ]);
    expect(violations.filter((v) => v.from === `${adapterDir}/good-zod.ts`)).toEqual([]);
    expect(hits('adr008-19-provider-keys-only-wiring', 'supabase/functions/api/router.ts').length).toBe(1);
    expect(violations.filter((v) => v.from === 'supabase/functions/_shared/providers/wiring.ts')).toEqual([]);
  });

  it('(AC-T23-11) (TC-25) ADR-008 rev 6: the four examples (news→registry, news→db, news→zod, news test→fake provider helper)', () => {
    const news = 'supabase/functions/_shared/news';
    expect(hits('adr008-20-news-no-providers-no-db', `${news}/bad-registry.ts`).map((v) => v.to)).toEqual([
      'supabase/functions/_shared/providers/registry.ts',
    ]);
    expect(hits('adr008-20-news-no-providers-no-db', `${news}/bad-db.ts`).map((v) => v.to)).toEqual([
      'supabase/functions/_shared/db/client.ts',
    ]);
    expect(violations.filter((v) => v.from === `${news}/good-zod.ts`)).toEqual([]);
    expect(violations.filter((v) => v.from === `${news}/ingest.test.ts`)).toEqual([]);
  });

  it('ADR-008 #4 (rev 1): "npm:" specifiers are recorded as the raw string', () => {
    const v = violations.find((x) => x.from === 'supabase/functions/api/bad-npm.ts');
    expect(v?.to).toBe('npm:@supabase/supabase-js@2');
  });
});
