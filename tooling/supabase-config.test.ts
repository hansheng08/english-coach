import { describe, expect, it } from 'vitest';
import product from '../supabase/config.toml?raw';
import probe from '../.github/ci/supabase-probe/supabase/config.toml?raw';
import envExample from '../supabase/functions/.env.example?raw';
import denoJsonRaw from '../supabase/functions/deno.json?raw';

const lines = (t: string): string[] => t.split('\n').filter((l) => !l.startsWith('#') && !l.startsWith('project_id ='));

describe('supabase config (T-003)', () => {
  it('(AC-T3-1) product config equals the CI probe except project_id and comments', () => {
    const a = lines(product);
    const b = lines(probe);
    expect({
      onlyInProduct: a.filter((l) => !b.includes(l)),
      onlyInProbe: b.filter((l) => !a.includes(l)),
      sameOrder: a.join('\n') === b.join('\n'),
    }).toEqual({ onlyInProduct: [], onlyInProbe: [], sameOrder: true });
    expect(product.split('\n')).toContain('project_id = "english-coach"');
  });

  it('(AC-T3-1) signup is closed and api uses verify_jwt = false with the deno.json import map', () => {
    expect({
      signupOff: /^enable_signup = false$/m.test(product),
      confirmationsOff: /^enable_confirmations = false$/m.test(product),
      apiFunction: /\[functions\.api\]\nverify_jwt = false\nimport_map = "\.\/functions\/deno\.json"/.test(product),
    }).toEqual({ signupOff: true, confirmationsOff: true, apiFunction: true });
  });

  it('(AC-T3-1) deno.json imports match ADR-009', () => {
    const parsed: unknown = JSON.parse(denoJsonRaw);
    expect(parsed).toEqual({
      imports: {
        '@english-coach/contracts': '../../packages/contracts/src/index.ts',
        '@english-coach/domain': '../../packages/domain/src/index.ts',
        zod: 'npm:zod@^4.6.7',
        '@supabase/supabase-js': 'npm:@supabase/supabase-js@^2.119.2',
      },
    });
  });

  it('(AC-T3-1) .env.example lists exactly the six names', () => {
    const entries = envExample
      .split('\n')
      .filter((l) => /^[A-Z]/.test(l))
      .map((l) => {
        const i = l.indexOf('=');
        return { name: l.slice(0, i), value: l.slice(i + 1) };
      });
    expect(entries.map((e) => e.name)).toEqual([
      'GEMINI_API_KEY',
      'GEMINI_PAID_API_KEY',
      'GROQ_API_KEY',
      'AZURE_SPEECH_KEY',
      'AZURE_SPEECH_REGION',
      'APP_ALLOWED_ORIGINS',
    ]);
    expect(entries.slice(0, 5).map((e) => e.value)).toEqual(['', '', '', '', '']);
    expect(entries[5]?.value).toBe('http://localhost:5173');
    expect(envExample.split('\n').filter((l) => l.startsWith('SUPABASE_'))).toEqual([]);
  });
});
