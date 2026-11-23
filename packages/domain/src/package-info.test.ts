import { describe, expect, it } from 'vitest';
import { DOMAIN_PACKAGE_NAME } from './index.ts';

describe('DOMAIN_PACKAGE_NAME', () => {
  it('equals the package name', () => {
    expect(DOMAIN_PACKAGE_NAME).toBe('@english-coach/domain');
  });
});
