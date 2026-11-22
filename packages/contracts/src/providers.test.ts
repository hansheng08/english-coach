import { describe, expectTypeOf, it } from 'vitest';
import type { Capability, ProviderErrorKind, Tier } from './providers';

describe('providers types (ARCHITECTURE §5.2)', () => {
  it('Tier is "free" | "paid"', () => {
    expectTypeOf<Tier>().toEqualTypeOf<'free' | 'paid'>();
  });

  it('Capability is "llm" | "stt" | "pronunciation" | "tts"', () => {
    expectTypeOf<Capability>().toEqualTypeOf<'llm' | 'stt' | 'pronunciation' | 'tts'>();
  });

  it('ProviderErrorKind has exactly the 9 error kinds', () => {
    expectTypeOf<ProviderErrorKind>().toEqualTypeOf<
      | 'quota_exhausted'
      | 'rate_limited'
      | 'unavailable'
      | 'timeout'
      | 'auth'
      | 'region_blocked'
      | 'invalid_response'
      | 'not_configured'
      | 'paid_not_allowed'
    >();
  });
});
