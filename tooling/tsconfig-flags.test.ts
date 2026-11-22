import { describe, expect, it } from 'vitest';
import base from '../tsconfig.base.json';

const REQUIRED = ['strict', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'noImplicitOverride', 'noFallthroughCasesInSwitch'] as const;

describe('tsconfig.base.json (CLAUDE.md §6)', () => {
  for (const flag of REQUIRED) {
    it(`CLAUDE.md §6: ${flag} is true`, () => {
      expect(base.compilerOptions[flag]).toBe(true);
    });
  }
});
