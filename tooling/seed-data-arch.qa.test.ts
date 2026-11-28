// QA probes for T-024 (dependency-cruiser rules for packages/seed-data). Uses the repo fixtures only.
import { beforeAll, describe, expect, it } from 'vitest';
import { cruise } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';
// 靜態 import 設定檔原文：讓 `vitest related .dependency-cruiser.cjs` 會選到這個檔案
import depCruiserSource from '../.dependency-cruiser.cjs?raw';

const BASE = 'tooling/fixtures/arch';
const SRC = 'packages/seed-data/src';

let violations: { rule: string; from: string; to: string }[] = [];
let ruleNames: string[] = [];

beforeAll(async () => {
  const options = await extractDepcruiseOptions('./.dependency-cruiser.cjs');
  ruleNames = (options.ruleSet?.forbidden ?? []).map((r) => r.name ?? '');
  const result = await cruise(['.'], { ...options, baseDir: BASE, validate: true, tsConfig: { fileName: `${BASE}/tsconfig.json` } });
  const output = result.output;
  if (typeof output === 'string') throw new Error('expected object output');
  violations = output.summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
});

const of = (rule: string, file: string) => violations.filter((v) => v.rule === rule && v.from === `${SRC}/${file}`).map((v) => v.to);

describe('QA: seed-data dependency-cruiser rules (T-024)', () => {
  it('(QA-60) the config text and the loaded rule list end with the two seed-data rules, in order, 17 in total', () => {
    expect(depCruiserSource).toContain("name: 'adr018-01-seed-data-imports'");
    expect(ruleNames).toHaveLength(17);
    expect(ruleNames.slice(-2)).toEqual(['adr018-01-seed-data-imports', 'adr018-01t-seed-data-tests-imports']);
  });

  it('(QA-61) production code: fs, node:fs and zod are each flagged exactly once; contracts and domain are not', () => {
    expect(of('adr018-01-seed-data-imports', 'bad-fs.ts')).toHaveLength(1);
    expect(of('adr018-01-seed-data-imports', 'bad-fs-plain.ts')).toHaveLength(1);
    expect(of('adr018-01-seed-data-imports', 'bad-zod.ts')).toEqual(['zod']);
    expect(violations.filter((v) => v.from === `${SRC}/good.ts`)).toEqual([]);
  });

  it('(QA-62) a production-code import is never judged by the test rule, and a test file never by the production rule', () => {
    expect(of('adr018-01t-seed-data-tests-imports', 'bad-zod.ts')).toEqual([]);
    expect(of('adr018-01-seed-data-imports', 'bad-zod.test.ts')).toEqual([]);
    expect(of('adr018-01-seed-data-imports', 'bad-child-process.test.ts')).toEqual([]);
  });

  it('(QA-63) tests: zod and node:child_process are flagged; vitest, fs, node:fs, node:path and node:url (with or without the prefix) are not', () => {
    expect(of('adr018-01t-seed-data-tests-imports', 'bad-zod.test.ts')).toEqual(['zod']);
    expect(of('adr018-01t-seed-data-tests-imports', 'bad-child-process.test.ts')).toHaveLength(1);
    expect(violations.filter((v) => v.from === `${SRC}/x.test.ts`)).toEqual([]);
  });
});
