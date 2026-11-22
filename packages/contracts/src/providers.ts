export type Tier = 'free' | 'paid';
export type Capability = 'llm' | 'stt' | 'pronunciation' | 'tts';

export type ProviderErrorKind =
  | 'quota_exhausted' | 'rate_limited' | 'unavailable' | 'timeout'
  | 'auth' | 'region_blocked' | 'invalid_response' | 'not_configured' | 'paid_not_allowed';
